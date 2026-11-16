import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { NextRequest } from 'next/server';
import { openDatabase, searchFoodGroupsIn, searchFoodsIn, searchGroupTypesIn, getFoodTypesIn, getFoodByFdcIdIn } from './db';
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

function build(file: string, fts: boolean, extraSql = '') {
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
    if (extraSql) w.exec(extraSql);
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

        it('sends at most `inlineTypes` types with a group; the rest load by key, in the same order', () => {
            const cod = searchFoodGroupsIn(conn(), 'cod', 1, 20, { inlineTypes: 3 }).groups.find(g => g.key === 'cod')!;
            assert.equal(cod.count, 8);
            assert.equal(cod.types.length, 3);
            const full = searchGroupTypesIn(conn(), 'cod', 'cod');
            assert.equal(full.length, 8);
            assert.deepEqual(full.slice(0, 3), cod.types);
            assert.deepEqual(searchGroupTypesIn(conn(), 'cod', 'no such food'), []);
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

describe('older entries linked by the crosswalk (USDA renumbered the Foundation food)', () => {
    // build_db links these through scripts/data/foundation_sr_crosswalk.csv: no shared NDB number,
    // but "Fish, cod, Atlantic, raw" is "Fish, cod, Atlantic, wild caught, raw" (and Pacific likewise).
    let conn: ReturnType<typeof openDatabase>;
    before(() => {
        conn = build(path.join(tmp, 'linked.db'), true, `
            UPDATE foods SET superseded_by_fdc_id = 2002, vitamin_d_ug = 0.9, vitamin_b12_ug = 0.91 WHERE id = 6;
            UPDATE foods SET superseded_by_fdc_id = 2001, vitamin_d_ug = 0.5 WHERE id = 8;
            UPDATE foods SET vitamin_b12_ug = 1.2 WHERE id = 2;`);
    });
    after(() => conn.db.close());

    it('hides them from grouped search, the type list and plain search', () => {
        const cod = searchFoodGroupsIn(conn, 'cod', 1, 20).groups.find(g => g.key === 'cod')!;
        assert.equal(cod.count, 6);
        assert.ok(!cod.types.some(t => [6, 8, 17].includes(t.id)), cod.types.map(t => t.label).join(' | '));
        assert.deepEqual(searchGroupTypesIn(conn, 'cod', 'cod').map(t => t.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 7]);
        assert.ok(!getFoodTypesIn(conn, getFoodByFdcIdIn(conn, 2002)!).some(t => t.id === 6));
        assert.ok(!searchFoodsIn(conn, 'cod raw', 1, 20).foods.some(f => f.id === 6 || f.id === 8));
    });

    it('fills only the Foundation food’s gaps from them, and says so', () => {
        const atlantic = getFoodByFdcIdIn(conn, 2002)!;
        assert.equal(atlantic.vitamin_d_ug, 0.9);
        assert.equal(atlantic.filledFrom?.vitamin_d_ug, 2006);
        assert.equal(atlantic.vitamin_b12_ug, 1.2, 'a value it has is kept');
        assert.equal(atlantic.filledFrom?.vitamin_b12_ug, undefined);
        assert.equal(atlantic.calories, 71);
        assert.equal(getFoodByFdcIdIn(conn, 2001)!.filledFrom?.vitamin_d_ug, 2008);
        // A nutrient neither record has stays empty.
        assert.equal(atlantic.vitamin_k_ug, null);
    });

    it('keeps the older entry itself as USDA published it, pointing at its replacement', () => {
        const old = getFoodByFdcIdIn(conn, 2006)!;
        assert.equal(old.superseded_by_fdc_id, 2002);
        assert.equal(old.calories, 82);
        assert.equal(old.filledFrom, undefined);
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
        assert.equal(g[0].count, 7);
        // The SR Legacy raw cods are the Foundation ones (crosswalk links), so they aren't listed twice.
        assert.ok(!g[0].types.some(t => t.description === 'Fish, cod, Atlantic, raw'), g[0].types.map(t => t.label).join(' | '));
        assert.ok(!g[0].types.some(t => t.description.startsWith('Fish, cod, Pacific, raw')));
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

    it('white rice: one White rice group, represented by cooked white rice', () => {
        const g = groups('white rice');
        assert.equal(g[0].name, 'White rice');
        assert.ok(g[0].count >= 20, `white rice has ${g[0].count} types`);
        assert.ok(g[0].types.every(t => /white/i.test(t.description)));
        assert.match(g[0].food.description, /^Rice, white, long.grain.*cooked/);
        assert.equal(g.filter(x => x.key === 'white rice').length, 1);
    });

    it('rice: White rice and Brown rice are separate rows with cooked representatives', () => {
        const g = groups('rice');
        const white = g.find(x => x.name === 'White rice')!;
        const brown = g.find(x => x.name === 'Brown rice')!;
        assert.ok(white && brown, g.map(x => x.name).join(' | '));
        assert.ok(g.indexOf(white) < 5 && g.indexOf(brown) < 5, g.slice(0, 5).map(x => x.name).join(' | '));
        assert.match(white.food.description, /cooked/);
        assert.match(brown.food.description, /cooked/);
        assert.ok(white.food.calories! < 200, `white rice row shows ${white.food.calories} kcal per 100 g`);
    });

    it('beef: several cut rows, ground beef among the first', () => {
        const g = groups('beef');
        const top = g.slice(0, 5).map(x => x.name);
        assert.ok(top.includes('Ground beef'), top.join(' | '));
        assert.ok(g.filter(x => /beef/i.test(x.name) && x.count > 1).length >= 8, g.map(x => x.name).join(' | '));
        assert.ok(g.every(x => x.count < 300), 'no row holds every beef entry');
    });

    it('chicken breast: one row, with "Chicken, breast" and "Chicken breast, deli" entries alike', () => {
        const g = groups('chicken breast');
        assert.equal(g[0].name, 'Chicken breast');
        assert.equal(g.filter(x => x.name === 'Chicken breast').length, 1);
        assert.ok(!g.some(x => x.name === 'Chicken'), g.map(x => x.name).join(' | '));
        assert.ok(g[0].types.some(t => t.data_type === 'foundation_food'));
        assert.ok(g[0].types.some(t => t.description.startsWith('Chicken breast, ')));
        assert.ok(g[0].types.some(t => t.description.startsWith('Chicken, broiler, rotisserie')), 'rotisserie breast is chicken breast');
        assert.equal(g[0].food.description, 'Chicken, breast, boneless, skinless, raw');
        assert.ok(g.some(x => x.name === 'Chicken breast tenders'), 'breaded tenders stay their own row');
    });

    it('eggs: the Foundation large egg is the most common, white and yolk are their own rows', () => {
        const g = groups('eggs');
        const egg = g.find(x => x.name === 'Egg')!;
        assert.equal(g.indexOf(egg), 0, g.slice(0, 5).map(x => x.name).join(' | '));
        assert.equal(egg.food.description, 'Eggs, Grade A, Large, egg whole');
        assert.ok(g.some(x => x.name === 'Egg white'));
        assert.ok(g.some(x => x.name === 'Egg yolk'));
    });

    it('milk: one group, whole fluid milk most common, dry and canned milks not listed as raw', () => {
        const milk = groups('milk').find(x => x.name === 'Milk')!;
        assert.equal(milk.food.description, 'Milk, whole, 3.25% milkfat, with added vitamin D');
        for (const t of milk.types.filter(t => /\b(dry|evaporated|condensed)\b/i.test(t.description))) {
            assert.notEqual(t.kind, 'raw', t.description);
        }
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
        assert.equal(grouped.groups[0].count, 7);
        assert.ok(grouped.total < grouped.entries);
        const flat = await (await searchRoute(new NextRequest('http://localhost/api/search?q=cod&limit=5'))).json();
        assert.equal(flat.groups, undefined);
        assert.equal(flat.foods.length, 5);
    });

    it('keeps a large group light: beef round sends its first 60 types, the rest load by key', async () => {
        const res = await searchRoute(new NextRequest('http://localhost/api/search?q=beef&group=1'));
        const text = await res.text();
        const round = JSON.parse(text).groups.find((g: { key: string }) => g.key === 'beef round');
        assert.ok(round.count > 60);
        assert.equal(round.types.length, 60);
        assert.ok(text.length < 120_000, `${text.length} bytes`);
        const more = await (await searchRoute(new NextRequest('http://localhost/api/search?q=beef&group=1&key=beef%20round'))).json();
        assert.equal(more.types.length, round.count);
        assert.deepEqual(more.types.slice(0, 60), round.types);
    });
});
