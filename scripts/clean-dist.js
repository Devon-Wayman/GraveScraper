const fs = require("fs");
const path = require("path");

const distDir = path.resolve(__dirname, "..", "dist");
const keepExtensions = new Set([
  ".dmg",
  ".exe",
  ".AppImage"
]);

if (!fs.existsSync(distDir)) {
  process.exit(0);
}

for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
  const entryPath = path.join(distDir, entry.name);
  const shouldKeep = entry.isFile() && keepExtensions.has(path.extname(entry.name));

  if (!shouldKeep) {
    fs.rmSync(entryPath, { recursive: true, force: true });
  }
}
