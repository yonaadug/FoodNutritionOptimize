import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { openDatabase, searchFoodGroupsIn, searchFoodsIn, getFoodTypesIn, getFoodByFdcIdIn } from './db';
import { GET as searchRoute } from '@/app/api/search/route';
import { NUTRIENT_COLUMNS } from './testing/fixtures';

// id, fdc_id, description, data_type, calories
const ROWS: [number, number, string, string, number][] = [
    [1, 2001, 'Cod, Pacific or Alaskan, frozen, wild caught', 'foundation_food', 61],
    [2, 2002, 'Fish, cod, Atlantic, wild caught, raw', 'foundation_food', 71],
    [3, 2003, 'Fish, cod, Atlantic, canned, solids and liquid', 'sr_legacy_food', 105],
    [4, 2004, 'Fish, cod, Atlantic, cooked, dry heat', 'sr_legacy_food', 105],
    [5, 2005, 'Fish, cod, Atlantic, dried and salted', 'sr_legacy_food', 290],
    [6, 2006, 'Fish, cod, Atlantic, raw', 'sr_legacy_food', 82],
    [7, 2007, 'Fish, cod, Pacific, cooked', 'sr_legacy_food', 84],
    [8, 2008, 'Fish, cod, Pacific, raw (may have been previously frozen)', 'sr_legacy_food', 69],
    [9, 2009, 'Codfish salad, Puerto Rican style, Serenata', 'survey_fndds_food', 183],
    [10, 2010, 'Fish, lingcod, raw', 'sr_legacy_food', 85],
    [11, 2011, 'Fish oil, cod liver', 'sr_legacy_food', 902],
    [12, 2012, 'Fish, salmon, Atlantic, farm raised, raw', 'foundation_food', 208],
    [13, 2013, 'Fish, salmon, sockeye, raw', 'sr_legacy_food', 131],
    [14, 2014, 'Cheese, cheddar', 'sr_legacy_food', 403],
    [15, 2015, 'Cheese, swiss', 'sr_legacy_food', 380],
    [16, 2016, 'Cheese, cheddar, sharp, sliced', 'foundation_food', 409],
    // An older record replaced by row 6: hidden from search and from the type list.
    [17, 2017, 'Fish, cod, Atlantic, raw, old', 'sr_legacy_food', 80],
];

let tmp: string;
const conns: Record<'fts' | 'like', ReturnType<typeof openDatabase>> = {} as never;

function build(file: string, fts: boolean) {
    const w = new Database(file);
    const cols = NUTRIENT_COLUMNS.map(c => `${c} REAL`).join(', ');
    w.exec(`CREATE TABLE foods (id INTEGER PRIMARY KEY, fdc_id INTEGER UNIQUE, description TEXT, data_type TEXT,
        food_category TEXT, brand_owner TEXT, serving_size REAL, serving_size_unit TEXT, data_type_rank INTEGER,
        superseded_by_fdc_id INTEGER, ${cols});
        CREATE TABLE serving_sizes (id INTEGER PRIMARY KEY, food_id INTEGER, label TEXT, weight_g REAL);`);
    const ins = w.prepare(`INSERT INTO foods (id, fdc_id, description, data_type, food_category, data_type_rank, calories, protein_g, total_fat_g)
        VALUES (?, ?, ?, ?, 'Finfish and Shellfish Products', ?, ?, 18, 1)`);
    for (const [id, fdc, d, t, kcal] of ROWS) ins.run(id, fdc, d, t, t === 'foundation_food' ? 1 : t === 'sr_legacy_food' ? 2 : 3, kcal);
    w.exec(`UPDATE foods SET superseded_by_fdc_id = 2006 WHERE id = 17;
        INSERT INTO serving_sizes (food_id, label, weight_g) VALUES (2, '1 fillet', 180), (6, '1 fillet', 180);`);
    if (fts) {
        w.exec(`CREATE VIRTUAL TABLE foods_fts USING fts5(description, food_category, content='foods', content_rowid='id');
            INSERT INTO foods_fts(foods_fts) VALUES('rebuild');`);
    }
    w.close();
    return openDatabase(file);
}

