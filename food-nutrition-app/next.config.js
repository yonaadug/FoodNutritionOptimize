const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
    // Self-contained server in .next/standalone (used by Electron and Docker).
    output: 'standalone',

    // Pin the project root so tracing/Turbopack don't walk up to a parent
    // directory that happens to contain another lockfile.
    outputFileTracingRoot: path.join(__dirname),
    turbopack: {
        root: path.join(__dirname),
    },

    // Native module: load it with Node's require() at runtime instead of
    // bundling it (works for both Turbopack and webpack builds). `highs` (the
    // week planner's solver) loads its .wasm from beside its own .js at runtime.
    serverExternalPackages: ['better-sqlite3', 'highs'],

    // The SQLite DB is opened via fs at runtime, so the tracer can't see it.
    // Ship it inside .next/standalone so the bundle is self-contained.
    outputFileTracingIncludes: {
        '/api/**/*': ['./nutrition.db'],
        '/api/plan/week': ['./node_modules/highs/build/highs.wasm'],
    },

    // No next/image optimization is used, so don't ship sharp/libvips
    // (~19 MB) in the standalone bundle — matters for Lambda/container size.
    images: {
        unoptimized: true,
    },
    // Don't let `next dev` write an AGENTS.md into the repo on every run.
    agentRules: false,

    // `next dev` blocks dev resources (HMR, dev chunks) requested from any
    // origin other than localhost, so the page never hydrates when opened as
    // http://127.0.0.1:3000, which is what the Electron dev shell and the
    // local-testing docs use. Dev-only; no effect on production builds.
    allowedDevOrigins: ['127.0.0.1'],

    outputFileTracingExcludes: {
        // 'next-server' is the key Next uses for the server runtime's own trace.
        'next-server': ['**/node_modules/sharp/**/*', '**/node_modules/@img/**/*'],
    },
};

module.exports = nextConfig;
