#!/usr/bin/env node
// Smoke test for any running NanoNutrition server (next dev/start, the
// standalone server, the Docker image or the Lambda-shaped container).
//
//   node scripts/smoke.mjs [baseUrl] [--wait <seconds>]
//   npm run smoke -- http://127.0.0.1:9000 --wait 60
//
// Checks: GET / (search home), /plan (planner), /food/<id> (redirect, SEO tags,
// 404), nutrient and category lists, sitemap and robots, GET /api/meta (DB
// loaded), GET /api/search?q=salmon, POST /api/optimize with a few searched
// foods. Exits non-zero on failure.
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
    if (!/role="search"/.test(text)) fail('GET /', 'no search form in the HTML');
    pass('GET /', `${res.status}, ${text.length} bytes of HTML, search form present`);
}

{
    const { res, text } = await request('/?q=salmon');
    if (res.status !== 200 || !/href="\/food\/\d+-[a-z0-9-]*salmon/.test(text)) fail('GET /?q=salmon', `status ${res.status}, no server-rendered result`);
    pass('GET /?q=salmon', 'results rendered on the server');
}

{
    const { res, text } = await request('/plan');
    if (res.status !== 200 || !/<html/i.test(text)) fail('GET /plan', `status ${res.status}`);
    pass('GET /plan', `${res.status}, ${text.length} bytes of HTML`);
}

{
    // A bare id redirects to the readable address, which is server-rendered with SEO tags.
    const { json: found } = await request('/api/search?q=salmon&limit=1');
    const fdcId = found?.foods?.[0]?.fdc_id;
    if (!fdcId) fail('find a food', 'no salmon in search');
    const bare = await fetch(`${base}/food/${fdcId}`, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const location = bare.headers.get('location') ?? '';
    if (bare.status !== 308 || !new RegExp(`/food/${fdcId}-[a-z0-9-]+$`).test(location)) {
        fail(`GET /food/${fdcId}`, `expected a 308 to the slug, got ${bare.status} ${location}`);
    }
    pass(`GET /food/${fdcId}`, `308 to ${location}`);
    const path = new URL(location, base).pathname;
    const { res, text } = await request(path);
    if (res.status !== 200) fail(`GET ${path}`, `status ${res.status}`);
    for (const [what, re] of [['title', /<title>[^<]*nutrition facts/i], ['Open Graph', /property="og:title"/], ['canonical', /rel="canonical"/], ['label', /Nutrition Facts/], ['nutrient table', /All nutrients/], ['USDA link', /fdc\.nal\.usda\.gov\/food-details/]]) {
        if (!re.test(text)) fail(`GET ${path}`, `missing ${what} in the HTML`);
    }
    pass(`GET ${path}`, 'server-rendered with title, Open Graph, label and nutrient table');
}

{
    const { res } = await request('/food/999999999');
    if (res.status !== 404) fail('GET /food/999999999', `expected 404, got ${res.status}`);
    pass('GET /food/999999999', '404');
}

{
    const nutrient = await request('/nutrients/vitamin-d');
    if (nutrient.res.status !== 200 || !/Foods high in Vitamin D/.test(nutrient.text)) fail('GET /nutrients/vitamin-d', `status ${nutrient.res.status}`);
    pass('GET /nutrients/vitamin-d', 'best sources listed');
    const category = await request('/food/category/vegetables-and-vegetable-products');
    if (category.res.status !== 200 || !/href="\/food\/\d+-/.test(category.text)) fail('GET /food/category/...', `status ${category.res.status}`);
    pass('GET /food/category/vegetables-and-vegetable-products', 'foods listed');
    const sitemap = await request('/sitemap.xml');
    if (sitemap.res.status !== 200 || !/<loc>[^<]*\/food\/\d+-/.test(sitemap.text)) fail('GET /sitemap.xml', `status ${sitemap.res.status}`);
    pass('GET /sitemap.xml', `${(sitemap.text.match(/<loc>/g) ?? []).length} URLs`);
    const robots = await request('/robots.txt');
    if (robots.res.status !== 200 || !/Sitemap:/i.test(robots.text)) fail('GET /robots.txt', `status ${robots.res.status}`);
    pass('GET /robots.txt');
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
