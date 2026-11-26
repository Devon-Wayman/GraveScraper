const crypto = require("crypto");
const config = require("../config");

module.exports = function access(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");

  if (config.accessToken) {
    const authorization = req.get("authorization") || "";
    let supplied = "";

    if (authorization.startsWith("Bearer ")) {
      supplied = authorization.slice(7);
    }

    if (authorization.startsWith("Basic ")) {
      const credentials = Buffer.from(authorization.slice(6), "base64").toString();

      if (credentials.startsWith("gravescraper:")) {
        supplied = credentials.slice(13);
      }
    }

    const hash = value => crypto.createHash("sha256").update(value).digest();

    if (!crypto.timingSafeEqual(hash(supplied), hash(config.accessToken))) {
      res.setHeader("WWW-Authenticate", 'Basic realm="GraveScraper", charset="UTF-8"');
      return res.status(401).json({ error: "Authentication required." });
    }

    res.setHeader("Cache-Control", "private, no-store");
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    let foreignOrigin = false;

    if (req.get("origin")) {
      try {
        foreignOrigin = new URL(req.get("origin")).host !== req.get("host");
      }
      catch {
        foreignOrigin = true;
      }
    }

    if (foreignOrigin || req.get("sec-fetch-site") === "cross-site") {
      return res.status(403).json({ error: "Cross-site changes are not allowed." });
    }
  }
  next();
};
