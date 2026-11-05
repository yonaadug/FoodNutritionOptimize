import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
    getCategoriesIn, getFoodByFdcIdIn, getFoodRefsIn, getFoodsInCategoryIn, getRelatedFoodsIn, getTopHitsIn, openDatabase, rankCandidates,
} from './db';
import { NUTRIENT_COLUMNS } from './testing/fixtures';

type Row = [id: number, fdcId: number, description: string, dataType: string, category: string | null, ndb: number | null, superseded: number | null, rank: number];

const SR = 'sr_legacy_food';
const FOUNDATION = 'foundation_food';
const DAIRY = 'Dairy and Egg Products';

const ROWS: Row[] = [
    [1, 748967, 'Eggs, Grade A, Large, egg whole', FOUNDATION, DAIRY, 1123, null, 1],
    [2, 171287, 'Egg, whole, raw, fresh', SR, DAIRY, 1123, 748967, 2],
    [3, 173423, 'Egg, whole, cooked, fried', SR, DAIRY, 1128, null, 2],
    [4, 747997, 'Eggs, Grade A, Large, egg white', FOUNDATION, DAIRY, 1124, null, 1],
    [5, 9001, 'Eggplant, raw', SR, 'Vegetables', 11209, null, 2],
    [6, 9002, 'Milk, whole', SR, DAIRY, 1077, null, 2],
    [7, 9003, 'Fish, salmon, sockeye, raw', SR, 'Finfish', 15085, null, 2],
    [8, 9004, 'Salmon, sockeye, canned', SR, 'Finfish', 15253, null, 2],
    [9, 9005, 'Tuna salad', 'survey_fndds_food', null, null, null, 3],
];

let tmp: string;
let conn: ReturnType<typeof openDatabase>;

before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'food-page-db-'));
    const file = path.join(tmp, 'test.db');
    const w = new Database(file);
    const cols = NUTRIENT_COLUMNS.map(c => `${c} REAL`).join(', ');
    w.exec(`CREATE TABLE foods (id INTEGER PRIMARY KEY, fdc_id INTEGER UNIQUE, description TEXT, data_type TEXT, data_type_rank INTEGER,
        food_category TEXT, brand_owner TEXT, serving_size REAL, serving_size_unit TEXT, ndb_number INTEGER, superseded_by_fdc_id INTEGER, ${cols});
        CREATE TABLE serving_sizes (id INTEGER PRIMARY KEY, food_id INTEGER, label TEXT, weight_g REAL);`);
    const ins = w.prepare(`INSERT INTO foods (id, fdc_id, description, data_type, food_category, ndb_number, superseded_by_fdc_id, data_type_rank, calories, protein_g)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, 10)`);
    for (const r of ROWS) ins.run(...r);
    w.prepare(`INSERT INTO serving_sizes (food_id, label, weight_g) VALUES (1, '1 egg', 50), (3, '1 large', 46)`).run();
    w.exec(`CREATE VIRTUAL TABLE foods_fts USING fts5(description, food_category, content='foods', content_rowid='id');
        INSERT INTO foods_fts(foods_fts) VALUES('rebuild');`);
    w.close();
    conn = openDatabase(file);
});

