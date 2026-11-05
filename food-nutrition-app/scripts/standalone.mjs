#!/usr/bin/env node
// Run the production build exactly the way Docker, Lambda and Electron do:
// the self-contained .next/standalone/server.js (not `next start`).
//
//   npm run build && npm run start:standalone     (or just: npm run preview)
//   PORT=4000 BIND_HOST=0.0.0.0 npm run start:standalone   (default 127.0.0.1:3000)
//
// Next's standalone output doesn't include .next/static or public/, so they are
// copied in first (https://nextjs.org/docs/app/api-reference/config/next-config-js/output).
import { spawn } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const standalone = path.join(appDir, '.next', 'standalone');
const server = path.join(standalone, 'server.js');

if (!existsSync(server)) {
    console.error(`[standalone] ${server} not found. Run "npm run build" first.`);
    process.exit(1);
}

const staticDst = path.join(standalone, '.next', 'static');
rmSync(staticDst, { recursive: true, force: true });
cpSync(path.join(appDir, '.next', 'static'), staticDst, { recursive: true });
if (existsSync(path.join(appDir, 'public'))) {
    cpSync(path.join(appDir, 'public'), path.join(standalone, 'public'), { recursive: true });
}

const env = {
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    ...process.env,
    PORT: process.env.PORT ?? '3000',
    HOSTNAME: process.env.BIND_HOST ?? '127.0.0.1',
};
// This script is for trying a production build on a laptop, so sign-in works with no
// settings: links are printed here instead of emailed. A deployed site never runs it.
if (!env.AUTH_BASE_URL) env.AUTH_BASE_URL = `http://localhost:${env.PORT}`;
const isLocalBase = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(env.AUTH_BASE_URL);
if (!env.AUTH_EMAIL_TRANSPORT && isLocalBase) env.AUTH_EMAIL_TRANSPORT = 'console';
console.log(`[standalone] http://localhost:${env.PORT}  (Ctrl+C to stop)`);
const child = spawn(process.execPath, [server], { cwd: standalone, env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, signal) => process.exit(signal ? 0 : (code ?? 0)));
