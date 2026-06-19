/* eslint-disable */
// Electron main process for Ingentive Agent OS.
// Self-contained desktop app: runs the Next.js standalone server as a child
// process and renders the dashboard inside a BrowserWindow. No external browser.

const { app, BrowserWindow, Menu, shell, dialog, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");

let Store;
try {
  Store = require("electron-store");
} catch (_) {
  Store = null;
}

const APP_NAME = "Ingentive Agent OS";
const DEFAULT_PORT = 3007;
const MAX_PORT = 3020;
const SERVER_READY_TIMEOUT_MS = 30_000;
const SERVER_POLL_INTERVAL_MS = 250;

const isDev = !app.isPackaged;
const store = Store ? new Store({ name: "ingentive-agent-os-prefs" }) : null;

let mainWindow = null;
let serverChild = null;
let serverPort = DEFAULT_PORT;
let serverReady = false;
let quitting = false;

// ---- Single-instance guard --------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on("second-instance", () => {
  showMainWindow();
});

// ---- Helpers ----------------------------------------------------------------
function findFreePort(start, end) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      const tester = net.createServer();
      tester.once("error", () => {
        tester.close();
        if (port >= end) {
          reject(new Error(`No free port available in range ${start}-${end}`));
          return;
        }
        port += 1;
        tryPort();
      });
      tester.once("listening", () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port, "127.0.0.1");
    };
    tryPort();
  });
}

function resolveServerEntry() {
  if (isDev) {
    const repoRoot = path.resolve(app.getAppPath(), "..");
    const fromRoot = path.join(repoRoot, ".next", "standalone", "server.js");
    if (fs.existsSync(fromRoot)) return fromRoot;
    return path.join(app.getAppPath(), ".next", "standalone", "server.js");
  }
  return path.join(process.resourcesPath, "app", "standalone", "server.js");
}

function resolveServerCwd() {
  return path.dirname(resolveServerEntry());
}

// Spawning process.execPath (the main app binary) on macOS makes the child
// show up in the Dock as its own icon, because the main bundle's Info.plist
// isn't an agent. The Helper.app bundles ship with LSUIElement=true, which
// keeps any process they launch invisible to the Dock and Cmd+Tab.
function resolveChildExec() {
  if (process.platform !== "darwin" || isDev) {
    return process.execPath;
  }
  // process.execPath inside the packaged app:
  //   /Applications/<App>.app/Contents/MacOS/<App>
  // Walk up to Contents/, then into Frameworks/<App> Helper.app/Contents/MacOS/<App> Helper
  const macOsDir = path.dirname(process.execPath);
  const contents = path.dirname(macOsDir);
  const productName = path.basename(process.execPath);
  const helperBinary = path.join(
    contents,
    "Frameworks",
    `${productName} Helper.app`,
    "Contents",
    "MacOS",
    `${productName} Helper`,
  );
  return fs.existsSync(helperBinary) ? helperBinary : process.execPath;
}

function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 1500 },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) {
            resolve();
          } else {
            scheduleNext();
          }
        },
      );
      req.on("error", scheduleNext);
      req.on("timeout", () => {
        req.destroy();
        scheduleNext();
      });
    };
    const scheduleNext = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Server did not become ready within ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, SERVER_POLL_INTERVAL_MS);
    };
    tick();
  });
}

