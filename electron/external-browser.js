const path = require('node:path');
const { BrowserWindow, WebContentsView, ipcMain } = require('electron');
const browsers = new Map();
const byWindow = new Map();

function isWebUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}
function pageContents(window) { return byWindow.get(window?.id)?.page || window?.webContents; }
function navigate(window, action) {
  const state = byWindow.get(window?.id);
  const page = pageContents(window);
  if (!page || page.isDestroyed()) return;
  if (action === 'back' && page.navigationHistory.canGoBack()) page.navigationHistory.goBack();
  if (action === 'forward' && page.navigationHistory.canGoForward()) page.navigationHistory.goForward();
  if (action === 'refresh') { if (state && !page.getURL()) state.load(state.original); else page.reload(); }
  if (action === 'force-refresh') page.reloadIgnoringCache();
  if (action === 'original' && state) state.load(state.original);
}
ipcMain.on('grave-browser:navigate', (event, action) => {
  const state = browsers.get(event.sender.id);
  if (state && event.senderFrame === event.sender.mainFrame) navigate(state.window, action);
});

function createExternalBrowser(url, { show = true } = {}) {
  if (!isWebUrl(url)) return null;
  const window = new BrowserWindow({
    width: 1200, height: 900, minWidth: 540, minHeight: 400, show,
    title: 'GraveScraper Browser', autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname, 'browser-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.contentView.addChildView(view);
  const page = view.webContents;
  const toolbarId = window.webContents.id;
  const windowId = window.id;
  const state = { window, page, original: url, requested: url, error: '', load };
  browsers.set(window.webContents.id, state);
  byWindow.set(window.id, state);
  function layout() {
    const [width, height] = window.getContentSize();
    view.setBounds({ x: 0, y: 58, width, height: Math.max(0, height - 58) });
  }
  function sendState() {
    if (window.isDestroyed() || page.isDestroyed()) return;
    window.webContents.send('grave-browser:state', {
      url: page.getURL() || state.requested,
      back: page.navigationHistory.canGoBack(), forward: page.navigationHistory.canGoForward(),
      loading: page.isLoading(), error: state.error
    });
  }
  function load(target) {
    if (!isWebUrl(target)) return;
    state.requested = target;
    state.error = '';
    page.loadURL(target).catch(error => {
      if (!page.isDestroyed() && error.code !== 'ERR_ABORTED') {
        state.error = 'Page could not be loaded. Check your connection and refresh.';
        sendState();
      }
    });
  }
  window.on('resize', layout);
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('did-finish-load', sendState);
  page.on('will-navigate', (event, target) => { if (!isWebUrl(target)) event.preventDefault(); });
  page.on('will-redirect', (event, target) => { if (!isWebUrl(target)) event.preventDefault(); });
  page.setWindowOpenHandler(({ url: target }) => { load(target); return { action: 'deny' }; });
  page.on('did-start-navigation', (_event, target, _inPlace, isMainFrame) => {
    if (isMainFrame) { state.error = ''; if (isWebUrl(target)) state.requested = target; }
  });
  for (const name of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) page.on(name, sendState);
  page.on('page-title-updated', (_event, title) => { if (!window.isDestroyed()) window.setTitle(`${title || 'Web page'} — GraveScraper`); });
  page.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { state.error = 'Page could not be loaded. Check your connection and refresh.'; sendState(); }
  });
  window.on('closed', () => {
    browsers.delete(toolbarId);
    byWindow.delete(windowId);
    if (!page.isDestroyed()) page.close();
  });
  layout();
  window.loadFile(path.join(__dirname, 'browser-toolbar.html')).then(() => load(url)).catch(console.error);
  return { window, page };
}
function attachExternalLinks(window, appUrl) {
  const appOrigin = new URL(appUrl).origin;
  window.webContents.setWindowOpenHandler(({ url }) => { createExternalBrowser(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    if (isWebUrl(url) && new URL(url).origin === appOrigin) return;
    event.preventDefault();
    createExternalBrowser(url);
  });
}
module.exports = { createExternalBrowser, attachExternalLinks, pageContents, navigate };
