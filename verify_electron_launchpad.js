const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, 'LaunchpadElectron');
const read = (file) => fs.readFileSync(file, 'utf8');
const compact = (text) => String(text).replace(/\s+/g, '');
const has = (text, needle) => compact(text).includes(compact(needle));

const main = read(path.join(root, 'main.js'));
const preload = read(path.join(root, 'preload.js'));
const renderer = read(path.join(root, 'renderer.js'));
const style = read(path.join(root, 'style.css'));
const index = read(path.join(root, 'index.html'));

const packagedRoot = path.join(root, 'dist', 'Launchpad-win32-x64', 'resources', 'app');
const exe = path.join(root, 'dist', 'Launchpad-win32-x64', 'Launchpad.exe');
const packagedMain = read(path.join(packagedRoot, 'main.js'));
const packagedPreload = read(path.join(packagedRoot, 'preload.js'));
const packagedRenderer = read(path.join(packagedRoot, 'renderer.js'));
const packagedStyle = read(path.join(packagedRoot, 'style.css'));
const packagedIndex = read(path.join(packagedRoot, 'index.html'));

const checks = [];
const check = (name, value) => checks.push({ name, value: Boolean(value) });

const channels = [
  'apps:list', 'apps:refresh', 'apps:order', 'state:save', 'apps:diagnostics',
  'app:launch', 'app:recycle', 'desktop:sync', 'wallpaper:desktop',
  'wallpaper:list', 'window:minimize', 'window:close',
];
const preloadApi = [
  ['listApps', 'apps:list'], ['refreshApps', 'apps:refresh'], ['getAppDiagnostics', 'apps:diagnostics'],
  ['saveState', 'state:save'], ['saveOrder', 'apps:order'], ['launchApp', 'app:launch'],
  ['recycleApp', 'app:recycle'], ['syncDesktop', 'desktop:sync'],
  ['getDesktopWallpaper', 'wallpaper:desktop'], ['listWallpapers', 'wallpaper:list'],
  ['minimize', 'window:minimize'], ['close', 'window:close'],
];

// Main process: window hardening and trust checks.
check('main: BrowserWindow', has(main, 'BrowserWindow'));
check('main: contextIsolation', has(main, 'contextIsolation: true'));
check('main: nodeIntegration', has(main, 'nodeIntegration: false'));
check('main: sandbox', has(main, 'sandbox: true'));
check('main: webviewTag', has(main, 'webviewTag: false'));
check('main: isTrustedEvent', has(main, 'isTrustedEvent'));
check('main: assertTrustedEvent', has(main, 'assertTrustedEvent'));
check('main: assert on every IPC handler', (compact(main).match(/assertTrustedEvent\(event\);/g) || []).length >= channels.length);
check('main: trusted sender frame URL', has(main, 'event.senderFrame.url'));
check('main: local navigation guard', has(main, 'will-navigate'));
check('main: deny window.open', has(main, 'setWindowOpenHandler'));

// Main process: core app behavior.
check('main: SendToRecycleBin', has(main, 'SendToRecycleBin'));
check('main: QuickApps', has(main, 'QuickApps'));
check('main: http URL guard', has(main, '^https?:'));
check('main: shortcutStamp', has(main, 'shortcutStamp'));
check('main: writeJsonAtomically', has(main, 'writeJsonAtomically'));
check('main: appData wallpaper lookup', has(main, "app.getPath('appData')"));
check('main: WallpaperEngineOverride', has(main, 'WallpaperEngineOverride'));
check('main: findWallpaperMedia', has(main, 'findWallpaperMedia'));
check('main: wallpaperLibrary', has(main, 'wallpaperLibrary'));
for (const channel of channels) check(`main: ipc ${channel}`, has(main, `ipcMain.handle('${channel}'`));

// Preload: narrow contextBridge API.
check('preload: contextBridge', has(preload, "contextBridge.exposeInMainWorld('launchpad'"));
for (const [api, channel] of preloadApi) {
  check(`preload: ${api} -> ${channel}`, has(preload, `invoke('${channel}'`));
}

// Renderer: app interactions.
for (const [api] of preloadApi) check(`renderer: window.launchpad.${api}`, has(renderer, `window.launchpad.${api}(`));
check('renderer: state.edit', has(renderer, 'card.draggable = state.edit'));
check('renderer: app name label', has(renderer, 'label.textContent = appItem.name'));
check('renderer: order persistence', has(renderer, 'window.launchpad.saveOrder'));
check('renderer: recycle action', has(renderer, 'window.launchpad.recycleApp'));
check('renderer: page metrics', has(renderer, 'pageMetrics'));
check('renderer: page label', has(renderer, "$('pageLabel')"));
check('renderer: page columns', has(renderer, 'const columns ='));
check('renderer: page rows', has(renderer, 'const rows ='));

