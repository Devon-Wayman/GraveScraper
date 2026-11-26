const path = require("path");
const express = require("express");
const config = require("./config");
const routes = require("./routes");
require("./db");

const app = express();
app.disable("x-powered-by");
app.use(require("./middleware/access"));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Parse form submissions and JSON requests used by the UI and API routes.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(require("./routes/settings"));

app.use(require("./routes/mobile"));
app.use(routes);

// Catch-all 404 handler stays last so earlier routes get the first chance to match.
app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Endpoint not found." });
  res.status(404).render("404");
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  const message = status === 400 ? "Invalid request body." : status === 413 ? "Request is too large." : "Unable to complete the request.";
  if (status === 500) console.error(error);
  if (req.path.startsWith("/api/")) return res.status(status).json({ error: message });
  res.status(status).render("action-error", { message });
});

function startServer(port = config.port, host = config.host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      const clientHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
      const url = `http://${clientHost.includes(":") ? `[${clientHost}]` : clientHost}:${resolvedPort}`;
      app.locals.network = { host, port: resolvedPort };
      console.log(`GraveScraper Node app listening on ${url}`);
      resolve({ app, server, port: resolvedPort, url });
    });
    server.on("error", reject);
  });
}

async function startDesktopServer() {
  try {
    app.locals.networkWarning = null;
    return await startServer();
  } catch (error) {
    if (!["EADDRINUSE", "EADDRNOTAVAIL", "EACCES", "ENOTFOUND"].includes(error.code)) throw error;
    app.locals.networkWarning = `Could not listen on ${config.host}:${config.port} (${error.code}). Running locally on a temporary port. Update Settings and restart to restore network access.`;
    return startServer(0, "127.0.0.1");
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  startDesktopServer
};
