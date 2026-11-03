// Zero-dependency test bootstrap for `node --test` (Node >= 22.15 / 23.5).
//
// Node strips TypeScript types natively, but its ESM resolver does not know
// two conventions that Next.js / TypeScript (moduleResolution "bundler") accept:
//   - the `@/` path alias from tsconfig.json ("@/*" -> "./*")
//   - extensionless relative imports ("./optimizer" -> "./optimizer.ts")
// This installs a synchronous resolve hook that adds exactly those two rules
// and defers everything else to Node's default resolver.
//
// Usage (see the "test" script in package.json):
//   node --import ./lib/testing/register.mjs --test "lib/**/*.test.ts"
import { registerHooks } from 'node:module';
import { statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs'];

function isFile(p) {
    try {
        return statSync(p).isFile();
    } catch {
        return false;
    }
}

function resolveTsPath(absPath) {
    if (isFile(absPath)) return absPath;
    for (const ext of EXTENSIONS) {
        if (isFile(absPath + ext)) return absPath + ext;
    }
    for (const ext of EXTENSIONS) {
        const idx = path.join(absPath, 'index' + ext);
        if (isFile(idx)) return idx;
    }
    return null;
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        // Never interfere with dependencies (they may be CommonJS and expect
        // Node's own resolution semantics).
        if (context.parentURL?.includes('/node_modules/')) {
            return nextResolve(specifier, context);
        }
        let candidate = null;
        if (specifier.startsWith('@/')) {
            candidate = path.join(projectRoot, specifier.slice(2));
        } else if (
            (specifier.startsWith('./') || specifier.startsWith('../')) &&
            context.parentURL?.startsWith('file:')
        ) {
            candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
        }
        if (candidate) {
            const resolved = resolveTsPath(candidate);
            if (resolved) return nextResolve(pathToFileURL(resolved).href, context);
        }
        return nextResolve(specifier, context);
    },
});
