const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let nextProcess;

// Path to Next.js app
const NEXT_APP_PATH = path.join(__dirname, '../food-nutrition-app');

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
  });

  // Start Next.js server
  startNextServer();

  // Load the app
  mainWindow.loadURL('http://localhost:3000');

  // Open DevTools in development
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function startNextServer() {
  console.log('Starting Next.js server...');

  // Determine if we're in development or production
  const isDev = !app.isPackaged;

  if (isDev) {
    // Development: run next dev
    nextProcess = spawn('npm', ['run', 'dev'], {
      cwd: NEXT_APP_PATH,
      shell: true,
      stdio: 'inherit'
    });
  } else {
    // Production: run next start (requires build first)
    nextProcess = spawn('npm', ['start'], {
      cwd: NEXT_APP_PATH,
      shell: true,
      stdio: 'inherit'
    });
  }

  nextProcess.on('error', (error) => {
    console.error('Failed to start Next.js server:', error);
  });

  // Wait for server to be ready before loading
  setTimeout(() => {
    console.log('Next.js server should be ready');
  }, 3000);
}

function stopNextServer() {
  if (nextProcess) {
    console.log('Stopping Next.js server...');
    nextProcess.kill();
    nextProcess = null;
  }
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  stopNextServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  stopNextServer();
});

// Handle app quit
app.on('will-quit', () => {
  stopNextServer();
});
