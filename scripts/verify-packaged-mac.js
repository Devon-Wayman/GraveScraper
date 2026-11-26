// Exercise the shipped native modules and HTTP routes using Electron's own Node runtime.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");

async function verify(bundle) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gravesite-packaged-"));
  Object.assign(process.env, {
    DATABASE_PATH: path.join(directory, "test.sqlite"),
    UPLOADS_PATH: path.join(directory, "uploads"),
    GRAVESITE_CONFIG_FOLDER: directory,
    GRAVESITE_ENV_PATH: path.join(directory, ".env"),
    APP_ACCESS_TOKEN: "", HOST: "127.0.0.1", PORT: "0"
  });
  const requireApp = createRequire(path.join(bundle, "Contents/Resources/app.asar/package.json"));
  let running;
  let db;
  try {
    const sharp = requireApp("sharp");
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: "green" } })
      .withExif({ IFD2: { DateTimeOriginal: "2026:10:20 12:30:00" } }).jpeg().toBuffer();
    const { startServer } = requireApp("./src/server");
    db = requireApp("./src/db");
    db.prepare("INSERT INTO cemeteries (cemetery_id, cemetery_name, cemetery_url) VALUES ('1', 'Smoke Test', 'https://example.com')").run();
    db.prepare("INSERT INTO memorials (memorial_id, cemetery_id, full_name, raw_payload) VALUES (1, '1', 'Smoke Test', '{}')").run();
    running = await startServer(0);
    for (const route of ["/", "/settings", "/memorials/1", "/memorials/1/timeline", "/photo-metadata.js"]) {
      const response = await fetch(running.url + route);
      if (!response.ok) throw new Error(`${route} returned ${response.status}`);
    }
    const sessionResponse = await fetch(`${running.url}/api/v1/memorials/1/cleaning-sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitDate: "2026-10-20" })
    });
    if (sessionResponse.status !== 201) throw new Error("Packaged session creation failed.");
    const { session } = await sessionResponse.json();
    if (session.entry_type !== "pre-cleaning") throw new Error("Packaged first entry is not pre-cleaning.");
    const projects = await fetch(`${running.url}/api/v1/active-cleaning?q=Smoke`);
    if ((await projects.json()).total !== 1) throw new Error("Packaged active cleaning search failed.");
    const form = new FormData();
    form.set("photo", new Blob([image], { type: "image/png" }), "test.png");
    form.set("stage", "before");
    const uploaded = await fetch(`${running.url}/api/v1/cleaning-sessions/${session.session_id}/photos`, { method: "POST", body: form });
    if (uploaded.status !== 201) throw new Error(`Packaged photo upload failed: ${await uploaded.text()}`);
    const { photo } = await uploaded.json();
    if (photo.photo_date !== "2026-10-20" || photo.date_source !== "exif") throw new Error("Packaged capture-date detection failed.");
    for (const route of [photo.url, photo.thumbnail_url]) {
      const response = await fetch(running.url + route);
      if (!response.ok) throw new Error(`Packaged image retrieval failed: ${route}`);
      await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    }
    const heicForm = new FormData();
    heicForm.set("photo", new Blob([fs.readFileSync(path.join(__dirname, "../tests/fixtures/gradient.heic"))], { type: "image/heic" }), "test.heic");
    heicForm.append("photo", new Blob([image], { type: "image/jpeg" }), "second-angle.jpg");
    const heicResponse = await fetch(`${running.url}/api/v1/cleaning-sessions/${session.session_id}/photos`, { method: "POST", body: heicForm });
    if (heicResponse.status !== 201) throw new Error(`Packaged HEIC upload failed: ${await heicResponse.text()}`);
    const batch = (await heicResponse.json()).photos;
    if (batch.length !== 2) throw new Error("Packaged multi-photo upload failed.");
    const heicPhoto = batch[0];
    if (heicPhoto.photo_date !== "2026-11-21") throw new Error("Packaged HEIC capture date failed.");
    const heicJpeg = Buffer.from(await (await fetch(running.url + heicPhoto.url)).arrayBuffer());
    if ((await sharp(heicJpeg).metadata()).format !== "jpeg") throw new Error("Packaged HEIC was not saved as JPEG.");
    const report = await fetch(`${running.url}/memorials/1/cleaning-progress.zip`);
    const zip = Buffer.from(await report.arrayBuffer());
    if (!report.ok || zip.readUInt32LE(0) !== 0x04034b50) throw new Error("Packaged report export failed.");
    if (!(await fetch(`${running.url}/api/v1/photos/${heicPhoto.photo_id}`, { method: "DELETE" })).ok) throw new Error("Packaged photo deletion failed.");
    if (!(await fetch(`${running.url}/api/v1/cleaning-sessions/${session.session_id}`, { method: "DELETE" })).ok) throw new Error("Packaged entry deletion failed.");
    if ((await fetch(running.url + photo.url)).status !== 404) throw new Error("Deleted entry still exposes images.");
    console.log("Packaged app verified: pre-cleaning baseline, HEIC batches, reports, photo deletion, and entry deletion.");
  } finally {
    if (running) await new Promise(resolve => running.server.close(resolve));
    if (db) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--worker") {
  verify(path.resolve(process.argv[3])).catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const bundle = path.resolve(process.argv[2] || `dist/mac-${process.arch}/GraveScraper.app`);
  execFileSync(path.join(bundle, "Contents/MacOS/GraveScraper"), [__filename, "--worker", bundle], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "inherit", timeout: 30000
  });
}
