const { Worker } = require("node:worker_threads");
const path = require("node:path");
let active = 0;

function isHeic(buffer) {
  if (buffer.length < 16 || buffer.toString("ascii", 4, 8) !== "ftyp") {
    return false;
  }

  return ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(buffer.toString("ascii", 8, 12));
}

function convertHeic(buffer) {
  if (active >= 2) {
    return Promise.reject(Object.assign(new Error("HEIC conversion is busy. Please try again shortly."), { status: 503 }));
  }

  active += 1;

  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    let done = false;
    const finish = (error, jpeg) => {
      if (done) return;

      done = true;
      active -= 1;
      clearTimeout(timer);
      if (worker) {
        worker.terminate().catch(() => { });
      }

      if (error) reject(error); else resolve(jpeg);
    };

    try {
      worker = new Worker(path.join(__dirname, "heicWorker.js"), { workerData: buffer });
      timer = setTimeout(() => finish(new Error("HEIC conversion timed out. Try a smaller image.")), 45000);
      worker.once("message", result => finish(result.error ? new Error(result.error) : null, result.jpeg && Buffer.from(result.jpeg)));
      worker.once("error", error => finish(error));
      worker.once("exit", code => { if (!done) finish(new Error(`HEIC decoder stopped (${code}).`)); });
    } catch (error) {
      finish(error);
    }
  });
}

module.exports = { isHeic, convertHeic };
