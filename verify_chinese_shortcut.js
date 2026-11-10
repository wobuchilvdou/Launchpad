const { spawnSync } = require('node:child_process');
const command = "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false);$OutputEncoding=New-Object System.Text.UTF8Encoding($false);$s=New-Object -ComObject WScript.Shell;$x=$s.CreateShortcut($env:TEST_LNK);[PSCustomObject]@{Id='钉钉.lnk';Target=$x.TargetPath}|ConvertTo-Json -Compress";
const env={...process.env,TEST_LNK:'D:\\Desktop\\QuickApps\\钉钉.lnk'};
const result=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',env});
if(result.status!==0||!result.stdout.includes('钉钉.lnk')||!result.stdout.includes('DingDing')){console.error(result.stderr||result.stdout);process.exit(1)}
console.log('CHINESE_SHORTCUT_ENCODING_OK');console.log(result.stdout.trim());
