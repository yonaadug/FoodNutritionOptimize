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
    // bundling it (works for both Turbopack and webpack builds).
    serverExternalPackages: ['better-sqlite3'],

    // The SQLite DB is opened via fs at runtime, so the tracer can't see it.
    // Ship it inside .next/standalone so the bundle is self-contained.
    outputFileTracingIncludes: {
        '/api/**/*': ['./nutrition.db'],
    },

    // No next/image optimization is used, so don't ship sharp/libvips
    // (~19 MB) in the standalone bundle — matters for Lambda/container size.
    images: {
        unoptimized: true,
    },
    // Don't let `next dev` write an AGENTS.md into the repo on every run.
    agentRules: false,

    outputFileTracingExcludes: {
        // 'next-server' is the key Next uses for the server runtime's own trace.
        'next-server': ['**/node_modules/sharp/**/*', '**/node_modules/@img/**/*'],
    },
};

module.exports = nextConfig;
