import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRoutedProvider, ACCESS_COOLDOWN_MS, CAPACITY_COOLDOWN_MS } from './router';
import { AiError, InvalidReplyError, type AiProvider, type AiResult, type RecipeInput } from './types';
import type { ParsedRecipe } from '../recipes/types';

const TEXT: RecipeInput = { kind: 'text', text: '2 eggs' };
const IMAGE: RecipeInput = { kind: 'image', base64: 'AAAA', mediaType: 'image/jpeg' };

function recipe(platedMeal = false, n = 1): ParsedRecipe {
    return {
        title: 't', servings: 1, platedMeal, warnings: [],
        ingredients: Array.from({ length: n }, () => ({ name: 'egg', quantity: 2, unit: null, preparation: null, notes: null, confidence: 0.9, original: null })),
    };
}

/** A provider that replays scripted outcomes and counts its calls. */
function fake(model: string, ...outcomes: (ParsedRecipe | Error)[]) {
    const calls: RecipeInput[] = [];
    const p: AiProvider & { calls: RecipeInput[] } = {
        name: 'bedrock',
        model,
        calls,
        async readRecipe(input): Promise<AiResult> {
            calls.push(input);
            const next = outcomes.length > 1 ? outcomes.shift()! : outcomes[0];
            if (next instanceof Error) throw next;
            return { recipe: structuredClone(next), usage: { inputTokens: 1, outputTokens: 1 } };
        },
    };
    return p;
}

const denied = () => new AiError('ai_unavailable', 'x', 'access');
const throttled = () => new AiError('ai_rate_limited', 'x', 'capacity');

