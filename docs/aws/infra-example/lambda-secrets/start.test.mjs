// node --test start.test.mjs   (needs `npm ci` here first; no AWS account used)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSecrets, parseSpec } from './start.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('parseSpec reads ENV=/param pairs and rejects anything else', () => {
    assert.deepEqual(parseSpec(''), []);
    assert.deepEqual(parseSpec(undefined), []);
    assert.deepEqual(parseSpec(' A_B=/x/a , C=/x/c '), [['A_B', '/x/a'], ['C', '/x/c']]);
    assert.throws(() => parseSpec('lower=/x'), /ENV_NAME/);
    assert.throws(() => parseSpec('A=x'), /ENV_NAME/);
    assert.throws(() => parseSpec('=/x'), /ENV_NAME/);
});

test('loadSecrets fills unset variables, keeps set ones and reports missing names', async () => {
    const env = { SSM_SECRETS: 'A=/p/a,B=/p/b,C=/p/c', B: 'already' };
    const calls = [];
    const { loaded, missing } = await loadSecrets(
        env,
        async input => {
            calls.push(input);
            return { Parameters: [{ Name: '/p/a', Value: 'secret-a' }], InvalidParameters: ['/p/c'] };
        },
        input => input,
    );
    assert.deepEqual(calls, [{ Names: ['/p/a', '/p/c'], WithDecryption: true }]);
    assert.equal(env.A, 'secret-a');
    assert.equal(env.B, 'already');
    assert.equal(env.C, undefined);
    assert.deepEqual(loaded, ['A']);
    assert.deepEqual(missing, ['/p/c']);
});

test('loadSecrets asks for at most 10 names per call', async () => {
    const names = Array.from({ length: 23 }, (_, i) => `V${i}=/p/${i}`).join(',');
    const sizes = [];
    await loadSecrets({ SSM_SECRETS: names }, async input => {
        sizes.push(input.Names.length);
        return { Parameters: [] };
    }, input => input);
    assert.deepEqual(sizes, [10, 10, 3]);
});

/** A stand-in for the SSM JSON API, so the real AWS SDK path runs without AWS. */
function fakeSsm(values) {
    return new Promise(resolve => {
        const seen = [];
        const server = createServer((req, res) => {
            let body = '';
            req.on('data', c => { body += c; });
            req.on('end', () => {
                seen.push({ target: req.headers['x-amz-target'], body: JSON.parse(body) });
                const names = JSON.parse(body).Names;
                res.setHeader('content-type', 'application/x-amz-json-1.1');
                res.end(JSON.stringify({
                    Parameters: names.filter(n => n in values).map(n => ({ Name: n, Value: values[n], Type: 'SecureString' })),
                    InvalidParameters: names.filter(n => !(n in values)),
                }));
            });
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` }));
    });
}

test('start.mjs reads SSM through the AWS SDK, then starts the server with the values set', async () => {
    const { server, seen, url } = await fakeSsm({ '/nd/dev/auth/secret': 'x'.repeat(44) });
    const dir = mkdtempSync(path.join(tmpdir(), 'nd-secrets-'));
    const entry = path.join(dir, 'server.js');
    // Stands in for Next's standalone server.js (CommonJS).
    writeFileSync(entry, "console.log(JSON.stringify({ auth: (process.env.AUTH_SECRET || '').length, google: process.env.GOOGLE_CLIENT_ID ?? null }));\n");
    try {
        const { stdout, stderr } = await new Promise((resolve, reject) => {
            execFile(process.execPath, [path.join(here, 'start.mjs')], {
                env: {
                    PATH: process.env.PATH,
                    SSM_SECRETS: 'AUTH_SECRET=/nd/dev/auth/secret,GOOGLE_CLIENT_ID=/nd/dev/auth/google-client-id',
                    SERVER_ENTRY: entry,
                    AWS_REGION: 'us-east-1',
                    AWS_ACCESS_KEY_ID: 'AKIDTEST',
                    AWS_SECRET_ACCESS_KEY: 'test',
                    AWS_ENDPOINT_URL_SSM: url,
                },
            }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
        });
        const last = JSON.parse(stdout.trim().split('\n').pop());
        assert.deepEqual(last, { auth: 44, google: null });
        assert.match(stdout, /\[secrets\] loaded AUTH_SECRET from SSM/);
        assert.match(stderr, /\/nd\/dev\/auth\/google-client-id does not exist yet/);
        assert.doesNotMatch(stdout + stderr, /xxxxxxxx/); // the value is never printed
        assert.equal(seen[0].target, 'AmazonSSM.GetParameters');
        assert.equal(seen[0].body.WithDecryption, true);
    } finally {
        server.close();
    }
});

test('start.mjs starts the server even when SSM is unreachable', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nd-secrets-'));
    const entry = path.join(dir, 'server.js');
    writeFileSync(entry, "console.log('server started');\n");
    const { stdout, stderr } = await new Promise((resolve, reject) => {
        execFile(process.execPath, [path.join(here, 'start.mjs')], {
            env: {
                PATH: process.env.PATH,
                SSM_SECRETS: 'AUTH_SECRET=/nd/dev/auth/secret',
                SERVER_ENTRY: entry,
                AWS_REGION: 'us-east-1',
                AWS_ACCESS_KEY_ID: 'AKIDTEST',
                AWS_SECRET_ACCESS_KEY: 'test',
                AWS_ENDPOINT_URL_SSM: 'http://127.0.0.1:9', // nothing listens here
                AWS_MAX_ATTEMPTS: '1',
            },
        }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
    });
    assert.match(stdout, /server started/);
    assert.match(stderr, /could not read SSM parameters/);
});
