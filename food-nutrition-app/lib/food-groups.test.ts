import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    filterTypes, foodGroupOf, groupRanked, pickRepresentative, servingForType, servingParam, typeKind,
    typeLabel, typeOptions, type TypeEntry,
} from './food-groups';
import { servingOptions } from './food-page';

const key = (d: string) => foodGroupOf(d).key;

const COD = [
    'Cod, Pacific or Alaskan, frozen, wild caught',
    'Fish, cod, Atlantic, wild caught, raw',
    'Fish, cod, Atlantic, canned, solids and liquid',
    'Fish, cod, Atlantic, cooked, dry heat',
    'Fish, cod, Atlantic, dried and salted',
    'Fish, cod, Atlantic, raw',
    'Fish, cod, Pacific, cooked',
    'Fish, cod, Pacific, cooked, dry heat (may contain additives to retain moisture)',
    'Fish, cod, Pacific, raw (may have been previously frozen)',
];

let nextId = 1;
function entry(description: string, over: Partial<TypeEntry> = {}): TypeEntry {
    const id = nextId++;
    return {
        id, fdc_id: 100000 + id, description, data_type: 'sr_legacy_food', data_type_rank: 2,
        calories: 100, protein_g: 10, total_fat_g: 1, carbohydrate_g: 0, ...over,
    };
}
const foundation = { data_type: 'foundation_food', data_type_rank: 1 };
const survey = { data_type: 'survey_fndds_food', data_type_rank: 3 };

