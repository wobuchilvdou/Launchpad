$shortcutPath = 'D:\Desktop\Launchpad.lnk'
$backupPath = Join-Path $env:TEMP 'Launchpad-Desktop-Backup.lnk'
$candidates = @(
    (Join-Path $PSScriptRoot 'dist\Launchpad-win32-x64\Launchpad.exe'),
    (Join-Path $PSScriptRoot '..\..\Launchpad.exe'),
    (Join-Path (Split-Path $PSScriptRoot) 'dist\Launchpad-win32-x64\Launchpad.exe')
)
$exePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exePath) { throw 'Electron executable not found' }
if ((Test-Path $shortcutPath) -and -not (Test-Path $backupPath)) { Copy-Item $shortcutPath $backupPath }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = Split-Path $exePath
$shortcut.IconLocation = "$exePath,0"
$shortcut.Description = 'Launchpad'
$shortcut.Save()
$check = $shell.CreateShortcut($shortcutPath)
if ($check.TargetPath -ne $exePath) { throw 'Desktop Electron shortcut verification failed' }
Write-Output 'DESKTOP_ELECTRON_SHORTCUT_OK'
