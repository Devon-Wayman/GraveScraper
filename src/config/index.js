const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const envPath = process.env.GRAVESITE_ENV_PATH ?? path.join(ROOT_DIR, ".env");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

const config = {
  // Central app config with environment overrides for local dev and deployment.
  rootDir: ROOT_DIR,
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  host: process.env.HOST || "127.0.0.1",
  accessToken: process.env.APP_ACCESS_TOKEN || "",
  uploadsPath: process.env.UPLOADS_PATH || path.join(
    path.dirname(process.env.DATABASE_PATH || (process.env.GRAVESITE_CONFIG_FOLDER
      ? path.join(process.env.GRAVESITE_CONFIG_FOLDER, "gravescraper.sqlite")
      : path.join(ROOT_DIR, "data", "gravescraper.sqlite"))), "uploads"
  ),
  envPath,
  databasePath: process.env.DATABASE_PATH
    || (process.env.GRAVESITE_CONFIG_FOLDER
      ? path.join(process.env.GRAVESITE_CONFIG_FOLDER, "gravescraper.sqlite")
      : path.join(ROOT_DIR, "data", "gravescraper.sqlite")),
  findAGrave: {
    baseUrl: "https://www.findagrave.com",
    graphqlUrl: "https://www.findagrave.com/orc/graphql",
    memorialPageSize: Number.parseInt(process.env.MEMORIAL_PAGE_SIZE ?? "100", 10),
    // Baseline pause between page requests.
    requestDelayMs: Number.parseInt(process.env.REQUEST_DELAY_MS ?? "2000", 10),
    // Extra cooldown after every few requests to reduce the chance of upstream rate limiting.
    cooldownEveryRequests: Number.parseInt(process.env.REQUEST_COOLDOWN_EVERY ?? "3", 10),
    cooldownMinMs: Number.parseInt(process.env.REQUEST_COOLDOWN_MIN_MS ?? "3000", 10),
    cooldownMaxMs: Number.parseInt(process.env.REQUEST_COOLDOWN_MAX_MS ?? "5000", 10),
    rateLimitBackoffMs: Number.parseInt(process.env.REQUEST_RATE_LIMIT_BACKOFF_MS ?? "120000", 10),
    headers: {
      // These integration headers may need updating if FindAGrave changes its current client expectations.
      mv: process.env.FINDAGRAVE_MV ?? "ios:1.22.3",
      ak: process.env.FINDAGRAVE_AK || ""
    }
  }
};

// User settings live outside the bundle and take precedence over legacy .env defaults.
const settings = require("./settings");
config.settingsPath = path.join(process.env.GRAVESITE_CONFIG_FOLDER || path.dirname(config.databasePath), "settings.json");
try {
  const saved = settings.read(config.settingsPath);
  if (saved.host !== undefined) config.host = saved.host;
  if (saved.port !== undefined) config.port = saved.port;
  for (const key of Object.keys(settings.numericFields)) {
    if (key !== "port" && saved[key] !== undefined) config.findAGrave[key] = saved[key];
  }
} catch (error) {
  config.settingsError = `Saved settings could not be loaded: ${error.message}`;
  console.error(config.settingsError);
}
module.exports = config;