describe('foodGroupOf: the grouping key', () => {
    it('puts every USDA cod entry in one group named Cod', () => {
        for (const d of COD) assert.equal(key(d), 'cod', d);
        assert.equal(foodGroupOf('Fish, cod, Atlantic, raw').name, 'Cod');
        assert.equal(foodGroupOf('Fish, cod, Atlantic, raw').detail, 'Atlantic, raw');
        assert.equal(foodGroupOf('Cod, Pacific or Alaskan, frozen, wild caught').detail, 'Pacific or Alaskan, frozen, wild caught');
    });

    it('keeps foods that only share a word apart', () => {
        assert.notEqual(key('Codfish salad, Puerto Rican style, Serenata'), 'cod');
        assert.notEqual(key('Biscayne codfish, Puerto Rican style'), 'cod');
        assert.notEqual(key('Fish oil, cod liver'), 'cod');
        assert.notEqual(key('Fish, lingcod, raw'), 'cod');
        assert.equal(key('Fish, lingcod, raw'), key('Fish, lingcod, cooked, dry heat'));
    });

    it('groups salmon from both naming styles, and keeps salmon dishes apart', () => {
        const salmon = ['Fish, salmon, Atlantic, farm raised, raw', 'Fish, salmon, sockeye, wild caught, raw',
            'Fish, Salmon, Chum, raw (Alaska Native)', 'Salmon, sockeye, canned, total can contents',
            'Salmon, red (sockeye), filets with skin, smoked (Alaska Native)'];
        for (const d of salmon) assert.equal(key(d), 'salmon', d);
        assert.notEqual(key('Salmon cake or patty'), 'salmon');
        assert.notEqual(key('Salmon nuggets, breaded, frozen, heated'), 'salmon');
    });

    it('splits rice by kind: white, brown, wild; rice cakes are another food', () => {
        assert.equal(key('Rice, white, long-grain, regular, enriched, cooked'), 'white rice');
        assert.equal(key('Rice, white, long grain, unenriched, raw'), 'white rice');
        assert.equal(foodGroupOf('Rice, white, long grain, unenriched, raw').name, 'White rice');
        assert.equal(foodGroupOf('Rice, white, long grain, unenriched, raw').detail, 'long grain, unenriched, raw');
        assert.equal(key('Rice, brown, long-grain, cooked (Includes foods for USDA\'s Food Distribution Program)'), 'brown rice');
        assert.equal(foodGroupOf('Rice, brown, long-grain, cooked').name, 'Brown rice');
        assert.equal(key('Wild rice, cooked'), 'wild rice');
        assert.equal(key('Rice, fried, with chicken'), 'fried rice');
        assert.equal(key('Rice, cooked with coconut milk'), 'rice');
        assert.notEqual(key('Rice cake, cracker (include hain mini rice cakes)'), 'rice');
    });

    it('groups meat and poultry by cut, not by animal', () => {
        assert.equal(foodGroupOf('Beef, ground, 85% lean meat / 15% fat, raw').name, 'Ground beef');
        assert.equal(foodGroupOf('Beef, ground, 85% lean meat / 15% fat, raw').detail, '85% lean meat / 15% fat, raw');
        assert.equal(foodGroupOf('Beef, round, top round, separable lean only, trimmed to 0" fat, select, raw').name, 'Beef round');
        assert.notEqual(key('Beef, ground, 80% lean meat / 20% fat, raw'), key('Beef, round, eye of round, raw'));
        assert.equal(foodGroupOf('Beef, variety meats and by-products, liver, raw').name, 'Beef liver');
        assert.equal(foodGroupOf('Pork, fresh, loin, whole, separable lean only, raw').name, 'Pork loin');
        assert.equal(foodGroupOf('Lamb, New Zealand, imported, leg chop/steak, separable lean only, raw').name, 'Lamb leg chop/steak');
        assert.equal(foodGroupOf('Lamb, New Zealand, imported, leg chop/steak, separable lean only, raw').detail, 'New Zealand, imported, separable lean only, raw');
        assert.equal(foodGroupOf('Turkey, whole, breast, meat only, raw').name, 'Turkey breast');
        assert.equal(foodGroupOf('Veal, leg (top round), separable lean only, raw').name, 'Veal leg');
        assert.equal(foodGroupOf('Game meat, deer, ground, raw').name, 'Ground deer');
        // Chicken breast from every USDA dataset is one food.
        const breast = key('Chicken, broilers or fryers, breast, meat only, cooked, roasted');
        assert.equal(breast, 'chicken breast');
        assert.equal(key('Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw'), breast);
        assert.equal(key('Chicken, breast, boneless, skinless, raw'), breast);
        assert.equal(key('Chicken breast, baked, coated, skin / coating eaten'), breast);
        // Compound products stay their own food.
        assert.notEqual(key('Chicken breast tenders, breaded, cooked, microwaved'), breast);
        // No cut named: the animal itself.
        assert.equal(foodGroupOf('Chicken, broilers or fryers, meat only, cooked, roasted').name, 'Chicken');
        assert.equal(foodGroupOf('Beef, composite of trimmed retail cuts, separable lean only, trimmed to 0" fat, all grades, raw').name, 'Beef');
    });

    it('keeps each cheese its own food (Cheddar vs Swiss), across USDA datasets', () => {
        assert.equal(key('Cheese, cheddar'), key('Cheese, Cheddar'));
        assert.equal(key('Cheese, cheddar, sharp, sliced'), key('Cheese, cheddar'));
        assert.notEqual(key('Cheese, cheddar'), key('Cheese, swiss'));
        assert.equal(foodGroupOf('Cheese, swiss').name, 'Swiss cheese');
        assert.notEqual(key('Cheese, cheddar'), key('Cheese sauce'));
    });

    it('keeps each kind of bean its own food', () => {
        assert.equal(key('Beans, black, mature seeds, raw'), key('Beans, black, mature seeds, cooked, boiled, without salt'));
        assert.equal(foodGroupOf('Beans, black, mature seeds, raw').name, 'Black beans');
        assert.notEqual(key('Beans, black, mature seeds, raw'), key('Beans, kidney, red, mature seeds, raw'));
        assert.notEqual(key('Beans, black, mature seeds, raw'), key('Beans, snap, green, raw'));
    });

    it('treats Egg / Eggs as one food, split by part, and other birds\' eggs apart', () => {
        const whole = key('Eggs, Grade A, Large, egg whole');
        assert.equal(key('Egg, whole, raw, frozen, pasteurized'), whole);
        assert.equal(key('Egg, whole, cooked, hard-boiled'), whole);
        assert.equal(foodGroupOf('Eggs, Grade A, Large, egg whole').name, 'Egg');
        assert.equal(foodGroupOf('Eggs, Grade A, Large, egg whole').detail, 'Grade A, Large');
        assert.equal(foodGroupOf('Eggs, Grade A, Large, egg white').name, 'Egg white');
        assert.equal(key('Egg, white, raw, frozen, pasteurized'), key('Eggs, Grade A, Large, egg white'));
        assert.equal(foodGroupOf('Egg, yolk, dried').name, 'Egg yolk');
        assert.notEqual(key('Egg, yolk, dried'), whole);
        assert.equal(foodGroupOf('Egg, duck, whole, fresh, raw').name, 'Duck egg');
        assert.notEqual(key('Egg white sandwich'), key('Eggs, Grade A, Large, egg white'));
    });

    it('splits catch-all names (Soup, Oil, Snacks, ...) by the food they name', () => {
        assert.notEqual(key('Oil, olive, salad or cooking'), key('Oil, canola'));
        assert.equal(key('Oil, olive, salad or cooking'), key('Oil, olive, extra virgin'));
        assert.equal(foodGroupOf('Oil, olive, salad or cooking').name, 'Oil, olive');
        assert.equal(foodGroupOf('Oil, olive, salad or cooking').detail, 'salad or cooking');
        assert.notEqual(key('Soup, tomato, canned, condensed'), key('Soup, chicken noodle, canned, condensed'));
        assert.equal(key('Soup, tomato, canned, condensed'), key('Soup, tomato'));
        assert.notEqual(key('Snacks, potato chips, plain, salted'), key('Snacks, popcorn, air-popped'));
    });

    it('keeps branded foods apart unless the product itself matches', () => {
        assert.notEqual(key("McDONALD'S, Big Mac"), key("McDONALD'S, Hamburger"));
        assert.equal(key("McDONALD'S, Big Mac"), key("McDONALD'S, Big Mac (without sauce)"));
        assert.notEqual(key('QUAKER, Instant Oatmeal, apple and cinnamon'), key('QUAKER, Oatmeal Squares cereal'));
        // A brand in the detail does not split the food: this is still brown rice.
        assert.equal(key('Rice, brown, parboiled, cooked, UNCLE BENS'), 'brown rice');
    });

    it('a food with no comma is its own group', () => {
        assert.equal(foodGroupOf('Milk').key, 'milk');
        assert.equal(foodGroupOf('Milk').detail, '');
    });
});

