const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("HEIC uploads become dated JPEGs and removed scraping features stay unavailable", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gravesite-heic-"));
  Object.assign(process.env, { DATABASE_PATH: path.join(directory, "test.sqlite"), UPLOADS_PATH: path.join(directory, "uploads"),
    GRAVESITE_CONFIG_FOLDER: directory, GRAVESITE_ENV_PATH: path.join(directory, ".env"), APP_ACCESS_TOKEN: "" });
  const { app } = require("../src/server");
  const db = require("../src/db");
  const cleaning = require("../src/db/cleaning");
  const sharp = require("sharp");
  const { PROVIDERS, searchProvider } = require("../src/services/researchProviders");
  db.prepare("INSERT INTO cemeteries (cemetery_id, cemetery_name, cemetery_url) VALUES ('1', 'Test Cemetery', 'https://example.com')").run();
  db.prepare("INSERT INTO memorials (memorial_id, cemetery_id, full_name, raw_payload) VALUES (1, '1', 'Test Memorial', '{}')").run();
  const session = cleaning.saveSession(1, { visitDate: "2026-11-21", methods: "Water", notes: "" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const upload = (buffer, date) => {
    const form = new FormData();
    form.set("photo", new Blob([buffer], { type: "image/heic" }), "photo.HEIC");
    form.set("stage", "after");
    if (date) form.set("photoDate", date);
    return fetch(`${base}/api/v1/cleaning-sessions/${session.session_id}/photos`, { method: "POST", body: form });
  };
  try {
    const fixture = fs.readFileSync(path.join(__dirname, "fixtures/gradient.heic"));
    let response = await upload(fixture);
    assert.equal(response.status, 201);
    const photo = (await response.json()).photo;
    assert.equal(photo.photo_date, "2026-11-21");
    assert.equal(photo.captured_at, "2026-11-21T14:35:20");
    assert.equal(photo.date_source, "exif");
    response = await fetch(base + photo.url);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    const jpeg = Buffer.from(await response.arrayBuffer());
    assert.equal(jpeg.readUInt16BE(0), 0xffd8);
    const metadata = await sharp(jpeg).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, 160);
    assert.equal(metadata.height, 96);
    assert.equal(metadata.exif, undefined);
    const raw = await sharp(jpeg).raw().toBuffer();
    assert.ok(raw[0] < 20 && raw[1] < 20, "gradient orientation is preserved");
    const bottomRight = (160 * 96 - 1) * 3;
    assert.ok(raw[bottomRight] > 230 && raw[bottomRight + 1] > 230);
    assert.equal((await fetch(base + photo.thumbnail_url)).status, 200);
    assert.deepEqual(fs.readdirSync(process.env.UPLOADS_PATH).map(name => path.extname(name)), [".jpg", ".jpg"]);
    response = await upload(fixture, "2026-11-19");
    assert.equal((await response.json()).photo.photo_date, "2026-11-19");
    const corrupt = Buffer.alloc(100);
    corrupt.write("ftypheic", 4);
    assert.equal((await upload(corrupt, "2026-11-21")).status, 400);
    assert.equal(fs.readdirSync(process.env.UPLOADS_PATH).length, 4);
    assert.ok(!PROVIDERS.some(provider => ["wikidata", "wikipedia"].includes(provider.key)));
    await assert.rejects(searchProvider("wikidata", { full_name: "Test Memorial" }), /Unknown research provider/);
    for (const route of ["/memorials/1/images/findagrave", "/api/memorials/1/images/findagrave", "/memorial-images/1/approve", "/api/memorial-images/1/approve"]) {
      assert.equal((await fetch(base + route, { method: "POST" })).status, 404);
    }
    const html = await (await fetch(base + "/memorials/1")).text();
    assert.ok(!html.includes("Find images") && !html.includes("Wikidata") && !html.includes("Memorial Images"));
    assert.ok(html.includes("image/heic") && html.includes("Cleaning history"));
    assert.equal((await fetch(`${base}/memorials/1/timeline`)).status, 200);
    assert.equal((await fetch(`${base}/memorials/1/cleaning-progress.zip`)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});
