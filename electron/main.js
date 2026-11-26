const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { attachExternalLinks, navigate } = require("./external-browser");
let mainAppWindow;
let mainAppUrl;

const DEFAULT_ENV_FILE = `# GraveScraper local configuration
# Edit these values, then restart the app.

# SQLite location. Leave blank to store gravescraper.sqlite in this config folder.
# DATABASE_PATH=

# Import pacing.
MEMORIAL_PAGE_SIZE=100
REQUEST_DELAY_MS=2000
REQUEST_COOLDOWN_EVERY=3
REQUEST_COOLDOWN_MIN_MS=3000
REQUEST_COOLDOWN_MAX_MS=5000
REQUEST_RATE_LIMIT_BACKOFF_MS=120000

# FindAGrave mobile headers.
FINDAGRAVE_MV=ios:1.22.3
# Provide this locally before importing; credentials are never bundled in source.
FINDAGRAVE_AK=
`;

function getConfigFolderPath() {
  return app.getPath("userData");
}

function getPackagedAppFolderPath() {
  if (process.platform === "darwin") {
    return path.dirname(path.dirname(path.dirname(path.dirname(app.getPath("exe")))));
  }

  return path.dirname(app.getPath("exe"));
}

function ensureEnvFile() {
  const preferredFolder = app.isPackaged ? getPackagedAppFolderPath() : process.cwd();
  const fallbackFolder = getConfigFolderPath();
  const candidates = [
    path.join(preferredFolder, ".env"),
    path.join(fallbackFolder, ".env")
  ];

  for (const envPath of candidates) {
    try {
      fs.mkdirSync(path.dirname(envPath), { recursive: true });

      if (!fs.existsSync(envPath)) {
        fs.writeFileSync(envPath, DEFAULT_ENV_FILE, { flag: "wx" });
      }

      process.env.GRAVESITE_ENV_PATH = envPath;
      process.env.GRAVESITE_CONFIG_FOLDER = fallbackFolder;
      return envPath;
    } catch (error) {
      console.warn(`Unable to use config file at ${envPath}.`, error.message);
    }
  }

  process.env.GRAVESITE_CONFIG_FOLDER = fallbackFolder;
  return null;
}

function buildApplicationMenu() {
  const template = [
    {
      label: "GraveScraper",
      submenu: [
        {
          label: "Settings",
          click: () => {
            if (mainAppWindow && !mainAppWindow.isDestroyed()) {
              mainAppWindow.loadURL(new URL("/settings", mainAppUrl).href);
              mainAppWindow.focus();
            }
          }
        },
        {
          label: "Restart to apply settings",
          click: () => {
            app.relaunch();
            app.quit();
          }
        },
        { type: "separator" },
        {
          label: "Open Config Folder",
          click: () => {
            shell.openPath(getConfigFolderPath());
          }
        },
        {
          label: "Open App Folder",
          click: () => {
            shell.openPath(app.isPackaged ? getPackagedAppFolderPath() : process.cwd());
          }
        },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { label: "Back", accelerator: "CmdOrCtrl+[", click: () => navigate(BrowserWindow.getFocusedWindow(), "back") },
        { label: "Forward", accelerator: "CmdOrCtrl+]", click: () => navigate(BrowserWindow.getFocusedWindow(), "forward") },
        { type: "separator" },
        { label: "Refresh", accelerator: "CmdOrCtrl+R", click: () => navigate(BrowserWindow.getFocusedWindow(), "refresh") },
        { label: "Force Refresh", accelerator: "CmdOrCtrl+Shift+R", click: () => navigate(BrowserWindow.getFocusedWindow(), "force-refresh") },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "close" }
      ]
    }
  ];

  if (process.platform === "darwin") {
    template[0].submenu.unshift({ role: "about" });
  }

  return Menu.buildFromTemplate(template);
}

function attachEditableContextMenu(window) {
  window.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable) {
      return;
    }

    Menu.buildFromTemplate([
      { role: "undo", enabled: params.editFlags.canUndo },
      { role: "redo", enabled: params.editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { role: "delete", enabled: params.editFlags.canDelete },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll }
    ]).popup({ window });
  });
}

async function createMainWindow() {
  ensureEnvFile();

  const { startDesktopServer } = require("../src/server");
  const { server, url, app: webApp } = await startDesktopServer();

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  attachEditableContextMenu(mainWindow);
  mainAppWindow = mainWindow;
  mainAppUrl = url;
  attachExternalLinks(mainWindow, url);

  mainWindow.on("closed", () => {
    server.close();
  });

  await mainWindow.loadURL(webApp.locals.networkWarning ? new URL("/settings", url).href : url);
}

function reportStartupFailure(error) {
  console.error("Failed to launch GraveScraper desktop app.", error);
  let logMessage = "";
  try {
    const logPath = path.join(getConfigFolderPath(), "startup-errors.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()}\n${error.stack || error}\n\n`);
    logMessage = `\n\nDetails were saved to ${logPath}`;
  } catch (logError) {
    console.error("Unable to write startup error log.", logError);
  }
  dialog.showErrorBox("GraveScraper could not start", `${error.message || error}${logMessage}`);
  app.quit();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildApplicationMenu());
  createMainWindow().catch(reportStartupFailure);

  app.on("activate", () => {
    if (!mainAppWindow || mainAppWindow.isDestroyed()) {
      createMainWindow().catch(reportStartupFailure);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
