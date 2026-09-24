/**
 * Lingvist Desktop — 主进程
 *
 * 第一阶段目标：一个原样加载 https://lingvist.com/ 的窗口。
 * 不做任何网页内容注入/改写，仅在外壳层做导航收口与桌面集成。
 */

const { app, BrowserWindow, Menu, Tray, nativeImage, screen, shell, session, ipcMain, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const APP_URL = 'https://lingvist.com/';

// 允许在应用内打开的域名（含子域）。
// lingvist.com 为主站；其余为第三方登录（Google / Apple）跳转所需。
const ALLOWED_HOSTS = [
  'lingvist.com',
  'accounts.google.com',
  'appleid.apple.com',
];

function isAllowedUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname;
    return ALLOWED_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`)
    );
  } catch {
    return false;
  }
}

// 供本地错误页使用的极简接口（不参与任何网页内容）
ipcMain.handle('app:reload', () => {
  if (mainWindow) mainWindow.loadURL(APP_URL);
});
ipcMain.handle('app:open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});
ipcMain.handle('app:version', () => app.getVersion());

// 设置窗口读写
// 设置相关接口只对本应用的本地页面开放，不响应网页里的调用
function fromSettingsPage(event) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  return url.startsWith('file://');
}

ipcMain.handle('settings:get', (event) => {
  if (!fromSettingsPage(event)) return null;
  return {
    opacity,
    alwaysOnTop,
    shortcuts: { ...settings.shortcuts },
    registered: { ...registeredShortcuts },
  };
});

ipcMain.handle('settings:save', (event, patch = {}) => {
  if (!fromSettingsPage(event)) return { ok: false };
  if (typeof patch.opacity === 'number') setOpacity(patch.opacity);
  if (typeof patch.alwaysOnTop === 'boolean') setAlwaysOnTop(patch.alwaysOnTop);
  if (patch.shortcuts) {
    settings.shortcuts = { ...settings.shortcuts, ...patch.shortcuts };
    registerAllShortcuts();
    if (tray) tray.setContextMenu(buildTrayMenu());
  }
  saveSettings();
  return { ok: true, registered: { ...registeredShortcuts } };
});

ipcMain.handle('settings:reset', (event) => {
  if (!fromSettingsPage(event)) return { ok: false };
  settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  setOpacity(settings.opacity);
  setAlwaysOnTop(settings.alwaysOnTop);
  registerAllShortcuts();
  if (tray) tray.setContextMenu(buildTrayMenu());
  saveSettings();
  return { ok: true, registered: { ...registeredShortcuts } };
});

ipcMain.handle('settings:close', (event) => {
  if (!fromSettingsPage(event)) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

// ---------- 无边框窗口的"整块区域拖动" ----------
// 做法：拖动开始时记下窗口的原始位置和尺寸，之后每次都用
// 「原始位置 + 总位移」算出绝对坐标，并把宽高原样写回去。
// 这样既不会有增量取整的累积误差，尺寸也不会被 setBounds 一点点撑大。
let dragBase = null;

ipcMain.on('window:drag-start', () => {
  dragBase = null;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized() || mainWindow.isFullScreen()) return; // 最大化/全屏时不拖
  const [x, y] = mainWindow.getPosition();
  const [width, height] = mainWindow.getSize();
  dragBase = { x, y, width, height };
});

ipcMain.on('window:drag-move', (_event, delta) => {
  if (!dragBase || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBounds(
    {
      x: Math.round(dragBase.x + delta.dx),
      y: Math.round(dragBase.y + delta.dy),
      width: dragBase.width,
      height: dragBase.height,
    },
    false
  );
});

ipcMain.on('window:drag-end', () => {
  // 兜底：万一系统还是把尺寸改了，松手时按原始尺寸还原一次
  if (dragBase && mainWindow && !mainWindow.isDestroyed()) {
    const [width, height] = mainWindow.getSize();
    if (width !== dragBase.width || height !== dragBase.height) {
      mainWindow.setSize(dragBase.width, dragBase.height);
    }
  }
  dragBase = null;
});

// ---------- 窗口状态记忆 ----------
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s;
  } catch {
    /* 首次运行还没有记录，用默认大小 */
  }
  return null;
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ ...win.getBounds(), maximized: win.isMaximized() })
    );
  } catch {
    /* 写不进去就忽略，不影响使用 */
  }
}

// 检查上次的位置是否还在当前屏幕上（比如拔掉了外接显示器）
function fitsAnyDisplay(b) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      b.x >= a.x - 40 &&
      b.y >= a.y - 40 &&
      b.x + b.width <= a.x + a.width + 40 &&
      b.y + b.height <= a.y + a.height + 40
    );
  });
}

// ---------- 设置（透明度 / 快捷键，可在设置窗口里改） ----------
const DEFAULT_SETTINGS = {
  opacity: 1,
  alwaysOnTop: true,
  // 页面背景处理：off = 原样；tint = 背景半透明（文字保持清晰）；clear = 背景全透明
  backdrop: { mode: 'off', alpha: 0.7 },
  shortcuts: {
    toggleWindow: 'Control+Shift+H',
    toggleTop: 'Control+Shift+T',
    opacityDown: 'Control+Shift+-',
    opacityUp: 'Control+Shift+=',
    openSettings: 'Control+Shift+,',
  },
};

const OPACITY_MIN = 0.3; // 再低就看不见、也没法点了
const OPACITY_STEP = 0.1;

let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
let opacity = 1; // 窗口不透明度，1 = 完全不透明
let alwaysOnTop = true;
let registeredShortcuts = {}; // 动作 -> 实际注册成功的按键
let settingsWindow = null;

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = {
      opacity: typeof saved.opacity === 'number' ? saved.opacity : DEFAULT_SETTINGS.opacity,
      alwaysOnTop: typeof saved.alwaysOnTop === 'boolean' ? saved.alwaysOnTop : true,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...(saved.shortcuts || {}) },
    };
  } catch {
    settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
  opacity = Math.min(1, Math.max(OPACITY_MIN, settings.opacity));
  alwaysOnTop = settings.alwaysOnTop;
}

function saveSettings() {
  settings.opacity = opacity;
  settings.alwaysOnTop = alwaysOnTop;
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch {
    /* 写不进去就忽略 */
  }
}

// 每次改完快捷键都整体重新注册一遍
function registerAllShortcuts() {
  globalShortcut.unregisterAll();
  registeredShortcuts = {};
  const actions = {
    toggleWindow: () => toggleMainWindow(),
    toggleTop: () => setAlwaysOnTop(!alwaysOnTop),
    opacityDown: () => setOpacity(opacity - OPACITY_STEP),
    opacityUp: () => setOpacity(opacity + OPACITY_STEP),
    openSettings: () => openSettingsWindow(),
  };
  for (const [action, handler] of Object.entries(actions)) {
    const accelerator = settings.shortcuts[action];
    if (!accelerator) continue;
    if (globalShortcut.register(accelerator, handler)) {
      registeredShortcuts[action] = accelerator;
    } else {
      console.warn('[lingvist-desktop] 快捷键注册失败:', action, accelerator);
    }
  }
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 460,
    height: 640,
    // 不设 parent：主窗口藏起来时设置窗口不会被一起带走
    frame: false,
    resizable: false,
    backgroundColor: '#ffffff',
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
}

// ---------- 托盘 ----------
let isQuitting = false;
let tray = null;

function assetPath(name) {
  return path.join(__dirname, '..', 'assets', name);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function resetWindowSize() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSize(1280, 860);
  mainWindow.center();
  saveWindowState(mainWindow);
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) mainWindow.hide();
  else showMainWindow();
}

function setAlwaysOnTop(enabled) {
  alwaysOnTop = enabled;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(enabled);
  if (tray) tray.setContextMenu(buildTrayMenu());
  saveSettings();
}

function setOpacity(value) {
  opacity = Math.min(1, Math.max(OPACITY_MIN, Math.round(value * 100) / 100));
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(opacity);
  if (tray) tray.setContextMenu(buildTrayMenu());
  saveSettings();
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: `设置…　${settings.shortcuts.openSettings || ''}`,
      click: openSettingsWindow,
    },
    {
      label: `显示 / 隐藏窗口　${settings.shortcuts.toggleWindow || ''}`,
      click: toggleMainWindow,
    },
    {
      label: '打开主页',
      click: () => {
        showMainWindow();
        if (mainWindow) mainWindow.loadURL(APP_URL);
      },
    },
    {
      label: `置顶显示　${settings.shortcuts.toggleTop || ''}`,
      type: 'checkbox',
      checked: alwaysOnTop,
      click: (item) => setAlwaysOnTop(item.checked),
    },
    { label: '恢复默认窗口大小', click: resetWindowSize },
    {
      label: `透明度　当前 ${Math.round(opacity * 100)}%　Ctrl+Shift+ - / =`,
      submenu: [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, OPACITY_MIN].map((value) => ({
        label: `${Math.round(value * 100)}%`,
        type: 'checkbox',
        checked: Math.abs(opacity - value) < 0.005,
        click: () => setOpacity(value),
      })),
    },
    { type: 'separator' },
    {
      label: '重新启动',
      click: () => {
        isQuitting = true;
        app.relaunch();
        app.exit(0);
      },
    },
    { label: '退出', click: () => app.quit() },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(assetPath('tray.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Lingvist Desktop');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleMainWindow);
  tray.on('double-click', toggleMainWindow);
}

let mainWindow = null;

function createWindow() {
  const saved = loadWindowState();
  const options = {
    width: 1280,
    height: 860,
    // 不设最小尺寸，拖到多小由你决定（Windows 自身还有个下限）
    // 想加回来就取消下面两行注释：
    // minWidth: 900,
    // minHeight: 600,
    title: 'Lingvist',
    backgroundColor: '#ffffff',
    show: false,
    // 无边框：去掉 Windows 标题栏和外框（拖动由 preload + 上面的 window:drag-* 实现，
    // 四边缩放在 Windows 上是原生可用的，不需要自己写）
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 安全基线：网页内容保持与真实浏览器一致的能力边界
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };

  // 恢复上次的窗口大小、位置和透明度（位置不合法时只用大小）
  if (saved) {
    options.width = saved.width;
    options.height = saved.height;
    if (fitsAnyDisplay(saved)) {
      options.x = saved.x;
      options.y = saved.y;
    }
    // 透明度由 settings.json 负责，这里不管
  }

  mainWindow = new BrowserWindow(options);
  if (saved && saved.maximized) mainWindow.maximize();
  mainWindow.setAlwaysOnTop(alwaysOnTop);
  mainWindow.setOpacity(opacity);

  // 拖动/缩放时把窗口状态记下来（防抖 400ms，避免频繁写盘）
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);

  // 去掉 UA 里的 Electron 标记：部分站点（尤其第三方 OAuth）会拒绝带 Electron 的请求
  const ua = session.defaultSession.getUserAgent().replace(/Electron\/\S+\s*/, '');
  mainWindow.webContents.setUserAgent(ua);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 站内导航放行，站外链接交给系统浏览器
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // 新窗口（如 Google 登录弹窗）：站内/登录域在应用内打开并共享会话，站外走浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) return { action: 'allow' };
    if (url) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 加载失败（断网等）时展示一个可重试的本地提示页
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ERR_ABORTED */) return;
    console.error('[lingvist-desktop] 加载失败:', errorCode, errorDescription, validatedUrl);
    mainWindow.loadFile(path.join(__dirname, 'error.html'));
  });

  // 点 × = 藏到托盘继续运行；托盘右键「退出」才是真正退出
  mainWindow.on('close', (event) => {
    clearTimeout(saveTimer);
    saveWindowState(mainWindow);
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(APP_URL);
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开主页', click: () => mainWindow && mainWindow.loadURL(APP_URL) },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        // 无边框后应用菜单栏是看不见的，这几项主要靠快捷键生效
        { label: '恢复默认窗口大小　Ctrl+Shift+D', accelerator: 'CmdOrCtrl+Shift+D', click: resetWindowSize },
        { role: 'reload', label: '刷新', accelerator: 'CmdOrCtrl+R' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '在浏览器中打开 Lingvist', click: () => shell.openExternal(APP_URL) },
        {
          label: '清空登录状态并重启',
          click: () => {
            session.defaultSession.clearStorageData().then(() => {
              app.relaunch();
              app.exit(0);
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 诊断模式：LINGVIST_DEBUG=1 启动时打印加载过程、渲染器报错，并截图到用户数据目录
function attachDebug(win) {
  const wc = win.webContents;
  wc.on('did-start-loading', () => console.log('[load] start'));
  wc.on('did-navigate', (_e, url) => console.log('[nav]', url));
  wc.on('did-finish-load', () => console.log('[load] finish', wc.getURL()));
  wc.on('did-fail-load', (_e, code, desc, url) => console.log('[load] FAIL', code, desc, url));
  wc.on('console-message', (_e, ...rest) => console.log('[console]', JSON.stringify(rest)));
  wc.on('render-process-gone', (_e, details) => console.log('[render-gone]', JSON.stringify(details)));
  setTimeout(async () => {
    console.log('[state] url =', wc.getURL(), '| title =', wc.getTitle());
    try {
      const img = await wc.capturePage();
      const out = path.join(app.getPath('userData'), 'debug-shot.png');
      fs.writeFileSync(out, img.toPNG());
      console.log('[shot] saved:', out);
    } catch (err) {
      console.log('[shot] failed:', err.message);
    }
  }, 8000);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.setName('Lingvist Desktop');
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.local.lingvistdesktop');
  }

  // 任何退出途径（托盘菜单、文件菜单、任务栏）都先经过这里，
  // 避免 close 事件把退出误当成"最小化到托盘"
  app.on('before-quit', () => {
    isQuitting = true;
    globalShortcut.unregisterAll();
  });

  app.whenReady().then(() => {
    loadSettings(); // 先读设置（透明度、快捷键），再建窗口
    registerAllShortcuts();
    // 麦克风权限：Lingvist 的听说练习需要；其余权限一律拒绝
    // （session 必须等 app ready 之后才能访问）
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const url = webContents.getURL();
      callback(permission === 'media' && isAllowedUrl(url));
    });

    buildMenu();
    createWindow();
    createTray();
    if (process.env.LINGVIST_DEBUG) attachDebug(mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
