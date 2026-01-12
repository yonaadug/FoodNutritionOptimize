const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverPort = 3000;
let serverProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'assets/icon.png'),
    title: 'NutriCompare - Nutrition Optimizer',
    show: false, // Don't show until ready
  });

  // Show window when ready to prevent white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Load the app
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

async function startServer() {
  try {
    // Determine if we're in development (use app.isPackaged for reliable detection)
    const isDev = !app.isPackaged;

    // Path to Next.js app (different in dev vs production)
    const NEXT_APP_PATH = isDev
      ? path.join(__dirname, '../food-nutrition-app')  // Dev: parent directory
      : path.join(__dirname, 'app');                    // Production: inside packaged app

    console.log('Starting server...');
    console.log('isDev:', isDev);
    console.log('isPackaged:', app.isPackaged);
    console.log('NEXT_APP_PATH:', NEXT_APP_PATH);

    if (isDev) {
      // Development: Use next dev server with the Next.js API
      const next = require('next');
      const { createServer } = require('http');
      const { parse } = require('url');

      const nextApp = next({ dev: true, dir: NEXT_APP_PATH });
      const handle = nextApp.getRequestHandler();

      await nextApp.prepare();

      const server = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
      });

      // Try to find an available port
      server.listen(serverPort, (err) => {
        if (err) {
          serverPort = 3001;
          server.listen(serverPort, (err) => {
            if (err) throw err;
            console.log(`> Ready on http://localhost:${serverPort}`);
            createWindow();
          });
        } else {
          console.log(`> Ready on http://localhost:${serverPort}`);
          createWindow();
        }
      });

      // Handle server errors
      server.on('error', (error) => {
        console.error('Server error:', error);
        if (error.code === 'EADDRINUSE') {
          console.log(`Port ${serverPort} is already in use, trying ${serverPort + 1}`);
          serverPort++;
          server.listen(serverPort);
        }
      });

      return server;
    } else {
      // Production: Run the standalone server.js as a child process
      const serverPath = path.join(NEXT_APP_PATH, 'server.js');

      console.log('Starting standalone server from:', serverPath);
      console.log('Working directory:', NEXT_APP_PATH);

      // Start the server process
      serverProcess = spawn('node', [serverPath], {
        cwd: NEXT_APP_PATH,
        env: {
          ...process.env,
          PORT: serverPort.toString(),
          HOSTNAME: '127.0.0.1',
          NODE_ENV: 'production'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      serverProcess.stdout.on('data', (data) => {
        console.log(`Server: ${data.toString()}`);
      });

      serverProcess.stderr.on('data', (data) => {
        console.error(`Server Error: ${data.toString()}`);
      });

      serverProcess.on('error', (error) => {
        console.error('Failed to start server process:', error);
        app.quit();
      });

      serverProcess.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          console.error(`Server process exited with code ${code}`);
          app.quit();
        }
      });

      // Wait for the server to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log(`> Standalone server should be running on http://localhost:${serverPort}`);
      createWindow();
    }
  } catch (error) {
    console.error('Failed to start Next.js server:', error);
    app.quit();
  }
}

app.on('ready', startServer);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', () => {
  // Kill the server process when app quits
  if (serverProcess) {
    serverProcess.kill();
  }
});
