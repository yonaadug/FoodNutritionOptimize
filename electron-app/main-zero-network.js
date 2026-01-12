/**
 * Zero-Network Electron App
 * No HTTP server, no localhost, no ports - completely isolated
 * Uses IPC (Inter-Process Communication) for all API calls
 */

const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// Import backend modules directly
const Database = require('better-sqlite3');
const solver = require('javascript-lp-solver');

let mainWindow;
let db;

// Database path
const DB_PATH = path.join(__dirname, '../food-nutrition-app/nutrition.db');

// Initialize database connection
function initDatabase() {
  try {
    db = new Database(DB_PATH, { readonly: false });
    console.log('Database initialized:', DB_PATH);
    return true;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    return false;
  }
}

// IPC Handlers - Replace API routes with IPC

// Search foods
ipcMain.handle('api:search', async (event, { query, page = 1, limit = 20 }) => {
  try {
    const offset = (page - 1) * limit;

    // Count total results
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM foods WHERE description LIKE ?');
    const { count } = countStmt.get(`%${query}%`);

    // Get paginated foods
    const foodsStmt = db.prepare(`
      SELECT * FROM foods
      WHERE description LIKE ?
      ORDER BY length(description) ASC, description ASC
      LIMIT ? OFFSET ?
    `);
    const foods = foodsStmt.all(`%${query}%`, limit, offset);

    // Get serving sizes
    if (foods.length > 0) {
      const ids = foods.map(f => f.id);
      const placeholders = ids.map(() => '?').join(',');
      const servingStmt = db.prepare(`SELECT * FROM serving_sizes WHERE food_id IN (${placeholders})`);
      const servings = servingStmt.all(...ids);

      const servingsMap = new Map();
      servings.forEach(s => {
        if (!servingsMap.has(s.food_id)) servingsMap.set(s.food_id, []);
        servingsMap.get(s.food_id).push(s);
      });

      foods.forEach(f => {
        f.serving_sizes = servingsMap.get(f.id) || [];
      });
    }

    return {
      foods,
      total: count,
      page,
      totalPages: Math.ceil(count / limit)
    };
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
});

// Get top foods by nutrient
ipcMain.handle('api:foods-top', async (event, { nutrient, limit = 50 }) => {
  try {
    const stmt = db.prepare(`
      SELECT * FROM foods
      WHERE ${nutrient} > 0
      ORDER BY ${nutrient} DESC
      LIMIT ?
    `);
    const foods = stmt.all(limit);

    // Get serving sizes
    if (foods.length > 0) {
      const ids = foods.map(f => f.id);
      const placeholders = ids.map(() => '?').join(',');
      const servingStmt = db.prepare(`SELECT * FROM serving_sizes WHERE food_id IN (${placeholders})`);
      const servings = servingStmt.all(...ids);

      const servingsMap = new Map();
      servings.forEach(s => {
        if (!servingsMap.has(s.food_id)) servingsMap.set(s.food_id, []);
        servingsMap.get(s.food_id).push(s);
      });

      foods.forEach(f => {
        f.serving_sizes = servingsMap.get(f.id) || [];
      });
    }

    return { foods };
  } catch (error) {
    console.error('Top foods error:', error);
    throw error;
  }
});

// Optimize diet
ipcMain.handle('api:optimize', async (event, params) => {
  try {
    // Import optimization logic (you'd need to extract this from optimizer.ts)
    const { optimizeDiet } = require(path.join(__dirname, '../food-nutrition-app/lib/optimizer-node.js'));

    const result = await optimizeDiet(params);
    return result;
  } catch (error) {
    console.error('Optimization error:', error);
    throw error;
  }
});

// Get food by ID
ipcMain.handle('api:food', async (event, { ids }) => {
  try {
    if (!Array.isArray(ids)) ids = [ids];

    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT * FROM foods WHERE id IN (${placeholders})`);
    const foods = stmt.all(...ids);

    // Get serving sizes
    const servingStmt = db.prepare(`SELECT * FROM serving_sizes WHERE food_id IN (${placeholders})`);
    const servings = servingStmt.all(...ids);

    const servingsMap = new Map();
    servings.forEach(s => {
      if (!servingsMap.has(s.food_id)) servingsMap.set(s.food_id, []);
      servingsMap.get(s.food_id).push(s);
    });

    foods.forEach(f => {
      f.serving_sizes = servingsMap.get(f.id) || [];
    });

    return foods;
  } catch (error) {
    console.error('Get food error:', error);
    throw error;
  }
});

// Register file protocol to serve static files
function registerFileProtocol() {
  protocol.handle('app', (request) => {
    let filePath = request.url.replace('app://', '');

    // Remove query strings
    const questionMarkIndex = filePath.indexOf('?');
    if (questionMarkIndex !== -1) {
      filePath = filePath.substring(0, questionMarkIndex);
    }

    // Default to index.html
    if (filePath === '' || filePath === '/') {
      filePath = 'index.html';
    }

    // Security: Prevent directory traversal
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');

    // Serve from Next.js out directory (static export)
    const fullPath = path.join(__dirname, '../food-nutrition-app/out', filePath);

    try {
      return net.fetch('file://' + fullPath);
    } catch (error) {
      console.error('File serve error:', error);
      return new Response('Not Found', { status: 404 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload-ipc.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    icon: path.join(__dirname, 'assets/icon.png'),
    title: 'NutriCompare - Nutrition Optimizer',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Load app from file protocol - NO NETWORK
  mainWindow.loadURL('app://index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (db) db.close();
  });
}

app.whenReady().then(() => {
  // Initialize database
  if (!initDatabase()) {
    console.error('Failed to initialize database');
    app.quit();
    return;
  }

  // Register file protocol
  registerFileProtocol();

  // Create window
  createWindow();
});

app.on('window-all-closed', () => {
  if (db) db.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Clean up on quit
app.on('will-quit', () => {
  if (db) db.close();
});