after(() => {
    conn.db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('getFoodByFdcId', () => {
    it('finds a food with its serving sizes', () => {
        const f = getFoodByFdcIdIn(conn, 748967);
        assert.equal(f?.description, 'Eggs, Grade A, Large, egg whole');
        assert.deepEqual(f?.serving_sizes?.map(s => s.label), ['1 egg']);
    });
    it('finds superseded records too, so old links still work', () => {
        assert.equal(getFoodByFdcIdIn(conn, 171287)?.superseded_by_fdc_id, 748967);
    });
    it('returns undefined for an unknown or invalid id', () => {
        assert.equal(getFoodByFdcIdIn(conn, 1), undefined);
        assert.equal(getFoodByFdcIdIn(conn, Number.NaN), undefined);
    });
});

describe('getRelatedFoods', () => {
    it('finds other forms across singular and plural names, and the same food in another dataset', () => {
        const food = getFoodByFdcIdIn(conn, 748967)!;
        const r = getRelatedFoodsIn(conn, food);
        assert.deepEqual(r.equivalents.map(f => f.fdc_id), [171287]);
        assert.deepEqual(r.forms.map(f => f.fdc_id).sort(), [173423, 747997].sort());
    });
    it('does not treat "Eggplant" as a form of egg', () => {
        const food = getFoodByFdcIdIn(conn, 748967)!;
        const r = getRelatedFoodsIn(conn, food);
        assert.ok(![...r.forms, ...r.similar].some(f => f.description.startsWith('Eggplant')));
    });
    it('attaches serving sizes to the foods it returns', () => {
        const food = getFoodByFdcIdIn(conn, 748967)!;
        const fried = getRelatedFoodsIn(conn, food).forms.find(f => f.fdc_id === 173423);
        assert.deepEqual(fried?.serving_sizes?.map(s => s.label), ['1 large']);
    });
    it('matches a food with and without its group prefix', () => {
        const food = getFoodByFdcIdIn(conn, 9003)!;
        assert.deepEqual(getRelatedFoodsIn(conn, food).forms.map(f => f.fdc_id), [9004]);
    });
    it('handles foods with no NDB number or category', () => {
        const r = getRelatedFoodsIn(conn, getFoodByFdcIdIn(conn, 9005)!);
        assert.deepEqual(r, { equivalents: [], forms: [], similar: [] });
    });
});

describe('categories', () => {
    it('counts current foods per category, largest first, without empty categories', () => {
        const cats = getCategoriesIn(conn);
        assert.deepEqual(cats[0], { category: DAIRY, slug: 'dairy-and-egg-products', count: 4 }, 'the superseded egg is not counted');
        assert.ok(!cats.some(c => c.category === null));
    });
    it('lists Foundation foods first and pages through a category', () => {
        const page1 = getFoodsInCategoryIn(conn, DAIRY, 1, 2);
        assert.equal(page1.total, 4);
        assert.equal(page1.totalPages, 2);
        assert.deepEqual(page1.foods.map(f => f.data_type), [FOUNDATION, FOUNDATION]);
        const page2 = getFoodsInCategoryIn(conn, DAIRY, 2, 2);
        assert.equal(page2.foods.length, 2);
        assert.ok(!page2.foods.some(f => f.superseded_by_fdc_id));
    });
    it('returns nothing for an unknown category', () => {
        assert.equal(getFoodsInCategoryIn(conn, 'Nope').total, 0);
    });
});

describe('getTopHits', () => {
    it('returns the best match per query, in order, skipping misses', () => {
        const hits = getTopHitsIn(conn, ['salmon', 'zzzz', 'milk']);
        assert.deepEqual(hits.map(f => f.fdc_id), [9003, 9002]);
    });
    it('answers repeated queries from its cache', () => {
        const a = getTopHitsIn(conn, ['salmon'])[0];
        assert.equal(getTopHitsIn(conn, ['salmon'])[0], a);
    });
});

describe('rankCandidates: plain forms', () => {
    const rank = (descriptions: [string, number][], tokens: string[]) => rankCandidates(
        descriptions.map(([description, dtr], i) => ({ id: i + 1, description, tier: 1, dtr, score: 0 })), tokens,
    ).map(c => c.description);

    it('does not count "without skin" as a specialty form, or let leaves lead', () => {
        assert.deepEqual(
            rank([['Sweet potato leaves, raw', 2], ['Sweet potatoes, orange flesh, without skin, raw', 1]], ['sweet', 'potato']),
            ['Sweet potatoes, orange flesh, without skin, raw', 'Sweet potato leaves, raw'],
        );
    });
    it('still ranks a food with its skin after the plain one when skin is named as a part', () => {
        assert.deepEqual(rank([['Chicken, skin only, raw', 1], ['Chicken, breast, raw', 1]], ['chicken']), ['Chicken, breast, raw', 'Chicken, skin only, raw']);
    });
    it('respects a query that asks for leaves', () => {
        assert.equal(rank([['Sweet potato, raw', 1], ['Sweet potato leaves, raw', 1]], ['sweet', 'potato', 'leaves'])[0], 'Sweet potato, raw', 'head and length still apply');
        assert.equal(rank([['Tea, black', 2], ['Bay leaf', 2]], ['leaf'])[0], 'Bay leaf');
    });
});

describe('getFoodRefs', () => {
    it('lists every food page worth indexing, leaving out superseded records', () => {
        const refs = getFoodRefsIn(conn);
        assert.equal(refs.length, ROWS.length - 1);
        assert.ok(!refs.some(r => r.fdc_id === 171287));
    });
});
