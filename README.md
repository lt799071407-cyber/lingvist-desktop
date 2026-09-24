# Lingvist Desktop

[English](./README.en.md) | 简体中文

> 把 Lingvist 官网装进一个 Windows 桌面小窗：无边框、可置顶、能调透明度，
> 缩成小窗挂在屏幕一角背单词。

一个基于 Electron 的**桌面外壳**，原样加载官方站点 <https://lingvist.com/>，
不重新实现、不改写、不缓存任何网页内容。登录自己的账号即可使用，体验与浏览器一致。

> ⚠️ 本项目只是外壳，不包含也不分发 Lingvist 的任何内容或商标；
> Lingvist 的名称、商标与产品内容归其官方所有。项目图标为本项目原创设计。

## 它是什么 / 不是什么

| | |
|---|---|
| ✅ 是 | 一个加载官网的桌面窗口，外加托盘、置顶、无边框、透明度等桌面能力 |
| ❌ 不是 | Lingvist 的客户端重写、破解、离线课程包、第三方 API 封装 |

## 功能

- **无边框窗口**：没有标题栏，页面占满整个窗口
- **整块区域拖动**：在页面空白处按住左键即可移动窗口
- **置顶显示**：永远浮在其他窗口之上，可一键开关（默认开启）
- **透明度调节**：30%~100%，快捷键步进或滑杆调节
- **系统托盘**：点 × 只是藏到托盘后台继续运行，点托盘图标唤回
- **记住窗口状态**：大小、位置、最大化、透明度都会记住
- **快捷键自定义**：设置窗口里可改每一个快捷键
- **登录状态保持**：Cookie / localStorage 持久化，关掉再开仍是登录状态
- 站外链接交给系统浏览器；麦克风权限只给 lingvist.com（听说练习需要）
- 断网时显示可重试的提示页，而不是白屏

## 快速开始

环境：Windows x64，Node.js 18 以上。

```bash
npm install
npm start
```

不想碰命令行的，直接双击 **`start.bat`**。
> 国内网络装 Electron 慢的话：`npm config set electron_mirror https://npmmirror.com/mirrors/electron/`

## 打包

```bash
npm run dist          # NSIS 安装包 + 免安装 exe
npm run dist:portable # 只要免安装单文件
npm run dist:dir      # 只要可直接运行的目录 dist/win-unpacked
```

产物在 `dist/`。`dist/win-unpacked/Lingvist Desktop.exe` 双击即可运行，
右键它 →「发送到」→「桌面快捷方式」。

## 操作方式

| 想做的事 | 怎么做 |
|----------|--------|
| 移动窗口 | 页面任意空白处按住左键拖动 |
| 改大小 | 拖窗口四边 / 四角（Windows 原生支持） |
| 显示 / 隐藏 | `Ctrl+Shift+H`，或点托盘图标 |
| 开关置顶 | `Ctrl+Shift+T`，或托盘右键「置顶显示」 |
| 调透明度 | `Ctrl+Shift+ -` / `Ctrl+Shift+ =`（也支持 `↑` `↓`），每档 10% |
| 打开设置 | `Ctrl+Shift+,`，或托盘右键「设置…」 |
| 恢复默认大小 | `Ctrl+Shift+D` |
| 刷新 | `Ctrl+R` |
| 彻底退出 | 托盘右键「退出」（关窗口只是藏到托盘） |

拖动需移动超过 6px 才触发，且在输入框、按钮、链接上不生效，所以不影响正常点击。

## 设置窗口

`Ctrl+Shift+,` 或托盘右键「设置…」打开：

- 不透明度滑杆 + 预设（实时生效）
- 置顶开关
- 五个动作的快捷键录制：点输入框后直接按新组合键即可（Esc 取消，「清除」禁用）

**注册失败的快捷键会标红**，换一个组合键即可。设置保存在
`%APPDATA%/Lingvist Desktop/settings.json`。

## 目录结构

```
src/
  main.js        主进程：窗口、托盘、设置、快捷键、导航收口
  preload.js     预加载：拖动整块区域 + 极简 IPC 接口
  settings.html  设置窗口界面
  error.html     加载失败时的提示页
assets/          图标（托盘 / 窗口 / 安装包）
scripts/
  make-icon.js      生成占位图标（纯 Node，无需素材）
  use-image-icon.js 把一张现成图片转成全套图标
start.bat / start-safe.bat    启动器
build-installer-admin.bat     管理员权限打包（生成安装包）
```

## 常见问题

**窗口一片空白 / 秒退**
别从 Electron 类软件（VS Code、本项目的另一个实例等）的终端或文件预览里启动，
会出现 `Invalid file descriptor to ICU data received`。从资源管理器双击即可。

**启动就闪退，报 `GPU process isn't usable`**
显卡进程起不来。用 `npm run start:safe`，或双击 `start-safe.bat`。
注意 Chromium 的开关必须写在 app 路径**前面**。

**快捷键没反应**
打开设置窗口看是否标红——被系统或其他软件占用时 Electron 注册不上，换一个组合键。
托盘菜单里有全部功能的入口，不会锁死。

**打包报 `Cannot create symbolic link`**
Windows 需要"创建符号链接"特权。右键 `build-installer-admin.bat` → 以管理员身份运行，
或开启 Windows 开发人员模式。

**登录跳转被拦**
把对应域名加进 `src/main.js` 的 `ALLOWED_HOSTS`。

**为什么这么大（约 300MB）**
Electron 会打包一整个 Chromium 运行时，我们自己的代码只有 0.4MB。
介意的话只能换 WebView2 路线（Tauri 等），体积可降到几 MB，但要重写主进程。

## 隐私与合规

- 不收集、不上传任何数据；所有会话数据留在本机
- 不注入脚本、不改写页面，只在外壳层做导航收口
- 第三方登录（Google / Apple）的跳转域名已在应用内放行并共享会话

## 许可

代码部分采用 [MIT](./LICENSE) 协议。Lingvist 相关商标与内容归其官方所有。