before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nutri-groups-test-'));
    conns.fts = build(path.join(tmp, 'fts.db'), true);
    conns.like = build(path.join(tmp, 'like.db'), false);
});

after(() => {
    conns.fts.db.close();
    conns.like.db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
});

for (const mode of ['fts', 'like'] as const) {
    describe(`searchFoodGroups (${mode})`, () => {
        const conn = () => conns[mode];

        it('returns cod once, with every matched type, and keeps codfish, lingcod and cod liver oil apart', () => {
            const r = searchFoodGroupsIn(conn(), 'cod', 1, 20);
            const cod = r.groups.find(g => g.key === 'cod')!;
            assert.ok(cod, 'a Cod group');
            assert.equal(cod.name, 'Cod');
            assert.equal(cod.count, 8);
            assert.equal(cod.types.length, 8);
            assert.equal(r.groups.filter(g => g.key === 'cod').length, 1);
            assert.ok(!cod.types.some(t => /codfish|lingcod|liver/i.test(t.description)));
            assert.ok(!cod.types.some(t => t.id === 17), 'superseded rows stay hidden');
            assert.ok(r.groups.some(g => g.food.description.startsWith('Codfish salad')), 'codfish salad is its own row');
            assert.equal(r.entries, r.groups.reduce((n, g) => n + g.count, 0));
            assert.equal(r.total, r.groups.length);
        });

        it('represents the group by its most typical entry, marked Most common and listed first', () => {
            const cod = searchFoodGroupsIn(conn(), 'cod', 1, 20).groups.find(g => g.key === 'cod')!;
            assert.equal(cod.food.description, 'Fish, cod, Atlantic, wild caught, raw');
            assert.equal(cod.food.serving_sizes?.length, 1, 'the representative is a full food, with servings');
            assert.equal(cod.types[0].id, cod.food.id);
            assert.equal(cod.types[0].mostCommon, true);
            assert.equal(cod.types.find(t => t.id === 5)!.label, 'Atlantic · dried and salted');
            assert.equal(cod.types.find(t => t.id === 5)!.calories, 290);
        });

        it('ranks a group by its best entry', () => {
            const flat = searchFoodsIn(conn(), 'cod', 1, 50).foods.map(f => f.id);
            const grouped = searchFoodGroupsIn(conn(), 'cod', 1, 20).groups;
            const firstSeen = grouped.map(g => Math.min(...g.types.map(t => flat.indexOf(t.id))));
            assert.deepEqual(firstSeen, [...firstSeen].sort((a, b) => a - b));
        });

        it('narrows a group to the matched types', () => {
            const r = searchFoodGroupsIn(conn(), 'cod raw', 1, 20);
            const cod = r.groups.find(g => g.key === 'cod')!;
            assert.deepEqual(cod.types.map(t => t.id).sort((a, b) => a - b), [2, 6, 8]);
        });

        it('a single-entry group carries just that food', () => {
            const r = searchFoodGroupsIn(conn(), 'swiss', 1, 20);
            assert.equal(r.groups.length, 1);
            assert.equal(r.groups[0].count, 1);
            assert.equal(r.groups[0].food.description, 'Cheese, swiss');
        });

        it('keeps Cheddar and Swiss cheese apart and groups the two cheddars', () => {
            const r = searchFoodGroupsIn(conn(), 'cheese', 1, 20);
            assert.deepEqual(r.groups.map(g => [g.name, g.count]).sort(), [['Cheddar cheese', 2], ['Swiss cheese', 1]]);
            assert.equal(r.groups.find(g => g.name === 'Cheddar cheese')!.food.description, 'Cheese, cheddar, sharp, sliced');
        });

        it('pages and counts groups, not entries', () => {
            const all = searchFoodGroupsIn(conn(), 'fish', 1, 50);
            assert.ok(all.total >= 3);
            const p1 = searchFoodGroupsIn(conn(), 'fish', 1, 2);
            const p2 = searchFoodGroupsIn(conn(), 'fish', 2, 2);
            assert.equal(p1.groups.length, 2);
            assert.equal(p1.total, all.total);
            assert.equal(p1.totalPages, Math.ceil(all.total / 2));
            assert.deepEqual([...p1.groups, ...p2.groups].map(g => g.key), all.groups.slice(0, 4).map(g => g.key));
            assert.equal(new Set([...p1.groups, ...p2.groups].map(g => g.key)).size, p1.groups.length + p2.groups.length, 'no group on two pages');
            assert.equal(p1.entries, all.entries);
        });

        it('returns nothing for an empty query', () => {
            assert.deepEqual(searchFoodGroupsIn(conn(), '  ', 1, 20).groups, []);
        });
    });
}

