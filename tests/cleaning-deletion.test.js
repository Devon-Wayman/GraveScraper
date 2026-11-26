const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("pre-cleaning baseline and confirmed deletion preserve other entries and remove photo files", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gravesite-deletion-"));
  Object.assign(process.env, { DATABASE_PATH: path.join(directory, "test.sqlite"), UPLOADS_PATH: path.join(directory, "uploads"),
    GRAVESITE_CONFIG_FOLDER: directory, GRAVESITE_ENV_PATH: path.join(directory, ".env"), APP_ACCESS_TOKEN: "" });
  const { app } = require("../src/server");
  const db = require("../src/db");
  const cleaning = require("../src/db/cleaning");
  db.prepare("INSERT INTO cemeteries (cemetery_id, cemetery_name, cemetery_url) VALUES ('1', 'Test Cemetery', 'https://example.com')").run();
  db.prepare("INSERT INTO memorials (memorial_id, cemetery_id, full_name, raw_payload) VALUES (1, '1', 'Test Memorial', '{}')").run();
  const first = cleaning.saveSession(1, { visitDate: "2026-11-20", methods: "", notes: "Initial condition, no work yet" });
  assert.equal(first.entry_type, "pre-cleaning", "baseline exists without any photos");
  const second = cleaning.saveSession(1, { visitDate: "2026-11-21", methods: "Water", notes: "Actual cleaning" });
  assert.equal(second.entry_type, "cleaning");
  fs.mkdirSync(process.env.UPLOADS_PATH);
  function addPhoto(sessionId, filename, date) {
    fs.writeFileSync(path.join(process.env.UPLOADS_PATH, filename), "fixture");
    fs.writeFileSync(path.join(process.env.UPLOADS_PATH, `thumb-${filename}`), "fixture");
    return cleaning.addPhoto(sessionId, filename, "during", "", date);
  }
  const before = addPhoto(first.session_id, "before.jpg", "2026-11-20");
  assert.equal(before.stage, "before", "legacy first-day progress defaults display as Before");
  const followup = addPhoto(first.session_id, "followup.jpg", "2026-11-25");
  assert.equal(followup.stage, "during", "later follow-ups remain progress");
  const other = addPhoto(second.session_id, "other.jpg", "2026-11-21");
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, fields = {}) => fetch(base + route, { method: "POST", body: new URLSearchParams(fields), redirect: "manual" });
  try {
    const html = await (await fetch(base + "/memorials/1")).text();
    assert.match(html, /Pre-cleaning record/);
    assert.match(html, /2 attached photo/);
    assert.equal((await post(`/cleaning-sessions/${first.session_id}/delete`)).status, 400);
    assert.ok(cleaning.getSession(first.session_id));
    assert.equal((await fetch(base + `/cleaning-sessions/${first.session_id}/delete`)).status, 404);
    assert.equal((await post(`/photos/${before.photo_id}/delete`)).status, 400);
    let response = await post(`/photos/${before.photo_id}/delete`, { confirmation: "delete" });
    assert.equal(response.status, 302);
    assert.equal(cleaning.getPhotoFile(before.photo_id), undefined);
    assert.equal(cleaning.getSession(first.session_id).photos.length, 1);
    assert.equal(fs.existsSync(path.join(process.env.UPLOADS_PATH, "before.jpg")), false);
    response = await post(`/cleaning-sessions/${first.session_id}/delete`, { confirmation: "delete" });
    assert.equal(response.status, 302);
    assert.equal(cleaning.getSession(first.session_id), null);
    assert.equal(cleaning.getPhotoFile(followup.photo_id), undefined);
    assert.equal(fs.existsSync(path.join(process.env.UPLOADS_PATH, "thumb-followup.jpg")), false);
    assert.ok(cleaning.getSession(second.session_id));
    assert.ok(cleaning.getPhotoFile(other.photo_id));
    assert.equal(cleaning.getSession(second.session_id).entry_type, "pre-cleaning", "earliest remaining entry is the baseline");
    assert.equal((await fetch(base + followup.url)).status, 404);
    assert.equal((await fetch(base + `/api/v1/cleaning-sessions/${first.session_id}`, { method: "DELETE" })).status, 404);
    response = await fetch(base + `/api/v1/photos/${other.photo_id}`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.deepEqual(fs.readdirSync(process.env.UPLOADS_PATH), []);
    response = await fetch(base + `/api/v1/cleaning-sessions/${second.session_id}`, { method: "DELETE" });
    assert.equal(response.status, 200);
    assert.deepEqual(cleaning.timeline(1), []);
    const late = cleaning.saveSession(1, { visitDate: "2026-11-22", methods: "", notes: "" });
    const earlier = cleaning.saveSession(1, { visitDate: "2026-11-19", methods: "", notes: "Backdated initial visit" });
    assert.equal(earlier.entry_type, "pre-cleaning");
    assert.equal(cleaning.getSession(late.session_id).entry_type, "cleaning");
    assert.equal((await post(`/cleaning-sessions/${earlier.session_id}/delete`, { confirmation: "delete" })).status, 302);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
