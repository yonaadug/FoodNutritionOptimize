# NutriCompare Desktop App - Standalone Version

This Electron app now runs **completely standalone** - no localhost dependency, no external servers needed!

## How It Works

The app uses **Next.js Standalone Mode** which bundles the entire Next.js server into the Electron application. When you launch the app:

1. Electron starts the bundled Next.js server internally
2. Server runs on a local port (3000 or 3001 if busy)
3. Electron window loads the app from the internal server
4. **Everything runs locally** - database, API, optimization

**No internet required after installation!**

---

## Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup

```bash
# Install Electron dependencies
cd electron-app
npm install

# The web app dependencies are already installed
```

### Running in Development Mode

```bash
npm start
```

This runs in development mode with:
- Hot reload enabled
- DevTools available
- Faster startup

### Running in Production Mode (Test)

```bash
npm run start:prod
```

Tests the production build locally before packaging.

---

## Building for Distribution

### Step 1: Build Next.js (Automatic)

The build scripts automatically build Next.js in standalone mode:

```bash
# This happens automatically when you run build commands
cd ../food-nutrition-app
npm run build
```

Creates:
- `.next/standalone/` - Minimal Node.js server
- `.next/static/` - Static assets
- Optimized production bundle

### Step 2: Package Electron App

#### Build for macOS

```bash
npm run build:mac
```

Creates:
- `dist/NutriCompare-1.0.0.dmg` - Installer
- `dist/mac/NutriCompare.app` - Application bundle

**Size**: ~150-200 MB (includes Node.js runtime + Next.js + dependencies)

#### Build for Windows

```bash
npm run build:win
```

Creates:
- `dist/NutriCompare Setup 1.0.0.exe` - Installer
- `dist/win-unpacked/` - Portable version

#### Build for Linux

```bash
npm run build:linux
```

Creates:
- `dist/NutriCompare-1.0.0.AppImage` - Universal Linux package
- `dist/NutriCompare_1.0.0_amd64.deb` - Debian/Ubuntu package

#### Build for All Platforms

```bash
npm run build
```

---

## What Gets Packaged

The standalone build includes:

✅ **Bundled:**
- Electron runtime
- Next.js server (standalone build)
- React app (optimized)
- SQLite database (nutrition.db)
- All npm dependencies
- better-sqlite3 native module
- javascript-lp-solver

❌ **Not Needed:**
- npm or Node.js on user's computer
- Internet connection (after install)
- External servers

---

## File Structure in Packaged App

```
NutriCompare.app/
└── Contents/
    └── Resources/
        └── app/
            ├── main-standalone.js      # Electron main process
            ├── preload.js              # Security preload
            └── app/                    # Bundled Next.js app
                ├── .next/
                │   ├── standalone/     # Node.js server
                │   └── static/         # Assets
                ├── public/             # Public files
                └── nutrition.db        # Database
```

---

## Key Differences from Web App

| Feature | Web App | Desktop App |
|---------|---------|-------------|
| **Requires** | Browser, localhost:3000 | Just the app |
| **Installation** | Node.js + npm | One-click installer |
| **Updates** | `git pull` + `npm install` | Download new version |
| **Database** | Local file | Bundled with app |
| **Internet** | Not required | Not required |
| **Size** | ~50 MB (node_modules) | ~200 MB (packaged) |

---

## Advantages of Standalone Mode

### 1. True Desktop Experience
- Native window controls
- System tray integration possible
- Native file dialogs
- OS notifications

### 2. No Port Conflicts
- Automatically finds available port
- No "port 3000 in use" errors
- Multiple instances possible

### 3. Easy Distribution
- One file to download
- Double-click to install
- No technical knowledge needed
- Works offline immediately

### 4. Better Performance
- Optimized production build
- Static asset caching
- Faster startup than dev mode

---

## Troubleshooting

### Build Fails

**Problem**: `electron-builder` fails during packaging

**Solutions:**
```bash
# Clean and rebuild
rm -rf dist node_modules
npm install
npm run build
```

**Problem**: Next.js build fails

**Solutions:**
```bash
# Rebuild Next.js
cd ../food-nutrition-app
rm -rf .next
npm run build
```

