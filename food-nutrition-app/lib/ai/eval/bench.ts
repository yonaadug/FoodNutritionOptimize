/**
 * Paid benchmark: which cheaper Bedrock models read recipes as well as the
 * current ones? Makes real, billed model calls, so it is NOT part of `npm test`.
 * Findings: docs/research/CHEAPER_MODELS.md.
 *
 *   cd food-nutrition-app
 *   AWS_PROFILE=nd-dev npm run bench:models             # dry run: lists the plan and its estimate
 *   AWS_PROFILE=nd-dev npm run bench:models -- --yes    # spends money
 *
 * Options: --models id,id (default: every candidate) --set text|image|all
 *          --cap 1.00 (USD, counted across runs from the ledger) --out <dir>
 *
 * What it does, per model:
 * - Sends the app's own request: SYSTEM_PROMPT, the record_recipe tool and the
 *   user turn from lib/ai/claude.ts, through the Converse API, built by
 *   novaRequest (lib/ai/nova.ts) and read by createNovaProvider, so the reply goes
 *   through validateRecipeOutput exactly as in production.
 * - If a model refuses a forced tool choice it falls back to "any", then "auto",
 *   then to JSON in the reply text (the schema in the system prompt). The mode
 *   used is reported: anything but "tool" would need app code to use.
 * - Maps each ingredient with the app's USDA matcher and scores it with the
 *   offline evaluation's scorer (lib/recipes/reader-eval.ts scoreIngredients).
 * - Text set: the pasted fixtures the built-in reader is unsure about (the ones
 *   lib/recipes/confidence.ts sends to AI), plus a few held-out recipes.
 *   Image set: recipe cards rendered from fixture lines (lib/ai/eval/cards.ts).
 * - One small call per model with the prompt alone measures the fixed prompt
 *   cost (system prompt plus schema) in that model's tokenizer, so image tokens
 *   can be read off the image calls.
 *
 * Safety: refuses to run unless AWS_PROFILE is nd-dev (or --profile names
 * another non-prod profile), stops before a call that could pass the cap, and
 * writes every call to calls.jsonl. Prices: AWS Price List for Amazon Bedrock,
 * us-east-1, publication 2026-11-11T01:30:37Z, read 2026-11-14.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../../db';
import { FIXTURE_RECIPES } from '../../recipes/fixtures';
import { HOLDOUT_RECIPES } from '../../recipes/fixtures-holdout';
import { PASTED_RECIPES, type PastedRecipe } from '../../recipes/fixtures-pasted';
import { matchIngredientIn } from '../../recipes/match';
import { asPasted, evaluateRouting, scoreIngredients, stats, type GroupStats, type RecipeScore } from '../../recipes/reader-eval';
import { SYSTEM_PROMPT } from '../claude';
import { createNovaProvider, novaRequest, type NovaRequest, type NovaResponse } from '../nova';
import { RECORD_RECIPE_TOOL, RECORD_RECIPE_TOOL_DEF } from '../schema';
import { AiError, type RecipeInput } from '../types';
import { CARD_STYLES, renderCard } from './cards';

/** USD per million tokens, on demand, us-east-1 (see the header). */
interface Candidate {
    id: string;
    label: string;
    vision: boolean;
    input: number;
    output: number;
}

