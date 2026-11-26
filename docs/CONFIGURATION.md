# Configuration

[Back to README](../README.md)

## Settings and local configuration


In local development, GraveScraper reads `.env` from the project root.

In the packaged Electron app, GraveScraper creates and reads an editable `.env` next to the app when possible. If that location is not writable, it falls back to the app config folder, which you can open from **GraveScraper > Open Config Folder**.

Use **Settings** in the app navigation (or **GraveScraper > Settings** in Electron) to change the listen address, port, and import pacing without editing `.env`. Save, then choose **GraveScraper > Restart to apply settings**. The Node version requires restarting its process. Settings are saved atomically in `settings.json` in Electron's user-data folder, or alongside the database in the Node version. They survive application updates and override the corresponding `.env` values. Database/upload paths and integration credentials remain advanced `.env` settings; changing network settings does not move your records or photos.

- `PORT`: Express port, defaults to `3000`
- `DATABASE_PATH`: SQLite file location. In local dev this defaults to `./data/gravescraper.sqlite`; in Electron this defaults to `gravescraper.sqlite` in the config folder.
- `MEMORIAL_PAGE_SIZE`: FindAGrave page size, defaults to `100`
- `REQUEST_DELAY_MS`: Delay between memorial page requests, defaults to `2000`
- `REQUEST_COOLDOWN_EVERY`: Adds a longer cooldown after this many page requests, defaults to `3`
- `REQUEST_COOLDOWN_MIN_MS`: Minimum cooldown length, defaults to `3000`
- `REQUEST_COOLDOWN_MAX_MS`: Maximum cooldown length, defaults to `5000`
- `REQUEST_RATE_LIMIT_BACKOFF_MS`: How long to wait after a 429 before retrying, defaults to `120000`
- `FINDAGRAVE_MV`: Override the `mv` mobile header if needed
- `FINDAGRAVE_AK`: Supply the integration key locally before importing. No real key is included in the repository.


## Network access and storage


Open **Settings**, enter the PC's Tailscale IP as the listen address, choose a fixed port such as `3000`, save, and restart the app. Connect your phone to the same tailnet and open `http://<tailscale-ip>:3000`. The Settings page lists currently listening addresses and connection URLs.

| Listen address | Connections accepted |
| --- | --- |
| `127.0.0.1` | This computer only (default) |
| PC's Tailscale IP | Connections to that address; the LAN IPv4 address will not work |
| `0.0.0.0` | All IPv4 addresses, including LAN and Tailscale; use the actual LAN/Tailscale IP in your browser |

Allow the port through the host firewall if needed. Access through Tailscale is controlled by your tailnet policy; LAN access is controlled separately by the LAN and host firewall. No app password is required. Everyone allowed to reach a listening address can read and modify records.

Electron uses the saved fixed port and opens its own window at a reachable address, including when bound to a specific Tailscale IP. If that IP is unavailable or the port is occupied, Electron opens Settings on a temporary local port with an explanation so you can correct the configuration. It does not silently change your saved preferences. The desktop app must be running for phone access.

The browser supports camera/library selection where the device provides it, responsive forms, and photo upload progress. Uploads require a working connection; this version has no offline queue. Camera and photo-library picker behavior depends on the device/browser; HEIC conversion runs on the host.

Optional authentication remains available by setting `APP_ACCESS_TOKEN`. If set, browsers prompt for username `gravescraper` and that token as the password; API clients send `Authorization: Bearer <token>`. Leave it unset for Tailscale-only access. Tailscale encrypts traffic between connected devices; HTTPS can additionally be provided by a reverse proxy if desired. Cross-site mutation requests are rejected.

`UPLOADS_PATH` optionally changes photo storage; by default it is `uploads` alongside the SQLite database. **Back up the SQLite database and uploads together while the app is stopped.** Restoring only the database will not restore photos. Packaged Electron apps store them outside the application bundle beside their configured database.


## First-time import setup

Copy the blank [environment template](../.env.example) to `.env` locally and supply `FINDAGRAVE_AK` before importing. Credentials are not included in source. Existing local `.env` files are preserved. Never commit populated env files, keys, local databases, photos, or settings. Browsing stored records and working with cleaning photos does not require an import key.

Additional options are `HOST` (default `127.0.0.1`), `UPLOADS_PATH` (uploads beside the database), and optional `APP_ACCESS_TOKEN`. Saved listen-address, port, and pacing preferences override the corresponding environment defaults after restart.
