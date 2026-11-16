import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fillFromOlderEntries, filledKeys, olderEntrySources } from './nutrient-fill';
import { makeFood } from './testing/fixtures';

const cod = makeFood({ id: 1, fdc_id: 2684444, description: 'Fish, cod, Atlantic, wild caught, raw', calories: 70.5, vitamin_d_ug: null, vitamin_k_ug: null, calcium_mg: 0, calories_source: 'fdc_1008_energy' });
const srCod = makeFood({ id: 2, fdc_id: 171955, description: 'Fish, cod, Atlantic, raw', calories: 82, vitamin_d_ug: 0.9, vitamin_k_ug: null, calcium_mg: 16 });

describe('fillFromOlderEntries', () => {
    it('fills a gap from the older entry and records where it came from', () => {
        const out = fillFromOlderEntries(cod, [srCod]);
        assert.equal(out.vitamin_d_ug, 0.9);
        assert.deepEqual(out.filledFrom, { vitamin_d_ug: 171955 });
    });
    it('keeps a measured 0 and leaves a gap the older entry has too', () => {
        const out = fillFromOlderEntries(cod, [srCod]);
        assert.equal(out.calcium_mg, 0);
        assert.equal(out.vitamin_k_ug, null);
        assert.equal(out.calories, 70.5, 'own calories are never replaced');
    });
    it('marks calories the build took from the older entry, without changing them', () => {
        const rutabaga = makeFood({ id: 3, fdc_id: 2685573, description: 'Rutabaga, peeled, raw', calories: 37, calories_source: 'sr_legacy_crosswalk_1008' });
        const sr = makeFood({ id: 4, fdc_id: 168454, description: 'Rutabagas, raw', calories: 37 });
        const out = fillFromOlderEntries(rutabaga, [sr]);
        assert.equal(out.calories, 37);
        assert.equal(out.filledFrom?.calories, 168454);
    });
    it('cites the older entry whose calories match when there are several', () => {
        const food = makeFood({ id: 5, fdc_id: 10, description: 'Butter, stick, salted', calories: 717, calories_source: 'sr_legacy_ndb_match_1008' });
        const out = fillFromOlderEntries(food, [makeFood({ id: 6, fdc_id: 20, description: 'a', calories: 700 }), makeFood({ id: 7, fdc_id: 30, description: 'b', calories: 717 })]);
        assert.equal(out.filledFrom?.calories, 30);
    });
    it('is safe to apply twice', () => {
        const once = fillFromOlderEntries(cod, [srCod]);
        assert.deepEqual(fillFromOlderEntries(once, [srCod]), once);
    });
});

describe('olderEntrySources', () => {
    it('groups filled values by the entry they came from, most first, nutrients in table order', () => {
        const food = { filledFrom: { vitamin_k_ug: 7, calories: 9, vitamin_d_ug: 7, choline_mg: 7, selenium_ug: 9 } };
        assert.deepEqual(olderEntrySources(food), [
            { fdcId: 7, keys: ['vitamin_d_ug', 'vitamin_k_ug', 'choline_mg'] },
            { fdcId: 9, keys: ['calories', 'selenium_ug'] },
        ]);
    });
    it('is empty for a food with nothing filled', () => {
        assert.deepEqual(olderEntrySources({}), []);
        assert.deepEqual(olderEntrySources(null), []);
    });
});

const hasDb = fs.existsSync(path.join(process.cwd(), 'nutrition.db'));

describe('filled values in nutrition.db', { skip: !hasDb && 'nutrition.db not available' }, () => {
    it('cites the SR entry for the owner’s cod example and for borrowed calories', async () => {
        const { getFoodByFdcId } = await import('./db');
        const codFood = await getFoodByFdcId(2684444);
        assert.equal(codFood?.filledFrom?.vitamin_d_ug, 171955);
        const butter = await getFoodByFdcId(790508);
        assert.equal(butter?.calories_source, 'sr_legacy_ndb_match_1008');
        assert.ok(butter?.filledFrom?.calories, 'calories from the older entry are marked');
        assert.ok(filledKeys(butter).includes('calories'));
    });
});