function startServer(port) {
  const entry = resolveServerEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(
      `Next.js standalone server.js not found at: ${entry}\n` +
        "Run `npm run build` (or `npm run electron:build-app`) first.",
    );
  }
  // When launched from /Applications (or Dock / login items), the child
  // inherits a minimal PATH that excludes Homebrew, asdf, npm-global, etc.
  // That makes `execFileSync("claude", ["--version"])` fail and every
  // CLI version shows up as "unknown" in the status bar. Augment PATH
  // with the common per-user install locations.
  const home = process.env.HOME || "";
  const extraPaths = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.cargo/bin`,
    `${home}/.volta/bin`,
    `${home}/n/bin`,
  ];
  const augmentedPath = [
    ...extraPaths,
    ...(process.env.PATH || "").split(":").filter(Boolean),
  ]
    .filter((p, i, arr) => p && arr.indexOf(p) === i)
    .join(":");

  const env = {
    ...process.env,
    PATH: augmentedPath,
    // Critical: process.execPath is the Electron binary. Without this env var
    // it launches as a GUI app and exits immediately instead of executing
    // the standalone server.js. With it set to 1, Electron behaves as plain
    // Node.js — same V8, same APIs, no GUI bootstrap.
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
  };
  // Default V8 old-space cap is ~2 GB. Heavy fleets blow past it during the
  // startup warmup (hundreds of audit.jsonl files across 5 providers).
  // ELECTRON_RUN_AS_NODE strips NODE_OPTIONS for security, so we pass the
  // V8 flag as a CLI argument instead.
  serverChild = spawn(
    resolveChildExec(),
    ["--max-old-space-size=4096", entry],
    {
      cwd: resolveServerCwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  serverChild.stdout.on("data", (b) => process.stdout.write(`[next] ${b}`));
  serverChild.stderr.on("data", (b) => process.stderr.write(`[next] ${b}`));
  serverChild.on("exit", (code, signal) => {
    serverReady = false;
    if (!quitting) {
      console.error(`[next] server exited unexpectedly code=${code} signal=${signal}`);
    }
  });
}

function stopServer() {
  if (!serverChild) return Promise.resolve();
  return new Promise((resolve) => {
    const child = serverChild;
    serverChild = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once("exit", finish);
    try {
      child.kill("SIGTERM");
    } catch (_) {
      /* ignore */
    }
    setTimeout(() => {
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch (_) {
        /* ignore */
      }
      finish();
    }, 3000);
  });
}

// ---- Window management ------------------------------------------------------
function getWindowBounds() {
  const saved = store?.get("windowBounds");
  if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
    return saved;
  }
  return { width: 1440, height: 900 };
}

function persistWindowBounds(win) {
  if (!store) return;
  try {
    const b = win.getBounds();
    store.set("windowBounds", b);
  } catch (_) {
    /* ignore */
  }
}

function loadingHtmlPath() {
  return path.join(__dirname, "loading.html");
}

function loadingIconPath() {
  // Bundled 128px PNG used for the splash logo.
  return path.join(__dirname, "assets", "icon-128.png");
}

function showLoadingIn(win) {
  if (!win || win.isDestroyed()) return;
  // Pass the icon path as a query string so the splash can show the real logo
  // regardless of whether we're running packaged or in dev.
  const iconUrl = `file://${loadingIconPath()}`;
  win.loadFile(loadingHtmlPath(), { query: { icon: iconUrl } }).catch((err) => {
    console.error("[ingentive-agent-os] failed to load splash:", err);
  });
}

// Minimum time the splash stays visible — prevents a jarring sub-second flash
// when the server happens to start very fast (cached SWR overview, etc.).
const MIN_SPLASH_MS = 900;
// Grace period after the dashboard's HTML finishes loading, to let SWR fetch
// the first wave of API data so users don't see skeleton states flash.
const POST_LOAD_GRACE_MS = 400;
// Max time we'll wait for cache warmup to complete before swapping anyway —
// pathological fleets shouldn't strand the user on the splash forever.
const WARMUP_MAX_WAIT_MS = 180_000;
// How often the splash polls /api/warmup-status.
const WARMUP_POLL_INTERVAL_MS = 400;

function fetchWarmupStatus(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/api/warmup-status", timeout: 2000 },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (_) {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function waitForWarmup(port, win) {
  const deadline = Date.now() + WARMUP_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const s = await fetchWarmupStatus(port);
    if (s && win && !win.isDestroyed()) {
      try {
        await win.webContents.executeJavaScript(
          `window.__setWarmup && window.__setWarmup(${JSON.stringify(s)});`,
          true,
        );
      } catch (_) {
        /* splash may have unloaded — ignore */
      }
    }
    if (s && s.complete) return s;
    await new Promise((r) => setTimeout(r, WARMUP_POLL_INTERVAL_MS));
  }
  return null;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  const bounds = getWindowBounds();
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#0f172a",
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    titleBarStyle: "default",
    icon:
      process.platform === "linux"
        ? path.join(__dirname, "..", "build", "icon.png")
        : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  showLoadingIn(mainWindow);
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Persist size/position on resize/move.
  const persist = () => persistWindowBounds(mainWindow);
  mainWindow.on("resize", persist);
  mainWindow.on("move", persist);

  // Send external links to the user's real browser instead of in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (serverReady) {
    loadDashboardInto(mainWindow);
  }

  return mainWindow;
}

