/**
 * Ingredient -> USDA food. Server side: uses the FTS search in lib/db.ts, then
 * re-scores candidates for recipe use. Search ranks for someone browsing;
 * a recipe wants the plain raw form unless the recipe says otherwise
 * ("2 eggs" -> whole egg, "1 cup cooked rice" -> rice, cooked).
 *
 * The scorer is deterministic. An optional LLM re-rank (lib/recipes/analyze.ts)
 * can only choose among these candidates, so it cannot invent a food.
 */
import { getFoodsByIdsIn, searchFoodsIn } from '../db';
import type { openDatabase, Food } from '../db';
import type { MatchCandidate, ParsedIngredient, RecipeFood } from './types';
import { mergePortions } from './grams';
import { wordStem, words } from './text';

type Connection = ReturnType<typeof openDatabase>;

/**
 * USDA names many staples oddly ("Oil, olive", "Sugars, granulated"), and a
 * recipe's bare word usually means one specific form. First match wins; queries
 * are tried in order and their results pooled. `cooked` variants are used when
 * the ingredient is described as cooked.
 */
interface Alias {
    re: RegExp;
    queries: string[];
    cooked?: string[];
    /** Test against "canned <preparation> <name>" instead of the name alone. */
    context?: boolean;
}

const ALIASES: Alias[] = [
    // Eggs and dairy
    { re: /\begg whites?\b/, queries: ['egg white'] },
    { re: /\begg yolks?\b/, queries: ['egg yolk'] },
    { re: /\beggs?$/, queries: ['eggs grade large egg whole', 'egg whole raw fresh'] },
    { re: /\bunsalted butter\b/, queries: ['butter stick unsalted'] },
    { re: /\bpeanut butter\b/, queries: ['peanut butter'] },
    { re: /\bbutter(milk)\b/, queries: ['buttermilk', 'milk buttermilk'] },
    { re: /^(salted )?butter\b/, queries: ['butter stick salted'] },
    { re: /\b(heavy|whipping|double) cream\b/, queries: ['cream heavy'] },
    { re: /\bhalf[ -]and[ -]half\b/, queries: ['cream half and half'] },
    { re: /\bsour cream\b/, queries: ['cream sour'] },
    { re: /\bcream cheese\b/, queries: ['cheese cream', 'cream cheese'] },
    { re: /\bcoconut milk\b/, queries: ['coconut milk'] },
    { re: /\balmond milk\b/, queries: ['almond milk'] },
    { re: /\b(skim|nonfat|fat[- ]free) milk\b/, queries: ['milk nonfat'] },
    { re: /\b(2%|reduced[- ]fat) milk\b/, queries: ['milk reduced fat'] },
    { re: /^(whole )?milk\b/, queries: ['milk whole'] },
    { re: /\bgreek yogh?urt\b/, queries: ['yogurt greek plain'] },
    { re: /\byogh?urt\b/, queries: ['yogurt plain'] },
    { re: /\b(parmesan|parmigiano)\b/, queries: ['cheese parmesan'] },
    { re: /\bcheddar\b/, queries: ['cheese cheddar'] },
    { re: /\bmozzarella\b/, queries: ['cheese mozzarella'] },
    { re: /\bfeta\b/, queries: ['cheese feta'] },

    // Baking and pantry
    { re: /\b(all[- ]purpose|plain|ap) flour\b|^flour$/, queries: ['flour wheat all purpose', 'wheat flour white all purpose'] },
    { re: /\bbread flour\b/, queries: ['flour bread', 'wheat flour white bread'] },
    { re: /\bwhole[- ]wheat flour\b/, queries: ['flour whole wheat'] },
    { re: /\bbrown sugar\b/, queries: ['sugars brown'] },
    { re: /\b(powdered|confectioners?'?|icing) sugar\b/, queries: ['sugars powdered'] },
    { re: /\b(white |granulated |caster )?sugar\b/, queries: ['sugars granulated'] },
    { re: /\bbaking powder\b/, queries: ['leavening agents baking powder double acting'] },
    { re: /\b(baking soda|bicarbonate of soda)\b/, queries: ['leavening agents baking soda'] },
    { re: /\bvanilla( extract)?\b/, queries: ['vanilla extract'] },
    { re: /\bcocoa( powder)?\b/, queries: ['cocoa dry powder unsweetened'] },
    { re: /\b(chocolate chips?|semi[- ]?sweet chocolate)\b/, queries: ['candies semisweet chocolate'] },
    { re: /\b(rolled |old[- ]fashioned |quick )?oats\b|\boatmeal\b/, queries: ['oats rolled', 'oats'] },
    { re: /\bcorn ?starch\b/, queries: ['cornstarch'] },
    { re: /\bhoney\b/, queries: ['honey'] },
    { re: /\bmaple syrup\b/, queries: ['syrups maple'] },
    { re: /\bmayonnaise\b|\bmayo\b/, queries: ['mayonnaise regular', 'salad dressing mayonnaise regular'] },
    { re: /\bketchup\b/, queries: ['ketchup', 'catsup'] },
    { re: /\bdijon\b|\bmustard\b/, queries: ['mustard prepared yellow'] },
    { re: /\bsoy sauce\b/, queries: ['soy sauce made from soy and wheat'] },
    { re: /\bred wine vinegar\b/, queries: ['vinegar red wine'] },
    { re: /\bbalsamic\b/, queries: ['vinegar balsamic'] },
    { re: /\bcider vinegar\b/, queries: ['vinegar cider'] },
    { re: /\bvinegar\b/, queries: ['vinegar distilled'] },
    { re: /\byeast\b/, queries: ['leavening agents yeast bakers active dry'] },

    // Oils and seasonings
    { re: /\bolive oil\b/, queries: ['oil olive'] },
    { re: /\b(vegetable|neutral|cooking) oil\b/, queries: ['oil vegetable soybean refined', 'oil soybean'] },
    { re: /\bcanola oil\b/, queries: ['oil canola'] },
    { re: /\bsesame oil\b/, queries: ['oil sesame'] },
    { re: /\bcoconut oil\b/, queries: ['oil coconut'] },
    { re: /\bsalt and (black )?pepper\b/, queries: ['salt table'] },
    { re: /\b(kosher |sea |table )?salt\b/, queries: ['salt table'] },
    { re: /^(ground |cracked |black |white )*pepper(corns?)?$/, queries: ['spices pepper black'] },
    { re: /\bcayenne\b/, queries: ['spices pepper red or cayenne'] },
    { re: /\bpaprika\b/, queries: ['spices paprika'] },
    { re: /\bcumin\b/, queries: ['spices cumin seed'] },
    { re: /\bcinnamon\b/, queries: ['spices cinnamon ground'] },
    { re: /\bnutmeg\b/, queries: ['spices nutmeg ground'] },
    { re: /\boregano\b/, queries: ['spices oregano dried'] },
    { re: /\bthyme\b/, queries: ['thyme fresh', 'spices thyme dried'] },
    { re: /\bchili powder\b/, queries: ['spices chili powder'] },
    { re: /\bgarlic powder$/, queries: ['spices garlic powder'] },
    { re: /\bonion powder\b/, queries: ['spices onion powder'] },
    { re: /\bbasil( leaves)?$/, queries: ['basil fresh'] },
    { re: /^(fresh )?ginger( root)?$/, queries: ['ginger root raw'] },
    { re: /\bcilantro( leaves)?$/, queries: ['coriander cilantro leaves raw'] },
    { re: /\bparsley( leaves)?$/, queries: ['parsley fresh'] },

    // Vegetables and fruit
    { re: /\bgarlic$/, queries: ['garlic raw'] },
    { re: /\b(green onions?|scallions?|spring onions?)\b/, queries: ['onions spring or scallions raw'] },
    { re: /\bred onions?$/, queries: ['onions red raw'] },
    { re: /\bonions?$/, queries: ['onions raw', 'onions yellow raw'], cooked: ['onions cooked boiled'] },
    { re: /\b(cherry|grape) tomato(es)?\b/, queries: ['tomatoes grape raw'] },
    { re: /\bcrushed\b.*\btomato(es)?$/, queries: ['tomatoes crushed canned'], context: true },
    { re: /\bcanned\b.*\btomato(es)?$/, queries: ['tomatoes canned red ripe diced'], context: true },
    { re: /\btomato paste\b/, queries: ['tomato products canned paste', 'tomato paste'] },
    { re: /\btomato sauce\b/, queries: ['tomato products canned sauce', 'tomato sauce'] },
    { re: /\bromas? tomato(es)?$/, queries: ['tomato roma'] },
    { re: /\btomato(es)?$/, queries: ['tomatoes red ripe raw', 'tomato roma'] },
    { re: /\bsweet potato(es)?$/, queries: ['sweet potato raw'] },
    { re: /\b(russet )?potato(es)?$/, queries: ['potatoes flesh and skin raw', 'potatoes russet raw', 'potatoes raw'], cooked: ['potatoes boiled cooked'] },
    { re: /\bcarrots?$/, queries: ['carrots mature raw', 'carrots raw'], cooked: ['carrots cooked boiled drained'] },
    { re: /\bcelery$/, queries: ['celery raw'] },
    { re: /\bspinach$/, queries: ['spinach mature', 'spinach raw'], cooked: ['spinach cooked boiled drained'] },
    { re: /\bbroccoli( florets?)?$/, queries: ['broccoli raw'], cooked: ['broccoli cooked boiled drained'] },
    { re: /\b(red |green |yellow )?bell peppers?$/, queries: ['peppers bell raw', 'peppers sweet raw'] },
    { re: /\bmushrooms?$/, queries: ['mushrooms white button', 'mushrooms white raw'] },
    { re: /\bzucchinis?$/, queries: ['squash summer zucchini raw'] },
    { re: /\bcucumbers?$/, queries: ['cucumber with peel raw'] },
    { re: /\bcabbage$/, queries: ['cabbage raw'] },
    { re: /\blettuce$/, queries: ['lettuce raw', 'lettuce romaine raw'] },
    { re: /^(sweet |fresh )?corn( kernels)?$/, queries: ['corn sweet yellow raw'] },
    { re: /\bcorn tortillas?$/, queries: ['tortillas corn'] },
    { re: /\bflour tortillas?$/, queries: ['tortillas flour'] },
    { re: /\bpeas$/, queries: ['peas green raw'] },
    { re: /\bavocados?$/, queries: ['avocados raw all commercial varieties'] },
    { re: /\bolives?$/, queries: ['olives ripe canned'] },
    { re: /\blemon juice\b/, queries: ['lemon juice raw'] },
    { re: /\blime juice\b/, queries: ['lime juice raw'] },
    { re: /\blemons?$/, queries: ['lemons raw without peel'] },
    { re: /\blimes?$/, queries: ['limes raw'] },
    { re: /\bbananas?$/, queries: ['bananas raw'] },
    { re: /\bapples?$/, queries: ['apples raw with skin'] },
    { re: /\bblueberries$/, queries: ['blueberries raw'] },
    { re: /\bstrawberries$/, queries: ['strawberries raw'] },

    // Grains and legumes
    { re: /\bbrown rice$/, queries: ['rice brown long grain raw', 'rice brown raw'], cooked: ['rice brown long grain cooked', 'rice brown cooked'] },
    { re: /\brice$/, queries: ['rice white long grain regular raw', 'rice white raw'], cooked: ['rice white long grain regular cooked', 'rice white cooked'] },
    { re: /\bquinoa$/, queries: ['quinoa uncooked'], cooked: ['quinoa cooked'] },
    { re: /^(?!rice ).*\b(spaghetti|penne|pasta|macaroni|linguine|fettuccine|rigatoni|noodles)$/, queries: ['pasta dry enriched', 'spaghetti dry'], cooked: ['pasta cooked enriched without added salt'] },
    { re: /\bblack beans?$/, queries: ['beans black canned sodium added drained', 'beans black mature seeds canned', 'beans black mature seeds raw'], cooked: ['beans black mature seeds cooked boiled without salt'] },
    { re: /\bkidney beans?$/, queries: ['beans kidney red mature seeds canned drained', 'beans kidney red mature seeds raw'], cooked: ['beans kidney red mature seeds cooked boiled without salt'] },
    { re: /\b(chickpeas?|garbanzo beans?)$/, queries: ['chickpeas canned sodium added drained', 'chickpeas mature seeds raw'], cooked: ['chickpeas mature seeds cooked boiled without salt'] },
    { re: /\blentils?$/, queries: ['lentils raw', 'lentils dry'], cooked: ['lentils mature seeds cooked boiled without salt'] },
    { re: /\bbread ?crumbs?$/, queries: ['bread crumbs dry grated plain'] },
    { re: /^(sandwich |white )?bread$/, queries: ['bread white commercial'] },

    // Meat and fish
    { re: /\bchicken breasts?$/, queries: ['chicken breast boneless skinless raw'], cooked: ['chicken breast meat only cooked roasted'] },
    { re: /\bchicken thighs?$/, queries: ['chicken thigh meat only raw', 'chicken dark meat thigh raw'], cooked: ['chicken thigh meat only cooked roasted'] },
    { re: /\bchicken (broth|stock)\b/, queries: ['soup chicken broth ready to serve', 'soup stock chicken'] },
    { re: /\bbeef (broth|stock)\b/, queries: ['soup beef broth', 'soup stock beef'] },
    { re: /\bvegetable (broth|stock)\b/, queries: ['soup vegetable broth', 'soup stock vegetable'] },
    { re: /\bground beef\b/, queries: ['beef ground 80 lean raw'], cooked: ['beef ground 80 lean cooked'] },
    { re: /\bground turkey\b/, queries: ['turkey ground raw'] },
    { re: /\bbacon\b/, queries: ['pork cured bacon unprepared', 'pork cured bacon raw'], cooked: ['pork cured bacon cooked'] },
    { re: /\bsalmon( fillets?| filets?| steaks?)?$/, queries: ['fish salmon atlantic farm raised raw'], cooked: ['fish salmon atlantic farmed cooked'] },
    { re: /\bshrimp$/, queries: ['crustaceans shrimp raw'], cooked: ['crustaceans shrimp cooked'] },
    { re: /\btuna$/, queries: ['fish tuna light canned in water'] },
    { re: /\btofu\b/, queries: ['tofu raw firm'] },
    { re: /^(cold |warm |hot |ice |tap )?water$/, queries: ['water tap', 'beverages water tap drinking'] },
];

/** Words that say nothing about which food it is. Dropped when building the search query. */
const NOISE = new Set([
    'fresh', 'freshly', 'large', 'small', 'medium', 'big', 'extra', 'organic', 'good', 'quality', 'ripe', 'lean',
    'virgin', 'light', 'pure', 'ground', 'whole', 'of', 'the', 'a', 'an', 'and', 'or', 'for', 'homemade', 'store',
    'bought', 'your', 'favorite', 'optional', 'finely', 'thinly', 'chopped', 'minced', 'diced', 'sliced', 'about',
]);

const COOKED_WORDS = ['cooked', 'boiled', 'roasted', 'baked', 'steamed', 'fried', 'grilled', 'broiled', 'braised', 'stewed', 'poached', 'scrambled', 'sauteed', 'sautéed', 'microwaved', 'toasted'];
const COOKED_RE = new RegExp(`\\b(${COOKED_WORDS.join('|')})\\b`, 'i');
const RAW_ASK_RE = /\b(raw|uncooked|dry|dried)\b/i;

/** Forms that are wrong for a plain recipe ingredient unless the recipe asks for them. */
const SPECIALTY_RE = /\b(dry|ultraviolet|babyfood|baby food|infant|toddler|fast foods?|restaurant|imitation|substitute|replacement|dehydrated|freeze-dried|frozen|canned|powder|powdered|breaded|nuggets|mix|concentrate|industrial|low sodium|reduced sodium|sodium added|low fat|lowfat|nonfat|fat free|reduced fat|light|sweetened|flavored|snacks?|candies|cookies|soup|sauce|dressing|school|meatless)\b/gi;
/** Words in a description's leading segments that don't change what the food is. */
const PLAIN_LEADING = new Set(['raw', 'fresh', 'whole', 'plain', 'regular', 'mature', 'grade', 'spices', 'fish', 'cheese', 'oil', 'seeds', 'nuts']);
/** Brand names are upper-case words in SR Legacy descriptions ("HORMEL ALWAYS TENDER"). */
const BRAND_RE = /\b[A-Z][A-Z'&-]{2,}\b/;

function isCookedAsk(ing: ParsedIngredient): boolean {
    const text = `${ing.name} ${ing.preparation ?? ''}`;
    return COOKED_RE.test(text) && !/\bun(cooked)\b/i.test(text);
}

/** Did the recipe say this came from a can ("1 (15 oz) can ...", "canned ...")? */
function isCannedAsk(ing: ParsedIngredient): boolean {
    return /\bcans?\b|\bcanned\b/i.test(`${ing.name} ${ing.notes ?? ''}`);
}

function aliasFor(ing: ParsedIngredient): Alias | undefined {
    const n = ing.name.toLowerCase();
    const context = `${isCannedAsk(ing) ? 'canned ' : ''}${ing.preparation ?? ''} ${n}`.toLowerCase();
    return ALIASES.find(a => a.re.test(a.context ? context : n));
}

/** Search queries for an ingredient, most specific first. */
export function buildQueries(ing: ParsedIngredient): string[] {
    const name = ing.name.toLowerCase();
    const queries: string[] = [];
    const alias = aliasFor(ing);
    const cooked = isCookedAsk(ing);
    if (alias) queries.push(...(cooked && alias.cooked ? alias.cooked : []), ...alias.queries);
    const toks = words(name).filter(w => !NOISE.has(w));
    if (toks.length) {
        if (cooked) queries.push(`${toks.join(' ')} cooked`);
        queries.push(toks.join(' '));
        // Progressively drop leading adjectives: "flat leaf parsley" -> "leaf parsley" -> "parsley".
        for (let i = 1; i < toks.length; i++) queries.push(toks.slice(i).join(' '));
    } else if (name.trim()) {
        queries.push(name.trim());
    }
    return Array.from(new Set(queries)).slice(0, 8);
}

export interface Scored { food: Food; score: number; coverage: number; headMatch: boolean }

/** Score one candidate. Exported for tests; higher is better and only comparable within one ingredient. */
export function scoreCandidate(food: Food, ing: ParsedIngredient, rank: number, queryIndex: number, aliasQueries: string[] = []): Scored {
    const desc = food.description;
    const lower = desc.toLowerCase();
    const descWords = new Set(words(lower).map(wordStem));
    const askText = `${isCannedAsk(ing) ? 'canned ' : ''}${ing.name} ${ing.preparation ?? ''} ${ing.notes ?? ''}`.toLowerCase();
    const askWords = new Set(words(askText).map(wordStem));
    const nameToks = words(ing.name).filter(w => !NOISE.has(w)).map(wordStem);

    let score = 40 - Math.min(rank, 25) - queryIndex * 6;

    // An alias names the form a recipe usually means: reward foods containing all of its words.
    const aliasHit = aliasQueries.findIndex(q => words(q).every(t => descWords.has(wordStem(t))));
    if (aliasHit >= 0) score += 30 - aliasHit * 5;

    // Words in the leading segments that nobody asked for point at a different food ("Egg, duck").
    const leading = words(lower.split(',').slice(0, 2).join(' ')).map(wordStem);
    const aliasWords = new Set(aliasQueries.flatMap(q => words(q).map(wordStem)));
    const extra = leading.filter(w => !askWords.has(w) && !aliasWords.has(w) && !PLAIN_LEADING.has(w));
    score -= extra.length * 3;

    const covered = nameToks.filter(t => descWords.has(t)).length;
    const coverage = nameToks.length ? covered / nameToks.length : 0;
    score += coverage * 25;

    // The food is named first: "Eggs, ...", "Garlic, raw". Group prefixes name it second.
    const segments = lower.split(',').map(s => s.trim());
    const headWords = words(segments[0]).map(wordStem);
    const groupHead = /^(spices|fish|crustaceans|mollusks|nuts|seeds|oil|cheese|leavening agents|soup|beverages)$/.test(segments[0]);
    const named = groupHead ? words(segments[1] ?? '').map(wordStem) : headWords;
    const headMatch = nameToks.some(t => named.includes(t));
    if (headMatch) score += 20;

    // Raw, cooked or canned follows the recipe. Getting this wrong is expensive:
    // dry beans have about 3x the calories of canned, per gram.
    const wantsCooked = isCookedAsk(ing);
    const wantsCanned = isCannedAsk(ing);
    const wantsDry = RAW_ASK_RE.test(askText);
    const isCooked = COOKED_RE.test(lower);
    const isCanned = /\bcanned\b/.test(lower);
    const isRaw = /\b(raw|fresh|uncooked)\b/.test(lower);
    // An alias whose first choice isn't raw says the plain word doesn't mean raw here ("black beans").
    const rawIsDefault = aliasQueries.length === 0 || /\braw\b/.test(aliasQueries[0]) || wantsDry;
    if (wantsCanned) {
        if (isCanned) score += 25;
        else if (isRaw) score -= 15;
    } else if (wantsCooked) {
        if (isCooked) score += 25;
        else if (isRaw) score -= 15;
    } else {
        if (isRaw && rawIsDefault) score += 12;
        if (isCooked && !askWords.has('cooked')) score -= 20;
        if (wantsDry && isCanned) score -= 25;
    }

    // Specialty forms lose unless the recipe asked for them.
    const primaryAlias = new Set(words(aliasQueries[0] ?? '').map(wordStem));
    const specialty = (lower.match(SPECIALTY_RE) ?? []).filter(w => {
        const stem = wordStem(w.toLowerCase());
        return !askWords.has(stem) && !primaryAlias.has(stem);
    });
    score -= specialty.length * 10;
    if (BRAND_RE.test(desc)) score -= 15;

    // Prefer better-measured data and foods we can convert.
    const dt = (food.data_type ?? '').toLowerCase();
    if (dt.startsWith('foundation')) score += 6;
    else if (dt.includes('sr')) score += 3;
    if (dt.includes('survey') || dt.includes('fndds')) score -= 6;

    score -= desc.length * 0.05;
    return { food, score, coverage, headMatch };
}

/** Confidence (0..1) from how well the best candidate covers the name. */
function confidenceOf(best: Scored | undefined, runnerUp: Scored | undefined, aliased: boolean): number {
    if (!best) return 0;
    let c = 0.35 + 0.35 * best.coverage;
    if (best.headMatch) c += 0.15;
    if (aliased) c += 0.1;
    if (!runnerUp || best.score - runnerUp.score > 8) c += 0.05;
    return Math.min(0.98, Math.round(c * 100) / 100);
}

export interface MatchResult {
    food: Food | null;
    confidence: number;
    candidates: MatchCandidate[];
}

const CANDIDATES_PER_QUERY = 15;
const MAX_ALTERNATIVES = 6;

/** Best USDA match and alternatives for one ingredient. */
export function matchIngredientIn(conn: Connection, ing: ParsedIngredient): MatchResult {
    const pool = new Map<number, Scored>();
    const alias = aliasFor(ing);
    const aliasQueries = alias ? [...(isCookedAsk(ing) && alias.cooked ? alias.cooked : []), ...alias.queries] : [];
    buildQueries(ing).forEach((q, qi) => {
        const { foods } = searchFoodsIn(conn, q, 1, CANDIDATES_PER_QUERY);
        foods.forEach((food, rank) => {
            const scored = scoreCandidate(food, ing, rank, qi, aliasQueries);
            const prev = pool.get(food.id);
            if (!prev || scored.score > prev.score) pool.set(food.id, scored);
        });
    });
    const ranked = Array.from(pool.values()).sort((a, b) => b.score - a.score || a.food.id - b.food.id);
    const best = ranked[0];
    return {
        food: best?.food ?? null,
        confidence: confidenceOf(best, ranked[1], alias !== undefined),
        candidates: ranked.slice(0, MAX_ALTERNATIVES).map(r => ({
            fdcId: r.food.fdc_id,
            description: r.food.description,
            dataType: r.food.data_type,
            score: Math.round(r.score * 10) / 10,
        })),
    };
}

interface RelatedRow { target: number; label: string; weight_g: number }

/**
 * Attach conversion portions to foods. Foundation foods often list no household
 * measures, but the SR Legacy food they supersede does ("Garlic, raw: 1 clove = 3 g").
 */
export function withPortionsIn(conn: Connection, foods: Food[]): RecipeFood[] {
    const fdcIds = Array.from(new Set(foods.map(f => f.fdc_id).filter(id => Number.isSafeInteger(id))));
    const related = new Map<number, { label: string; weight_g: number }[]>();
    if (fdcIds.length && conn.schema.foodColumns.has('superseded_by_fdc_id') && conn.schema.hasServingSizes) {
        const rows = conn.db.prepare(
            `SELECT f.superseded_by_fdc_id AS target, s.label AS label, s.weight_g AS weight_g
             FROM foods f JOIN serving_sizes s ON s.food_id = f.id
             WHERE f.superseded_by_fdc_id IN (${fdcIds.map(() => '?').join(',')})
             ORDER BY s.weight_g, s.id`,
        ).all(...fdcIds) as RelatedRow[];
        for (const r of rows) {
            const list = related.get(r.target);
            if (list) list.push(r);
            else related.set(r.target, [r]);
        }
    }
    return foods.map(f => ({ ...f, portions: mergePortions(f.serving_sizes, related.get(f.fdc_id)) }));
}

/** One food by FDC id, with its conversion portions. */
export function foodWithPortionsIn(conn: Connection, fdcId: number): RecipeFood | null {
    const row = conn.db.prepare('SELECT id FROM foods WHERE fdc_id = ?').get(fdcId) as { id: number } | undefined;
    const food = row ? getFoodsByIdsIn(conn, [row.id])[0] : undefined;
    return food ? withPortionsIn(conn, [food])[0] : null;
}
