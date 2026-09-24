/**
 * 预加载脚本：只向页面暴露与"外壳"有关的能力，不改任何网页内容。
 * 仅本地错误页（error.html）和设置页（settings.html）会用到。
 *
 * 另外：无边框窗口没有标题栏，这里实现"整块区域可拖动"——
 * 只监听鼠标事件，不插入元素、不改样式（拖动期间临时禁用文字选中，结束后恢复）。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lingvistDesktop', {
  reload: () => ipcRenderer.invoke('app:reload'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  version: () => ipcRenderer.invoke('app:version'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
    reset: () => ipcRenderer.invoke('settings:reset'),
    close: () => ipcRenderer.invoke('settings:close'),
  },
});

// ---- 整块区域拖动（无边框窗口没有标题栏，只能自己实现） ----

// 这些元素上的操作留给网页自己处理（输入框、按钮、链接、可编辑区等）
const SKIP_SELECTOR = [
  'input',
  'textarea',
  'select',
  'option',
  'button',
  'a',
  'video',
  'audio',
  'canvas',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[draggable="true"]',
  '[role="button"]',
  '[role="slider"]',
  '[role="textbox"]',
].join(', ');

const DRAG_THRESHOLD = 6; // 移动超过 6px 才算拖动窗口，避免影响普通点击

let pressOrigin = null; // 鼠标按下时的屏幕位置
let dragging = false;

function shouldSkip(target) {
  return !!(target && target.closest && target.closest(SKIP_SELECTOR));
}

function hasTextSelection() {
  const sel = window.getSelection && window.getSelection();
  return !!(sel && String(sel).length > 0);
}

function endDrag() {
  if (dragging) {
    dragging = false;
    document.documentElement.style.userSelect = '';
    ipcRenderer.send('window:drag-end');
  }
  pressOrigin = null;
}

document.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  if (shouldSkip(event.target)) return;
  pressOrigin = { x: event.screenX, y: event.screenY };
  dragging = false;
});

document.addEventListener('mousemove', (event) => {
  if (!pressOrigin || event.buttons === 0) return;

  // 关键：始终用「相对按下点」的总位移，而不是每次挪动的增量。
  // 增量累加会累积取整误差；总位移不会，配合主进程锁死宽高就不会越拖越大。
  const dx = event.screenX - pressOrigin.x;
  const dy = event.screenY - pressOrigin.y;

  if (!dragging) {
    if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    if (hasTextSelection()) {
      endDrag();
      return;
    }
    dragging = true;
    document.documentElement.style.userSelect = 'none';
    ipcRenderer.send('window:drag-start');
  }

  ipcRenderer.send('window:drag-move', { dx, dy });
});

document.addEventListener('mouseup', endDrag);
document.addEventListener('mouseleave', endDrag);
window.addEventListener('blur', endDrag);
