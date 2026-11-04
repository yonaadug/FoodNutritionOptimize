#!/usr/bin/env node
// Smoke test for any running Vital Nutrition server (next dev/start, the
// standalone server, the Docker image or the Lambda-shaped container).
//
//   node scripts/smoke.mjs [baseUrl] [--wait <seconds>]
//   npm run smoke -- http://127.0.0.1:9000 --wait 60
//
// Checks: GET / (HTML), GET /api/meta (DB loaded), GET /api/search?q=salmon,
// POST /api/optimize with a few searched foods. Exits non-zero on failure.
// Zero dependencies (Node >= 22: global fetch).

const args = process.argv.slice(2);
const waitIdx = args.indexOf('--wait');
const waitSeconds = waitIdx >= 0 ? Number(args.splice(waitIdx, 2)[1]) : 0;
const base = (args[0] ?? process.env.SMOKE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

const results = [];
function pass(name, detail) {
    results.push(name);
    console.log(`  ok  ${name}${detail ? ` - ${detail}` : ''}`);
}
function fail(name, detail) {
    console.error(`  FAIL ${name}: ${detail}`);
    process.exit(1);
}

async function request(path, init) {
    const res = await fetch(base + path, { ...init, signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        /* HTML or plain text */
    }
    return { res, text, json };
}

async function waitForServer() {
    const deadline = Date.now() + waitSeconds * 1000;
    for (;;) {
        try {
            await fetch(base + '/api/meta', { signal: AbortSignal.timeout(5_000) });
            return;
        } catch (err) {
            if (Date.now() > deadline) fail('server reachable', `${base} (${err.cause?.code ?? err.message})`);
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
}

console.log(`Smoke testing ${base}`);
await waitForServer();

{
    const { res, text } = await request('/');
    if (res.status !== 200 || !/<html/i.test(text)) fail('GET /', `status ${res.status}`);
    pass('GET /', `${res.status}, ${text.length} bytes of HTML`);
}

{
    const { res, json } = await request('/api/meta');
    if (res.status !== 200 || !(json?.foodCount > 0)) fail('GET /api/meta', `status ${res.status} ${JSON.stringify(json)?.slice(0, 200)}`);
    pass('GET /api/meta', `${json.foodCount} foods, search mode ${json.searchMode}`);
}

const picked = [];
for (const q of ['salmon', 'broccoli', 'rice', 'apple', 'egg']) {
    const { res, json } = await request(`/api/search?q=${encodeURIComponent(q)}&limit=5`);
    if (res.status !== 200 || !Array.isArray(json?.foods) || json.foods.length === 0) {
        fail(`GET /api/search?q=${q}`, `status ${res.status} ${JSON.stringify(json)?.slice(0, 200)}`);
    }
    if (q === 'salmon') pass('GET /api/search?q=salmon', `${json.total} matches, first: "${json.foods[0].description}"`);
    picked.push(json.foods[0]);
}

async function optimize(extra) {
    const body = JSON.stringify({ foods: picked.map((f) => ({ id: f.id })), ...extra });
    const { res, json } = await request('/api/optimize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
    });
    if (res.status !== 200 || typeof json?.success !== 'boolean') {
        fail('POST /api/optimize', `status ${res.status} ${JSON.stringify(json)?.slice(0, 300)}`);
    }
    return json;
}

{
    // 1) Default goals: five foods rarely cover every daily value, so an
    //    "infeasible" answer (with a diagnosis) is a valid result here.
    const first = await optimize({});
    pass(
        'POST /api/optimize (default goals)',
        first.success ? `plan found, ${first.diet.length} foods` : `infeasible with diagnosis (${first.message.split('\n')[1]?.trim() ?? ''})`,
    );
    // 2) Relaxed goals (only calories + protein) must produce a plan.
    const relaxed = Object.fromEntries(Object.keys(first.constraintLimits ?? {}).map((k) => [k, null]));
    const plan = await optimize({ customConstraints: { ...relaxed, protein_g: { min: 50 } }, minCalories: 1000, maxCalories: 2000 });
    if (!plan.success) fail('POST /api/optimize (relaxed goals)', plan.message);
    pass(
        'POST /api/optimize (relaxed goals)',
        `${plan.diet.length} foods, ${Math.round(plan.totalCalories)} kcal, ${Math.round(plan.totalNutrients.protein_g)} g protein`,
    );
}

console.log(`All ${results.length} smoke checks passed.`);
