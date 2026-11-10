// 静态一致性检查：不依赖 dist，全部基于源码动态提取。
// 任何一项失败即以非零退出码结束。
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, 'LaunchpadElectron');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const compact = (text) => String(text).replace(/\s+/g, '');
const has = (text, needle) => compact(text).includes(compact(needle));

const main = read('main.js');
const preload = read('preload.js');
const renderer = read('renderer.js');
const style = read('style.css');
const index = read('index.html');

const checks = [];
const check = (name, value) => checks.push({ name, value: Boolean(value) });

// ---- 动态提取：IPC 通道集合 ----
const mainChannels = new Set(
  [...main.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1])
);
const preloadChannels = new Set(
  [...preload.matchAll(/invoke\(\s*'([^']+)'/g)].map((m) => m[1])
);

const mainOnly = [...mainChannels].filter((c) => !preloadChannels.has(c)).sort();
const preloadOnly = [...preloadChannels].filter((c) => !mainChannels.has(c)).sort();
check('ipc: main 与 preload 通道集合一致', mainOnly.length === 0 && preloadOnly.length === 0);
check('ipc: main 至少声明了一个通道', mainChannels.size > 0);
if (mainOnly.length || preloadOnly.length) {
  console.log('IPC_CHANNEL_MISMATCH');
  if (mainOnly.length) console.log('  仅 main.js 有: ' + mainOnly.join(', '));
  if (preloadOnly.length) console.log('  仅 preload.js 有: ' + preloadOnly.join(', '));
}

// ---- 动态提取：renderer $('id') 与 index.html id="..." ----
const rendererIds = new Set(
  [...renderer.matchAll(/\$\(\s*'([^']+)'\s*\)/g)].map((m) => m[1])
);
const htmlIds = new Set(
  [...index.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
);
const missingIds = [...rendererIds].filter((id) => !htmlIds.has(id)).sort();
check('dom: renderer 引用的 id 都存在于 index.html', missingIds.length === 0);
check('dom: renderer 至少引用了一个元素', rendererIds.size > 0);
if (missingIds.length) {
  console.log('MISSING_DOM_IDS: ' + missingIds.join(', '));
}

// ---- renderer 禁用项 ----
check('renderer: 不使用 window.prompt', !renderer.includes('window.prompt') && !/\bprompt\s*\(/.test(renderer));
check('renderer: 不使用 innerHTML', !renderer.includes('innerHTML'));

// ---- main.js 必需标识符 ----
for (const needle of [
  'contextIsolation: true',
  'nodeIntegration: false',
  'sandbox: true',
  'webviewTag: false',
  'isTrustedEvent',
  'assertTrustedEvent',
  'will-navigate',
  'setWindowOpenHandler',
  'writeJsonAtomically',
  'SendToRecycleBin',
  '^https?:',
  'shortcutStamp',
  'requestSingleInstanceLock',
  'setLoginItemSettings',
]) {
  check(`main: ${needle}`, has(main, needle));
}

// ---- 桌面同步必须复用「可启动目标」判定，不能只看扩展名 ----
check('main: 定义 isLaunchableTarget', has(main, 'function isLaunchableTarget(target)'));
check('main: readApps 复用 isLaunchableTarget', has(main, 'if (!isLaunchableTarget(target)) { invalid += 1; continue; }'));
check('main: desktop:sync 复用 isLaunchableTarget', has(main, 'if (!isLaunchableTarget(targets.get(entry.name))) { skipped += 1; continue; }'));
check('main: desktop:sync 通过 readLnkTargets 读取目标', has(main, 'targets = readLnkTargets(DESKTOP_DIR)'));
check('renderer: 同步提示包含跳过数', has(renderer, 'result.skipped'));

// ---- 常驻后台能力必须为空：关闭即退出，不保留托盘/全局热键 ----
for (const needle of ['Tray', 'globalShortcut', 'nativeImage', 'displayBalloon']) {
  check(`main: 不包含 ${needle}（关闭即退出）`, !has(main, needle));
}
check('main: 关闭窗口直接退出', has(main, "app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); })"));
check('main: 默认最大化', has(main, 'mainWindow.maximize()'));

// ---- 入站通道必须全部校验来源 ----
const handleCount = mainChannels.size;
const assertCount = (compact(main).match(/assertTrustedEvent\(event\);/g) || []).length;
check('main: 每个入站通道都有 assertTrustedEvent', handleCount > 0 && assertCount === handleCount);

// ---- CSP ----
check('index: CSP meta', has(index, 'http-equiv="Content-Security-Policy"'));
check('index: CSP default-src', has(index, "default-src 'self'"));
check('index: CSP script-src', has(index, "script-src 'self'"));

// ---- 壁纸相关（保留原有断言） ----
check('main: findWallpaperMedia', has(main, 'findWallpaperMedia'));
check('main: wallpaperLibrary', has(main, 'wallpaperLibrary'));
check('main: WallpaperEngineOverride', has(main, 'WallpaperEngineOverride'));
check('main: appData wallpaper lookup', has(main, "app.getPath('appData')"));
check('renderer: applyWallpaper', has(renderer, 'async function applyWallpaper'));
check('renderer: renderWallpapers', has(renderer, 'function renderWallpapers'));
check('renderer: scanWallpapers', has(renderer, 'async function scanWallpapers'));
check('renderer: stopWallpaperMedia', has(renderer, 'function stopWallpaperMedia'));
check('renderer: wallpaperMode', has(renderer, 'state.settings.wallpaperMode'));
check('index: wallpaper layer', has(index, 'id="wallpaper"'));
check('index: wallpaperImage', has(index, 'id="wallpaperImage"'));
check('index: wallpaperVideo', has(index, 'id="wallpaperVideo"'));
check('index: wallpaperWeb', has(index, 'id="wallpaperWeb"'));
check('index: wallpaperMode', has(index, 'id="wallpaperMode"'));
check('style: wallpaper layer', has(style, '#wallpaper { position: fixed; inset: 0; z-index: 0;'));
check('style: wallpaper media layers', has(style, '#wallpaperImage, #wallpaperVideo, #wallpaperWeb { position: absolute;'));
check('style: brightness filter', has(style, 'filter: brightness(var(--wallpaper-brightness))'));
check('style: hidden layers', has(style, '#wallpaperImage[hidden], #wallpaperVideo[hidden], #wallpaperWeb[hidden] { display: none; }'));

// ---- 汇总 ----
const failed = checks.filter((c) => !c.value).map((c) => c.name);
console.log(`SOURCE_CHECKS: ${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.error('FAILED_CHECKS:');
  for (const name of failed) console.error('  ✗ ' + name);
  process.exitCode = 1;
} else {
  console.log('VERIFY_SOURCE_OK');
}
