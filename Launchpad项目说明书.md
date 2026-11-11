# Launchpad 项目说明书

更新日期：2026-11-10

## 1. 项目目标

这是一个运行在 Windows 上的 Electron 应用，目标是提供接近 macOS Launchpad 的应用启动台体验。

当前稳定版本名称：`Launchpad`
桌面入口：由 `Set-DesktopElectronShortcut.ps1` 创建的 `Launchpad.lnk`
入口目标：`LaunchpadElectron/dist/Launchpad-win32-x64/Launchpad.exe`

## 2. 当前技术栈

- Node.js
- Electron 35.x
- electron-packager
- Windows PowerShell，仅用于读取和启动 `.lnk` 快捷方式
- 前端：原生 HTML / CSS / JavaScript

工程目录：

```text
LaunchpadElectron/
```

## 3. 重要文件

```text
LaunchpadElectron/
├─ main.js                         Electron 主进程
├─ preload.js                      安全 IPC 桥接
├─ renderer.js                     界面、搜索、分页、排序、文件夹、回收站交互
├─ index.html                      页面结构
├─ style.css                       UI 样式、动画、深色背景
├─ package.json                    npm 脚本和依赖
├─ package-lock.json               依赖锁定
├─ Set-DesktopElectronShortcut.ps1 更新桌面 Launchpad 快捷方式
└─ dist/Launchpad-win32-x64/       当前打包发布目录
   └─ Launchpad.exe                当前可运行程序

根目录验证脚本：

```text
verify_electron_launchpad.js
verify_chinese_shortcut.js
```

## 4. 运行和打包

在 PowerShell 中执行：

```powershell
Set-Location "LaunchpadElectron"
npm install
npm run check
npm run package
powershell -NoProfile -ExecutionPolicy Bypass -File .\Set-DesktopElectronShortcut.ps1
```

检查 Electron JavaScript 语法：

```powershell
node --check main.js
node --check preload.js
node --check renderer.js
```

运行项目验证：

```powershell
Set-Location "Launchpad"
node .\verify_electron_launchpad.js
```

该命令依次执行两个子检查：

- `verify_source.js`：纯静态检查（不依赖 dist），动态比对 IPC 通道集合、`$()` 引用的 DOM id、入站通道的来源校验数量等；
- `verify_packaged.js`：校验 `dist/` 打包产物与源码一致，dist 不存在时自动跳过并返回成功。

也可以单独运行：

```powershell
node .\verify_source.js
node .\verify_packaged.js
```

## 5. 应用来源

Launchpad 读取：

```text
%APPDATA%\Launchpad\QuickApps\*.lnk
```

只读取快捷方式，不扫描整个硬盘中的所有 `.exe`。这样可以避免把安装程序、卸载程序、组件和缓存程序显示出来。

桌面同步功能只处理：

```text
用户桌面目录\*.lnk
```

同步时会跳过 `AppLauncher.lnk`、Launchpad 相关入口，并且不会移动普通文件、文件夹、图片、视频或文档。

## 6. 当前功能

- 默认最大化打开
- 关闭窗口即退出应用，不常驻后台、不保留托盘
- 单实例运行，重复启动会激活已有窗口
- 深色渐变背景，支持壁纸
- 应用图标和中文名称显示
- 单击启动应用
- 保留 `.lnk` 的启动参数和工作目录
- 中文快捷方式支持
- 搜索应用名称和目标路径
- 分页、左右翻页和底部圆点
- 最近使用区域
- 工作/创作分类筛选
- 编辑模式
- 拖拽排序
- 新建文件夹（内联对话框，支持 Enter 提交、Esc 取消）
- 文件夹重命名和删除
- 手动同步桌面快捷方式
- 拖入回收站删除快捷方式
- 删除只发送 `.lnk` 到 Windows 回收站，不卸载软件
- 图标大小、透明度、每行数量设置
- 开机自动启动（打包版可用，默认关闭）
- UI 入场动画、翻页动画、悬停和拖动反馈

## 7. 壁纸支持

当前版本**已启用 Wallpaper Engine 壁纸**，Launchpad 会从 Steam 创意工坊目录读取壁纸资源。

支持的两种模式：

1. `desktop`：跟随系统桌面壁纸，读取注册表 `HKCU:\Control Panel\Desktop` 的 `WallPaper`，并回退到 Wallpaper Engine 生成的覆盖图；
2. `custom`：在 Launchpad 内单独挑选壁纸，与系统桌面壁纸互不影响。

支持的三种媒体：

- `image`：原始图片，优先使用体积最大的图片文件；
- `video`：原始视频，循环静音播放；
- `web`：壁纸目录根部的 `index.html`，通过沙箱 iframe 加载。

扫描位置为各 Steam 库下的：

```text
steamapps\workshop\content\431960
```

`431960` 是 Wallpaper Engine 的创意工坊应用 ID。扫描时会跳过 `preview`、`thumb` 等预览图，避免把缩略图当成壁纸。

限制：`scene.pkg` 场景壁纸**不支持直接渲染**，因为这种格式只能由 Wallpaper Engine 本身渲染。遇到此类壁纸时，请在 Wallpaper Engine 中把它设为桌面壁纸，然后使用 Launchpad 的“跟随系统桌面壁纸”模式。不要在未重新设计窗口合成方案并实际测试前，把 `preview.jpg`、`preview.png` 或缩略图伪装成实时 Wallpaper Engine 画面——预览图不是实时渲染画面，比例、画面内容和动态效果都会不一致。

## 8. Electron 安全约束

不要降低以下安全设置：

```js
contextIsolation: true
nodeIntegration: false
sandbox: true
```

必须保留：

- 可信 renderer IPC 校验
- 只允许本地 `index.html` 主 frame 调用 IPC
- 禁止外部导航
- 禁止新窗口
- 启动目标必须是当前可见 QuickApps 中的 `.lnk`
- 目标仅允许普通文件或 `http/https`
- 回收站只能处理当前可见的 QuickApps 快捷方式
- PowerShell 参数通过 JSON 环境变量传递，不要拼接用户输入到命令字符串
- Renderer 使用 `textContent` 和 DOM API，不使用不可信 `innerHTML`

## 9. 数据和配置

快捷方式目录：

```text
%APPDATA%\Launchpad\QuickApps
```

配置目录：

```text
%APPDATA%\Launchpad\config
```

主要配置包括：

- `electron-launchpad-order.json`：应用排序
- `electron-launchpad-state.json`：最近使用、文件夹和界面设置

不要删除或覆盖用户的排序、文件夹和设置数据。

## 10. 修改建议

如果要继续开发：

1. 先读取 `LaunchpadElectron/main.js`、`renderer.js`、`index.html`、`style.css`；
2. 修改后先执行 `npm run check`；
3. 再执行 `npm run package`；
4. 检查桌面入口目标是否仍为 `dist\Launchpad-win32-x64\Launchpad.exe`；
5. 运行 `node verify_electron_launchpad.js`；
6. 不要把 `node_modules`、旧打包目录、临时文件或无关目录提交进项目；
7. `.gitignore` 应包含 `LaunchpadElectron/dist/`，打包产物不入库。

## 11. 版本控制边界

提交仓库时只保留当前 Electron 工程、验证脚本、配置示例和项目文档。用户本机的快捷方式、排序、文件夹、壁纸选择、打包产物与依赖目录均不应提交。

`.gitignore` 应包含 `LaunchpadElectron/dist/`、`LaunchpadElectron/node_modules/` 以及本机临时文件。