// Renderer: wallpaper behavior is enabled.
check('renderer: applyWallpaper', has(renderer, 'async function applyWallpaper'));
check('renderer: renderWallpapers', has(renderer, 'function renderWallpapers'));
check('renderer: scanWallpapers', has(renderer, 'async function scanWallpapers'));
check('renderer: stopWallpaperMedia', has(renderer, 'function stopWallpaperMedia'));
check('renderer: wallpaperMode', has(renderer, "state.settings.wallpaperMode"));
check('renderer: wallpaperSelect listener', has(renderer, "$('wallpaperSelect').addEventListener"));
check('renderer: refreshWallpapers listener', has(renderer, "$('refreshWallpapers').addEventListener"));
check('renderer: refreshDesktopWallpaper listener', has(renderer, "$('refreshDesktopWallpaper').addEventListener"));
check('renderer: saveWallpaperLibrary listener', has(renderer, "$('saveWallpaperLibrary').addEventListener"));
check('renderer: wallpaperImage layer', has(renderer, "$('wallpaperImage')"));
check('renderer: wallpaperVideo layer', has(renderer, "$('wallpaperVideo')"));
check('renderer: wallpaperWeb layer', has(renderer, "$('wallpaperWeb')"));

// HTML: CSP, wallpaper layer and key controls.
check('index: CSP meta', has(index, 'http-equiv="Content-Security-Policy"'));
check('index: CSP default-src', has(index, "default-src 'self'"));
check('index: CSP script-src', has(index, "script-src 'self'"));
check('index: CSP img-src', has(index, "img-src 'self' data: file:"));
check('index: CSP media-src', has(index, "media-src 'self' file:"));
check('index: CSP frame-src', has(index, "frame-src file:"));
check('index: wallpaper layer', has(index, 'id="wallpaper"'));
check('index: wallpaperImage', has(index, 'id="wallpaperImage"'));
check('index: wallpaperVideo', has(index, 'id="wallpaperVideo"'));
check('index: wallpaperWeb', has(index, 'id="wallpaperWeb"'));
check('index: wallpaperMode', has(index, 'id="wallpaperMode"'));
check('index: wallpaperSelect', has(index, 'id="wallpaperSelect"'));
check('index: wallpaperPicker', has(index, 'id="wallpaperPicker"'));
check('index: wallpaperLibraryPicker', has(index, 'id="wallpaperLibraryPicker"'));
check('index: saveWallpaperLibrary', has(index, 'id="saveWallpaperLibrary"'));
check('index: refreshWallpapers', has(index, 'id="refreshWallpapers"'));
check('index: refreshDesktopWallpaper', has(index, 'id="refreshDesktopWallpaper"'));
check('index: wallpaperStatus', has(index, 'id="wallpaperStatus"'));
check('index: wallpaperBrightness', has(index, 'id="wallpaperBrightness"'));
check('index: renderer script', has(index, 'src="renderer.js"'));

// CSS: wallpaper layers must actually be visible behind the UI.
check('style: wallpaper layer', has(style, '#wallpaper { position: fixed; inset: 0; z-index: 0;'));
check('style: wallpaper media layers', has(style, '#wallpaperImage, #wallpaperVideo, #wallpaperWeb { position: absolute;'));
check('style: image contain', has(style, 'background-size: contain'));
check('style: image no-repeat', has(style, 'background-repeat: no-repeat'));
check('style: cover variant', has(style, '.wallpaper-cover { background-size: cover; }'));
check('style: video object-fit', has(style, 'object-fit: contain'));
check('style: brightness filter', has(style, 'filter: brightness(var(--wallpaper-brightness))'));
check('style: hidden layers', has(style, '#wallpaperImage[hidden], #wallpaperVideo[hidden], #wallpaperWeb[hidden] { display: none; }'));

// Packaged app: must exist and match the source (whitespace-insensitive).
check('dist: exe exists', fs.existsSync(exe));
check('dist: packaged app exists', fs.existsSync(packagedRoot));
check('dist: main matches source', compact(packagedMain) === compact(main));
check('dist: preload matches source', compact(packagedPreload) === compact(preload));
check('dist: renderer matches source', compact(packagedRenderer) === compact(renderer));
check('dist: style matches source', compact(packagedStyle) === compact(style));
check('dist: index matches source', compact(packagedIndex) === compact(index));

const failed = checks.filter((item) => !item.value).map((item) => item.name);
if (failed.length) throw Error(`Electron checks failed: ${failed.join(', ')}`);
console.log('ELECTRON_LAUNCHPAD_CHECK_OK');
console.log('EXE_BYTES=' + fs.statSync(exe).size);