### App Won't Start

**Problem**: Blank window or crash on startup

**Causes:**
1. Database not found
2. Port conflict
3. Missing dependencies

**Solutions:**
```bash
# Check database exists
ls ../food-nutrition-app/nutrition.db

# Test in development first
npm start

# Check console output for errors
```

### Database Issues

**Problem**: "Cannot open database" error

**Solution:**

The database needs to be in the correct location:

**Development:**
```
food-nutrition-app/nutrition.db
```

**Production (packaged):**
```
Bundled automatically by electron-builder
```

### Large File Size

**Problem**: App installer is 200+ MB

**Why?**
- Electron runtime: ~100 MB
- Node.js modules: ~50 MB
- Next.js build: ~20 MB
- Database: ~1 MB

**Can't reduce much** because:
- Electron needs Chromium + Node.js
- better-sqlite3 is a native module
- javascript-lp-solver is a large library

---

## Advanced Configuration

### Custom Port

Edit `main-standalone.js`:

```javascript
let serverPort = 8080; // Change from 3000
```

### Disable DevTools in Production

Edit `main-standalone.js`:

```javascript
if (!isDev) {
  mainWindow.webContents.openDevTools = () => {}; // Disable
}
```

### Add Auto-Updates

Install `electron-updater`:

```bash
npm install electron-updater
```

Then configure in `package.json` and `main-standalone.js`.

---

## Security Considerations

### Bundled Database
- Database is bundled in ASAR archive
- Read-only in production
- Users can't easily modify food data
- Good for preventing tampering

### API Keys
- Not needed at runtime
- Only for data ingestion scripts
- Don't bundle in production

### Content Security Policy
Already configured in `preload.js`:
- `nodeIntegration: false`
- `contextIsolation: true`
- No eval() allowed

---

## Performance Tips

### 1. Reduce Initial Load Time

Cache static assets:

```javascript
// In main-standalone.js
app.on('ready', () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    // Cache static files
  });
});
```

### 2. Optimize Database Queries

Database is already optimized with:
- Indexed queries
- Prepared statements
- Connection pooling (better-sqlite3)

### 3. Lazy Load Components

Already implemented in Next.js build:
- Code splitting
- Dynamic imports
- Route-based chunking

---

## Comparison: Standalone vs. Static Export

### Why NOT Static Export?

NutriCompare uses **API routes** heavily:
- `/api/search` - Database queries
- `/api/optimize` - LP solver
- `/api/foods/top` - Nutrient ranking

**Static export doesn't support API routes!**

### Why Standalone Works

- Bundles minimal Node.js server
- API routes work perfectly
- Database queries work
- No code changes needed

---

## Development Workflow

### 1. Develop Web App

```bash
cd food-nutrition-app
npm run dev
# Make changes, test in browser
```

### 2. Test in Electron (Dev Mode)

```bash
cd ../electron-app
npm start
# Test in Electron window
```

### 3. Build and Test

```bash
npm run start:prod
# Test production build locally
```

### 4. Package

```bash
npm run build:mac  # or :win, :linux
# Creates installer in dist/
```

### 5. Distribute

Upload `dist/*.dmg` (or .exe, .AppImage) to:
- GitHub Releases
- Website download page
- App stores

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build Electron App
on: [push]
jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm run build:mac
      - uses: actions/upload-artifact@v2
        with:
          name: NutriCompare.dmg
          path: electron-app/dist/*.dmg
```

---

## Future Enhancements

Possible improvements:
- **Auto-updates**: electron-updater integration
- **Native menus**: File, Edit, Help menus
- **Keyboard shortcuts**: Global hotkeys
- **System tray**: Minimize to tray
- **Multiple windows**: Compare diets side-by-side
- **Export PDFs**: Native print dialog
- **Offline mode indicator**: Show connection status

---

## Resources

- [Electron Docs](https://www.electronjs.org/docs)
- [Next.js Standalone](https://nextjs.org/docs/advanced-features/output-file-tracing)
- [electron-builder](https://www.electron.build/)
- [Code Signing](https://www.electron.build/code-signing)

---

**The app is now truly standalone - no localhost, no servers, no hassle!** 🎉
