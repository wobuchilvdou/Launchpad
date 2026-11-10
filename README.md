# Launchpad

一个运行在 Windows 上的 macOS Launchpad 风格应用启动台，基于 Electron 与原生 HTML / CSS / JavaScript 构建，无前端框架、无构建步骤。

## 功能

- **应用启动**：扫描指定目录中的 `.lnk` / `.url` 快捷方式，保留原始启动参数与工作目录，单击即可启动
- **图标提取**：通过 PowerShell + `System.Drawing` 提取真实程序图标，按路径与修改时间缓存
- **搜索**：按应用名称与目标路径实时过滤，`Ctrl + K` 聚焦搜索框
- **分类筛选**：全部 / 最近 / 工作 / 创作
- **分页**：自动按窗口尺寸计算每页容量，支持左右翻页与底部圆点
- **整理模式**：拖拽排序、多选建文件夹、文件夹重命名与删除
- **回收站**：拖入回收站只把 `.lnk` 移入 Windows 回收站，不卸载软件
- **桌面同步**：把桌面上的快捷方式批量移入应用目录
- **壁纸**：跟随系统桌面壁纸，或单独选择 Wallpaper Engine 本地壁纸（图片 / 视频 / Web）
- **外观设置**：窗口透明度、图标大小、每行数量、壁纸亮度
- **可访问性**：键盘导航、`prefers-reduced-motion` 支持

## 技术栈

- Electron 35.x
- electron-packager（打包 Windows x64 绿色目录）
- 原生 HTML / CSS / JavaScript
- Windows PowerShell：仅用于读取 `.lnk`、提取图标、启动进程

## 目录结构

```text
Launchpad/
├─ LaunchpadElectron/
│  ├─ main.js                        主进程：扫描、图标、配置、启动、回收、壁纸
│  ├─ preload.js                     contextBridge 暴露的白名单 IPC
│  ├─ renderer.js                    渲染、搜索、分页、拖拽、文件夹、设置
│  ├─ index.html                     页面结构
│  ├─ style.css                      样式与动画
│  ├─ package.json                   npm 脚本与依赖
│  ├─ Set-DesktopElectronShortcut.ps1 生成桌面快捷方式
│  ├─ assets/social/                 项目封面图
│  └─ test/smoke.js                  冒烟测试
├─ verify_electron_launchpad.js      结构与安全约束校验
├─ verify_chinese_shortcut.js        中文快捷方式编码校验
├─ Launchpad项目说明书.md            详细项目说明书
└─ reasonix.toml                     本地工作区配置
```

## 环境要求

- Windows 10 / 11
- Node.js 18+
- 可选：Steam 与 Wallpaper Engine（仅使用壁纸功能时需要）

## 安装与运行

```powershell
Set-Location "LaunchpadElectron"
npm install
npm start
```

## 常用脚本

在 `LaunchpadElectron/` 下执行：

```powershell
npm run check    # 语法检查 main.js / preload.js / renderer.js
npm test         # 冒烟测试
npm run verify   # check + test
npm run package  # 打包到 dist/Launchpad-win32-x64/
```

在仓库根目录执行：

```powershell
node verify_electron_launchpad.js
node verify_chinese_shortcut.js
```

打包完成后可运行 `Set-DesktopElectronShortcut.ps1` 更新桌面快捷方式。

## 数据位置

应用快捷方式默认读取：

```text
%USERPROFILE%\Desktop\QuickApps\*.lnk
```

若 `D:\Desktop` 存在则优先使用 `D:\Desktop\QuickApps`，也可通过环境变量 `LAUNCHPAD_APP_DIR` 指定。

配置保存在同一目录下的 `.config/`：

- `electron-launchpad-order.json`：应用排序
- `electron-launchpad-state.json`：最近使用、固定项、文件夹、界面设置、窗口位置

图标缓存位于 `%TEMP%\ReasonixElectronIcons`。

## 壁纸

- `desktop`：读取注册表 `HKCU:\Control Panel\Desktop` 的 `WallPaper`，并回退到 Wallpaper Engine 生成的覆盖图
- `custom`：扫描各 Steam 库的 `steamapps\workshop\content\431960`，支持图片、视频、Web 三种媒体

`scene.pkg` 场景壁纸无法直接渲染，请在 Wallpaper Engine 中设为桌面壁纸后使用「跟随系统桌面壁纸」模式。不要用预览图或缩略图伪装实时画面。

## 安全设计

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`
- 页面启用 CSP，脚本仅允许同源
- 每个 IPC 调用都校验来源窗口、主 frame 与本地页面 URL
- 禁止外部导航与新窗口
- 启动目标仅限当前可见的快捷方式，且仅允许普通文件或 `http/https`
- PowerShell 参数通过 JSON 环境变量传递，不做字符串拼接
- 渲染层仅使用 `textContent` 与 DOM API

## 说明

打包产物（`LaunchpadElectron/dist/`）与 `node_modules/` 不纳入版本控制，请本地执行 `npm run package` 生成。
