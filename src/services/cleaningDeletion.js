const fs = require("node:fs/promises");
const path = require("node:path");
const config = require("../config");

async function removePhotoFiles(rows) {
  const files = rows.flatMap(row => [row.filename, `thumb-${row.filename}`]);
  const results = await Promise.allSettled(files.map(name => fs.rm(path.join(config.uploadsPath, name), { force: true })));
  const failures = results.filter(result => result.status === "rejected");
  failures.forEach(result => console.error("Unable to remove deleted cleaning photo:", result.reason.message));
  return failures.length ? "The entry was deleted, but some image files could not be removed from storage. Check the upload folder’s permissions." : null;
}

module.exports = { removePhotoFiles };