describe('typeKind', () => {
    it('sorts forms into raw, cooked, preserved and other', () => {
        assert.equal(typeKind('Fish, cod, Atlantic, raw'), 'raw');
        assert.equal(typeKind('Cod, Pacific or Alaskan, frozen, wild caught'), 'raw');
        assert.equal(typeKind('Fish, cod, Atlantic, cooked, dry heat'), 'cooked');
        assert.equal(typeKind('Fish, cod, Atlantic, canned, solids and liquid'), 'preserved');
        assert.equal(typeKind('Fish, cod, Atlantic, dried and salted'), 'preserved');
        assert.equal(typeKind('Fish, salmon, chinook, smoked'), 'preserved');
        assert.equal(typeKind('Rice, white, glutinous, unenriched, uncooked'), 'raw');
        assert.equal(typeKind('Rice, white, with peas, fat added'), 'other');
        assert.equal(typeKind('Peas, green, frozen, cooked, boiled, drained, without salt'), 'cooked');
        // Dry milk and dry pasta are not "raw".
        assert.equal(typeKind('Milk, dry, nonfat, regular, without added vitamin A and vitamin D'), 'other');
        assert.equal(typeKind('Pasta, dry, enriched'), 'other');
        assert.equal(typeKind('Milk, whole, 3.25% milkfat, with added vitamin D'), 'other');
    });
});

describe('typeLabel', () => {
    it('reads as short qualifiers separated by dots', () => {
        assert.equal(typeLabel('Atlantic, raw'), 'Atlantic · raw');
        assert.equal(typeLabel('Atlantic, dried and salted'), 'Atlantic · dried and salted');
        assert.equal(typeLabel(''), 'Plain');
    });
});

