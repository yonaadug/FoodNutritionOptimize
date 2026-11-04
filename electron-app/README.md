# Micronutrient Diary Desktop (Electron)

A thin Electron shell around the Next.js app in `../food-nutrition-app`. Everything
runs locally, and the app works offline.

## How it works

`main.js` is the only main-process file:

1. It picks a random free port and starts the Next.js server bound to `127.0.0.1`,
   so other machines on the network can't reach it.
   - **Packaged app:** it runs the Next.js *standalone* server (`Resources/web/server.js`)
     with Electron's built-in Node via `utilityProcess`. Users don't need Node installed.
   - **Development (`npm start`):** it runs `next dev` from `../food-nutrition-app` with
     your system Node, so hot reload works.
2. It sets `NUTRITION_DB_PATH` to the bundled `nutrition.db`, which the server opens read-only.
3. It waits until the server answers, then loads it in a locked-down `BrowserWindow`.

The app has no preload script and does no IPC. The renderer is ordinary web content.

## Security

| Control | Setting |
|---|---|
| Renderer isolation | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: false` |
| Network | Server listens on `127.0.0.1` with a random port. Every http(s)/ws request that isn't to that origin is cancelled, so no remote content loads. |
| CSP | Added to every local response: `default-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, … (`'unsafe-inline'` scripts are needed for Next's inline RSC payload, and `'unsafe-eval'` only in dev) |
| Navigation | `will-navigate`/`will-redirect` are blocked for other origins. `window.open` never creates a window, and `https:` links open in the default browser. |
| Permissions | Every permission request (camera, geolocation, notifications, …) is denied. |
| Other | Single-instance lock, Next telemetry disabled, main code packed in `app.asar` |

## Prerequisites

- Node.js 22+ (only for development and building; the packaged app doesn't need it)
- The web app installed and its database present:
  `cd ../food-nutrition-app && git lfs pull && npm install`

## Commands

```bash
cd electron-app
npm install           # downloads Electron on first `electron` run

npm start             # dev: next dev + Electron window
npm run start:prod    # build web app, stage it, and run Electron against the staged server
npm run pack          # build + stage + unpacked app in dist/<platform>/ (fastest packaging check)
npm run build:mac     # dmg + zip   (also build:win, build:linux, build = current platform)
```

`npm run stage` runs `npm run build` in the web app and then `scripts/stage-web.js`. The
script copies `.next/standalone`, `.next/static`, and `public/` into `staging/web/`, checks
that the bundled DB is a real SQLite file and not a Git LFS pointer, and leaves the
directory ready for electron-builder to ship as `Resources/web`.

Packaged size: about 285 MB for the unpacked macOS arm64 app (Electron is about 260 MB of
that, the web server about 25 MB).

### Code signing

Unsigned builds work locally. To skip signing explicitly, set
`CSC_IDENTITY_AUTO_DISCOVERY=false`. To distribute on macOS you need a Developer ID
certificate and notarization; see https://www.electron.build/code-signing.

## Troubleshooting

- **Logs:** the main and server output goes to the console and to
  `~/Library/Logs/Micronutrient Diary/main.log` on macOS (`%APPDATA%\Micronutrient Diary\logs` on
  Windows, `~/.config/Micronutrient Diary/logs` on Linux).
- **"Database not found" or "not a SQLite file":** run `git lfs pull` in the repo root,
  then rebuild.
- **`electron .` behaves like plain Node:** your shell has `ELECTRON_RUN_AS_NODE` set
  (some IDE terminals do this). The npm scripts unset it for you.
- **Cross-building:** the standalone bundle only contains the `better-sqlite3` binary for
  the platform and CPU it was built on. Build each target on a matching OS and arch, for
  example a macOS arm64 runner for an arm64 dmg.
