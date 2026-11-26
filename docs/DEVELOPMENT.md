# Development and packaging

[Back to README](../README.md)

## Running from source

Install Node.js and npm, then clone the repository:

```bash
git clone https://github.com/Devon-Wayman/GraveScraper.git
cd GraveScraper
npm install
cp .env.example .env
```

Keep an existing local `.env` when updating. Supply required integration credentials locally; see [configuration](CONFIGURATION.md). The app can browse local records and manage cleaning photos without an import key.

Run the standalone server with `npm start`, or use `npm run dev` for the configured watch mode. The default address is http://127.0.0.1:3000. Before running the desktop version, build its native dependencies with `npx electron-builder install-app-deps`, then use `npm run electron`. Packaging also rebuilds these dependencies automatically.

Both modes use the same Express routes, SQLite repository layer, and versioned [API](API.md). Their default data locations differ, as described in the configuration guide.

## Project structure

| Location | Purpose |
| --- | --- |
| `electron/main.js` | Desktop startup, application menu, and server lifecycle |
| `electron/external-browser.js`, `electron/browser-*` | External browser window, isolated toolbar, navigation controls |
| `src/server.js` | Express setup and listener startup/recovery |
| `src/config/` | Local configuration and validated persistent settings |
| `src/db/` | Schema, additive migrations, imported records, cleaning/photo metadata |
| `src/routes/index.js` | Main HTML routes and imports/record exports |
| `src/routes/mobile.js` | Cleaning/photo forms and `/api/v1` routes |
| `src/routes/settings.js` | In-app settings |
| `src/views/`, `src/public/` | EJS pages, timeline/dialog behavior, styles |
| `src/services/photoUpload.js`, `heicPhoto.js`, `heicWorker.js` | Batch processing, HEIC decoding, JPEG storage, rollback |
| `src/services/cleaningReport.js` | Portable progress report ZIP |
| `src/services/findAGraveService.js`, `importService.js` | Sequential imports and upstream mapping |
| `tests/` | Isolated database and HTTP integration tests; synthetic HEIC fixture |
| `scripts/` | Packaging checks, desktop UI checks, public-source audit, build cleanup |

Photos are stored as files, with metadata in SQLite. Relationship arrays and raw imported payloads are stored as JSON text. Local notes, permission details, project statuses, and cleaning history must survive import refreshes. Schema changes are additive at startup rather than requiring a separate migration command.

## Tests and native dependencies

```bash
npm test
```

Tests use temporary databases and upload directories with local HTTP listeners. A restricted execution environment may need permission to listen on localhost.

`better-sqlite3` is native code. Packaging rebuilds it for Electron’s ABI, which may differ from the system Node runtime. If switching runtimes produces a module-version mismatch, either rebuild for system Node using `npm rebuild better-sqlite3` or run the tests with Electron’s Node runtime. Rebuild for the runtime you intend to use next.

On macOS:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test tests/*.test.js
```

GUI checks use temporary records and require a desktop session:

```bash
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/verify-cleaning-ui.js
env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/verify-browser-navigation.js
```

The navigation check uses local pages to verify browser history, refresh, popup handling, isolation, and cleanup. Remote page contents run separately from the local toolbar with Node integration disabled.

## Packaging Electron

Build on the target platform where possible so native dependencies and platform tools match:

```bash
npm run electron:dist:mac
npm run electron:dist:win
npm run electron:dist:win:x64
npm run electron:dist:linux
```

The configured targets are macOS DMG, Windows NSIS installer, and Linux AppImage. Artifacts are written to `dist/`. The scripts run the build cleanup step, keeping installer files and removing intermediates. Keep any diagnostic app bundle in a separate output directory if you need to inspect it before cleanup.

The macOS script also runs the packaged-app check before cleanup. To validate an existing bundle manually:

```bash
node scripts/verify-packaged-mac.js /path/to/GraveScraper.app
```

This checks the bundled SQLite and image libraries, pages, capture dates, HEIC batches, reports, project search, and deletion against temporary data. Passing source tests alone does not verify native-library packaging.

Keep the `build.asarUnpack` rules for Sharp and its `@img` binaries together. Their native image libraries must resolve outside the ASAR archive; omitting the unpack rules can prevent desktop startup.

Public distribution may require platform-specific signing/notarization setup. Signing credentials and private keys must remain outside source control.

## Desktop startup troubleshooting

If the saved address is unavailable or its port is occupied, Electron opens Settings on a temporary local port. Fix the configuration and restart using the app menu.

Other startup errors show a dialog and are written to `startup-errors.log` in the app config folder. The menu includes Open Config Folder and Open App Folder. Runtime data and settings are stored separately from the installed app, so updates should preserve them.

## Publishing source safely

Never commit populated environment files, databases, uploaded photos, local settings, credentials, dependencies, or build artifacts. The committed `.env.example` contains no real keys. Keep tests independent of personal records.

After staging intended files, run:

```bash
node scripts/audit-public-source.js
```

The audit checks tracked/staged file paths, credential signatures, and matching locally configured secret values without printing the secret values. Review the exact staged changes before publishing.