describe('pickRepresentative: the most typical entry', () => {
    it('picks Atlantic cod, wild caught, raw (Foundation, raw, the variety most entries share)', () => {
        const entries = COD.map(d => entry(d, d.includes('wild caught') ? foundation : {}));
        assert.equal(pickRepresentative(entries).description, 'Fish, cod, Atlantic, wild caught, raw');
    });

    it('prefers Foundation data, then raw over cooked', () => {
        const cooked = entry('Fish, cod, Atlantic, cooked, dry heat', foundation);
        const raw = entry('Fish, cod, Atlantic, raw');
        assert.equal(pickRepresentative([raw, cooked]).id, cooked.id, 'Foundation first');
        const rawF = entry('Fish, cod, Atlantic, raw', foundation);
        assert.equal(pickRepresentative([cooked, rawF]).id, rawF.id, 'then raw');
    });

    it('never picks a canned, dried, salted or smoked form when a plain one exists, even from Foundation', () => {
        const dried = entry('Fish, cod, Atlantic, dried and salted', foundation);
        const plain = entry('Fish, cod, Atlantic, cooked, dry heat', survey);
        assert.equal(pickRepresentative([dried, plain]).id, plain.id);
    });

    it('keeps a preserved form when the search asked for it', () => {
        const canned = entry('Fish, salmon, pink, canned, drained solids');
        const smoked = entry('Fish, salmon, chinook, smoked');
        assert.equal(pickRepresentative([smoked, canned], ['canned']).id, canned.id);
    });

    it('skips entries with no calories or macros', () => {
        const empty = entry('Fish, cod, Atlantic, raw', { ...foundation, calories: null, protein_g: null, total_fat_g: null, carbohydrate_g: null });
        const ok = entry('Fish, cod, Atlantic, cooked, dry heat');
        assert.equal(pickRepresentative([empty, ok]).id, ok.id);
    });

    it('picks cooked for grains and pasta, eaten cooked (even over Foundation raw)', () => {
        const rices = [
            entry('Rice, white, long grain, unenriched, raw', foundation),
            entry('Rice, white, puffed', foundation),
            entry('Rice, white, long-grain, regular, enriched, cooked'),
            entry('Rice, white, medium-grain, enriched, cooked'),
            entry('Rice, white, with peas, fat added', survey),
        ];
        assert.equal(pickRepresentative(rices).description, 'Rice, white, long-grain, regular, enriched, cooked');
        const pasta = [entry('Pasta, dry, enriched, spaghetti', foundation), entry('Pasta, cooked, enriched, without added salt')];
        assert.equal(pickRepresentative(pasta).description, 'Pasta, cooked, enriched, without added salt');
        const quinoa = [entry('Quinoa, uncooked'), entry('Quinoa, cooked')];
        assert.equal(pickRepresentative(quinoa).description, 'Quinoa, cooked');
        // Still raw first for everything else.
        const fish = [entry('Fish, cod, Atlantic, cooked, dry heat'), entry('Fish, cod, Atlantic, raw')];
        assert.equal(pickRepresentative(fish).description, 'Fish, cod, Atlantic, raw');
    });

    it('picks the Foundation large egg, not frozen pasteurized or dried egg', () => {
        const eggs = [
            entry('Egg, whole, dried', foundation),
            entry('Egg, whole, raw, frozen, pasteurized', foundation),
            entry('Eggs, Grade A, Large, egg whole', foundation),
            entry('Egg, whole, cooked, hard-boiled'),
            entry('Egg, whole, raw, frozen, salted, pasteurized'),
        ];
        assert.equal(pickRepresentative(eggs).description, 'Eggs, Grade A, Large, egg whole');
    });

    it('picks whole fluid milk for milk', () => {
        const milks = [
            entry('Milk, lowfat, fluid, 1% milkfat, with added vitamin A and vitamin D', foundation),
            entry('Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)', foundation),
            entry('Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D', foundation),
            entry('Milk, whole, 3.25% milkfat, with added vitamin D', foundation),
            entry('Milk, dry, whole, with added vitamin D'),
            entry('Milk, canned, evaporated, with added vitamin A'),
        ];
        assert.equal(pickRepresentative(milks).description, 'Milk, whole, 3.25% milkfat, with added vitamin D');
    });

    it('is deterministic whatever the input order', () => {
        const entries = COD.map(d => entry(d));
        const a = pickRepresentative(entries).id;
        const b = pickRepresentative([...entries].reverse()).id;
        assert.equal(a, b);
    });
});