describe('model routing', () => {
    beforeEach(() => {
        mock.method(console, 'warn', () => {});
        mock.method(console, 'info', () => {});
    });

    it('reads with Haiku by default, and says which model read it', async () => {
        const haiku = fake('haiku', recipe());
        const sonnet = fake('sonnet', recipe());
        const nova = fake('nova', recipe());
        const r = await createRoutedProvider({ primary: haiku, escalation: sonnet, fallback: nova }).readRecipe(TEXT);
        assert.equal(r.model, 'haiku');
        assert.deepEqual([haiku.calls.length, sonnet.calls.length, nova.calls.length], [1, 0, 0]);
    });

    it('keeps a recipe card on Haiku', async () => {
        const haiku = fake('haiku', recipe(false));
        const sonnet = fake('sonnet', recipe());
        const r = await createRoutedProvider({ primary: haiku, escalation: sonnet, fallback: null }).readRecipe(IMAGE);
        assert.equal(r.model, 'haiku');
        assert.equal(sonnet.calls.length, 0);
    });

    it('re-reads a photo of plated food with Sonnet', async () => {
        const haiku = fake('haiku', recipe(true));
        const sonnet = fake('sonnet', recipe(true, 3));
        const r = await createRoutedProvider({ primary: haiku, escalation: sonnet, fallback: null }).readRecipe(IMAGE);
        assert.equal(r.model, 'sonnet');
        assert.equal(r.recipe.ingredients.length, 3);
    });

    it('keeps the Haiku read of a plate when Sonnet fails', async () => {
        const haiku = fake('haiku', recipe(true, 2));
        const sonnet = fake('sonnet', throttled());
        const r = await createRoutedProvider({ primary: haiku, escalation: sonnet, fallback: null }).readRecipe(IMAGE);
        assert.equal(r.model, 'haiku');
        assert.equal(r.recipe.ingredients.length, 2);
    });

    it('escalates to Sonnet when Haiku\'s reply fails validation', async () => {
        const haiku = fake('haiku', new InvalidReplyError('bad'));
        const sonnet = fake('sonnet', recipe());
        const r = await createRoutedProvider({ primary: haiku, escalation: sonnet, fallback: null }).readRecipe(TEXT);
        assert.equal(r.model, 'sonnet');
    });

    it('treats a recipe read with no ingredients as a failed read', async () => {
        const haiku = fake('haiku', recipe(false, 0));
        const sonnet = fake('sonnet', recipe());
        const r = await createRoutedProvider({ primary: haiku, escalation: sonnet, fallback: null }).readRecipe(TEXT);
        assert.equal(r.model, 'sonnet');
    });

    it('passes an empty read through when there is no stronger model, so the page can say "not a recipe"', async () => {
        const nova = fake('nova', recipe());
        const r = await createRoutedProvider({ primary: fake('haiku', recipe(false, 0)), escalation: null, fallback: nova }).readRecipe(TEXT);
        assert.deepEqual([r.model, r.recipe.ingredients.length, nova.calls.length], ['haiku', 0, 0]);
    });

    it('does not escalate other failures: timeouts, refusals, not food, rejected requests', async () => {
        for (const e of [new AiError('ai_timeout', 'x'), new AiError('ai_refused', 'x'), new AiError('ai_not_food', 'x'), new AiError('ai_bad_output', 'x')]) {
            const sonnet = fake('sonnet', recipe());
            const nova = fake('nova', recipe());
            await assert.rejects(createRoutedProvider({ primary: fake('haiku', e), escalation: sonnet, fallback: nova }).readRecipe(TEXT), { code: e.code });
            assert.equal(sonnet.calls.length + nova.calls.length, 0, e.code);
        }
    });

    it('falls back to Nova when Claude is unavailable: access denied, not found, quota, throttling, outage', async () => {
        for (const e of [denied(), throttled(), new AiError('ai_unavailable', 'x', 'capacity')]) {
            const nova = fake('nova', recipe());
            const r = await createRoutedProvider({ primary: fake('haiku', e), escalation: fake('sonnet', recipe()), fallback: nova }).readRecipe(IMAGE);
            assert.equal(r.model, 'nova');
        }
    });

    it('falls back to Nova when Haiku fails validation and Sonnet is unavailable', async () => {
        const nova = fake('nova', recipe());
        const r = await createRoutedProvider({ primary: fake('haiku', new InvalidReplyError('bad')), escalation: fake('sonnet', denied()), fallback: nova }).readRecipe(TEXT);
        assert.equal(r.model, 'nova');
    });

    it('validates Nova like any other read: its failures reach the caller', async () => {
        const router = createRoutedProvider({ primary: fake('haiku', denied()), escalation: null, fallback: fake('nova', new InvalidReplyError('bad')) });
        await assert.rejects(router.readRecipe(TEXT), { code: 'ai_bad_output' });
    });

    it('skips Claude for a while after it was unavailable, then tries it again', async () => {
        let now = 1_000_000;
        const haiku = fake('haiku', denied(), recipe());
        const nova = fake('nova', recipe());
        const router = createRoutedProvider({ primary: haiku, escalation: null, fallback: nova, now: () => now });
        await router.readRecipe(TEXT);
        await router.readRecipe(TEXT);
        assert.equal(haiku.calls.length, 1, 'second request goes straight to Nova');
        assert.equal(nova.calls.length, 2);
        now += ACCESS_COOLDOWN_MS;
        const r = await router.readRecipe(TEXT);
        assert.equal(r.model, 'haiku', 'Claude takes over again once it works');
    });

    it('waits less after throttling than after access denied', () => {
        assert.ok(CAPACITY_COOLDOWN_MS < ACCESS_COOLDOWN_MS);
    });

    it('still tries Claude when there is nothing to fall back to', async () => {
        let now = 0;
        const haiku = fake('haiku', denied());
        const router = createRoutedProvider({ primary: haiku, escalation: null, fallback: null, now: () => now });
        await assert.rejects(router.readRecipe(TEXT), { code: 'ai_unavailable' });
        now += 1;
        await assert.rejects(router.readRecipe(TEXT), { code: 'ai_unavailable' });
        assert.equal(haiku.calls.length, 2);
    });

    it('works with any tier turned off', async () => {
        assert.equal((await createRoutedProvider({ primary: null, escalation: null, fallback: fake('nova', recipe()) }).readRecipe(IMAGE)).model, 'nova');
        assert.equal((await createRoutedProvider({ primary: fake('haiku', recipe(true)), escalation: null, fallback: null }).readRecipe(IMAGE)).model, 'haiku');
        assert.throws(() => createRoutedProvider({ primary: null, escalation: null, fallback: null }));
    });

    it('re-ranks with Claude only while Claude is available', async () => {
        let now = 0;
        const rerank = mock.fn(async () => new Map([[0, 1]]));
        const haiku = Object.assign(fake('haiku', denied()), { rerank });
        const router = createRoutedProvider({ primary: haiku, escalation: null, fallback: fake('nova', recipe()), now: () => now });
        assert.ok(router.rerank);
        await router.readRecipe(TEXT);
        assert.equal((await router.rerank!([])).size, 0);
        assert.equal(rerank.mock.callCount(), 0);
        now += ACCESS_COOLDOWN_MS;
        assert.equal((await router.rerank!([])).size, 1);
    });
});
