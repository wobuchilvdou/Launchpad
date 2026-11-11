const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

// 单实例锁：必须在 app.whenReady() 之前。第二个实例直接退出，由第一个实例接管。
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.setAppUserModelId('com.launchpad.electron');

// 用户数据统一放在 %APPDATA%\Launchpad，位于代码仓库之外，避免快捷方式等私人信息进入 git 或打包产物。
const DATA_ROOT = process.env.LAUNCHPAD_DATA_DIR || path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Roaming'), 'Launchpad');
const LEGACY_APP_DIR = 'D:\\Desktop\\QuickApps';
const DESKTOP_DIR = process.env.LAUNCHPAD_DESKTOP_DIR || (fs.existsSync('D:\\Desktop') ? 'D:\\Desktop' : path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Desktop'));
const APP_DIR = process.env.LAUNCHPAD_APP_DIR || path.join(DATA_ROOT, 'QuickApps');
const CONFIG_DIR = path.join(DATA_ROOT, 'config');
const ORDER_FILE = path.join(CONFIG_DIR, 'electron-launchpad-order.json');
const STATE_FILE = path.join(CONFIG_DIR, 'electron-launchpad-state.json');
const ICON_DIR = path.join(app.getPath('temp'), 'ReasonixElectronIcons');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v']);
const MAX_ICON_CACHE_FILES = 400;
const ICON_CACHE_VERSION = 'icons-v2-256';
const MAX_WALLPAPERS = 1000;

let mainWindow;
let appCache = [];
let appCacheLoaded = false;
let wallpaperCache = null;
let wallpaperCacheAt = 0;
let scanDiagnostics = { total: 0, valid: 0, invalid: 0, duplicates: 0, appDirectory: APP_DIR };
let windowSaveTimer = null;

function ensureDirectory(directory) { try { fs.mkdirSync(directory, { recursive: true }); return true; } catch { return false; } }
ensureDirectory(CONFIG_DIR);
ensureDirectory(APP_DIR);
ensureDirectory(ICON_DIR);

// 首次运行：把旧位置（桌面 QuickApps）里的快捷方式与配置迁移到新的用户数据目录，成功后删除旧目录。
function migrateLegacyAppDir() {
  if (path.resolve(LEGACY_APP_DIR) === path.resolve(APP_DIR)) return false;
  let entries = [];
  try { entries = fs.readdirSync(LEGACY_APP_DIR, { withFileTypes: true }); } catch { return false; }
  if (!entries.length) { try { fs.rmdirSync(LEGACY_APP_DIR); } catch {} return false; }
  let moved = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = path.join(LEGACY_APP_DIR, entry.name);
    let target = path.join(APP_DIR, entry.name);
    for (let index = 2; fs.existsSync(target); index += 1) target = path.join(APP_DIR, `${path.basename(entry.name, path.extname(entry.name))} (${index})${path.extname(entry.name)}`);
    try {
      fs.renameSync(source, target);
      moved += 1;
    } catch {
      // 跨盘符时 rename 会失败，退化为复制后删除。
      try { fs.copyFileSync(source, target); fs.unlinkSync(source); moved += 1; } catch {}
    }
  }
  const legacyConfig = path.join(LEGACY_APP_DIR, '.config');
  for (const name of ['electron-launchpad-order.json', 'electron-launchpad-state.json']) {
    const source = path.join(legacyConfig, name);
    const destination = path.join(CONFIG_DIR, name);
    if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
    try { fs.copyFileSync(source, destination); } catch {}
  }
  try { fs.rmSync(LEGACY_APP_DIR, { recursive: true, force: true }); } catch {}
  return moved > 0;
}
try { migrateLegacyAppDir(); } catch {}

function normalizeId(value) { return String(value || '').trim().toLocaleLowerCase('en-US'); }
function clamp(value, min, max, fallback) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback; }
function sanitizeIds(value, maximum = 200) { if (!Array.isArray(value)) return []; const seen = new Set(); return value.filter((id) => typeof id === 'string' && id.trim() && id.length <= 500 && !seen.has(normalizeId(id)) && seen.add(normalizeId(id))).slice(0, maximum); }

function isTrustedEvent(event) {
  return Boolean(mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame && event.senderFrame.url === pathToFileURL(path.join(__dirname, 'index.html')).href);
}
function assertTrustedEvent(event) { if (!isTrustedEvent(event)) throw new Error('未经授权的窗口请求。'); }

