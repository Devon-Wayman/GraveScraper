const express = require("express");
const os = require("node:os");
const config = require("../config");
const settings = require("../config/settings");
const router = express.Router();

function connectionUrls(network) {
  if (!network) return [];

  let addresses = [network.host];

  if (["0.0.0.0", "::"].includes(network.host)) {
    addresses = ["127.0.0.1", ...Object.values(os.networkInterfaces()).flat().filter(item => item && !item.internal && (network.host === "::" || item.family === "IPv4")).map(item => item.address)];
  }

  return [...new Set(addresses)].map(host => `http://${host.includes(":") ? `[${host}]` : host}:${network.port}`);
}

function render(req, res, values, error = null, message = null) {
  res.render("settings", {
    values, error, message,
    numericFields: settings.numericFields,
    desktop: Boolean(process.versions.electron),
    settingsPath: config.settingsPath,
    network: req.app.locals.network || null,
    warning: req.app.locals.networkWarning || config.settingsError || null,
    urls: connectionUrls(req.app.locals.network)
  });
}

router.get("/settings", (req, res) => {
  try {
    render(req, res, { ...settings.current(config), ...settings.read(config.settingsPath) });
  }
  catch (error) {
    render(req, res, settings.current(config), error.message);
  }
});

router.post("/settings", (req, res) => {
  // Only explicitly supported preferences can be edited, never arbitrary env or paths.
  const values = { host: req.body.host, ...Object.fromEntries(Object.keys(settings.numericFields).map(key => [key, req.body[key]])) };

  try {
    settings.write(config.settingsPath, values);
    render(req, res, settings.validate(values), null, "Settings saved. Restart the app to apply changes. Your current connection stays active until then.");
  } catch (error) {
    res.status(400);
    render(req, res, values, error.code ? "Unable to save settings. Check that the app’s configuration folder is writable." : error.message);
  }
});

module.exports = router;