describe('typeOptions: the picker list', () => {
    it('lists Most common first, then raw, cooked, preserved and other, alphabetically within each', () => {
        const entries = COD.map(d => entry(d, d.includes('wild caught') ? foundation : {}));
        const rep = pickRepresentative(entries);
        const opts = typeOptions(entries, rep.id);
        assert.equal(opts.length, COD.length);
        assert.equal(opts[0].id, rep.id);
        assert.equal(opts[0].mostCommon, true);
        assert.equal(opts.filter(o => o.mostCommon).length, 1);
        const kinds = opts.slice(1).map(o => o.kind);
        const order = ['raw', 'cooked', 'preserved', 'other'];
        assert.deepEqual(kinds, [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
        const raw = opts.slice(1).filter(o => o.kind === 'raw').map(o => o.label);
        assert.deepEqual(raw, [...raw].sort((a, b) => a.localeCompare(b)));
        assert.equal(opts.find(o => o.description === 'Fish, cod, Atlantic, dried and salted')!.label, 'Atlantic · dried and salted');
        assert.equal(opts.find(o => o.description === 'Fish, cod, Atlantic, dried and salted')!.kind, 'preserved');
        assert.equal(opts[0].calories, 100);
    });
});

describe('filterTypes', () => {
    const entries = ['Fish, salmon, Atlantic, farm raised, raw', 'Fish, salmon, sockeye, canned, drained solids',
        'Fish, salmon, sockeye, cooked, dry heat', 'Fish, salmon, chinook, smoked'].map(d => entry(d));
    const opts = typeOptions(entries, entries[0].id);
    it('keeps types whose label contains every word typed, in any order', () => {
        assert.deepEqual(filterTypes(opts, 'sockeye').map(o => o.description), [entries[1].description, entries[2].description].sort((a, b) =>
            opts.findIndex(o => o.description === a) - opts.findIndex(o => o.description === b)));
        assert.deepEqual(filterTypes(opts, 'cooked sockeye').map(o => o.id), [entries[2].id]);
        assert.equal(filterTypes(opts, '  ').length, 4);
        assert.equal(filterTypes(opts, 'tuna').length, 0);
    });
});

describe('groupRanked', () => {
    it('keeps the order of each group\'s best entry and the order within groups', () => {
        const ranked = [
            { id: 1, description: 'Fish, cod, Atlantic, raw' },
            { id: 2, description: 'Codfish salad, Puerto Rican style' },
            { id: 3, description: 'Fish, cod, Pacific, cooked' },
            { id: 4, description: 'Fish, lingcod, raw' },
            { id: 5, description: 'Cod, Pacific or Alaskan, frozen, wild caught' },
        ];
        const groups = groupRanked(ranked);
        assert.deepEqual(groups.map(g => g.members.map(m => m.id)), [[1, 3, 5], [2], [4]]);
        assert.equal(groups[0].key, 'cod');
    });
});

describe('carrying the serving to another type', () => {
    const food = (labels: [string, number][]) => ({
        description: 'Fish, cod, Atlantic, raw', food_category: 'Finfish and Shellfish Products', calories: 82,
        serving_sizes: labels.map(([label, weight_g], i) => ({ id: i + 1, food_id: 1, label, weight_g })),
    });
    const from = servingOptions(food([['1 fillet', 180], ['3 oz', 85]]));
    const to = servingOptions(food([['1 fillet', 200], ['1 cup', 140]]));

    it('keeps a standard weight', () => {
        const p = servingParam({ servingId: 'w-100g', options: from.options, defaultId: from.defaultId });
        assert.equal(p, 'w-100g');
        assert.deepEqual(servingForType(p, to.options), { servingId: 'w-100g' });
    });

    it('keeps a household measure the other type also has, by its words', () => {
        const fillet = from.options.find(o => o.label.startsWith('1 fillet'))!;
        const p = servingParam({ servingId: fillet.id, options: from.options, defaultId: 'none' })!;
        assert.equal(p, 'm:1 fillet');
        const got = servingForType(p, to.options)!;
        assert.match(to.options.find(o => o.id === got.servingId)!.label, /^1 fillet \(200 g\)$/);
    });

    it('falls back to the other type\'s own default when it has no such measure', () => {
        const pinch = servingOptions(food([['1 pinch', 0.3]]));
        const p = servingParam({ servingId: pinch.options.find(o => o.label.startsWith('1 pinch'))!.id, options: pinch.options, defaultId: 'none' });
        assert.equal(servingForType(p, to.options), null);
    });

    it('keeps a custom amount', () => {
        const p = servingParam({ servingId: 'custom', options: from.options, defaultId: from.defaultId, custom: { text: '6', unit: 'oz' } });
        assert.equal(p, 'custom:6oz');
        assert.deepEqual(servingForType(p, to.options), { servingId: 'custom', custom: { text: '6', unit: 'oz' } });
    });

    it('carries nothing when the visitor left the default serving, or for unreadable values', () => {
        assert.equal(servingParam({ servingId: from.defaultId, options: from.options, defaultId: from.defaultId }), null);
        assert.equal(servingForType(null, to.options), null);
        assert.equal(servingForType('custom:abc', to.options), null);
        assert.equal(servingForType('<script>', to.options), null);
    });
});