export const CANDIDATES: Candidate[] = [
    { id: 'deepseek.v3.2', label: 'DeepSeek V3.2', vision: false, input: 0.62, output: 1.85 },
    { id: 'amazon.nova-micro-v1:0', label: 'Nova Micro', vision: false, input: 0.035, output: 0.14 },
    { id: 'amazon.nova-lite-v1:0', label: 'Nova Lite v1', vision: true, input: 0.06, output: 0.24 },
    // The us. profile bills the in-region price, 10% over global (lib/ai/cost.ts).
    { id: 'us.amazon.nova-2-lite-v1:0', label: 'Nova 2 Lite (current fallback)', vision: true, input: 0.33, output: 2.75 },
    { id: 'us.meta.llama4-scout-17b-instruct-v1:0', label: 'Llama 4 Scout', vision: true, input: 0.17, output: 0.66 },
    { id: 'us.meta.llama4-maverick-17b-instruct-v1:0', label: 'Llama 4 Maverick', vision: true, input: 0.24, output: 0.97 },
    { id: 'qwen.qwen3-vl-235b-a22b', label: 'Qwen3 VL 235B', vision: true, input: 0.53, output: 2.66 },
    { id: 'qwen.qwen3-32b-v1:0', label: 'Qwen3 32B', vision: false, input: 0.15, output: 0.6 },
    { id: 'qwen.qwen3-next-80b-a3b', label: 'Qwen3 Next 80B', vision: false, input: 0.14, output: 1.2 },
    { id: 'google.gemma-3-4b-it', label: 'Gemma 3 4B', vision: true, input: 0.04, output: 0.08 },
    { id: 'google.gemma-3-12b-it', label: 'Gemma 3 12B', vision: true, input: 0.09, output: 0.29 },
    { id: 'google.gemma-3-27b-it', label: 'Gemma 3 27B', vision: true, input: 0.23, output: 0.38 },
    { id: 'mistral.ministral-3-3b-instruct', label: 'Ministral 3 3B', vision: true, input: 0.1, output: 0.1 },
    { id: 'mistral.ministral-3-8b-instruct', label: 'Ministral 3 8B', vision: true, input: 0.15, output: 0.15 },
    { id: 'mistral.ministral-3-14b-instruct', label: 'Ministral 3 14B', vision: true, input: 0.2, output: 0.2 },
    { id: 'us.mistral.pixtral-large-2502-v1:0', label: 'Pixtral Large', vision: true, input: 2, output: 6 },
    { id: 'openai.gpt-oss-20b-1:0', label: 'gpt-oss-20b', vision: false, input: 0.07, output: 0.3 },
    { id: 'openai.gpt-oss-120b-1:0', label: 'gpt-oss-120b', vision: false, input: 0.15, output: 0.6 },
];

/**
 * The baseline, run only when named with --models: on 2026-11-14 the dev account
 * had no Marketplace agreement for it (agreementAvailability NOT_AVAILABLE), so
 * it wasn't called. US-geo price, AmazonBedrockFoundationModels price list.
 */
export const BASELINE: Candidate = { id: 'us.anthropic.claude-haiku-5-5', label: 'Claude Haiku 5.5', vision: true, input: 0.11, output: 0.55 };

/** How the record_recipe call is asked for. */
type Mode = 'tool' | 'any' | 'auto' | 'json';
const MODES: Mode[] = ['tool', 'any', 'auto', 'json'];

interface Item {
    kind: 'text' | 'image';
    recipe: PastedRecipe;
    input: RecipeInput;
}

interface CallRecord {
    ts: string;
    model: string;
    kind: string;
    item: string;
    mode: Mode;
    ms: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    stopReason: string | null;
    error: string | null;
}

interface ReadRecord {
    model: string;
    kind: 'text' | 'image';
    item: string;
    ok: boolean;
    error: string | null;
    ms: number;
    inputTokens: number;
    outputTokens: number;
    /** Input tokens of the first call alone (a read may retry once). */
    firstCallInput: number;
    costUsd: number;
    score: RecipeScore | null;
}

// ---------- arguments and safety ----------

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const APP_DIR = path.resolve(import.meta.dirname, '..', '..', '..');
const OUT_DIR = path.resolve(arg('out') ?? path.join(APP_DIR, '..', 'docs', 'research', 'data', 'cheaper-models'));
const CAP_USD = Number(arg('cap') ?? '1.00');
const PAID = flag('yes');
const SET = (arg('set') ?? 'all') as 'text' | 'image' | 'all';
const REGION = 'us-east-1';
const MAX_TOKENS = 4096;
/** Holdout recipes added to the unsure pasted ones: clean text, to check nothing breaks on easy input. */
const HOLDOUT_TEXT = 5;
const CARDS = 8;

const allowedProfile = arg('profile') ?? 'nd-dev';
if (process.env.AWS_PROFILE !== allowedProfile || /prod/i.test(allowedProfile)) {
    console.error(`Refusing to run: set AWS_PROFILE=${allowedProfile} (a non-prod profile). Got "${process.env.AWS_PROFILE ?? ''}".`);
    process.exit(2);
}

// ---------- the spend guard ----------