function runPowerShell(script, payload = {}) {
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Text.UTF8Encoding]::new($false);${script}`], {
    encoding: 'utf8', env: { ...process.env, LAUNCHPAD_PAYLOAD: JSON.stringify(payload) }, maxBuffer: 20 * 1024 * 1024, windowsHide: true,
  });
  if (result.status !== 0) throw new Error((result.stderr || 'PowerShell 操作失败。').trim());
  return result.stdout.trim();
}

function readJson(file, fallback) { try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return value && typeof value === 'object' ? value : fallback; } catch { return fallback; } }
function writeJsonAtomically(file, value) {
  const serialized = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(serialized, 'utf8') > 512 * 1024) throw new Error('配置文件过大，未保存。');
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, serialized, 'utf8');
  try { fs.renameSync(temporary, file); } catch (error) {
    try { fs.copyFileSync(temporary, file); fs.unlinkSync(temporary); } catch { throw error; }
  }
}
function sanitizeWindow(raw) {
  const bounds = raw?.bounds && typeof raw.bounds === 'object' ? raw.bounds : {};
  return {
    bounds: {
      x: clamp(bounds.x, -10000, 10000, 0), y: clamp(bounds.y, -10000, 10000, 0),
      width: clamp(bounds.width, 860, 10000, 1440), height: clamp(bounds.height, 620, 10000, 900),
    },
    maximized: Boolean(raw?.maximized),
  };
}
function sanitizeState(raw) {
  const settings = raw?.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const folders = {};
  for (const [name, ids] of Object.entries(raw?.folders && typeof raw.folders === 'object' ? raw.folders : {}).slice(0, 100)) {
    if (typeof name === 'string' && name.trim() && name.length <= 80) folders[name.trim()] = sanitizeIds(ids, 64);
  }
  return {
    version: 3, recent: sanitizeIds(raw?.recent, 32), pinned: sanitizeIds(raw?.pinned, 64), folders,
    wallpaperId: typeof raw?.wallpaperId === 'string' && raw.wallpaperId.length <= 500 ? raw.wallpaperId : '',
    wallpaperIds: sanitizeIds(raw?.wallpaperIds, 200),
    settings: { opacity: clamp(settings.opacity, 70, 100, 92), iconSize: clamp(settings.iconSize, 52, 96, 72), columns: clamp(settings.columns, 6, 14, 10), wallpaperBrightness: clamp(settings.wallpaperBrightness, 45, 140, 100), wallpaperMode: settings.wallpaperMode === 'custom' ? 'custom' : 'desktop', appearance: settings.appearance === 'glass' ? 'glass' : 'wallpaper', glassCard: settings.glassCard === 'card' ? 'card' : 'plain', glassIntensity: clamp(settings.glassIntensity, 30, 100, 100), launchAtLogin: Boolean(settings.launchAtLogin) },
    window: sanitizeWindow(raw?.window),
  };
}
function loadState() {
  const raw = readJson(STATE_FILE, {});
  const state = sanitizeState(raw);
  if (fs.existsSync(STATE_FILE) && raw?.version !== state.version) { try { writeJsonAtomically(STATE_FILE, state); } catch {} }
  return state;
}
function saveState(update) {
  const current = loadState();
  const input = update && typeof update === 'object' ? update : {};
  const next = sanitizeState({ ...current, ...input, settings: { ...current.settings, ...(input.settings || {}) }, folders: input.folders || current.folders });
  writeJsonAtomically(STATE_FILE, next);
  return next;
}
function cleanStateForApps(apps) {
  const current = loadState();
  const available = new Set(apps.map((item) => normalizeId(item.id)));
  const recent = current.recent.filter((id) => available.has(normalizeId(id)));
  const pinned = current.pinned.filter((id) => available.has(normalizeId(id)));
  const folders = Object.fromEntries(Object.entries(current.folders).map(([name, ids]) => [name, ids.filter((id) => available.has(normalizeId(id)))]).filter(([, ids]) => ids.length));
  if (JSON.stringify({ recent, pinned, folders }) === JSON.stringify({ recent: current.recent, pinned: current.pinned, folders: current.folders })) return current;
  return saveState({ recent, pinned, folders });
}

function iconPathFor(shortcut, target) {
  let targetStamp = ''; let shortcutStamp = '';
  try { targetStamp = fs.statSync(target).mtimeMs.toString(); } catch {}
  try { shortcutStamp = fs.statSync(shortcut).mtimeMs.toString(); } catch {}
  const hash = crypto.createHash('sha1').update(`${shortcut}|${target}|${targetStamp}|${shortcutStamp}|${ICON_CACHE_VERSION}`).digest('hex');
  return path.join(ICON_DIR, `icon-${hash}.png`);
}
function cleanupIconCache() {
  try {
    const files = fs.readdirSync(ICON_DIR).map((name) => ({ file: path.join(ICON_DIR, name), stat: fs.statSync(path.join(ICON_DIR, name)) })).filter((item) => item.stat.isFile()).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    files.slice(MAX_ICON_CACHE_FILES).forEach((item) => fs.unlinkSync(item.file));
  } catch {}
}
function extractIcons(items) {
  if (!ensureDirectory(ICON_DIR)) return;
  const missing = items.filter((item) => !fs.existsSync(item.iconPath));
  if (!missing.length) return;
  const script = `$items=$env:LAUNCHPAD_PAYLOAD|ConvertFrom-Json;Add-Type -AssemblyName System.Drawing;$q=[char]34;$sig='using System;using System.Runtime.InteropServices;public class IconEx{[DllImport(~user32.dll~,CharSet=CharSet.Unicode)]public static extern int PrivateExtractIcons(string lpszFile,int nIconIndex,int cxIcon,int cyIcon,IntPtr[] phicon,uint[] piconid,uint nIcons,uint flags);[DllImport(~user32.dll~)]public static extern bool DestroyIcon(IntPtr hIcon);}'.Replace('~',$q);Add-Type -TypeDefinition $sig -ReferencedAssemblies System.Drawing;foreach($item in $items){$done=$false;foreach($size in 256,48,32){if($done){continue};$h=New-Object IntPtr[] 1;$iconId=New-Object uint32[] 1;try{$n=[IconEx]::PrivateExtractIcons($item.target,0,$size,$size,$h,$iconId,1,0)}catch{$n=0};if($n -gt 0 -and $h[0] -ne [IntPtr]::Zero){$tmp=$item.output+'.tmp';try{$ico=[System.Drawing.Icon]::FromHandle($h[0]);$bmp=$ico.ToBitmap();$bmp.Save($tmp,[Drawing.Imaging.ImageFormat]::Png);$bmp.Dispose();$ico.Dispose();Move-Item -LiteralPath $tmp -Destination $item.output -Force;$done=$true}catch{Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue};[void][IconEx]::DestroyIcon($h[0])}};if(-not $done){$ico=$null;try{$ico=[Drawing.Icon]::ExtractAssociatedIcon($item.shortcut)}catch{};if($ico){$tmp=$item.output+'.tmp';try{$bmp=$ico.ToBitmap();$bmp.Save($tmp,[Drawing.Imaging.ImageFormat]::Png);$bmp.Dispose();Move-Item -LiteralPath $tmp -Destination $item.output -Force;$done=$true}catch{Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue};$ico.Dispose()}}}`;
  try { runPowerShell(script, missing.map((item) => ({ shortcut: item.file, target: item.target, output: item.iconPath }))); } catch {}
  cleanupIconCache();
}
function readUrlShortcut(file) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(/^URL=(.+)$/im);
    return match ? { id: path.basename(file), target: match[1].trim(), args: '', cwd: '' } : null;
  } catch { return null; }
}
function readShortcutMetadata() {
  const script = `$payload=$env:LAUNCHPAD_PAYLOAD|ConvertFrom-Json;$shell=New-Object -ComObject WScript.Shell;$items=@();Get-ChildItem -LiteralPath $payload.appDir -Filter '*.lnk' -File|ForEach-Object{if($_.Name -ieq 'AppLauncher.lnk'){return};try{$shortcut=$shell.CreateShortcut($_.FullName);$items+=[PSCustomObject]@{id=$_.Name;target=$shortcut.TargetPath;args=$shortcut.Arguments;cwd=$shortcut.WorkingDirectory}}catch{}};$items|ConvertTo-Json -Compress -Depth 3`;
  const parsed = JSON.parse(runPowerShell(script, { appDir: APP_DIR }) || '[]');
  const shortcuts = Array.isArray(parsed) ? parsed : [parsed];
  let urlFiles = [];
  try { urlFiles = fs.readdirSync(APP_DIR, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.url')).map((entry) => readUrlShortcut(path.join(APP_DIR, entry.name))).filter(Boolean); } catch {}
  return shortcuts.concat(urlFiles);
}
function isLaunchableTarget(target) {
  if (!target) return false;
  if (/^https?:\/\//i.test(target)) return true;
  try { return fs.statSync(target).isFile(); } catch { return false; }
}
function readLnkTargets(directory) {
  const script = `$payload=$env:LAUNCHPAD_PAYLOAD|ConvertFrom-Json;$shell=New-Object -ComObject WScript.Shell;$items=@();Get-ChildItem -LiteralPath $payload.dir -Filter '*.lnk' -File|ForEach-Object{try{$items+=[PSCustomObject]@{id=$_.Name;target=$shell.CreateShortcut($_.FullName).TargetPath}}catch{}};$items|ConvertTo-Json -Compress -Depth 2`;
  const parsed = JSON.parse(runPowerShell(script, { dir: directory }) || '[]');
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const targets = new Map();
  for (const item of list) { if (item && typeof item.id === 'string') targets.set(item.id, typeof item.target === 'string' ? item.target.trim() : ''); }
  return targets;
}
function readApps() {
  let metadata = [];
  try { metadata = readShortcutMetadata(); } catch {}
  const apps = [];
  const seenTargets = new Set();
  let invalid = 0; let duplicates = 0;
  const total = metadata.filter(Boolean).length;
  for (const item of metadata) {
    if (!item || typeof item.id !== 'string' || path.basename(item.id) !== item.id || !/\.(lnk|url)$/i.test(item.id)) { invalid += 1; continue; }
    const file = path.join(APP_DIR, item.id); if (!fs.existsSync(file)) { invalid += 1; continue; }
    const target = typeof item.target === 'string' ? item.target.trim() : '';
    if (!isLaunchableTarget(target)) { invalid += 1; continue; }
    const targetKey = `${normalizeId(target)}\n${String(item.args || '').trim()}`;
    if (seenTargets.has(targetKey)) { duplicates += 1; continue; }
    seenTargets.add(targetKey);
    let shortcutStamp = 0;
    try { shortcutStamp = fs.statSync(file).mtimeMs; } catch { continue; }
    const iconPath = iconPathFor(file, target);
    apps.push({ id: item.id, file, name: path.basename(item.id, path.extname(item.id)), target, args: typeof item.args === 'string' ? item.args.slice(0, 4096) : '', cwd: typeof item.cwd === 'string' ? item.cwd.slice(0, 1024) : '', shortcutStamp, iconPath, icon: null });
  }
  extractIcons(apps);
  for (const item of apps) { try { item.icon = fs.existsSync(item.iconPath) ? `data:image/png;base64,${fs.readFileSync(item.iconPath).toString('base64')}` : null; } catch {} delete item.iconPath; }
  const rank = new Map(sanitizeIds(readJson(ORDER_FILE, []), 5000).map((id, index) => [normalizeId(id), index]));
  apps.sort((a, b) => (rank.get(normalizeId(a.id)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(normalizeId(b.id)) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, 'zh-CN'));
  appCache = apps; appCacheLoaded = true; scanDiagnostics = { total, valid: apps.length, invalid, duplicates, appDirectory: APP_DIR }; cleanStateForApps(apps); return apps;
}
function saveOrder(ids) {
  const available = new Map(appCache.map((item) => [normalizeId(item.id), item.id]));
  const order = [];
  for (const id of sanitizeIds(ids, 5000)) { const actual = available.get(normalizeId(id)); if (actual && !order.some((saved) => normalizeId(saved) === normalizeId(actual))) order.push(actual); }
  for (const item of appCache) if (!order.some((saved) => normalizeId(saved) === normalizeId(item.id))) order.push(item.id);
  writeJsonAtomically(ORDER_FILE, order); return order;
}
function resolveVisibleApp(id) {
  if (typeof id !== 'string' || path.basename(id) !== id || !/\.(lnk|url)$/i.test(id)) throw new Error('无效的应用快捷方式。');
  if (!appCacheLoaded) readApps();
  const item = appCache.find((candidate) => normalizeId(candidate.id) === normalizeId(id));
  if (!item || !fs.existsSync(item.file) || fs.statSync(item.file).mtimeMs !== item.shortcutStamp) throw new Error('快捷方式已经变化，请先刷新应用列表。');
  return item;
}

function desktopWallpaper() {
  const themeDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes');
  const candidates = [];
  try { const configured = runPowerShell("(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop').WallPaper"); if (configured) candidates.push(configured); } catch {}
  candidates.push(path.join(themeDir, 'WallpaperEngineOverride.jpg'), path.join(themeDir, 'WallpaperEngineLockOverride.jpg'));
  candidates.push(path.join(themeDir, 'TranscodedWallpaper'));
  for (const file of candidates) { try { if (fs.statSync(file).isFile() && fs.statSync(file).size > 0) return pathToFileURL(file).href; } catch {} }
  return null;
}
function steamLibraryRoots() {
  const roots = [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')];
  for (const [registry, property] of [['HKCU:\\Software\\Valve\\Steam', 'SteamPath'], ['HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath']]) { try { const installed = runPowerShell(`(Get-ItemProperty -Path '${registry}').${property}`); if (installed) roots.push(installed); } catch {} }
  for (const root of [...roots]) { try { const content = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'); for (const match of content.matchAll(/"path"\s+"([^"]+)"/g)) roots.push(match[1].replace(/\\\\/g, '\\')); } catch {} }
  return [...new Set(roots.map((root) => path.resolve(root)))];
}
function findWallpaperMedia(folder) {
  const images = []; const videos = []; let hasScenePackage = false; let hasWebEntry = false;
  const visit = (directory, depth) => {
    let entries = []; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name); const extension = path.extname(entry.name).toLowerCase();
      if (entry.isDirectory() && depth < 4) visit(file, depth + 1);
      if (!entry.isFile()) continue;
      if (entry.name.toLowerCase() === 'scene.pkg') hasScenePackage = true;
      if (depth === 0 && entry.name.toLowerCase() === 'index.html') hasWebEntry = true;
      if (/preview|thumb/i.test(entry.name)) continue;
      if (IMAGE_EXTENSIONS.has(extension)) images.push(file);
      if (VIDEO_EXTENSIONS.has(extension)) videos.push(file);
    }
  };
  visit(folder, 0);
  const largest = (files) => files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0] || null;
  if (hasWebEntry) return { type: 'web', file: path.join(folder, 'index.html'), available: true };
  const image = largest(images); if (image) return { type: 'image', file: image, available: true };
  const video = largest(videos); if (video) return { type: 'video', file: video, available: true };
  if (hasScenePackage) return { type: 'scene', available: false, reason: '这是 Wallpaper Engine 的 scene.pkg 场景壁纸，只能由 Wallpaper Engine 渲染。请在 Wallpaper Engine 中设为桌面壁纸后使用“跟随系统桌面壁纸”。' };
  return { type: 'unsupported', available: false, reason: '未找到可直接使用的原始图片、视频或 Web 壁纸资源。' };
}
async function wallpaperLibrary(force = false) {
  if (!force && wallpaperCache && Date.now() - wallpaperCacheAt < 30000) return wallpaperCache;
  const items = [];
  let scanned = 0;
  for (const steamRoot of steamLibraryRoots()) {
    const contentDir = path.join(steamRoot, 'steamapps', 'workshop', 'content', '431960'); let directories = [];
    try { directories = fs.readdirSync(contentDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()); } catch { continue; }
    for (const directory of directories) {
      const folder = path.join(contentDir, directory.name); const media = findWallpaperMedia(folder); let name = `Wallpaper ${directory.name}`;
      const project = readJson(path.join(folder, 'project.json'), {}); name = String(project.title || project.general?.title || name).replace(/[\r\n]+/g, ' ').slice(0, 120);
      items.push({ id: folder, name, mediaType: media.type, available: media.available, reason: media.reason || '', source: media.file ? pathToFileURL(media.file).href : '' });
      scanned += 1;
      if (scanned % 20 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
  }
  const unique = new Map(); for (const item of items) { const key = normalizeId(item.name); if (!unique.has(key) || (item.available && !unique.get(key).available)) unique.set(key, item); }
  wallpaperCache = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).slice(0, MAX_WALLPAPERS);
  wallpaperCacheAt = Date.now();
  return wallpaperCache;
}

function createWindow() {
  const savedWindow = loadState().window;
  mainWindow = new BrowserWindow({ ...savedWindow.bounds, width: savedWindow.bounds.width, height: savedWindow.bounds.height, minWidth: 860, minHeight: 620, show: false, backgroundColor: '#0b1020', autoHideMenuBar: true, title: 'Launchpad', icon: path.join(__dirname, 'assets', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false } });
  const localUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== localUrl) event.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const saveWindowNow = () => {
    clearTimeout(windowSaveTimer); windowSaveTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    try { saveState({ window: { bounds, maximized: mainWindow.isMaximized() } }); } catch (error) { console.warn(`保存窗口位置失败：${error.message}`); }
  };
  const saveWindow = () => { clearTimeout(windowSaveTimer); windowSaveTimer = setTimeout(saveWindowNow, 250); };
  mainWindow.on('resize', saveWindow); mainWindow.on('move', saveWindow); mainWindow.on('close', saveWindowNow);
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.once('ready-to-show', () => { mainWindow.maximize(); mainWindow.show(); });
}

ipcMain.handle('apps:list', (event) => { assertTrustedEvent(event); const apps = appCacheLoaded ? appCache : readApps(); return { apps, state: loadState(), diagnostics: scanDiagnostics }; });
ipcMain.handle('apps:refresh', (event) => { assertTrustedEvent(event); return readApps(); });
ipcMain.handle('apps:order', (event, ids) => { assertTrustedEvent(event); if (!appCacheLoaded) readApps(); const order = saveOrder(ids); const rank = new Map(order.map((id, index) => [normalizeId(id), index])); appCache.sort((a, b) => (rank.get(normalizeId(a.id)) ?? 0) - (rank.get(normalizeId(b.id)) ?? 0)); return true; });
ipcMain.handle('state:save', (event, state) => { assertTrustedEvent(event); return saveState(state); });
ipcMain.handle('apps:diagnostics', (event) => { assertTrustedEvent(event); return scanDiagnostics; });
ipcMain.handle('app:launch', (event, id) => { assertTrustedEvent(event); const item = resolveVisibleApp(id); runPowerShell(`$payload=$env:LAUNCHPAD_PAYLOAD|ConvertFrom-Json;$shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($payload.file);$target=$shortcut.TargetPath;if(-not ($target -match '^https?://' -or (Test-Path -LiteralPath $target -PathType Leaf))){throw '目标程序不存在。'};$params=@{FilePath=$target};if($shortcut.Arguments){$params.ArgumentList=$shortcut.Arguments};if($shortcut.WorkingDirectory -and (Test-Path -LiteralPath $shortcut.WorkingDirectory -PathType Container)){$params.WorkingDirectory=$shortcut.WorkingDirectory};Start-Process @params`, { file: item.file }); return true; });
ipcMain.handle('app:recycle', (event, id) => { assertTrustedEvent(event); const item = resolveVisibleApp(id); runPowerShell(`$payload=$env:LAUNCHPAD_PAYLOAD|ConvertFrom-Json;Add-Type -AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($payload.file,'OnlyErrorDialogs','SendToRecycleBin')`, { file: item.file }); appCache = appCache.filter((appItem) => normalizeId(appItem.id) !== normalizeId(item.id)); return true; });
ipcMain.handle('desktop:sync', (event) => { assertTrustedEvent(event); let moved = 0; let failed = 0; let skipped = 0; let targets = new Map(); try { targets = readLnkTargets(DESKTOP_DIR); } catch { return { moved, failed, skipped }; } for (const entry of fs.readdirSync(DESKTOP_DIR, { withFileTypes: true })) { if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.lnk') || /^(applauncher|launchpad|reasonixlaunchpad)/i.test(path.basename(entry.name, '.lnk'))) continue; if (!isLaunchableTarget(targets.get(entry.name))) { skipped += 1; continue; } try { const source = path.join(DESKTOP_DIR, entry.name); let target = path.join(APP_DIR, entry.name); for (let index = 2; fs.existsSync(target); index += 1) target = path.join(APP_DIR, `${path.basename(entry.name, '.lnk')} (${index}).lnk`); fs.renameSync(source, target); moved += 1; } catch { failed += 1; } } appCacheLoaded = false; return { moved, failed, skipped }; });
ipcMain.handle('wallpaper:desktop', (event) => { assertTrustedEvent(event); return desktopWallpaper(); });
ipcMain.handle('wallpaper:list', (event, force) => { assertTrustedEvent(event); return wallpaperLibrary(Boolean(force)); });
ipcMain.handle('settings:login-item', (event, options) => {
  assertTrustedEvent(event);
  if (!app.isPackaged) return { enabled: false, available: false };
  if (options && typeof options === 'object' && typeof options.enabled === 'boolean') {
    app.setLoginItemSettings({ openAtLogin: options.enabled, path: process.execPath, args: [] });
  }
  return { enabled: Boolean(app.getLoginItemSettings().openAtLogin), available: true };
});
ipcMain.handle('window:minimize', (event) => { assertTrustedEvent(event); mainWindow.minimize(); });
ipcMain.handle('window:close', (event) => { assertTrustedEvent(event); mainWindow.close(); });

app.on('second-instance', () => {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else { mainWindow.show(); mainWindow.focus(); }
  });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
