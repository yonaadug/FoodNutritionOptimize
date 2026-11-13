/**
 * NanoNutrition desktop shell.
 *
 * Starts the Next.js server on 127.0.0.1 with a random free port and shows it
 * in a locked-down BrowserWindow:
 *   - packaged (or NANONUTRITION_USE_STAGED=1): the standalone server staged by
 *     scripts/stage-web.js, run with Electron's own Node via utilityProcess,
 *     so users don't need Node installed;
 *   - development: `next dev` from ../food-nutrition-app using the system Node.
 */
const { app, BrowserWindow, dialog, session, shell, utilityProcess } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const HOST = '127.0.0.1';
const useStaged = app.isPackaged || process.env.NANONUTRITION_USE_STAGED === '1';
const isDev = !useStaged;

const webDir = app.isPackaged
  ? path.join(process.resourcesPath, 'web') // extraResources: staging/web -> Resources/web
  : useStaged
    ? path.join(__dirname, 'staging', 'web')
    : path.join(__dirname, '..', 'food-nutrition-app');
const dbPath = process.env.NUTRITION_DB_PATH || path.join(webDir, 'nutrition.db');

let mainWindow = null;
let serverProcess = null;
let origin = null;
let quitting = false;

// ---------------------------------------------------------------------------
// Logging (console + file, so packaged builds can be debugged)
// ---------------------------------------------------------------------------
let logStream = null;
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  try {
    if (!logStream) {
      const dir = app.getPath('logs');
      fs.mkdirSync(dir, { recursive: true });
      logStream = fs.createWriteStream(path.join(dir, 'main.log'), { flags: 'w' });
    }
    logStream.write(line + '\n');
  } catch {
    /* logging must never crash the app */
  }
}

function fatal(title, message) {
  log(`FATAL: ${title}: ${message}`);
  if (!quitting) dialog.showErrorBox(title, `${message}\n\nLog: ${path.join(app.getPath('logs'), 'main.log')}`);
  app.exit(1);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.setTimeout(5000, () => req.destroy(new Error('timeout')));
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(`Server did not respond at ${url} within ${timeoutMs / 1000}s`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function pipeOutput(child) {
  child.stdout?.on('data', (d) => log('[server]', d.toString().trimEnd()));
  child.stderr?.on('data', (d) => log('[server:err]', d.toString().trimEnd()));
}

async function startServer() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found at ${dbPath}. Run "git lfs pull" in the repo (or rebuild the app).`);
  }
  const port = await getFreePort();
  origin = `http://${HOST}:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: isDev ? 'development' : 'production',
    PORT: String(port),
    HOSTNAME: HOST,
    NUTRITION_DB_PATH: dbPath,
    NEXT_TELEMETRY_DISABLED: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  log(`Starting ${isDev ? 'dev' : 'standalone'} server from ${webDir} on ${origin} (db: ${dbPath})`);

  if (isDev) {
    const nextBin = path.join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next');
    if (!fs.existsSync(nextBin)) {
      throw new Error(`${nextBin} not found. Run "npm install" in food-nutrition-app first.`);
    }
    serverProcess = spawn('node', [nextBin, 'dev', '--hostname', HOST, '--port', String(port)], {
      cwd: webDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess.on('error', (err) => fatal('Could not start Next.js dev server', `${err.message} (is Node.js on your PATH?)`));
  } else {
    const serverJs = path.join(webDir, 'server.js');
    if (!fs.existsSync(serverJs)) {
      throw new Error(`${serverJs} not found. Run "npm run stage" in electron-app.`);
    }
    serverProcess = utilityProcess.fork(serverJs, [], {
      cwd: webDir,
      env,
      stdio: 'pipe',
      serviceName: 'NanoNutrition Server',
    });
  }
  pipeOutput(serverProcess);
  serverProcess.on('exit', (code) => {
    log(`Server exited with code ${code}`);
    serverProcess = null;
    if (!quitting) fatal('NanoNutrition server stopped', `The internal server exited unexpectedly (code ${code}).`);
  });

  await waitForServer(`${origin}/`, isDev ? 120000 : 30000);
  log('Server is ready');
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------
function isAppUrl(url) {
  try {
    const u = new URL(url);
    const o = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'ws:') && u.host === o.host;
  } catch {
    return false;
  }
}

function contentSecurityPolicy() {
  const wsOrigin = origin.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    // Next.js streams RSC payloads via inline <script>; dev mode also needs eval for React Refresh.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ` ${wsOrigin}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function hardenSession(ses) {
  // No remote content: only the local server (plus devtools/data/blob URLs) may load.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const { protocol } = new URL(details.url);
    const isNetwork = ['http:', 'https:', 'ws:', 'wss:'].includes(protocol);
    const blocked = isNetwork && !isAppUrl(details.url);
    if (blocked) log('Blocked request:', details.url);
    callback({ cancel: blocked });
  });

  // CSP on every response from the local server.
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (isAppUrl(details.url)) {
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === 'content-security-policy') delete headers[k];
      }
      headers['Content-Security-Policy'] = [contentSecurityPolicy()];
    }
    callback({ responseHeaders: headers });
  });

  // The app needs no camera/mic/geolocation/notifications/etc.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      log('Blocked navigation:', url);
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      log('Blocked redirect:', url);
    }
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    // Never open new Electron windows; hand https links to the user's browser.
    if (url.startsWith('https://')) shell.openExternal(url);
    else log('Blocked window.open:', url);
    return { action: 'deny' };
  });
});

// ---------------------------------------------------------------------------
// Window / lifecycle
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'NanoNutrition',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    log(`NanoNutrition ${app.getVersion()} (Electron ${process.versions.electron}, packaged=${app.isPackaged}, dev=${isDev})`);
    try {
      await startServer();
    } catch (err) {
      fatal('NanoNutrition failed to start', err.message);
      return;
    }
    hardenSession(session.defaultSession);
    createWindow();
  });

  app.on('activate', () => {
    if (mainWindow === null && origin) createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('will-quit', stopServer);
}