const ledgerPath = path.join(OUT_DIR, 'calls.jsonl');
fs.mkdirSync(OUT_DIR, { recursive: true });
const priorCalls: CallRecord[] = fs.existsSync(ledgerPath)
    ? fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as CallRecord)
    : [];
let spent = priorCalls.reduce((s, c) => s + c.costUsd, 0);
let reserved = 0;

function price(c: Candidate, inTok: number, outTok: number): number {
    return (inTok * c.input + outTok * c.output) / 1_000_000;
}

/** Worst case for one call: generous input, the whole output budget. */
function worstCase(c: Candidate, req: NovaRequest): number {
    const chars = JSON.stringify(req.system).length + JSON.stringify(RECORD_RECIPE_TOOL_DEF).length
        + req.messages[0].content.reduce((n, b) => n + ('text' in b ? b.text.length : 0), 0);
    const hasImage = req.messages[0].content.some(b => 'image' in b);
    return price(c, Math.ceil(chars / 2.5) + (hasImage ? 8000 : 0), req.inferenceConfig.maxTokens);
}

class BudgetError extends Error {
    constructor() {
        super('budget');
        this.name = 'BudgetError';
    }
}

function record(r: CallRecord): void {
    fs.appendFileSync(ledgerPath, `${JSON.stringify(r)}\n`);
}

// ---------- Converse, generically ----------

type Client = { send: (cmd: unknown) => Promise<NovaResponse> };
let clientPromise: Promise<{ client: Client; Converse: new (input: unknown) => unknown }> | null = null;
function bedrock() {
    return (clientPromise ??= import('@aws-sdk/client-bedrock-runtime').then(({ BedrockRuntimeClient, ConverseCommand }) => ({
        client: new BedrockRuntimeClient({ region: REGION, maxAttempts: 4, requestHandler: { requestTimeout: 90_000 } }) as unknown as Client,
        Converse: ConverseCommand as unknown as new (input: unknown) => unknown,
    })));
}

const JSON_INSTRUCTION = `\n\nThis interface has no tools. Instead of calling ${RECORD_RECIPE_TOOL}, reply with one JSON object that is valid input for it, and nothing else. It must match this JSON Schema:\n${JSON.stringify(RECORD_RECIPE_TOOL_DEF.input_schema)}`;

/** The app's request, adapted to a mode. */
function adapt(req: NovaRequest, mode: Mode): Record<string, unknown> {
    const { toolConfig, system, ...rest } = req;
    if (mode === 'json') return { ...rest, system: [{ text: system[0].text + JSON_INSTRUCTION }] };
    const toolChoice = mode === 'tool' ? toolConfig.toolChoice : mode === 'any' ? { any: {} } : { auto: {} };
    return { ...rest, system, toolConfig: { tools: toolConfig.tools, toolChoice } };
}

/** First JSON object in a text reply, ignoring <think> blocks and code fences. */
export function jsonFromText(text: string): unknown | undefined {
    const s = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
        return JSON.parse(s.slice(start, end + 1));
    } catch {
        return undefined;
    }
}

/** A ValidationException that means "this model can't do that kind of tool call". */
function modeRejected(e: unknown): boolean {
    const err = e as { name?: string; message?: string };
    return err?.name === 'ValidationException' && /tool|choice|function/i.test(err.message ?? '');
}

/** Per model: the mode that works, found on the first call. */
const modeOf = new Map<string, Mode>();

/** What one model's calls have cost so far; models run in parallel, so the global total can't be used per read. */
interface Context { item: string; kind: string; cost: number; inputTokens: number; outputTokens: number; firstCallInput: number }

