# GraveScraper

Keep cemetery records, cleaning projects, and progress photos together. GraveScraper helps you record permissions, document a memorial’s condition before cleaning, and follow its progress over time.

## What you can do

- **Organize cemeteries and memorials.** Import records from FindAGrave, browse names, and keep personal notes.
- **Track permission to clean.** Record cemetery owners, contact details, permission progress, and requirements to follow.
- **Find ongoing projects.** Search active graves across cemeteries and mark projects active, monitoring, paused, or complete.
- **Build a cleaning timeline.** Start with a pre-cleaning record, then add cleaning visits and dated follow-ups. Expand an entry to see its notes and grouped photos.
- **Upload multiple angles.** Add up to 20 HEIC/HEIF, JPEG, PNG, or WebP photos at once. Images are converted to compressed JPEGs, with capture dates retained for the timeline.
- **Share progress reports.** Print a report or export a ZIP containing a portable report and chronologically numbered images.
- **Browse related memorials.** Desktop FindAGrave windows include Back, Forward, Refresh, and Original page controls.
- **Use your phone.** Access the running app through your LAN or Tailscale, with responsive forms and photo uploads.

## Three ways to use GraveScraper

### 1. Desktop app with Electron

The desktop app runs GraveScraper in its own window, including the local server. Settings, records, and photos are stored separately from the installed application.

Packaged installers have not yet been published to [GitHub Releases](https://github.com/Devon-Wayman/GraveScraper/releases). To run or package the desktop app from source, install Node.js and npm, clone this repository, and run:

```bash
npm install
cp .env.example .env
npx electron-builder install-app-deps
npm run electron
```

To build an installer for your platform, use one of:

```bash
npm run electron:dist:mac
npm run electron:dist:win
npm run electron:dist:linux
```

Installers are written to `dist/`. Build on the target platform where possible. See the [development guide](docs/DEVELOPMENT.md) for native dependencies, packaging, and validation.

### 2. Local Node server in your browser

Run the same application from a terminal without opening Electron:

```bash
npm install
cp .env.example .env
npm start
```

Open **http://127.0.0.1:3000** in your browser. Keep the terminal process running while you use the app; press **Ctrl+C** to stop it.

If you previously ran or built Electron in this checkout, run `npm rebuild better-sqlite3` before starting the standalone Node server.

Copy the template only when creating your local configuration; keep an existing populated `.env` when updating. FindAGrave imports require a locally supplied integration key. See [configuration](docs/CONFIGURATION.md) for setup, storage, and network access.

### 3. API access

The desktop app and standalone Node server both expose a versioned API for reading records, updating projects, recording visits, and uploading photos. Start either one before making requests.

For example, with the server running locally:

```bash
curl http://127.0.0.1:3000/api/v1/cemeteries
curl http://127.0.0.1:3000/api/v1/active-cleaning
```

Use the address and port shown in Settings when connecting from another device. See the [API reference](docs/API.md) for endpoints, authentication, photo batches, and examples.

## A typical cleaning project

1. Import a cemetery and open a memorial.
2. Record ownership and cleaning permission on the cemetery page.
3. Create a **Pre-cleaning** record of the initial condition; photos are optional.
4. Add a cleaning session with the date, methods, and observations.
5. Use **Add check-in / photos** to document changes over the following days or months.
6. Find the grave again under **Active cleaning**, then export a report or mark the project complete.

## Your records and photos

Records and uploaded photos stay on the computer running GraveScraper. Back up both together. Keep original photos separately if you need their full resolution and original metadata.

When you enable network access, devices allowed to reach the app can read and modify records unless optional authentication is configured. The host app must remain running for phone access, and uploads need a live connection.

## More help

- [User guide](docs/USER_GUIDE.md) — sessions, photos, reports, and project tracking
- [Configuration](docs/CONFIGURATION.md) — local settings, storage, network access, and credentials
- [Development](docs/DEVELOPMENT.md) — source layout, tests, Electron builds, and troubleshooting
- [API reference](docs/API.md) — programmatic access and upload examples
- [Issues](https://github.com/Devon-Wayman/GraveScraper/issues) — bug reports and feature requests
