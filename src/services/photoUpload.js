const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const multer = require("multer");
const os = require("node:os");
const sharp = require("sharp");
const config = require("../config");
const cleaning = require("../db/cleaning");
const { captureDate, validDate } = require("./photoDates");
const { isHeic, convertHeic } = require("./heicPhoto");

const upload = multer({
  // Stage batches on disk, then decode one image at a time to keep memory bounded.
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, callback) => callback(null, `gravescraper-upload-${randomUUID()}`)
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 20, fields: 4, fieldSize: 12000, parts: 24 }
}).array("photo", 20);

async function cleanupUploads(files = []) {
  await Promise.all(files.filter(file => file.path).map(file => fs.rm(file.path, { force: true })));
}

async function savePhoto(sessionId, file, stage, caption, photoDate) {
  if (!file) throw Object.assign(new Error("Choose a photo to upload."), { status: 400 });
  if (!file.buffer) file.buffer = await fs.readFile(file.path);
  const capturedAt = await captureDate(file.buffer);
  const dateSource = photoDate ? "manual" : "exif";
  photoDate = photoDate || capturedAt.slice(0, 10);
  if (!validDate(photoDate)) throw Object.assign(new Error("No capture date was found in this photo. Enter the photo / observation date."), { status: 400 });
  const filename = `${randomUUID()}.jpg`;
  const full = path.join(config.uploadsPath, filename);
  const thumb = path.join(config.uploadsPath, `thumb-${filename}`);
  let image;
  try {
    if (isHeic(file.buffer)) {
      image = await convertHeic(file.buffer);
    } else {
      const input = sharp(file.buffer, { limitInputPixels: 65000000, failOn: "warning" });
      const metadata = await input.metadata();
      if (!["jpeg", "png", "webp", "heif"].includes(metadata.format)) throw new Error("Unsupported format");
      image = await input.rotate().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    }
  } catch (error) {
    if (error.status === 503) throw error;
    throw Object.assign(new Error("Could not read this photo. Choose a valid HEIC, HEIF, JPEG, PNG, or WebP image (up to 65 megapixels)."), { status: 400 });
  }
  await fs.mkdir(config.uploadsPath, { recursive: true });
  try {
    await fs.writeFile(full, image, { flag: "wx" });
    await sharp(image).resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(thumb);
    // The session may have been deleted while the image was being processed.
    if (!cleaning.getSession(sessionId)) throw Object.assign(new Error("Cleaning session not found."), { status: 404 });
    return cleaning.addPhoto(sessionId, filename, stage, caption, photoDate, capturedAt, dateSource);
  } catch (error) {
    await Promise.all([full, thumb].map(filePath => fs.rm(filePath, { force: true })));
    throw error;
  }
}
async function savePhotos(sessionId, files, stage, caption, photoDate) {
  if (!files?.length) throw Object.assign(new Error("Choose at least one photo to upload."), { status: 400 });
  const saved = [];
  try {
    for (const file of files) {
      try { saved.push(await savePhoto(sessionId, file, stage, caption, photoDate)); }
      catch (error) {
        error.message = `${String(file.originalname || "Photo").slice(0, 200)}: ${error.message}`;
        throw error;
      } finally { delete file.buffer; }
    }
    return saved;
  } catch (error) {
    const removed = cleaning.removePhotos(saved.map(photo => photo.photo_id));
    await Promise.all(removed.flatMap(row => [row.filename, `thumb-${row.filename}`]).map(name => fs.rm(path.join(config.uploadsPath, name), { force: true })));
    throw error;
  }
}
module.exports = { upload, savePhoto, savePhotos, cleanupUploads };
