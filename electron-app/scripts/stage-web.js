#!/usr/bin/env node
/**
 * Stage the Next.js standalone server into electron-app/staging/web/ so that
 * electron-builder can ship it as an extra resource (Resources/web).
 *
 * Expects `npm run build` to have been run in ../food-nutrition-app.
 * Next's standalone output does not include .next/static or public/, so they
 * are copied in here, as https://nextjs.org/docs/app/api-reference/config/next-config-js/output
 * requires.
 */
const fs = require('fs');
const path = require('path');

const webDir = path.resolve(__dirname, '..', '..', 'food-nutrition-app');
const standaloneDir = path.join(webDir, '.next', 'standalone');
// electron-builder always drops a node_modules dir at the root of an
// extraResources source, so stage one level down: staging/web -> Resources/web.
const outDir = path.resolve(__dirname, '..', 'staging', 'web');

function fail(msg) {
  console.error(`[stage-web] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(standaloneDir, 'server.js'))) {
  fail(`No standalone build at ${standaloneDir}. Run "npm run build" in food-nutrition-app first.`);
}

fs.rmSync(outDir, { recursive: true, force: true });

// verbatimSymlinks keeps Turbopack's relative .next/node_modules/<pkg>-<hash> links intact.
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });

copy(standaloneDir, outDir);
copy(path.join(webDir, '.next', 'static'), path.join(outDir, '.next', 'static'));
if (fs.existsSync(path.join(webDir, 'public'))) {
  copy(path.join(webDir, 'public'), path.join(outDir, 'public'));
}

// next.config.js traces nutrition.db into the standalone output; fall back to
// copying it so an older config can't silently produce a DB-less app.
const db = path.join(outDir, 'nutrition.db');
if (!fs.existsSync(db)) {
  copy(path.join(webDir, 'nutrition.db'), db);
}
const header = Buffer.alloc(16);
const fd = fs.openSync(db, 'r');
fs.readSync(fd, header, 0, 16, 0);
fs.closeSync(fd);
if (header.toString('latin1') !== 'SQLite format 3\0') {
  fail(`${db} is not a SQLite file (Git LFS pointer?). Run "git lfs pull" and rebuild.`);
}

console.log(`[stage-web] Staged Next.js standalone server into ${outDir}`);
