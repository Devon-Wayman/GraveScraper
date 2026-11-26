const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("in-app settings persist across startup, validate input, and recover desktop port conflicts", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gravesite-settings-"));
  process.env.DATABASE_PATH = path.join(directory, "test.sqlite");
  process.env.GRAVESITE_CONFIG_FOLDER = directory;
  process.env.GRAVESITE_ENV_PATH = path.join(directory, ".env");
  process.env.APP_ACCESS_TOKEN = "";
  process.env.HOST = "127.0.0.1";
  process.env.PORT = "3000";
  const config = require("../src/config");
  const settings = require("../src/config/settings");
  const { app, startServer, startDesktopServer } = require("../src/server");
  const db = require("../src/db");
  const active = await startServer(0, "127.0.0.1");
  let recovery;
  const defaults = settings.current(config);
  const save = values => fetch(`${active.url}/settings`, { method: "POST", body: new URLSearchParams(values) });
  try {
    const initial = await fetch(`${active.url}/settings`);
    assert.equal(initial.status, 200);
    assert.match(await initial.text(), /LAN and Tailscale/);
    const values = { ...defaults, host: "0.0.0.0", port: 4321, requestDelayMs: 2500 };
    let response = await save(values);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Restart the app/);
    assert.equal(config.host, "127.0.0.1", "saving does not interrupt the current listener");
    assert.equal(settings.read(config.settingsPath).host, "0.0.0.0");
    assert.equal(fs.readdirSync(directory).filter(name => name.endsWith(".tmp")).length, 0);
    const fresh = JSON.parse(execFileSync(process.execPath, ["-e", 'const c = require("./src/config"); process.stdout.write(JSON.stringify({host:c.host,port:c.port,delay:c.findAGrave.requestDelayMs}));'], { cwd: path.resolve(__dirname, ".."), env: process.env, encoding: "utf8" }));
    assert.deepEqual(fresh, { host: "0.0.0.0", port: 4321, delay: 2500 });
    const original = fs.readFileSync(config.settingsPath, "utf8");
    for (const invalid of [{ host: "http://100.1.2.3" }, { host: "../bad" }, { port: "3000junk" }, { port: 0 }, { cooldownMinMs: 100, cooldownMaxMs: 99 }]) {
      assert.equal((await save({ ...values, ...invalid })).status, 400);
      assert.equal(fs.readFileSync(config.settingsPath, "utf8"), original);
    }
    response = await fetch(`${active.url}/settings`, { method: "POST", headers: { Origin: "https://other.example" }, body: new URLSearchParams(values) });
    assert.equal(response.status, 403);
    config.port = active.port;
    config.host = "127.0.0.1";
    recovery = await startDesktopServer();
    assert.notEqual(recovery.port, active.port);
    assert.equal(app.locals.network.host, "127.0.0.1");
    assert.match(app.locals.networkWarning, /EADDRINUSE/);
    const recoveryPage = await (await fetch(`${recovery.url}/settings`)).text();
    assert.match(recoveryPage, /temporary port/);
    assert.equal(settings.read(config.settingsPath).port, 4321);
    const allInterfaces = await startServer(0, "0.0.0.0");
    try {
      assert.equal(new URL(allInterfaces.url).hostname, "127.0.0.1");
      assert.equal((await fetch(allInterfaces.url)).status, 200);
    } finally { await new Promise(resolve => allInterfaces.server.close(resolve)); }
  } finally {
    if (recovery) await new Promise(resolve => recovery.server.close(resolve));
    await new Promise(resolve => active.server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
