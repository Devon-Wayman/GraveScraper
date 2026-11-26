const fs = require("node:fs/promises");
const path = require("node:path");
const ejs = require("ejs");
const { ZipFile } = require("yazl");
const { pipeline } = require("node:stream/promises");
const cleaning = require("../db/cleaning");
const config = require("../config");

async function exportReport(res, memorial) {
  const events = cleaning.timeline(memorial.memorial_id);
  const files = [];
  const exported = events.map(event => {
    if (event.type !== "photo") return event;
    const row = cleaning.getPhotoFile(event.photo_id);
    const name = `images/${String(files.length + 1).padStart(5, "0")}_${event.date}_${event.stage}.jpg`;
    files.push({ source: path.join(config.uploadsPath, row.filename), name });
    return { ...event, url: name, thumbnail_url: name };
  });
  // Missing files fail before sending a partial archive presented as a valid report.
  for (const file of files) await fs.access(file.source);
  const report = await ejs.renderFile(path.join(__dirname, "../views/timeline.ejs"), { memorial, events: exported, offline: true });
  const archive = new ZipFile();
  archive.on("error", error => archive.outputStream.destroy(error));
  res.attachment(`memorial-${memorial.memorial_id}-cleaning-progress.zip`);
  const completion = pipeline(archive.outputStream, res);
  archive.addBuffer(Buffer.from(report), "report.html");
  archive.addBuffer(Buffer.from(JSON.stringify({ memorial_id: memorial.memorial_id, name: memorial.full_name, cemetery: memorial.cemetery_name, events: exported }, null, 2)), "timeline.json");
  for (const file of files) archive.addFile(file.source, file.name, { compress: false });
  archive.end();
  await completion;
}
module.exports = { exportReport };
