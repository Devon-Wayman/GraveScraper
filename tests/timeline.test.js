const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yauzl = require("yauzl");

function unzip(buffer) {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error);
    const files = {};
    zip.on("error", reject);
    zip.on("end", () => resolve(files));
    zip.on("entry", entry => zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      stream.on("error", reject);
      stream.on("data", chunk => chunks.push(chunk));
      stream.on("end", () => { files[entry.fileName] = Buffer.concat(chunks); zip.readEntry(); });
    }));
    zip.readEntry();
  }));
}

test("capture metadata, cross-session timeline, compression and portable ordered report", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gravesite-timeline-"));
  Object.assign(process.env, { DATABASE_PATH: path.join(directory, "test.sqlite"), UPLOADS_PATH: path.join(directory, "uploads"),
    GRAVESITE_CONFIG_FOLDER: directory, GRAVESITE_ENV_PATH: path.join(directory, ".env"), APP_ACCESS_TOKEN: "" });
  const { app } = require("../src/server");
  const db = require("../src/db");
  const cleaning = require("../src/db/cleaning");
  const sharp = require("sharp");
  db.prepare("INSERT INTO cemeteries (cemetery_id, cemetery_name, cemetery_url) VALUES ('1', 'Test Cemetery', 'https://example.com')").run();
  db.prepare("INSERT INTO memorials (memorial_id, cemetery_id, full_name, raw_payload) VALUES (1, '1', '<script>Test</script>', '{}')").run();
  const first = cleaning.saveSession(1, { visitDate: "2026-10-01", methods: "Water", notes: "First cleaning" });
  const second = cleaning.saveSession(1, { visitDate: "2026-11-01", methods: "Soft brush", notes: "Second cleaning" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const upload = (id, buffer, date) => {
    const form = new FormData();
    form.set("photo", new Blob([buffer], { type: "image/jpeg" }), "test.jpg");
    form.set("stage", "during"); form.set("caption", "<script>Caption</script>");
    if (date !== undefined) form.set("photoDate", date);
    return fetch(`${base}/api/v1/cleaning-sessions/${id}/photos`, { method: "POST", body: form });
  };
  try {
    const source = sharp({ create: { width: 3000, height: 1000, channels: 3, background: "green" } });
    const dated = await source.clone().withExif({ IFD2: { DateTimeOriginal: "2026:11:20 23:59:55" } }).jpeg({ quality: 100 }).toBuffer();
    let response = await upload(first.session_id, dated);
    assert.equal(response.status, 201);
    const photo = (await response.json()).photo;
    assert.equal(photo.photo_date, "2026-11-20");
    assert.equal(photo.captured_at, "2026-11-20T23:59:55");
    assert.equal(photo.date_source, "exif");
    const saved = Buffer.from(await (await fetch(base + photo.url)).arrayBuffer());
    const metadata = await sharp(saved).metadata();
    assert.equal(metadata.width, 2560);
    assert.equal(metadata.exif, undefined);
    assert.ok(saved.length < dated.length);
    // An earlier photo uploaded to a newer session must precede the older session's follow-up.
    response = await upload(second.session_id, dated, "2026-10-15");
    assert.equal(response.status, 201);
    assert.equal((await response.json()).photo.date_source, "manual");
    const undated = await source.clone().png().toBuffer();
    assert.equal((await upload(first.session_id, undated)).status, 400);
    assert.equal((await upload(first.session_id, dated, "2026-02-30")).status, 400);
    const events = (await (await fetch(`${base}/api/v1/memorials/1/timeline`)).json()).events;
    assert.deepEqual(events.map(event => event.date), ["2026-10-01", "2026-10-15", "2026-11-01", "2026-11-20"]);
    const html = await (await fetch(`${base}/memorials/1/timeline`)).text();
    assert.match(html, /&lt;script&gt;Test&lt;\/script&gt;/);
    assert.match(html, /Print \/ Save as PDF/);
    response = await fetch(`${base}/memorials/1/cleaning-progress.zip`);
    assert.equal(response.status, 200);
    const files = await unzip(Buffer.from(await response.arrayBuffer()));
    assert.ok(files["report.html"]);
    assert.ok(files["images/00001_2026-10-15_during.jpg"]);
    assert.ok(files["images/00002_2026-11-20_during.jpg"]);
    const report = files["report.html"].toString();
    assert.match(report, /src="images\/00001_2026-10-15_during.jpg"/);
    assert.ok(!report.includes("/api/v1/"));
    assert.ok(!report.includes("<script>Caption</script>"));
    assert.equal(JSON.parse(files["timeline.json"]).events.length, 4);
    for (const [name, image] of Object.entries(files)) if (name.endsWith(".jpg")) assert.equal((await sharp(image).metadata()).format, "jpeg");
    const empty = await fetch(`${base}/memorials/999/timeline`);
    assert.equal(empty.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