function makeSend(c: Candidate, context: Context) {
    return async (req: NovaRequest): Promise<NovaResponse> => {
        const { client, Converse } = await bedrock();
        let i = MODES.indexOf(modeOf.get(c.id) ?? 'tool');
        for (;;) {
            const mode = MODES[i];
            const est = worstCase(c, req);
            if (spent + reserved + est > CAP_USD) throw new BudgetError();
            reserved += est;
            const started = Date.now();
            try {
                const reply = await client.send(new Converse(adapt(req, mode)));
                const inTok = reply.usage?.inputTokens ?? 0;
                const outTok = reply.usage?.outputTokens ?? 0;
                const cost = price(c, inTok, outTok);
                spent += cost;
                if (!context.inputTokens) context.firstCallInput = inTok;
                context.cost += cost;
                context.inputTokens += inTok;
                context.outputTokens += outTok;
                modeOf.set(c.id, mode);
                record({
                    ts: new Date().toISOString(), model: c.id, kind: context.kind, item: context.item, mode,
                    ms: Date.now() - started, inputTokens: inTok, outputTokens: outTok, costUsd: cost,
                    stopReason: reply.stopReason ?? null, error: null,
                });
                if (mode !== 'json') return reply;
                // Present a JSON reply as the tool call it stands for, so the app's provider code reads it.
                const text = (reply.output?.message?.content ?? []).map(b => b.text ?? '').join('');
                const parsed = jsonFromText(text);
                return {
                    ...reply,
                    output: { message: { content: parsed === undefined ? [{ text }] : [{ toolUse: { name: RECORD_RECIPE_TOOL, input: parsed } }] } },
                };
            } catch (e) {
                const err = e as { name?: string; message?: string };
                record({
                    ts: new Date().toISOString(), model: c.id, kind: context.kind, item: context.item, mode,
                    ms: Date.now() - started, inputTokens: 0, outputTokens: 0, costUsd: 0, stopReason: null,
                    error: `${err.name ?? 'Error'}: ${(err.message ?? '').slice(0, 200)}`,
                });
                if (modeRejected(e) && i < MODES.length - 1) {
                    i++;
                    continue;
                }
                throw e;
            } finally {
                reserved -= est;
            }
        }
    };
}

// ---------- the test sets ----------

async function buildItems(conn: ReturnType<typeof openDatabase>): Promise<{ text: Item[]; image: Item[]; builtin: RecipeScore[] }> {
    const all = [
        ...FIXTURE_RECIPES.map((r, i) => asPasted(r, i)),
        ...HOLDOUT_RECIPES.map((r, i) => asPasted(r, i)),
        ...PASTED_RECIPES,
    ];
    const routing = evaluateRouting(conn, all);
    const unsure = all.filter((_, i) => !routing.scores[i].verdict.confident);
    const holdout = all.slice(FIXTURE_RECIPES.length, FIXTURE_RECIPES.length + HOLDOUT_RECIPES.length)
        .filter(r => !unsure.includes(r)).slice(0, HOLDOUT_TEXT);
    const textRecipes = [...unsure, ...holdout];
    const builtin = textRecipes.map(r => routing.scores[all.indexOf(r)]);
    const text = textRecipes.map(recipe => ({ kind: 'text' as const, recipe, input: { kind: 'text' as const, text: recipe.text } }));

    // Cards: alternate tuning and held-out recipes, cycling through the styles.
    const cardRecipes = Array.from({ length: CARDS }, (_, i) => (i % 2 === 0 ? FIXTURE_RECIPES[i] : HOLDOUT_RECIPES[i]));
    const cardsDir = path.join(OUT_DIR, 'cards');
    fs.mkdirSync(cardsDir, { recursive: true });
    const image: Item[] = [];
    for (const [i, r] of cardRecipes.entries()) {
        const jpeg = await renderCard(r, CARD_STYLES[i % CARD_STYLES.length]);
        fs.writeFileSync(path.join(cardsDir, `${String(i + 1).padStart(2, '0')}-${r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`), jpeg);
        image.push({ kind: 'image', recipe: asPasted(r, 0), input: { kind: 'image', base64: jpeg.toString('base64'), mediaType: 'image/jpeg' } });
    }
    return { text, image, builtin };
}

// ---------- running ----------

