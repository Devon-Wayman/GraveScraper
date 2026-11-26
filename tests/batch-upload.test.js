const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("mixed photo batches preserve per-image dates, share labels, and roll back failures", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gravesite-batch-"));
  const staging = path.join(directory, "staging");
  fs.mkdirSync(staging);
  Object.assign(process.env, { DATABASE_PATH: path.join(directory, "test.sqlite"), UPLOADS_PATH: path.join(directory, "uploads"),
    GRAVESITE_CONFIG_FOLDER: directory, GRAVESITE_ENV_PATH: path.join(directory, ".env"), APP_ACCESS_TOKEN: "", TMPDIR: staging });
  const { app } = require("../src/server");
  const db = require("../src/db");
  const cleaning = require("../src/db/cleaning");
  const sharp = require("sharp");
  db.prepare("INSERT INTO cemeteries (cemetery_id, cemetery_name, cemetery_url) VALUES ('1', 'Test Cemetery', 'https://example.com')").run();
  db.prepare("INSERT INTO memorials (memorial_id, cemetery_id, full_name, raw_payload) VALUES (1, '1', 'Test Memorial', '{}')").run();
  const session = cleaning.saveSession(1, { visitDate: "2026-11-20", methods: "Water", notes: "" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const jpeg = await sharp({ create: { width: 10, height: 10, channels: 3, background: "green" } })
    .withExif({ IFD2: { DateTimeOriginal: "2026:11:20 10:30:00" } }).jpeg().toBuffer();
  const heic = fs.readFileSync(path.join(__dirname, "fixtures/gradient.heic"));
  const upload = (files, fields = {}, browser = false) => {
    const form = new FormData();
    for (const [name, buffer] of files) form.append("photo", new Blob([buffer]), name);
    for (const [name, value] of Object.entries({ stage: "before", caption: "Multiple angles", ...fields })) form.set(name, value);
    const prefix = browser ? "" : "/api/v1";
    return fetch(`${base}${prefix}/cleaning-sessions/${session.session_id}/photos`, { method: "POST", body: form, redirect: "manual" });
  };
  const unchanged = (rows, files) => {
    assert.equal(cleaning.getSession(session.session_id).photos.length, rows);
    assert.equal(fs.readdirSync(process.env.UPLOADS_PATH).length, files);
    assert.deepEqual(fs.readdirSync(staging), []);
  };
  try {
    let response = await upload([["side.heic", heic], ["front.jpg", jpeg]]);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.photos.length, 2);
    assert.deepEqual(body.photos.map(photo => photo.photo_date), ["2026-11-21", "2026-11-20"]);
    assert.ok(body.photos.every(photo => photo.stage === "before" && photo.caption === "Multiple angles" && photo.date_source === "exif"));
    assert.deepEqual(cleaning.timeline(1).filter(event => event.type === "photo").map(photo => photo.date), ["2026-11-20", "2026-11-21"]);
    unchanged(2, 4);
    response = await upload([["a.jpg", jpeg], ["b.jpg", jpeg]], { photoDate: "2026-11-19", stage: "after" });
    assert.equal(response.status, 201);
    assert.ok((await response.json()).photos.every(photo => photo.photo_date === "2026-11-19" && photo.stage === "after"));
    unchanged(4, 8);
    response = await upload([["good.jpg", jpeg], ["bad.jpg", Buffer.from("not an image")]], { photoDate: "2026-11-19" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /bad.jpg/);
    unchanged(4, 8);
    const undated = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    response = await upload([["good.jpg", jpeg], ["undated.png", undated]]);
    assert.equal(response.status, 400);
    unchanged(4, 8);
    response = await upload(Array.from({ length: 21 }, (_, i) => [`${i}.jpg`, jpeg]));
    assert.equal(response.status, 400);
    unchanged(4, 8);
    response = await upload([["good.jpg", jpeg]], { stage: "invalid" });
    assert.equal(response.status, 400);
    unchanged(4, 8);
    response = await upload([["a.jpg", jpeg], ["b.jpg", jpeg]], {}, true);
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location"), /2%20photo/);
    unchanged(6, 12);
    const html = await (await fetch(base + "/memorials/1")).text();
    assert.match(html, /multiple required/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
