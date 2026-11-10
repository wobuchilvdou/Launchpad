const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const html = read('index.html');

assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /sandbox:\s*true/);
assert.match(main, /scene\.pkg/);
assert.match(main, /libraryfolders\.vdf/);
assert.match(main, /writeJsonAtomically/);
assert.match(main, /\.url/);
assert.match(main, /version: 3/);
assert.match(main, /sanitizeWindow/);
assert.match(main, /apps:diagnostics/);
assert.match(preload, /listWallpapers: \(force = false\)/);
assert.match(preload, /getAppDiagnostics/);
for (const id of ['wallpaperBrightness', 'wallpaperLibraryPicker', 'saveWallpaperLibrary', 'loading', 'appPathStatus']) {
  assert.match(html, new RegExp(`id="${id}"`));
}
assert.match(html, /Content-Security-Policy/);
assert.match(read('renderer.js'), /togglePinned/);
assert.match(read('renderer.js'), /wallpaper-cover/);
assert.match(read('style.css'), /object-fit: cover/);
console.log('LAUNCHPAD_SMOKE_OK');
