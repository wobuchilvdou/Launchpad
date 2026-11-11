// 薄运行器：依次执行静态检查与打包产物检查，任一失败即非零退出。
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const run = (script) => {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`VERIFY_FAILED: ${script} 退出码 ${result.status}`);
    process.exit(result.status || 1);
  }
};

run('verify_source.js');
run('verify_packaged.js');
console.log('ELECTRON_ORBITPAD_CHECK_OK');
