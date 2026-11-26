const { parentPort, workerData } = require("node:worker_threads");
const decode = require("heic-decode");
const sharp = require("sharp");

(async () => {
  let images;

  try {
    images = await decode.all({ buffer: Buffer.from(workerData) });
    const first = images[0];

    if (!first || first.width < 1 || first.height < 1 || first.width * first.height > 65000000) {
      throw new Error("HEIC image exceeds the 65 megapixel limit.");
    }

    const { width, height, data } = await first.decode();

    // libheif applies HEIF container transforms; raw pixels must not be rotated a second time.
    const jpeg = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } })
      .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    parentPort.postMessage({ jpeg });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  } finally {
    if (images) images.dispose();
  }
})();
