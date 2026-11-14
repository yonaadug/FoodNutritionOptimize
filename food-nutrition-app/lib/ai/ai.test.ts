import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import Anthropic from '@anthropic-ai/sdk';
import { bedrockConfigHint, bedrockEndpoint, bedrockModelId, chooseProvider, createProvider, DEFAULT_MODEL, mapSdkError } from './index';
import { createClaudeProvider, type ClaudeMessage, type ClaudeRequest } from './claude';
import { createMockProvider } from './mock';
import { baseModelId, estimateCostUsd } from './cost';
import { PLATED_MEAL_MAX_CONFIDENCE, RECORD_RECIPE_TOOL, RECORD_RECIPE_TOOL_DEF, validateChoices, validateRecipeOutput } from './schema';
import { clientIp, overDailyBudget, RateLimiter, recordSpend, resetLimits } from './rate-limit';
import { boxDownscale, fitWithin, imageTokenEstimate, ImageError, MAX_EDGE_PX, MAX_MODEL_IMAGE_BYTES, prepareImage, sniffImage, stripJpegMetadata } from './image';
import { AiError } from './types';

const record = (input: unknown): ClaudeMessage => ({
    content: [{ type: 'tool_use', name: RECORD_RECIPE_TOOL, input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 1000, output_tokens: 500 },
});
const GOOD = {
    kind: 'recipe', title: 'Rice', servings: 2, warnings: [],
    ingredients: [{ name: 'rice', quantity: 1, unit: 'cups', preparation: 'cooked', notes: null, confidence: 0.9 }],
};
const silence = () => mock.method(console, 'info', () => {});

describe('chooseProvider', () => {
    it('defaults to mock, even with credentials present', () => {
        assert.equal(chooseProvider({}).provider, 'mock');
        assert.equal(chooseProvider({ ANTHROPIC_API_KEY: 'x', AWS_REGION: 'us-east-1' }).provider, 'mock');
        assert.equal(chooseProvider({}).fallbackReason, null);
    });
    it('falls back to mock, with a reason, when settings are missing', () => {
        const a = chooseProvider({ AI_PROVIDER: 'anthropic' });
        assert.equal(a.provider, 'mock');
        assert.match(a.fallbackReason!, /ANTHROPIC_API_KEY/);
        const b = chooseProvider({ AI_PROVIDER: 'bedrock' });
        assert.equal(b.provider, 'mock');
        assert.match(b.fallbackReason!, /REGION/);
        assert.match(chooseProvider({ AI_PROVIDER: 'gpt' }).fallbackReason!, /Unknown/);
    });
    it('reads the Bedrock region and prefixes the model id', () => {
        const c = chooseProvider({ AI_PROVIDER: 'bedrock', AWS_REGION: 'us-west-2' });
        assert.deepEqual([c.provider, c.region, c.model], ['bedrock', 'us-west-2', `anthropic.${DEFAULT_MODEL}`]);
        assert.equal(chooseProvider({ AI_PROVIDER: 'bedrock', AI_BEDROCK_REGION: 'eu-west-1', AWS_REGION: 'us-west-2' }).region, 'eu-west-1');
        assert.equal(chooseProvider({ AI_PROVIDER: 'bedrock', AWS_REGION: 'x', AI_MODEL: 'claude-haiku-5-5' }).model, 'anthropic.claude-haiku-5-5');
    });
    it('keeps full Bedrock ids and profiles as written', () => {
        assert.equal(bedrockModelId('us.anthropic.claude-haiku-5-5'), 'us.anthropic.claude-haiku-5-5');
        assert.equal(bedrockModelId('arn:aws:bedrock:us-east-1:1:inference-profile/x'), 'arn:aws:bedrock:us-east-1:1:inference-profile/x');
    });
    it('sends inference profiles and ARNs to bedrock-runtime, bare ids to the Mantle endpoint', () => {
        // Mantle serves "anthropic.<model>" ids only, and not every model (Haiku 5.5 and Sonnet 5.5
        // were missing from its us-east-1 model list on 2026-11-13). Profiles go through InvokeModel.
        assert.equal(bedrockEndpoint('anthropic.claude-opus-5-5'), 'mantle');
        assert.equal(bedrockEndpoint('us.anthropic.claude-haiku-5-5'), 'runtime');
        assert.equal(bedrockEndpoint('global.anthropic.claude-haiku-5-5'), 'runtime');
        assert.equal(bedrockEndpoint('eu.anthropic.claude-sonnet-5-5'), 'runtime');
        assert.equal(bedrockEndpoint('apac.anthropic.claude-sonnet-5-5'), 'runtime');
        assert.equal(bedrockEndpoint('arn:aws:bedrock:us-east-1:1:inference-profile/us.anthropic.claude-haiku-5-5'), 'runtime');
        const c = chooseProvider({ AI_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1', AI_MODEL: 'us.anthropic.claude-haiku-5-5' });
        assert.deepEqual([c.model, c.endpoint], ['us.anthropic.claude-haiku-5-5', 'runtime']);
        assert.equal(chooseProvider({ AI_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1' }).endpoint, 'mantle');
        assert.equal(chooseProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).endpoint, null);
        assert.equal(createProvider({ AI_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1', AI_MODEL: 'global.anthropic.claude-haiku-5-5' }).provider.model, 'global.anthropic.claude-haiku-5-5');
    });
    it('tells the owner what to do about Bedrock 403 and 404', () => {
        const denied = bedrockConfigHint(403, 'us.anthropic.claude-haiku-5-5', 'runtime');
        assert.match(denied, /use-case form/);
        assert.match(denied, /quota/);
        assert.match(denied, /BEDROCK_SETUP\.md/);
        const missing = bedrockConfigHint(404, 'anthropic.claude-haiku-5-5', 'mantle');
        assert.match(missing, /us\.anthropic\.claude-haiku-5-5/);
        assert.match(missing, /AI_MODEL/);
        assert.match(bedrockConfigHint(404, 'us.anthropic.claude-nope', 'runtime'), /list-inference-profiles/);
        assert.match(bedrockConfigHint(401, 'anthropic.claude-opus-5-5', 'mantle'), /credentials/);
    });
    it('logs the hint for Bedrock configuration errors but keeps the user message generic', async () => {
        const logged: string[] = [];
        const err = mock.method(console, 'error', (m: string) => { logged.push(m); });
        try {
            const e = new Anthropic.PermissionDeniedError(403, { message: 'not available for this account' }, 'not available for this account', new Headers());
            const mapped = await mapSdkError(e, { model: 'us.anthropic.claude-haiku-5-5', endpoint: 'runtime' });
            assert.equal(mapped.code, 'ai_unavailable');
            assert.doesNotMatch(mapped.message, /form|quota|AI_MODEL/);
            assert.match(logged.join('\n'), /use-case form/);
            const plain = await mapSdkError(new Anthropic.NotFoundError(404, {}, 'x', new Headers()), null);
            assert.equal(plain.code, 'ai_unavailable');
        } finally {
            err.mock.restore();
        }
    });
    it('uses the bare model id on the Claude API', () => {
        assert.equal(chooseProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).model, DEFAULT_MODEL);
    });
    it('creates a provider without touching the network', () => {
        assert.equal(createProvider({ AI_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1' }).provider.name, 'bedrock');
        assert.equal(createProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).provider.name, 'anthropic');
        assert.equal(createProvider({}).provider.name, 'mock');
    });
    it('offers re-rank only on real providers that opted in', () => {
        assert.equal(createProvider({ AI_RERANK: '1' }).provider.rerank, undefined);
        assert.equal(createProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).provider.rerank, undefined);
        assert.equal(typeof createProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', AI_RERANK: '1' }).provider.rerank, 'function');
    });
});

describe('Claude provider request', () => {
    it('asks for the tool without forcing it, with a strict schema', async () => {
        silence();
        let seen: ClaudeRequest | undefined;
        const p = createClaudeProvider({ name: 'anthropic', model: 'claude-opus-5-5', send: async r => { seen = r; return record(GOOD); } });
        await p.readRecipe({ kind: 'text', text: '1 cup rice' });
        assert.equal(seen!.tool_choice.type, 'auto');
        assert.equal(seen!.output_config?.effort, 'low');
        assert.ok(!('thinking' in seen!), 'thinking cannot be disabled on Opus 5.5, so it is not sent');
        assert.ok(!('temperature' in seen!));
        const tool = seen!.tools[0] as typeof RECORD_RECIPE_TOOL_DEF;
        assert.equal(tool.strict, true);
        assert.equal(tool.input_schema.additionalProperties, false);
        assert.match(JSON.stringify(seen!.messages), /<recipe>/);
    });
    it('every object in the tool schema is closed and requires all its keys', () => {
        const walk = (s: Record<string, unknown>) => {
            if (s.type === 'object') {
                assert.equal(s.additionalProperties, false);
                assert.deepEqual([...(s.required as string[])].sort(), Object.keys(s.properties as object).sort());
                Object.values(s.properties as object).forEach(walk);
            }
            if (s.items) walk(s.items as Record<string, unknown>);
        };
        walk(RECORD_RECIPE_TOOL_DEF.input_schema as unknown as Record<string, unknown>);
    });
    it('omits effort for models that reject it', async () => {
        silence();
        let seen: ClaudeRequest | undefined;
        const p = createClaudeProvider({ name: 'anthropic', model: 'claude-haiku-4-5', send: async r => { seen = r; return record(GOOD); } });
        await p.readRecipe({ kind: 'text', text: 'x' });
        assert.equal(seen!.output_config, undefined);
    });
    it('sends images as base64 before the text', async () => {
        silence();
        let seen: ClaudeRequest | undefined;
        const p = createClaudeProvider({ name: 'bedrock', model: 'anthropic.claude-opus-5-5', send: async r => { seen = r; return record(GOOD); } });
        await p.readRecipe({ kind: 'image', base64: 'AAAA', mediaType: 'image/jpeg' });
        const content = seen!.messages[0].content as { type: string; source?: { type: string; data: string } }[];
        assert.equal(content[0].type, 'image');
        assert.equal(content[0].source?.type, 'base64');
        assert.equal(content[1].type, 'text');
    });
});

describe('Claude provider replies', () => {
    it('returns the normalised recipe and usage', async () => {
        silence();
        const p = createClaudeProvider({ name: 'anthropic', model: 'claude-opus-5-5', send: async () => record(GOOD) });
        const r = await p.readRecipe({ kind: 'text', text: 'x' });
        assert.equal(r.recipe.ingredients[0].unit, 'cup');
        assert.deepEqual([r.usage?.inputTokens, r.usage?.outputTokens], [1000, 500]);
    });
    it('checks a refusal before reading content', async () => {
        silence();
        const p = createClaudeProvider({ name: 'anthropic', model: 'claude-opus-5-5', send: async () => ({ content: [], stop_reason: 'refusal' }) });
        await assert.rejects(p.readRecipe({ kind: 'text', text: 'x' }), (e: AiError) => e.code === 'ai_refused' && e.status === 422);
    });
    it('reports a truncated reply', async () => {
        silence();
        const p = createClaudeProvider({ name: 'anthropic', model: 'm', send: async () => ({ ...record(GOOD), stop_reason: 'max_tokens' }) });
        await assert.rejects(p.readRecipe({ kind: 'text', text: 'x' }), (e: AiError) => e.code === 'ai_bad_output');
    });
    it('retries once when no tool call came back, counting both calls', async () => {
        silence();
        let calls = 0;
        const send = async () => {
            calls++;
            return calls === 1
                ? { content: [{ type: 'text' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }
                : record(GOOD);
        };
        const r = await createClaudeProvider({ name: 'anthropic', model: 'm', send }).readRecipe({ kind: 'text', text: 'x' });
        assert.equal(calls, 2);
        assert.equal(r.usage?.inputTokens, 1010);
    });
    it('gives up after the second reply with no tool call', async () => {
        silence();
        let calls = 0;
        const send = async () => { calls++; return { content: [], stop_reason: 'end_turn' }; };
        await assert.rejects(createClaudeProvider({ name: 'anthropic', model: 'm', send }).readRecipe({ kind: 'text', text: 'x' }), (e: AiError) => e.code === 'ai_bad_output');
        assert.equal(calls, 2);
    });
    it('counts spend for successful and failed calls', async () => {
        silence();
        const spent: number[] = [];
        await createClaudeProvider({ name: 'anthropic', model: 'claude-opus-5-5', send: async () => record(GOOD), onSpend: u => spent.push(u) }).readRecipe({ kind: 'text', text: 'x' });
        await assert.rejects(createClaudeProvider({ name: 'anthropic', model: 'claude-opus-5-5', send: async () => ({ ...record(GOOD), stop_reason: 'max_tokens' }), onSpend: u => spent.push(u) }).readRecipe({ kind: 'text', text: 'x' }));
        assert.equal(spent.length, 2);
        assert.ok(spent.every(u => Math.abs(u - 0.014) < 1e-9));
    });
    it('never logs recipe text or image data', async () => {
        const lines: string[] = [];
        mock.method(console, 'info', (s: string) => { lines.push(s); });
        const p = createClaudeProvider({ name: 'anthropic', model: 'claude-opus-5-5', send: async () => record(GOOD) });
        await p.readRecipe({ kind: 'text', text: 'SECRET-RECIPE-TEXT' });
        await p.readRecipe({ kind: 'image', base64: 'SECRET-IMAGE-DATA', mediaType: 'image/png' });
        assert.equal(lines.length, 2);
        assert.doesNotMatch(lines.join('\n'), /SECRET/);
        assert.match(lines[0], /cost_usd=0\.01400/);
    });
});

describe('re-rank', () => {
    const items = [{ index: 3, name: 'quark', preparation: null, candidates: [{ fdcId: 1, description: 'a', dataType: 'x', score: 1 }, { fdcId: 2, description: 'b', dataType: 'x', score: 0 }] }];
    const reply = (choices: unknown): ClaudeMessage => ({ content: [{ type: 'tool_use', name: 'choose_foods', input: { choices } }], stop_reason: 'tool_use' });

    it('returns only ids among the candidates', async () => {
        silence();
        const p = createClaudeProvider({ name: 'anthropic', model: 'm', rerank: true, send: async () => reply([{ index: 3, fdc_id: 999 }]) });
        assert.equal((await p.rerank!(items)).size, 0);
    });
    it('caches answers, including "none fit"', async () => {
        silence();
        let calls = 0;
        const p = createClaudeProvider({ name: 'anthropic', model: 'm', rerank: true, send: async () => { calls++; return reply([{ index: 3, fdc_id: 2 }]); } });
        assert.equal((await p.rerank!(items)).get(3), 2);
        assert.equal((await p.rerank!(items)).get(3), 2);
        assert.equal(calls, 1);
        let nullCalls = 0;
        const q = createClaudeProvider({ name: 'anthropic', model: 'm', rerank: true, send: async () => { nullCalls++; return reply([{ index: 3, fdc_id: null }]); } });
        assert.equal((await q.rerank!(items)).size, 0);
        await q.rerank!(items);
        assert.equal(nullCalls, 1);
    });
    it('validateChoices ignores malformed rows', () => {
        assert.deepEqual([...validateChoices({ choices: [{ index: 1, fdc_id: 5 }, { index: 'x', fdc_id: 5 }, null, { index: 2 }] })], [[1, 5]]);
        assert.equal(validateChoices(null).size, 0);
    });
});

describe('validateRecipeOutput', () => {
    const ing = (o: object) => validateRecipeOutput({ ...GOOD, ingredients: [{ name: 'x', quantity: 1, unit: null, preparation: null, notes: null, confidence: 0.5, ...o }] }).ingredients;

    it('normalises units and keeps unknown ones visible', () => {
        assert.equal(ing({ unit: 'Tablespoons' })[0].unit, 'tbsp');
        const u = ing({ unit: 'knob', notes: 'soft' })[0];
        assert.equal(u.unit, null);
        assert.equal(u.notes, 'soft; knob');
    });
    it('rejects bad numbers', () => {
        for (const q of [-1, 0, NaN, Infinity, '2', 1e9]) assert.equal(ing({ quantity: q })[0].quantity, null);
    });
    it('clamps confidence and defaults a missing one', () => {
        assert.equal(ing({ confidence: 7 })[0].confidence, 1);
        assert.equal(ing({ confidence: -1 })[0].confidence, 0);
        assert.equal(ing({ confidence: 'high' })[0].confidence, 0.5);
    });
    it('drops rows with no name and caps the list', () => {
        assert.equal(ing({ name: '  ' }).length, 0);
        const many = Array.from({ length: 200 }, (_, i) => ({ name: `f${i}`, quantity: 1, unit: null, preparation: null, notes: null, confidence: 1 }));
        assert.equal(validateRecipeOutput({ ...GOOD, ingredients: many }).ingredients.length, 60);
    });
    it('caps text length', () => {
        assert.ok(ing({ name: 'a'.repeat(5000) })[0].name.length <= 120);
    });
    it('caps confidence on plated meals, whatever the model says', () => {
        const r = validateRecipeOutput({ ...GOOD, kind: 'plated_meal', ingredients: [{ name: 'rice', quantity: 200, unit: 'g', preparation: null, notes: null, confidence: 0.99 }] });
        assert.equal(r.platedMeal, true);
        assert.equal(r.ingredients[0].confidence, PLATED_MEAL_MAX_CONFIDENCE);
    });
    it('rejects non-food and malformed replies', () => {
        assert.throws(() => validateRecipeOutput({ ...GOOD, kind: 'not_food' }), (e: AiError) => e.code === 'ai_not_food');
        assert.throws(() => validateRecipeOutput('nope'), (e: AiError) => e.code === 'ai_bad_output');
        assert.throws(() => validateRecipeOutput({ kind: 'recipe' }), (e: AiError) => e.code === 'ai_bad_output');
    });
    it('rejects silly servings', () => {
        for (const s of [0, -1, 500, '4']) assert.equal(validateRecipeOutput({ ...GOOD, servings: s }).servings, null);
    });
});

describe('mock provider', () => {
    const p = createMockProvider();
    it('reads real text with the rule-based parser', async () => {
        const r = await p.readRecipe({ kind: 'text', text: 'Toast\nServes 2\n2 slices bread\n1 tbsp butter' });
        assert.equal(r.recipe.title, 'Toast');
        assert.equal(r.recipe.ingredients.length, 2);
        assert.equal(r.usage, null);
    });
    it('is deterministic for images and says it is a sample', async () => {
        const a = await p.readRecipe({ kind: 'image', base64: 'abc', mediaType: 'image/jpeg' });
        const b = await p.readRecipe({ kind: 'image', base64: 'abc', mediaType: 'image/jpeg' });
        assert.deepEqual(a, b);
        assert.equal(a.recipe.platedMeal, true);
        assert.match(a.recipe.warnings![0], /sample/);
    });
    it('does not let callers mutate its fixtures', async () => {
        const a = await p.readRecipe({ kind: 'image', base64: 'abc', mediaType: 'image/jpeg' });
        a.recipe.ingredients.length = 0;
        const b = await p.readRecipe({ kind: 'image', base64: 'abc', mediaType: 'image/jpeg' });
        assert.ok(b.recipe.ingredients.length > 0);
    });
    it('rejects text with no ingredients', async () => {
        await assert.rejects(p.readRecipe({ kind: 'text', text: '   ' }), (e: AiError) => e.code === 'ai_not_food');
    });
    it('does not re-rank', () => assert.equal(p.rerank, undefined));
});

describe('cost', () => {
    it('strips Bedrock prefixes', () => {
        assert.equal(baseModelId('anthropic.claude-opus-5-5'), 'claude-opus-5-5');
        assert.equal(baseModelId('us.anthropic.claude-haiku-5-5'), 'claude-haiku-5-5');
        assert.equal(baseModelId('global.anthropic.claude-haiku-5-5'), 'claude-haiku-5-5');
        assert.equal(baseModelId('claude-haiku-5-5'), 'claude-haiku-5-5');
    });
    it('uses list prices', () => {
        const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
        assert.equal(estimateCostUsd('claude-opus-5-5', usage), 24);
        assert.equal(estimateCostUsd('claude-haiku-5-5', usage), 0.6);
        assert.equal(estimateCostUsd('global.anthropic.claude-sonnet-5-5', usage), 12);
    });
    it('adds the 10% Bedrock premium for regional and US-only routing', () => {
        // AWS Marketplace offer for Haiku 5.5, 2026-11-13: global $0.10/$0.50, "Standard" (non-global) $0.11/$0.55.
        const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
        assert.equal(Number(estimateCostUsd('us.anthropic.claude-haiku-5-5', usage).toFixed(6)), 0.66);
        assert.equal(Number(estimateCostUsd('anthropic.claude-sonnet-5-5', usage).toFixed(6)), 13.2);
        assert.equal(Number(estimateCostUsd('arn:aws:bedrock:us-east-1:1:inference-profile/us.anthropic.claude-haiku-5-5', usage).toFixed(6)), 0.66);
        assert.equal(baseModelId('arn:aws:bedrock:us-east-1:1:inference-profile/global.anthropic.claude-haiku-5-5'), 'claude-haiku-5-5');
    });
    it('is zero for mock, and an unknown model never looks free', () => {
        assert.equal(estimateCostUsd(null, { inputTokens: 1, outputTokens: 1 }), 0);
        assert.equal(estimateCostUsd('claude-opus-5-5', null), 0);
        assert.ok(estimateCostUsd('claude-new', { inputTokens: 1000, outputTokens: 1000 }) > 0);
    });
});

describe('RateLimiter', () => {
    it('allows up to the per-minute limit, then resets', () => {
        const l = new RateLimiter(2, 100);
        assert.ok(l.check('a', 0).allowed);
        assert.ok(l.check('a', 1).allowed);
        const blocked = l.check('a', 2);
        assert.equal(blocked.allowed, false);
        assert.equal(blocked.retryAfterSeconds, 60);
        assert.ok(l.check('b', 2).allowed, 'keys are separate');
        assert.ok(l.check('a', 60_000).allowed);
    });
    it('enforces the daily limit', () => {
        const l = new RateLimiter(100, 2);
        l.check('a', 0);
        l.check('a', 1);
        const blocked = l.check('a', 120_000);
        assert.equal(blocked.allowed, false);
        assert.ok(blocked.retryAfterSeconds > 3600);
        assert.ok(l.check('a', 24 * 3600_000).allowed);
    });
    it('treats 0 as no limit', () => {
        const l = new RateLimiter(0, 0);
        for (let i = 0; i < 100; i++) assert.ok(l.check('a', i).allowed);
    });
    it('does not grow without bound', () => {
        const l = new RateLimiter(1, 1);
        for (let i = 0; i < 25_000; i++) l.check(`ip-${i}`, 0);
        assert.ok((l as unknown as { entries: Map<string, unknown> }).entries.size <= 10_000);
    });
});

describe('clientIp', () => {
    const h = (o: Record<string, string>) => new Headers(o);
    it('prefers the CloudFront viewer address, without the port', () => {
        assert.equal(clientIp(h({ 'cloudfront-viewer-address': '1.2.3.4:443', 'x-forwarded-for': '9.9.9.9' })), '1.2.3.4');
    });
    it('uses the right-most forwarded address, which a client cannot forge', () => {
        assert.equal(clientIp(h({ 'x-forwarded-for': 'forged, 5.6.7.8' })), '5.6.7.8');
    });
    it('falls back to x-real-ip, then a shared bucket', () => {
        assert.equal(clientIp(h({ 'x-real-ip': '7.7.7.7' })), '7.7.7.7');
        assert.equal(clientIp(h({})), 'unknown');
    });
});

describe('daily budget', () => {
    beforeEach(() => resetLimits());
    const noon = Date.UTC(2026, 10, 4, 12);
    it('trips at the budget and resets the next day', () => {
        assert.equal(overDailyBudget({ AI_DAILY_BUDGET_USD: '1' }, noon), false);
        recordSpend(0.6, noon);
        assert.equal(overDailyBudget({ AI_DAILY_BUDGET_USD: '1' }, noon), false);
        recordSpend(0.5, noon);
        assert.equal(overDailyBudget({ AI_DAILY_BUDGET_USD: '1' }, noon), true);
        assert.equal(overDailyBudget({ AI_DAILY_BUDGET_USD: '1' }, noon + 24 * 3600_000), false);
    });
    it('0 turns it off', () => {
        recordSpend(1000, noon);
        assert.equal(overDailyBudget({ AI_DAILY_BUDGET_USD: '0' }, noon), false);
    });
});

function makeJpeg(width: number, height: number): Uint8Array {
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = (i / 4) % 256; data[i + 1] = 128; data[i + 2] = 64; data[i + 3] = 255; }
    return new Uint8Array(jpeg.encode({ data, width, height }, 80).data);
}

function withExif(j: Uint8Array): Uint8Array {
    const payload = new TextEncoder().encode('Exif\0\0GPS-LOCATION-SECRET');
    const seg = new Uint8Array(4 + payload.length);
    seg[0] = 0xff; seg[1] = 0xe1;
    new DataView(seg.buffer).setUint16(2, payload.length + 2);
    seg.set(payload, 4);
    const out = new Uint8Array(j.length + seg.length);
    out.set(j.subarray(0, 2), 0);
    out.set(seg, 2);
    out.set(j.subarray(2), 2 + seg.length);
    return out;
}

/** 1x1 PNG header with chosen dimensions (enough for the sniffer). */
function pngHeader(w: number, h: number): Uint8Array {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const v = new DataView(b.buffer);
    v.setUint32(16, w);
    v.setUint32(20, h);
    return b;
}

describe('images', () => {
    it('sniffs types from bytes, not names', () => {
        assert.deepEqual(sniffImage(makeJpeg(32, 16)), { mediaType: 'image/jpeg', width: 32, height: 16 });
        assert.deepEqual(sniffImage(pngHeader(640, 480)), { mediaType: 'image/png', width: 640, height: 480 });
        const gif = new Uint8Array(20);
        gif.set(new TextEncoder().encode('GIF89a'));
        new DataView(gif.buffer).setUint16(6, 300, true);
        new DataView(gif.buffer).setUint16(8, 200, true);
        assert.deepEqual(sniffImage(gif), { mediaType: 'image/gif', width: 300, height: 200 });
        const webp = new Uint8Array(30);
        webp.set(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8X'));
        webp.set([99, 0, 0, 49, 0, 0], 24);
        assert.deepEqual(sniffImage(webp), { mediaType: 'image/webp', width: 100, height: 50 });
        assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
        assert.equal(sniffImage(new Uint8Array(4)), null);
    });
    it('names HEIC photos in the error, with what to do instead', async () => {
        const heic = new Uint8Array(32);
        heic.set(new TextEncoder().encode('\0\0\0\x18ftypheic'));
        await assert.rejects(prepareImage(heic), (e: ImageError) => e.status === 415 && /HEIC/.test(e.message) && /JPEG/.test(e.message));
        const avif = new Uint8Array(32);
        avif.set(new TextEncoder().encode('\0\0\0\x18ftypmif1'));
        await assert.rejects(prepareImage(avif), (e: ImageError) => e.status === 415 && /HEIC/.test(e.message));
    });
    it('removes EXIF from a JPEG and keeps it decodable', () => {
        const j = withExif(makeJpeg(32, 32));
        assert.match(Buffer.from(j).toString('latin1'), /GPS-LOCATION-SECRET/);
        const out = stripJpegMetadata(j);
        assert.doesNotMatch(Buffer.from(out).toString('latin1'), /GPS-LOCATION-SECRET/);
        assert.equal(jpeg.decode(out).width, 32);
    });
    it('passes a small JPEG through without metadata', async () => {
        const r = await prepareImage(withExif(makeJpeg(64, 48)));
        assert.equal(r.downscaled, false);
        assert.doesNotMatch(Buffer.from(r.base64, 'base64').toString('latin1'), /GPS-LOCATION-SECRET/);
    });
    it('downscales a large JPEG to the long-edge limit, keeping the aspect ratio', async () => {
        const r = await prepareImage(withExif(makeJpeg(2000, 1000)));
        assert.deepEqual([r.width, r.height, r.downscaled], [MAX_EDGE_PX, 784, true]);
        assert.deepEqual(sniffImage(Buffer.from(r.base64, 'base64')), { mediaType: 'image/jpeg', width: MAX_EDGE_PX, height: 784 });
        assert.doesNotMatch(Buffer.from(r.base64, 'base64').toString('latin1'), /GPS-LOCATION-SECRET/);
    });
    it('rejects oversized uploads, wrong types and bitmap bombs', async () => {
        await assert.rejects(prepareImage(makeJpeg(16, 16), 10), (e: ImageError) => e.status === 413);
        await assert.rejects(prepareImage(new TextEncoder().encode('not an image, just some text')), (e: ImageError) => e.status === 415);
        await assert.rejects(prepareImage(pngHeader(7999, 7999)), (e: ImageError) => e.status === 413 && /dimensions/.test(e.message));
        await assert.rejects(prepareImage(pngHeader(9000, 10)), (e: ImageError) => e.status === 413);
        await assert.rejects(prepareImage(pngHeader(0, 0)), (e: ImageError) => e.status === 413);
    });
    it('applies the 5 MB model limit to the base64 it sends, not the raw bytes', async () => {
        // Claude on Bedrock: 5 MB per image, base64-encoded. 4 MB of PNG is about 5.3 MB of base64.
        const big = new Uint8Array(4 * 1024 * 1024);
        big.set(pngHeader(1000, 1000));
        await assert.rejects(prepareImage(big), (e: ImageError) => e.status === 413);
        const fits = new Uint8Array(3 * 1024 * 1024);
        fits.set(pngHeader(1000, 1000));
        const r = await prepareImage(fits);
        assert.ok(r.base64.length <= MAX_MODEL_IMAGE_BYTES);
    });
    it('fitWithin only shrinks', () => {
        assert.equal(fitWithin(100, 100, 200), null);
        assert.deepEqual(fitWithin(4000, 3000, 1568), { width: 1568, height: 1176 });
        assert.deepEqual(fitWithin(3000, 4000, 1568), { width: 1176, height: 1568 });
    });
    it('boxDownscale averages pixels', () => {
        const src = new Uint8Array([0, 0, 0, 255, 100, 100, 100, 255, 100, 100, 100, 255, 200, 200, 200, 255]);
        assert.deepEqual([...boxDownscale(src, 2, 2, 1, 1)], [100, 100, 100, 255]);
    });
    it('estimates vision tokens by 28 px patches', () => {
        assert.equal(imageTokenEstimate(1000, 1000), 1296);
        assert.equal(imageTokenEstimate(1568, 1176), 2352);
    });
});
