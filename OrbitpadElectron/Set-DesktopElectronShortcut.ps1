$shortcutPath = 'D:\Desktop\Orbitpad.lnk'
$legacyShortcutPath = 'D:\Desktop\Launchpad.lnk'
$backupPath = Join-Path $env:TEMP 'Orbitpad-Desktop-Backup.lnk'
$candidates = @(
    (Join-Path $PSScriptRoot 'dist\Orbitpad-win32-x64\Orbitpad.exe'),
    (Join-Path (Split-Path $PSScriptRoot) 'dist\Orbitpad-win32-x64\Orbitpad.exe')
)
$exePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exePath) { throw 'Orbitpad executable not found' }
if ((Test-Path $shortcutPath) -and -not (Test-Path $backupPath)) { Copy-Item $shortcutPath $backupPath }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = Split-Path $exePath
$shortcut.IconLocation = "$exePath,0"
$shortcut.Description = 'Orbitpad'
$shortcut.Save()
$check = $shell.CreateShortcut($shortcutPath)
if ($check.TargetPath -ne $exePath) { throw 'Desktop Orbitpad shortcut verification failed' }
if (Test-Path $legacyShortcutPath) {
    $legacy = $shell.CreateShortcut($legacyShortcutPath)
    if ($legacy.TargetPath -like '*Launchpad-win32-x64\Launchpad.exe') { Remove-Item -LiteralPath $legacyShortcutPath -Force }
}
Write-Output 'DESKTOP_ELECTRON_SHORTCUT_OK'
