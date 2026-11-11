// 打包产物校验：dist 缺失时跳过（exit 0），存在时校验 exe 与资源文件一致性。
const fs = require('node:fs');
const path = require('node:path');

const srcRoot = path.join(__dirname, 'OrbitpadElectron');
const distRoot = process.env.ORBITPAD_DIST_ROOT
  ? path.resolve(process.env.ORBITPAD_DIST_ROOT)
  : path.join(srcRoot, 'dist', 'Orbitpad-win32-x64');

const compact = (text) => String(text).replace(/\s+/g, '');
const read = (file) => fs.readFileSync(file, 'utf8');

if (!fs.existsSync(distRoot)) {
  console.log('PACKAGED_CHECK_SKIPPED: dist 未构建 (' + distRoot + ')');
  process.exit(0);
}

const checks = [];
const check = (name, value) => checks.push({ name, value: Boolean(value) });

const exe = path.join(distRoot, 'Orbitpad.exe');
check('dist: Orbitpad.exe 存在', fs.existsSync(exe));

const packagedApp = path.join(distRoot, 'resources', 'app');
for (const file of ['main.js', 'preload.js', 'renderer.js', 'style.css', 'index.html']) {
  const packaged = path.join(packagedApp, file);
  const source = path.join(srcRoot, file);
  let ok = fs.existsSync(packaged) && fs.existsSync(source);
  if (ok) ok = compact(read(packaged)) === compact(read(source));
  check(`dist: ${file} 与源文件一致`, ok);
}

const failed = checks.filter((c) => !c.value).map((c) => c.name);
console.log(`PACKAGED_CHECKS: ${checks.length - failed.length}/${checks.length} 通过`);
if (failed.length) {
  console.error('FAILED_CHECKS:');
  for (const name of failed) console.error('  ✗ ' + name);
  process.exitCode = 1;
} else {
  console.log('VERIFY_PACKAGED_OK');
  if (fs.existsSync(exe)) console.log('EXE_BYTES=' + fs.statSync(exe).size);
}