async function loadDashboardInto(win) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  // Tell the splash to start its fade-out animation while we navigate.
  try {
    await wc.executeJavaScript("document.body && document.body.classList.add('leaving');", true);
  } catch (_) {
    /* splash may already have unloaded — ignore */
  }
  // Brief delay so the fade-out is perceptible before navigation starts.
  await new Promise((r) => setTimeout(r, 220));
  try {
    await wc.loadURL(`http://127.0.0.1:${serverPort}/`);
  } catch (err) {
    console.error("[ingentive-agent-os] failed to load dashboard:", err);
    return;
  }
  // Give SWR a moment to land its first API responses so the user lands on
  // populated cards instead of skeletons.
  await new Promise((r) => setTimeout(r, POST_LOAD_GRACE_MS));
}

function showMainWindow() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---- Auto-start at login ----------------------------------------------------
function getAutoStart() {
  if (store && store.has("autoStart")) return store.get("autoStart");
  return true;
}

function setAutoStart(enabled) {
  if (store) store.set("autoStart", enabled);
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    args: ["--hidden"],
  });
}

// ---- App menu ---------------------------------------------------------------
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const autoStart = getAutoStart();

  const template = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Auto-start at Login",
                type: "checkbox",
                checked: autoStart,
                click: (item) => {
                  setAutoStart(item.checked);
                  Menu.setApplicationMenu(buildAppMenu());
                },
              },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => showMainWindow(),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
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
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev ? [{ type: "separator" }, { role: "toggleDevTools" }] : []),
      ],
    },
    {
      label: "Window",
      submenu: isMac
        ? [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" },
          ]
        : [{ role: "minimize" }, { role: "close" }],
    },
    ...(!isMac
      ? [
          {
            label: "Settings",
            submenu: [
              {
                label: "Auto-start at Login",
                type: "checkbox",
                checked: autoStart,
                click: (item) => {
                  setAutoStart(item.checked);
                  Menu.setApplicationMenu(buildAppMenu());
                },
              },
            ],
          },
        ]
      : []),
  ];

  return Menu.buildFromTemplate(template);
}

// ---- App lifecycle ----------------------------------------------------------
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // macOS: clicking the Dock icon re-opens the window.
  showMainWindow();
});

app.on("before-quit", async (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  try {
    await stopServer();
  } finally {
    app.exit(0);
  }
});

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) {
    const icnsPath = path.join(__dirname, "..", "electron-resources", "icon.icns");
    if (fs.existsSync(icnsPath)) {
      try {
        app.dock.setIcon(nativeImage.createFromPath(icnsPath));
      } catch (_) {
        /* ignore */
      }
    }
  }

  app.setLoginItemSettings({
    openAtLogin: getAutoStart(),
    openAsHidden: true,
    args: ["--hidden"],
  });

  Menu.setApplicationMenu(buildAppMenu());

  const launchedHidden =
    process.argv.includes("--hidden") ||
    app.getLoginItemSettings().wasOpenedAsHidden;

  if (!launchedHidden) {
    createMainWindow();
  }

  const startedAt = Date.now();
  try {
    serverPort = await findFreePort(DEFAULT_PORT, MAX_PORT);
    startServer(serverPort);
    await waitForServer(serverPort, SERVER_READY_TIMEOUT_MS);
    serverReady = true;
    // Wait for the cache warmup before swapping. The splash gets live
    // progress updates via __setWarmup so the user sees the providers
    // tick through.
    await waitForWarmup(serverPort, mainWindow);
    // Respect a minimum splash duration so very fast startups don't flicker.
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_SPLASH_MS) {
      await new Promise((r) => setTimeout(r, MIN_SPLASH_MS - elapsed));
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      await loadDashboardInto(mainWindow);
    }
  } catch (err) {
    console.error("[ingentive-agent-os] startup failed:", err);
    dialog.showErrorBox(APP_NAME, `Failed to start the local server:\n\n${err.message}`);
  }
});
