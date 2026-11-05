import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
    resolveDbPath, openDatabase, searchFoodsIn, getTopFoodsByNutrientIn, hydrateFoodsIn,
    getMetaIn, getFoodsByIdsIn, tokenizeQuery, DatabaseUnavailableError,
} from './db';
import { NUTRIENT_COLUMNS } from './testing/fixtures';

const FOODS: [number, number, string, string, string, number | null][] = [
    // id, fdc_id, description, data_type, category, protein_g
    [1, 1001, 'Milk, whole, 3.25% milkfat', 'sr_legacy_food', 'Dairy and Egg Products', 3.2],
    [2, 1002, 'Milk', 'foundation_food', 'Dairy and Egg Products', 3.3],
    [3, 1003, 'Milkfish, raw', 'sr_legacy_food', 'Finfish and Shellfish Products', 20.5],
    [4, 1004, 'Cheese, mozzarella, whole milk', 'foundation_food', 'Dairy and Egg Products', 22],
    [5, 1005, 'Buttermilk, low fat', 'foundation_food', 'Dairy and Egg Products', 3.3],
    [6, 1006, 'Milk, whole', 'survey_fndds_food', 'Milk, whole', 3.2],
    [7, 1007, 'Eggs, Grade A, Large, egg white', 'foundation_food', 'Dairy and Egg Products', null],
    [8, 1008, 'Chicken, broiler, breast, meat only, cooked (100% lean)', 'foundation_food', 'Poultry Products', 31],
    [9, 1009, 'Yogurt, plain, whole milk', 'sr_legacy_food', 'Dairy and Egg Products', 3.5],
];

let tmp: string;

type FoodRow = [number, number, string, string, string, number | null];