describe('getFoodTypes (the food page Type switcher)', () => {
    it('lists every current type of the food, Most common first', () => {
        const food = getFoodByFdcIdIn(conns.fts, 2004)!;
        const types = getFoodTypesIn(conns.fts, food);
        assert.equal(types.length, 8);
        assert.equal(types[0].description, 'Fish, cod, Atlantic, wild caught, raw');
        assert.ok(types.some(t => t.id === food.id));
        assert.ok(!types.some(t => t.id === 17));
    });

    it('is a single entry for a food with no other types', () => {
        assert.equal(getFoodTypesIn(conns.fts, getFoodByFdcIdIn(conns.fts, 2015)!).length, 1);
    });
});

const DB_PATH = path.join(import.meta.dirname, '..', 'nutrition.db');
const hasDb = fs.existsSync(DB_PATH) && fs.statSync(DB_PATH).size > 1_000_000;

describe('grouped search on the real database', { skip: !hasDb && 'nutrition.db not present' }, () => {
    let real: ReturnType<typeof openDatabase>;
    before(() => { real = openDatabase(DB_PATH); });
    after(() => real.db.close());
    const groups = (q: string, limit = 20) => searchFoodGroupsIn(real, q, 1, limit).groups;

    it('cod: one row with every cod entry, codfish dishes separate', () => {
        const g = groups('cod');
        assert.equal(g[0].name, 'Cod');
        assert.equal(g[0].count, 9);
        assert.equal(g[0].food.description, 'Fish, cod, Atlantic, wild caught, raw');
        assert.ok(g.slice(1).some(x => /^Codfish salad/.test(x.food.description)));
        assert.equal(g.filter(x => x.key === 'cod').length, 1);
    });

    it('salmon: one large group (40+) represented by a Foundation raw salmon', () => {
        const g = groups('salmon');
        assert.equal(g[0].name, 'Salmon');
        assert.ok(g[0].count >= 40, `salmon has ${g[0].count} types`);
        assert.equal(g[0].food.data_type, 'foundation_food');
        assert.match(g[0].food.description, /raw/);
        assert.ok(g.some(x => /Salmon cake|Salmon nuggets/i.test(x.name)), 'salmon dishes stay separate');
    });

    it('white rice: one Rice group of white rices, represented by plain white rice', () => {
        const g = groups('white rice');
        const rice = g.find(x => x.key === 'rice')!;
        assert.ok(rice.count >= 20, `white rice has ${rice.count} types`);
        assert.ok(rice.types.every(t => /white/i.test(t.description)));
        assert.match(rice.food.description, /^Rice, white, long.grain/);
    });

    it('cheese: Cheddar and Swiss are separate rows', () => {
        const names = groups('cheese', 60).map(x => x.name);
        assert.ok(names.includes('Cheddar cheese'));
        assert.ok(names.includes('Swiss cheese'));
    });

    it('beans: black and kidney beans are separate rows', () => {
        const names = groups('beans', 60).map(x => x.name);
        assert.ok(names.includes('Black beans'));
        assert.ok(names.includes('Kidney beans'));
    });

    it('GET /api/search?group=1 returns groups; without it, foods as before', async () => {
        const grouped = await (await searchRoute(new NextRequest('http://localhost/api/search?q=cod&group=1&limit=5'))).json();
        assert.equal(grouped.groups[0].name, 'Cod');
        assert.equal(grouped.groups[0].count, 9);
        assert.ok(grouped.total < grouped.entries);
        const flat = await (await searchRoute(new NextRequest('http://localhost/api/search?q=cod&limit=5'))).json();
        assert.equal(flat.groups, undefined);
        assert.equal(flat.foods.length, 5);
    });
});