function percentile(xs: number[], p: number): number | null {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/** Errors that mean this account can't call the model at all (access, agreement, verification, unknown id). */
const NOT_INVOCABLE = /AccessDenied|ResourceNotFound|UnrecognizedClient|ExpiredToken/;

/**
 * One small call with the prompt alone: the fixed cost of the system prompt and
 * schema in this model's tokenizer. Also the check that the model can be called.
 */
async function measureOverhead(c: Candidate): Promise<{ tokens: number | null; blocked: string | null }> {
    // A one-line recipe: an empty one makes some models emit a broken tool call, which reports no usage.
    const req = novaRequest(c.id, { kind: 'text', text: '1 egg' });
    req.inferenceConfig.maxTokens = 300;
    try {
        const reply = await makeSend(c, { item: '(prompt + "1 egg")', kind: 'overhead', cost: 0, inputTokens: 0, outputTokens: 0, firstCallInput: 0 })(req);
        return { tokens: reply.usage?.inputTokens ?? null, blocked: null };
    } catch (e) {
        const err = e as { name?: string; message?: string };
        const name = err.name ?? 'Error';
        return { tokens: null, blocked: NOT_INVOCABLE.test(name) ? `${name}: ${(err.message ?? '').slice(0, 120)}` : null };
    }
}

async function runModel(conn: ReturnType<typeof openDatabase>, c: Candidate, items: Item[]): Promise<ReadRecord[]> {
    const context: Context = { item: '', kind: '', cost: 0, inputTokens: 0, outputTokens: 0, firstCallInput: 0 };
    const send = makeSend(c, context);
    const provider = createNovaProvider({ model: c.id, send: req => send(req) });
    const out: ReadRecord[] = [];
    for (const item of items) {
        context.item = item.recipe.title;
        context.kind = item.kind;
        context.cost = 0;
        context.inputTokens = 0;
        context.outputTokens = 0;
        context.firstCallInput = 0;
        const started = Date.now();
        let rec: ReadRecord;
        try {
            const { recipe } = await provider.readRecipe(item.input);
            const foods = recipe.ingredients.map(ing => matchIngredientIn(conn, ing).food);
            rec = {
                model: c.id, kind: item.kind, item: item.recipe.title, ok: recipe.ingredients.length > 0, error: recipe.ingredients.length ? null : 'no ingredients',
                ms: Date.now() - started, inputTokens: context.inputTokens, outputTokens: context.outputTokens, firstCallInput: context.firstCallInput, costUsd: context.cost,
                score: scoreIngredients(item.recipe, recipe.ingredients, foods),
            };
        } catch (e) {
            if (e instanceof BudgetError) {
                console.warn(`[bench] cap reached at $${spent.toFixed(4)}; stopping ${c.id}`);
                break;
            }
            rec = {
                model: c.id, kind: item.kind, item: item.recipe.title, ok: false,
                error: e instanceof AiError ? e.code : `${(e as Error).name}`,
                ms: Date.now() - started,
                inputTokens: context.inputTokens, outputTokens: context.outputTokens, firstCallInput: context.firstCallInput, costUsd: context.cost, score: null,
            };
        }
        out.push(rec);
        console.log(`[bench] ${c.id} ${item.kind} "${item.recipe.title}": ${rec.ok ? 'ok' : `FAIL ${rec.error}`} ${rec.ms} ms in=${rec.inputTokens} out=${rec.outputTokens} $${rec.costUsd.toFixed(5)}`
            + (rec.score ? ` food ${rec.score.foodHits}/${rec.score.lines} grams ${rec.score.gramHits}/${rec.score.lines} kcal ${rec.score.kcalOk ? 'ok' : 'off'}` : ''));
    }
    return out;
}

/** Scores over every item: a failed read counts as every line wrong (as a missed line does in the offline evaluation). */
function scoreAll(reads: ReadRecord[], items: Item[]): GroupStats {
    const scores = items.map(item => {
        const r = reads.find(x => x.item === item.recipe.title && x.kind === item.kind);
        return r?.score ?? { title: item.recipe.title, verdict: { confident: false, reasons: [] }, lines: item.recipe.expect.length, foodHits: 0, gramHits: 0, kcal: 0, kcalOk: false, misses: ['NO READ'] };
    });
    return stats(scores);
}

function summarize(c: Candidate, kind: 'text' | 'image', reads: ReadRecord[], items: Item[], overhead: number | null) {
    const mine = reads.filter(r => r.kind === kind);
    if (!mine.length) return null;
    const ok = mine.filter(r => r.ok);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const meanIn = mean(ok.map(r => r.inputTokens));
    return {
        model: c.id, label: c.label, kind, mode: modeOf.get(c.id) ?? null,
        reads: mine.length, schemaValid: ok.length,
        accuracy: scoreAll(mine, items),
        latencyP50: percentile(ok.map(r => r.ms), 50), latencyP95: percentile(ok.map(r => r.ms), 95),
        meanInputTokens: meanIn, meanOutputTokens: mean(ok.map(r => r.outputTokens)),
        promptOverheadTokens: overhead,
        // About: the overhead call's one-line text prompt is a few tokens longer than the image prompt.
        imageTokens: kind === 'image' && overhead !== null ? percentile(mine.filter(r => r.firstCallInput).map(r => r.firstCallInput - overhead), 50) : null,
        meanCostPerRead: mean(ok.map(r => r.costUsd)),
        spend: mine.reduce((s, r) => s + r.costUsd, 0),
        errors: mine.filter(r => !r.ok).map(r => `${r.item}: ${r.error}`),
    };
}

async function main() {
    const only = arg('models')?.split(',').map(s => s.trim()).filter(Boolean);
    const models = only ? [...CANDIDATES, BASELINE].filter(c => only.includes(c.id)) : CANDIDATES;
    const conn = openDatabase(path.join(APP_DIR, 'nutrition.db'));
    const { text, image, builtin } = await buildItems(conn);
    const useText = SET !== 'image';
    const useImage = SET !== 'text';

    console.log(`[bench] text set: ${text.length} recipes (${text.length - HOLDOUT_TEXT} unsure + ${HOLDOUT_TEXT} held out); image set: ${image.length} cards in ${path.join(OUT_DIR, 'cards')}`);
    console.log(`[bench] built-in reader on the text set: food ${stats(builtin).foodPct?.toFixed(1)}%, grams ${stats(builtin).gramPct?.toFixed(1)}%, kcal ${stats(builtin).kcalOk}/${builtin.length}`);
    // Estimate: about 1,700 input and 600 output tokens a text read, plus about 2,500 input tokens an image.
    let estimate = 0;
    for (const c of models) {
        const e = price(c, 1300, 16)
            + (useText ? text.length * price(c, 1700, 600) : 0)
            + (useImage && c.vision ? image.length * price(c, 4200, 600) : 0);
        estimate += e;
        console.log(`[bench] plan ${c.id.padEnd(44)} ${useText ? text.length : 0} text + ${useImage && c.vision ? image.length : 0} image reads, about $${e.toFixed(4)}`);
    }
    console.log(`[bench] estimate $${estimate.toFixed(4)}; already spent $${spent.toFixed(4)} (ledger); cap $${CAP_USD.toFixed(2)}`);
    if (!PAID) {
        console.log('[bench] dry run. Add --yes to make the calls.');
        return;
    }
    if (spent + estimate > CAP_USD) {
        console.error('[bench] the estimate would pass the cap; narrow --models or --set');
        process.exit(1);
    }

    // The provider logs a line per call with the app's price table, which doesn't know these models. Quiet it.
    console.info = () => {};

    const results: unknown[] = [];
    const queue = [...models];
    const workers = Array.from({ length: 6 }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
            const { tokens: overhead, blocked } = await measureOverhead(c);
            if (blocked) {
                console.warn(`[bench] ${c.id} can't be called from this account: ${blocked}`);
                results.push({ model: c.id, label: c.label, notInvocable: blocked });
                continue;
            }
            const items = [...(useText ? text : []), ...(useImage && c.vision ? image : [])];
            const reads = await runModel(conn, c, items);
            for (const kind of ['text', 'image'] as const) {
                const s = summarize(c, kind, reads, kind === 'text' ? text : image, overhead);
                if (s) results.push({ ...s, details: reads.filter(r => r.kind === kind).map(r => ({ item: r.item, ok: r.ok, error: r.error, ms: r.ms, in: r.inputTokens, out: r.outputTokens, misses: r.score?.misses ?? [] })) });
            }
        }
    });
    await Promise.all(workers);

    const file = path.join(OUT_DIR, `results-${SET}${only ? `-${only.length}models` : ''}.json`);
    fs.writeFileSync(file, JSON.stringify({
        ranAt: new Date().toISOString(), region: REGION, cap: CAP_USD, totalSpentAllRuns: spent,
        builtinOnTextSet: stats(builtin), textItems: text.map(t => t.recipe.title), imageItems: image.map(t => t.recipe.title), results,
    }, null, 1));
    console.log(`[bench] wrote ${file}; total spent across runs $${spent.toFixed(4)}`);
}

await main();
