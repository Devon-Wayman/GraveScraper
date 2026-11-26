const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gravesite-navigation-'));
app.setPath('userData', path.join(directory, 'browser'));
app.on('window-all-closed', () => {});
let server, browser;
const hits = {};
async function until(check) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Browser navigation check timed out.');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
app.whenReady().then(async () => {
  const { createExternalBrowser } = require(path.join(process.env.GRAVESITE_TEST_BUNDLE || path.resolve(__dirname, '..'), process.env.GRAVESITE_TEST_BUNDLE ? 'Contents/Resources/app.asar/electron/external-browser.js' : 'electron/external-browser.js'));
  server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','text/html');
    res.end(`<title>${req.url}</title><h1>${req.url}</h1><a id="related" href="/related">Related memorial</a><a id="popup" href="/another" target="_blank">Another memorial</a>`);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = createExternalBrowser(base + '/memorial', {show:false});
  const toolbar = code => browser.window.webContents.executeJavaScript(code,true);
  const remote = code => browser.page.executeJavaScript(code,true);
  await until(() => browser.page.getURL() === base+'/memorial' && !browser.page.isLoading());
  assert.equal(await toolbar('document.querySelector("#back").disabled'),true);
  assert.equal(await remote('typeof window.graveBrowser'), 'undefined');
  assert.equal(await remote('typeof require'), 'undefined');
  await remote('document.querySelector("#related").click()');
  await until(() => browser.page.getURL() === base+'/related' && !browser.page.isLoading());
  await until(async () => !(await toolbar('document.querySelector("#back").disabled')));
  await toolbar('document.querySelector("#back").click()');
  await until(() => browser.page.getURL() === base+'/memorial' && !browser.page.isLoading());
  await until(async () => !(await toolbar('document.querySelector("#forward").disabled')));
  await toolbar('document.querySelector("#forward").click()');
  await until(() => browser.page.getURL() === base+'/related' && !browser.page.isLoading());
  const previousHits = hits['/related'];
  await toolbar('document.querySelector("#refresh").click()');
  await until(() => hits['/related'] > previousHits && !browser.page.isLoading());
  await remote('document.querySelector("#popup").click()');
  await until(() => browser.page.getURL() === base+'/another' && !browser.page.isLoading());
  assert.equal(BrowserWindow.getAllWindows().length,1,'target=_blank stays in navigable browser window');
  await toolbar('document.querySelector("#original").click()');
  await until(() => browser.page.getURL() === base+'/memorial' && !browser.page.isLoading());
  await until(async () => (await toolbar('document.querySelector("#address").value')) === base+'/memorial');
  browser.window.setSize(600,600);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(await toolbar('document.documentElement.scrollWidth <= innerWidth'),true);
  assert.equal(createExternalBrowser('file:///etc/passwd'),null);
  browser.window.destroy();
  await until(() => browser.page.isDestroyed());
  console.log('Browser controls verified: Back, Forward, Refresh, Original page, related popup links, page isolation, resize, and cleanup.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if (browser && !browser.window.isDestroyed()) browser.window.destroy();
  if (server) await new Promise(resolve=>server.close(resolve));
  app.exit(process.exitCode || 0);
});
