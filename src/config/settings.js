const fs = require("node:fs");
const path = require("node:path");
const { isIP } = require("node:net");
const { randomUUID } = require("node:crypto");

const numericFields = {
  port: { label: "Port", min: 1, max: 65535 },
  memorialPageSize: { label: "Memorials per request", min: 1, max: 100 },
  requestDelayMs: { label: "Request delay (ms)", min: 0, max: 3600000 },
  cooldownEveryRequests: { label: "Requests between cooldowns", min: 1, max: 1000 },
  cooldownMinMs: { label: "Minimum cooldown (ms)", min: 0, max: 3600000 },
  cooldownMaxMs: { label: "Maximum cooldown (ms)", min: 0, max: 3600000 },
  rateLimitBackoffMs: { label: "Rate-limit retry delay (ms)", min: 1000, max: 86400000 }
};

function validate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid settings.");

  const result = {};

  if (Object.hasOwn(input, "host")) {
    if (typeof input.host !== "string") {
      throw new Error("Enter an IP address or localhost.");
    }

    result.host = input.host.trim();

    if (result.host !== "localhost" && !isIP(result.host)) {
      throw new Error("Enter an IP address or localhost, without http:// or a port.");
    }
  }

  for (const [key, spec] of Object.entries(numericFields)) {
    if (!Object.hasOwn(input, key)) continue;

    const raw = input[key];

    if (!["string", "number"].includes(typeof raw) || !/^\d+$/.test(String(raw))) {
      throw new Error(`${spec.label} must be a whole number.`);
    }

    const value = Number(raw);

    if (!Number.isSafeInteger(value) || value < spec.min || value > spec.max) {
      throw new Error(`${spec.label} must be between ${spec.min} and ${spec.max}.`);
    }

    result[key] = value;
  }

  if (result.cooldownMinMs !== undefined && result.cooldownMaxMs !== undefined && result.cooldownMinMs > result.cooldownMaxMs) {
    throw new Error("Minimum cooldown must not exceed maximum cooldown.");
  }

  return result;
}

function read(file) {
  if (!fs.existsSync(file)) return {};

  return validate(JSON.parse(fs.readFileSync(file, "utf8")));
}

function write(file, values) {
  const settings = validate(values);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;

  try {
    fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }

  return settings;
}

function current(config) {
  return {
    host: config.host, port: config.port,
    ...Object.fromEntries(Object.keys(numericFields).filter(key => key !== "port").map(key => [key, config.findAGrave[key]]))
  };
}

module.exports = { numericFields, validate, read, write, current };
