import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { sameOriginFetch, sha256Hex } from './same-origin-fetch';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('sha256Hex', () => {
    it('matches the published test vectors', async () => {
        assert.equal(await sha256Hex(''), EMPTY_SHA256);
        assert.equal(await sha256Hex('abc'), ABC_SHA256);
        assert.equal(await sha256Hex(new TextEncoder().encode('abc')), ABC_SHA256);
    });
});

describe('sameOriginFetch', () => {
    const realFetch = globalThis.fetch;
    let calls: { url: string; init: RequestInit }[] = [];
    beforeEach(() => {
        calls = [];
        globalThis.fetch = (async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Response('{}');
        }) as typeof fetch;
    });
    afterEach(() => { globalThis.fetch = realFetch; });

    it('sends JSON with the hash of the exact body CloudFront will see', async () => {
        await sameOriginFetch('/api/optimize', { method: 'POST', json: { a: 1 } });
        const { url, init } = calls[0];
        const headers = init.headers as Record<string, string>;
        assert.equal(url, '/api/optimize');
        assert.equal(init.method, 'POST');
        assert.equal(init.body, '{"a":1}');
        assert.equal(headers['Content-Type'], 'application/json');
        assert.equal(headers['x-amz-content-sha256'], await sha256Hex('{"a":1}'));
        assert.equal(init.credentials, 'same-origin');
    });

    it('hashes a binary body, such as a photo', async () => {
        const bytes = new TextEncoder().encode('abc');
        await sameOriginFetch('/api/recipes/parse', { method: 'POST', body: new Blob([bytes]), contentType: 'image/jpeg' });
        const headers = calls[0].init.headers as Record<string, string>;
        assert.equal(headers['Content-Type'], 'image/jpeg');
        assert.equal(headers['x-amz-content-sha256'], ABC_SHA256);
    });

    it('hashes an empty body on a DELETE', async () => {
        await sameOriginFetch('/api/history?all=1', { method: 'DELETE' });
        assert.equal((calls[0].init.headers as Record<string, string>)['x-amz-content-sha256'], EMPTY_SHA256);
    });

    it('adds nothing to a GET, and passes the abort signal through', async () => {
        const ctrl = new AbortController();
        await sameOriginFetch('/api/me', { signal: ctrl.signal });
        assert.equal(calls[0].init.method, 'GET');
        assert.equal((calls[0].init.headers as Record<string, string>)['x-amz-content-sha256'], undefined);
        assert.equal(calls[0].init.signal, ctrl.signal);
    });
});

/**
 * Behind CloudFront, a request body without its SHA-256 header is refused, so the site
 * works locally and fails in production. Browser code may only call fetch() directly for
 * reads; anything that sends a body goes through sameOriginFetch (or apiFetch).
 */
describe('browser code sends request bodies through sameOriginFetch', () => {
    const root = process.cwd();
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) {
                if (full === path.join(root, 'app', 'api')) continue; // server routes
                walk(full);
            } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
                files.push(full);
            }
        }
    };
    for (const dir of ['app', 'components', 'hooks']) walk(path.join(root, dir));

    /** The text of each direct fetch( ... ) call's arguments. */
    function rawFetchArgs(source: string): string[] {
        const out: string[] = [];
        const re = /(^|[^A-Za-z0-9_$.])fetch\(/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(source))) {
            let depth = 1;
            let i = m.index + m[0].length;
            const start = i;
            for (; i < source.length && depth > 0; i++) {
                if (source[i] === '(') depth++;
                else if (source[i] === ')') depth--;
            }
            out.push(source.slice(start, i - 1));
        }
        return out;
    }

    it('finds the browser files to check', () => {
        assert.ok(files.length > 50, `only ${files.length} files found under ${root}`);
    });

    it('has no direct fetch() that sends a body or takes an init it can\'t see', () => {
        const offenders: string[] = [];
        for (const file of files) {
            for (const args of rawFetchArgs(readFileSync(file, 'utf8'))) {
                const sendsBody = /\b(method|body)\b/.test(args);
                // fetch(url, init) with init from elsewhere could carry a method or body.
                const opaqueInit = /,\s*[A-Za-z_$][\w$.]*\s*$/.test(args.trim());
                if (sendsBody || opaqueInit) offenders.push(`${path.relative(root, file)}: fetch(${args.replace(/\s+/g, ' ').slice(0, 80)})`);
            }
        }
        assert.deepEqual(offenders, [], 'Use sameOriginFetch from lib/same-origin-fetch.ts for these');
    });
});
