// Configure SQLite before any modules load to avoid macOS DetachedSignatures issue
process.env.SQLITE_TMPDIR = require('os').tmpdir();

const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const { URL } = require('url');
const fs = require('fs');
const os = require('os');

// File-based logging for debugging
const logFile = path.join(os.tmpdir(), 'nutricompare-debug.log');
function log(...args) {
  const message = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  fs.appendFileSync(logFile, message);
  console.log(...args);
}

// Clear previous log
try {
  fs.writeFileSync(logFile, `=== NutriCompare Debug Log ===\n`);
  log('[NutriCompare] Log file:', logFile);
} catch (err) {
  console.error('Failed to create log file:', err);
}

let mainWindow;
let nextServerUrl = null;
let isDev;
let NEXT_APP_PATH;

// Start Next.js server on a random unused port (internal only, not exposed)
async function startInternalServer() {
  try {
    // Determine if we're in development or production
    // Use app.isPackaged for reliable detection (true in packaged app, false in dev)
    isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

    // Path to Next.js app (different in dev vs production)
    NEXT_APP_PATH = isDev
      ? path.join(__dirname, '../food-nutrition-app')  // Dev: parent directory
      : path.join(__dirname, 'app');                    // Production: inside packaged app

    log('[NutriCompare] Starting...');
    log('[NutriCompare] isDev:', isDev);
    log('[NutriCompare] isPackaged:', app.isPackaged);
    log('[NutriCompare] __dirname:', __dirname);
    log('[NutriCompare] NEXT_APP_PATH:', NEXT_APP_PATH);

    log('[NutriCompare] Starting internal Next.js server...');
    const { createServer } = require('http');
    const next = require('next');

    const nextConfig = isDev
      ? { dev: true, dir: NEXT_APP_PATH }
      : {
          dev: false,
          dir: NEXT_APP_PATH,
          conf: { distDir: '.next' }
        };

    log('[NutriCompare] Next.js config:', JSON.stringify(nextConfig, null, 2));
    const nextApp = next(nextConfig);

    log('[NutriCompare] Preparing Next.js app...');
    await nextApp.prepare();
    log('[NutriCompare] Next.js app prepared successfully');

  const handle = nextApp.getRequestHandler();
  const server = createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    handle(req, res, parsedUrl);
  });

    // Listen on random port (localhost only, not accessible from network)
    return new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', (err) => {
        if (err) reject(err);
        const port = server.address().port;
        log(`[NutriCompare] Internal server running on port ${port} (not exposed to network)`);
        resolve(`http://127.0.0.1:${port}`);
      });
    });
  } catch (error) {
    log('[NutriCompare] ERROR starting internal server:', error);
    throw error;
  }
}

// Register custom protocol handler
function registerProtocol() {
  protocol.handle('app', async (request) => {
    // Parse the app:// URL to extract pathname, search, and hash
    const parsedUrl = new URL(request.url);

    // Ensure pathname starts with / (add if missing)
    let pathname = parsedUrl.pathname || '/';
    if (!pathname.startsWith('/')) {
      pathname = '/' + pathname;
    }

    // Build the internal server URL with proper path components
    const url = `${nextServerUrl}${pathname}${parsedUrl.search}${parsedUrl.hash}`;

    log('[NutriCompare] Protocol request:', request.url, '→', url);
    log('[NutriCompare] Pathname:', pathname, 'Search:', parsedUrl.search, 'Hash:', parsedUrl.hash);
    log('[NutriCompare] Request method:', request.method);

    try {
      // Try simple fetch first
      log('[NutriCompare] Fetching:', url);
      const response = await net.fetch(url);

      log('[NutriCompare] Response status:', response.status);
      return response;
    } catch (error) {
      log('[NutriCompare] Protocol handler error:', error.message);
      log('[NutriCompare] Error stack:', error.stack);
      console.error('Protocol handler error:', error);
      return new Response('Internal Error', { status: 500 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Disable web security for custom protocol
      webSecurity: true,
    },
    icon: path.join(__dirname, 'assets/icon.png'),
    title: 'NutriCompare - Nutrition Optimizer',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Load app using custom protocol (no localhost visible to user)
  // Load without trailing slash to match Next.js default behavior
  mainWindow.loadURL('app://nutricompare');

  // Optional: Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    log('[NutriCompare] App ready, initializing...');
    // Start internal server (localhost only, random port)
    nextServerUrl = await startInternalServer();
    log('[NutriCompare] Server URL:', nextServerUrl);

    // Register custom protocol (app://)
    registerProtocol();
    log('[NutriCompare] Protocol registered');

    // Create window
    createWindow();
    log('[NutriCompare] Window created');
  } catch (error) {
    log('[NutriCompare] FATAL ERROR:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    // Only allow navigation to our custom protocol
    if (parsedUrl.protocol !== 'app:') {
      event.preventDefault();
      console.warn('Blocked navigation to:', navigationUrl);
    }
  });

  // Block new window creation
  contents.setWindowOpenHandler(({ url }) => {
    console.warn('Blocked window.open:', url);
    return { action: 'deny' };
  });
});