function buildDb(file: string, { fts, meta, v2 = false, rows = FOODS }: { fts: boolean; meta: boolean; v2?: boolean; rows?: FoodRow[] }) {
    const w = new Database(file);
    const cols = NUTRIENT_COLUMNS.map(c => `${c} REAL`).join(', ');
    w.exec(`CREATE TABLE foods (id INTEGER PRIMARY KEY, fdc_id INTEGER UNIQUE, description TEXT, data_type TEXT,
        food_category TEXT, brand_owner TEXT, serving_size REAL, serving_size_unit TEXT, ${cols});
        CREATE TABLE serving_sizes (id INTEGER PRIMARY KEY, food_id INTEGER, label TEXT, weight_g REAL);`);
    const ins = w.prepare(`INSERT INTO foods (id, fdc_id, description, data_type, food_category, calories, protein_g)
        VALUES (?, ?, ?, ?, ?, 50, ?)`);
    for (const f of rows) ins.run(...f);
    if (v2) {
        w.exec(`ALTER TABLE foods ADD COLUMN data_type_rank INTEGER;
            ALTER TABLE foods ADD COLUMN superseded_by_fdc_id INTEGER;
            ALTER TABLE foods ADD COLUMN choline_mg REAL;
            UPDATE foods SET data_type_rank = CASE data_type WHEN 'foundation_food' THEN 1 WHEN 'sr_legacy_food' THEN 2 ELSE 3 END;
            UPDATE foods SET superseded_by_fdc_id = 1002 WHERE id = 1;
            UPDATE foods SET choline_mg = 14 WHERE id = 2;
            UPDATE foods SET choline_mg = 85 WHERE id = 8;`);
    }
    w.prepare(`INSERT INTO serving_sizes (food_id, label, weight_g) VALUES (1, '1 cup', 244), (1, '1 quart', 976)`).run();
    if (fts) {
        w.exec(`CREATE VIRTUAL TABLE foods_fts USING fts5(description, food_category, content='foods', content_rowid='id');
            INSERT INTO foods_fts(foods_fts) VALUES('rebuild');`);
    }
    if (meta) w.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('source', 'unit test');`);
    w.close();
    return openDatabase(file);
}

let ftsConn: ReturnType<typeof openDatabase>;
let likeConn: ReturnType<typeof openDatabase>;
let v2Conn: ReturnType<typeof openDatabase>;

before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nutri-db-test-'));
    ftsConn = buildDb(path.join(tmp, 'fts.db'), { fts: true, meta: true });
    likeConn = buildDb(path.join(tmp, 'like.db'), { fts: false, meta: false });
    v2Conn = buildDb(path.join(tmp, 'v2.db'), { fts: true, meta: true, v2: true });
});

after(() => {
    ftsConn.db.close();
    likeConn.db.close();
    v2Conn.db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveDbPath', () => {
    const has = (...files: string[]) => (p: string) => files.includes(p);

    it('prefers NUTRITION_DB_PATH (relative to cwd) and fails loudly if it is missing', () => {
        assert.equal(resolveDbPath({ NUTRITION_DB_PATH: 'data/x.db' }, '/srv/app', has('/srv/app/data/x.db')).path, '/srv/app/data/x.db');
        assert.throws(() => resolveDbPath({ NUTRITION_DB_PATH: '/nope.db' }, '/srv/app', has('/srv/app/nutrition.db')), DatabaseUnavailableError);
    });

    it('finds the DB in cwd (next dev, standalone server.js, Electron)', () => {
        assert.equal(resolveDbPath({}, '/srv/app', has('/srv/app/nutrition.db')).path, '/srv/app/nutrition.db');
    });

    it('finds the app DB from .next/standalone and from the repo root', () => {
        assert.equal(resolveDbPath({}, '/repo/food-nutrition-app/.next/standalone', has('/repo/food-nutrition-app/nutrition.db')).path,
            '/repo/food-nutrition-app/nutrition.db');
        assert.equal(resolveDbPath({}, '/repo', has('/repo/food-nutrition-app/nutrition.db')).path, '/repo/food-nutrition-app/nutrition.db');
    });

    it('finds the DB at LAMBDA_TASK_ROOT', () => {
        assert.equal(resolveDbPath({ LAMBDA_TASK_ROOT: '/var/task' }, '/tmp', has('/var/task/nutrition.db')).path, '/var/task/nutrition.db');
    });

    it('throws a DatabaseUnavailableError listing what it tried', () => {
        assert.throws(() => resolveDbPath({}, '/x', has()), /Tried: \/x\/nutrition.db/);
    });
});

describe('connection', () => {
    it('is read-only', () => {
        assert.throws(() => ftsConn.db.prepare(`DELETE FROM foods`).run(), /readonly/i);
    });
});

for (const mode of ['fts', 'like'] as const) {
    describe(`searchFoods (${mode})`, () => {
        const conn = () => (mode === 'fts' ? ftsConn : likeConn);
        const ids = (q: string, page = 1, limit = 20) => searchFoodsIn(conn(), q, page, limit).foods.map(f => f.id);

        it('ranks exact > prefix > whole word, then Foundation > SR Legacy > others, then shorter', () => {
            const expected = [
                2, // "Milk": exact
                1, // starts with the word "milk", SR Legacy
                6, // starts with the word "milk", survey (FNDDS) food
                4, // whole word "milk", Foundation
                9, // whole word "milk", SR Legacy
            ];
            // "Milkfish" / "Buttermilk" only contain "milk" inside a word: last.
            if (mode === 'fts') expected.push(3);
            else expected.push(5, 3);
            assert.deepEqual(ids('milk'), expected);
            assert.deepEqual(ids('milks').slice(0, 3), [2, 1, 6], 'plural query matches singular words');
        });

        it('matches all words in any order, preferring foods named by a query word', () => {
            // "Milk, whole..." is milk; "Cheese, mozzarella, whole milk" merely contains it.
            assert.deepEqual(ids('whole milk'), [1, 6, 4, 9]);
        });

        it('paginates with total and totalPages', () => {
            const r = searchFoodsIn(conn(), 'milk', 2, 2);
            assert.equal(r.page, 2);
            assert.equal(r.limit, 2);
            assert.equal(r.total, mode === 'fts' ? 6 : 7);
            assert.equal(r.totalPages, Math.ceil(r.total / 2));
            assert.deepEqual(r.foods.map(f => f.id), ids('milk').slice(2, 4));
        });

        it('is safe with SQL/FTS metacharacters', () => {
            for (const q of [`"`, `'`, `%`, `_`, `100%`, `milk" OR 1=1 --`, `NEAR(milk)`, `milk*`, `-milk`, `)`]) {
                assert.doesNotThrow(() => searchFoodsIn(conn(), q), q);
            }
            assert.deepEqual(ids('100%'), [8]);
            assert.deepEqual(ids('%'), []);
        });

        it('attaches serving sizes and keeps nulls', () => {
            const r = searchFoodsIn(conn(), 'egg white');
            assert.equal(r.foods[0].id, 7);
            assert.equal(r.foods[0].protein_g, null);
            const milk = searchFoodsIn(conn(), 'milk whole 3').foods.find(f => f.id === 1)!;
            assert.deepEqual(milk.serving_sizes!.map(s => s.weight_g), [244, 976]);
        });

        it('clamps limit and page', () => {
            const r = searchFoodsIn(conn(), 'milk', -5, 10_000);
            assert.equal(r.page, 1);
            assert.equal(r.limit, 100);
        });
    });
}

describe('searchFoods (schema v2 columns)', () => {
    it('ranks by data_type_rank and hides superseded SR rows unless asked', () => {
        const ids = (q: string, opts?: { includeSuperseded?: boolean }) =>
            searchFoodsIn(v2Conn, q, 1, 20, opts).foods.map(f => f.id);
        assert.deepEqual(ids('milk'), [2, 6, 4, 9, 3]);
        assert.deepEqual(ids('milk', { includeSuperseded: true }), [2, 1, 6, 4, 9, 3]);
    });

    it('top foods skips NULLs and supports columns present only in the new schema', () => {
        assert.deepEqual(getTopFoodsByNutrientIn(v2Conn, 'choline_mg', 10).map(f => f.id), [8, 2]);
        assert.deepEqual(getTopFoodsByNutrientIn(v2Conn, 'protein_g', 20).map(f => f.id).includes(7), false);
    });
});

describe('searchFoods ranking (everyday foods first)', () => {
    const RANKING: FoodRow[] = [
        [1, 2001, 'Egg, yolk, dried', 'foundation_food', 'Dairy and Egg Products', 34],
        [2, 2002, 'Eggs, Grade A, Large, egg whole', 'foundation_food', 'Dairy and Egg Products', 12.4],
        [3, 2003, 'Eggs, Grade A, Large, egg yolk', 'foundation_food', 'Dairy and Egg Products', 16],
        [4, 2004, 'Egg, whole, raw, fresh', 'sr_legacy_food', 'Dairy and Egg Products', 12.6],
        [5, 2005, 'Salmon nuggets, breaded, frozen, heated', 'sr_legacy_food', 'Finfish and Shellfish Products', 12],
        [6, 2006, 'Salmon, sockeye, canned, total can contents', 'sr_legacy_food', 'Finfish and Shellfish Products', 23],
        [7, 2007, 'Fish, salmon, sockeye, wild caught, raw', 'foundation_food', 'Finfish and Shellfish Products', 22],
        [8, 2008, 'Salmon salad', 'survey_fndds_food', 'Fish', 15],
        [9, 2009, 'Apricots, dried, sulfured, uncooked', 'sr_legacy_food', 'Fruits and Fruit Juices', 3.4],
        [10, 2010, 'Apricots, raw', 'sr_legacy_food', 'Fruits and Fruit Juices', 1.4],
        [11, 2011, 'Pepper, banana, raw', 'foundation_food', 'Vegetables and Vegetable Products', 1.7],
        [12, 2012, 'Bananas, raw', 'sr_legacy_food', 'Fruits and Fruit Juices', 1.1],
        [13, 2013, 'Oil, corn, peanut, and olive', 'sr_legacy_food', 'Fats and Oils', 0],
        [14, 2014, 'Oil, olive, salad or cooking', 'sr_legacy_food', 'Fats and Oils', 0],
        [15, 2015, 'Bananas, overripe, raw', 'foundation_food', 'Fruits and Fruit Juices', 0.7],
        [16, 2016, 'Bananas, ripe and slightly ripe, raw', 'foundation_food', 'Fruits and Fruit Juices', 0.7],
        [17, 2017, 'Chicken, wing, meat and skin, raw', 'foundation_food', 'Poultry Products', 18],
        [18, 2018, 'Chicken, breast, boneless, skinless, raw', 'foundation_food', 'Poultry Products', 22],
    ];
    let conn: ReturnType<typeof openDatabase>;
    before(() => {
        conn = buildDb(path.join(tmp, 'ranking.db'), { fts: true, meta: false, rows: RANKING });
    });
    after(() => conn.db.close());
    const ids = (q: string) => searchFoodsIn(conn, q).foods.map(f => f.id);

    it('puts plain whole foods ahead of dried/processed forms', () => {
        assert.deepEqual(ids('egg'), [2, 3, 4, 1]);
        assert.deepEqual(ids('apricot'), [10, 9]);
    });

    it('treats a food named in its second segment ("Fish, salmon") as that food', () => {
        assert.deepEqual(ids('salmon'), [7, 6, 8, 5]);
    });

    it('only treats generic group prefixes that way ("Pepper, banana" is a pepper)', () => {
        assert.deepEqual(ids('banana').filter(id => id === 12 || id === 11), [12, 11]);
    });

    it('opens with the everyday form ("banana" is not "overripe", "chicken" is not "wing")', () => {
        const banana = ids('banana');
        assert.ok(banana.indexOf(16) < banana.indexOf(15), `banana order ${banana}`);
        assert.equal(ids('chicken')[0], 18);
    });

    it('prefers foods whose leading segments name more of the query words', () => {
        assert.deepEqual(ids('olive oil'), [14, 13]);
        assert.deepEqual(ids('banana pepper'), [11]);
    });

    it('does not penalise a processed form the user asked for', () => {
        assert.equal(ids('dried apricots')[0], 9);
        assert.equal(ids('dried egg')[0], 1);
    });
});

describe('tokenizeQuery', () => {
    it('splits on non-word characters and dedupes', () => {
        assert.deepEqual(tokenizeQuery(' Milk,  WHOLE (milk) '), ['milk', 'whole']);
    });
});

describe('getTopFoodsByNutrient', () => {
    it('only accepts allow-listed nutrient columns that exist', () => {
        assert.deepEqual(getTopFoodsByNutrientIn(ftsConn, 'protein_g', 2).map(f => f.id), [8, 4]);
        assert.throws(() => getTopFoodsByNutrientIn(ftsConn, 'protein_g; DROP TABLE foods', 2), RangeError);
        assert.throws(() => getTopFoodsByNutrientIn(ftsConn, 'description', 2), RangeError);
        assert.throws(() => getTopFoodsByNutrientIn(ftsConn, 'choline_mg', 2), RangeError, 'column absent in this DB');
    });
});

describe('hydrateFoods', () => {
    it('uses DB nutrients, matching by fdc_id first and keeping the client id', () => {
        const out = hydrateFoodsIn(ftsConn, [
            { id: 42, fdc_id: 1008, protein_g: 999 },
            { id: 7, protein_g: 5 },
            { id: 1234, fdc_id: 999999, protein_g: 1 },
        ]);
        assert.equal(out[0].id, 42);
        assert.equal((out[0] as { protein_g: number }).protein_g, 31);
        assert.equal((out[1] as { protein_g: number | null }).protein_g, null);
        assert.equal((out[2] as { protein_g: number }).protein_g, 1, 'unknown foods are passed through');
    });
});

describe('getMeta / getFoodsByIds', () => {
    it('returns meta when present, null otherwise', () => {
        assert.deepEqual(getMetaIn(ftsConn), { source: 'unit test' });
        assert.equal(getMetaIn(likeConn), null);
    });

    it('ignores non-integer ids', () => {
        assert.deepEqual(getFoodsByIdsIn(ftsConn, [2, Number.NaN, 2.5, 3]).map(f => f.id).sort(), [2, 3]);
    });
});
