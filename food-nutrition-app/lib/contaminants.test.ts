import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { FoodNotFoundError, getContaminantReportIn } from './contaminants';
import { ContaminantQueryError, parseContaminantQuery } from './contaminants-query';
import {
    MERCURY_WEEKLY_EDGES, MICROPLASTIC_PARTICLE_EDGES, REFERENCE_DAILY_EDGES,
    dataQuality, formatAmount, formatPercent, groupResidues, hazardIndexPercent, levelFor, meterPosition, percentOf, perServing,
    referenceAmount, servingsLine, type ContaminantItem, type ContaminantReport, type ResidueInput,
} from './contaminants-meter';

const FULL_DB = path.resolve(process.cwd(), 'nutrition.db');

describe('meter levels', () => {
    it('applies daily edges at their boundaries', () => {
        assert.equal(levelFor(0, REFERENCE_DAILY_EDGES), 'low');
        assert.equal(levelFor(9.99, REFERENCE_DAILY_EDGES), 'low');
        assert.equal(levelFor(10, REFERENCE_DAILY_EDGES), 'moderate');
        assert.equal(levelFor(25, REFERENCE_DAILY_EDGES), 'elevated');
        assert.equal(levelFor(50, REFERENCE_DAILY_EDGES), 'high');
    });

    it('keeps mercury in step with the FDA/EPA fish advice for a 4 oz serving', () => {
        const weekly = referenceAmount({ value: 0.7, per_kg_bw: 1, body_weight_kg: 75 });
        assert.equal(weekly, 52.5);
        const pctAt = (ppm: number) => percentOf(perServing(ppm * 1000, 113, null), weekly)!;
        // Top of "Best Choices" stays below elevated, top of "Good Choices" stays below high.
        assert.equal(levelFor(pctAt(0.15), MERCURY_WEEKLY_EDGES), 'moderate');
        assert.equal(levelFor(pctAt(0.46), MERCURY_WEEKLY_EDGES), 'elevated');
        assert.equal(levelFor(pctAt(0.47), MERCURY_WEEKLY_EDGES), 'high');
    });

    it('rates microplastics by particle count', () => {
        assert.equal(levelFor(9, MICROPLASTIC_PARTICLE_EDGES), 'low');
        assert.equal(levelFor(200, MICROPLASTIC_PARTICLE_EDGES), 'high');
    });

    it('maps a value to a marker on a four-segment bar', () => {
        assert.equal(meterPosition(0, REFERENCE_DAILY_EDGES), 0);
        assert.equal(meterPosition(5, REFERENCE_DAILY_EDGES), 12.5);
        assert.equal(meterPosition(10, REFERENCE_DAILY_EDGES), 25);
        assert.equal(meterPosition(50, REFERENCE_DAILY_EDGES), 75);
        assert.equal(meterPosition(100, REFERENCE_DAILY_EDGES), 100);
        assert.equal(meterPosition(5000, REFERENCE_DAILY_EDGES), 100);
    });
});

describe('amounts', () => {
    it('computes per-serving amounts and applies the moisture factor', () => {
        assert.equal(perServing(100, 50, null), 5);
        assert.equal(perServing(100, 50, 2), 10);
    });

    it('computes reference amounts with and without body weight', () => {
        assert.equal(referenceAmount({ value: 8.8, per_kg_bw: 0, body_weight_kg: 80 }), 8.8);
        assert.ok(Math.abs(referenceAmount({ value: 0.21, per_kg_bw: 1, body_weight_kg: 80 }) - 16.8) < 1e-9);
    });

    it('rejects a zero allowance rather than dividing by it', () => {
        assert.equal(percentOf(1, 0), null);
    });

    it('formats small and large numbers for display', () => {
        assert.equal(formatAmount(0), '0');
        assert.equal(formatAmount(0.00123), '0.0012');
        assert.equal(formatAmount(1234.5), '1235');
        assert.equal(formatPercent(0.4), 'under 1%');
        assert.equal(formatPercent(32.4), '32%');
    });

    it('says how many servings fit, and stays quiet when the number means nothing', () => {
        assert.equal(servingsLine(1, 'day'), null);
        assert.match(servingsLine(32, 'week')!, /About 3 servings a week/);
        assert.match(servingsLine(150, 'day')!, /more than the whole day's/);
    });
});

describe('data quality', () => {
    it('grades from samples, match confidence and age', () => {
        assert.equal(dataQuality({ samples: 27, confidence: 0.92, yearEnd: 2020 }), 'good');
        assert.equal(dataQuality({ samples: 3, confidence: 0.92, yearEnd: 2020 }), 'limited');
        assert.equal(dataQuality({ samples: 27, confidence: 0.5, yearEnd: 2020 }), 'limited');
        assert.equal(dataQuality({ samples: 89, confidence: 0.9, yearEnd: 1978 }), 'limited');
        assert.equal(dataQuality({ samples: 27, confidence: 0.92, yearEnd: 2008 }), 'fair');
    });

    it('caps moisture-scaled values at fair', () => {
        assert.equal(dataQuality({ samples: 27, confidence: 0.92, yearEnd: 2020, moistureAdjusted: true }), 'fair');
    });
});

describe('pesticide residues', () => {
    const row = (name: string, parentName: string, role: string, meanUgPerKg: number, allowanceUgPerDay: number | null = 1000): ResidueInput =>
        ({ contaminantId: `pesticide:${name}`, name, parentName, role, meanUgPerKg, maxUgPerKg: meanUgPerKg * 2, detectionFrequency: 0.5, allowanceUgPerDay });

    it('uses a reported total instead of adding its parts', () => {
        const [g] = groupResidues([
            row('Permethrin cis', 'Permethrin', 'part', 40),
            row('Permethrin trans', 'Permethrin', 'part', 60),
            row('Permethrin Total', 'Permethrin', 'total', 100),
        ], 1000);
        assert.equal(g.amountUg, 100);
    });

    it('adds parts and metabolites when there is no total', () => {
        const [g] = groupResidues([row('Imidacloprid', 'Imidacloprid', 'parent', 10), row('Imidacloprid urea', 'Imidacloprid', 'metabolite', 5)], 1000);
        assert.equal(g.amountUg, 15);
    });

    it('sums shares across pesticides and leaves unrated ones out of the index', () => {
        const groups = groupResidues([row('A', 'A', 'parent', 100, 100), row('B', 'B', 'parent', 100, 1000), row('C', 'C', 'parent', 100, null)], 100);
        assert.equal(hazardIndexPercent(groups), 11);
        assert.equal(groups.find(g => g.name === 'C')!.percent, null);
    });
});

describe('query validation', () => {
    const parse = (q: string) => parseContaminantQuery(new URLSearchParams(q));
    const rejects = (q: string) => assert.throws(() => parse(q), ContaminantQueryError);

    it('accepts valid input', () => {
        assert.deepEqual(parse('fdcId=123&grams=85.5'), { fdcId: 123, grams: 85.5 });
        assert.deepEqual(parse('fdcId=123'), { fdcId: 123 });
    });

    it('rejects bad input', () => {
        rejects('');
        rejects('fdcId=abc');
        rejects('fdcId=-1');
        rejects('fdcId=0');
        rejects('fdcId=1%20OR%201=1');
        rejects('fdcId=99999999999999');
        rejects('fdcId=1&grams=0');
        rejects('fdcId=1&grams=-5');
        rejects('fdcId=1&grams=abc');
        rejects('fdcId=1&grams=1e9');
        rejects('fdcId=1&grams=5001');
    });
});

function fixtureDb(file: string, withTables: boolean): void {
    const db = new Database(file);
    db.exec(`
        CREATE TABLE foods (id INTEGER PRIMARY KEY, fdc_id INTEGER UNIQUE, description TEXT, food_category TEXT, calories REAL);
        CREATE TABLE serving_sizes (id INTEGER PRIMARY KEY, food_id INTEGER, label TEXT, weight_g REAL);
        INSERT INTO foods VALUES (1, 100, 'Egg, whole, raw', 'Dairy and Egg Products', 143), (2, 200, 'Egg, whole, dried', 'Dairy and Egg Products', 600),
                                 (3, 300, 'Unmatched food', 'Other', 50), (4, 400, 'Fish, cod, raw', 'Finfish and Shellfish Products', 80);
        INSERT INTO serving_sizes VALUES (1, 1, '1 large', 50);
    `);
    if (withTables) {
        db.exec(`
            CREATE TABLE contaminant_sources (id TEXT PRIMARY KEY, name TEXT, publisher TEXT, year TEXT, citation TEXT, url TEXT, retrieved TEXT, license TEXT);
            CREATE TABLE contaminant_reference_values (id TEXT PRIMARY KEY, contaminant TEXT, value REAL, unit TEXT, period TEXT, per_kg_bw INTEGER,
                body_weight_kg REAL, population TEXT, basis TEXT, why_chosen TEXT, authority TEXT, year TEXT, source_id TEXT, is_default INTEGER, notes TEXT);
            CREATE TABLE contaminants (id TEXT PRIMARY KEY, name TEXT, grp TEXT, reference_id TEXT, parent_name TEXT, role TEXT);
            CREATE TABLE contaminant_profiles (id TEXT PRIMARY KEY, family TEXT, source_id TEXT, source_code TEXT, name TEXT, moisture_ref_fdc_id INTEGER,
                samples_total INTEGER, samples_detected INTEGER, samples_over_tolerance INTEGER, samples_no_tolerance INTEGER, analytes_tested INTEGER,
                year_start INTEGER, year_end INTEGER, notes TEXT);
            CREATE TABLE contaminant_measurements (profile_id TEXT, contaminant_id TEXT, statistic TEXT, value REAL, unit TEXT, upper_bound REAL, median REAL,
                low REAL, high REAL, detection_frequency REAL, n_samples INTEGER, n_detected INTEGER, reporting_limit REAL, year_start INTEGER, year_end INTEGER,
                source_id TEXT, notes TEXT, PRIMARY KEY (profile_id, contaminant_id));
            CREATE TABLE food_contaminant_profiles (fdc_id INTEGER, profile_id TEXT, family TEXT, match_method TEXT, confidence REAL, rule TEXT,
                moisture_factor REAL, caveat TEXT, PRIMARY KEY (fdc_id, profile_id));
            INSERT INTO contaminant_sources VALUES ('fda_tds_2018_2020', 'FDA TDS', 'FDA', '2022', 'cite', 'https://fda.example/tds', '2026-11-04', 'public domain'),
                ('fda_lead_irl', 'FDA IRL', 'FDA', '2022', 'cite', 'https://fda.example/irl', '2026-11-04', 'public domain');
            INSERT INTO contaminant_reference_values VALUES
                ('lead_irl', 'lead', 8.8, 'ug/day', 'day', 0, 80, 'Women of childbearing age', 'IRL', NULL, 'US FDA', '2022', 'fda_lead_irl', 1, NULL),
                ('lead_child', 'lead', 2.2, 'ug/day', 'day', 0, 16, 'Children', 'IRL', NULL, 'US FDA', '2022', 'fda_lead_irl', 0, NULL),
                ('cd', 'cadmium', 0.21, 'ug/kg-bw/day', 'day', 1, 80, 'General population', 'TRV', NULL, 'US FDA', '2023', 'fda_lead_irl', 1, NULL),
                ('ias', 'arsenic_inorganic', 0.06, 'ug/kg-bw/day', 'day', 1, 80, 'General population', 'RfD', NULL, 'US EPA', '2025', 'fda_lead_irl', 1, NULL);
            INSERT INTO contaminants VALUES ('lead', 'Lead', 'heavy_metal', 'lead_irl', NULL, NULL), ('cadmium', 'Cadmium', 'heavy_metal', 'cd', NULL, NULL),
                ('arsenic_total', 'Total arsenic', 'heavy_metal', 'ias', NULL, NULL);
            INSERT INTO contaminant_profiles (id, family, source_id, source_code, name, samples_total, year_start, year_end) VALUES
                ('tds:37', 'tds', 'fda_tds_2018_2020', '37', 'Eggs, hard-boiled', 27, 2017, 2020),
                ('tds:387', 'tds', 'fda_tds_2018_2020', '387', 'Cod, baked', 27, 2017, 2020);
            INSERT INTO contaminant_measurements (profile_id, contaminant_id, statistic, value, unit, upper_bound, high, detection_frequency, n_samples, n_detected, reporting_limit, year_start, year_end, source_id) VALUES
                ('tds:37', 'lead', 'mean', 10, 'ug/kg', 11, 40, 0.5, 27, 13, 2, 2017, 2020, 'fda_tds_2018_2020'),
                ('tds:37', 'cadmium', 'mean', 0, 'ug/kg', 1, 0, 0, 27, 0, 1, 2017, 2020, 'fda_tds_2018_2020'),
                ('tds:37', 'arsenic_total', 'mean', 4, 'ug/kg', 5, 8, 0.2, 27, 5, 1, 2017, 2020, 'fda_tds_2018_2020'),
                ('tds:387', 'arsenic_total', 'mean', 2000, 'ug/kg', 2000, 5000, 1, 27, 27, 1, 2017, 2020, 'fda_tds_2018_2020');
            INSERT INTO food_contaminant_profiles VALUES (100, 'tds:37', 'tds', 'description_rule', 0.92, 'x', NULL, NULL),
                (200, 'tds:37', 'tds', 'description_rule', 0.7, 'x', 3.8, NULL),
                (400, 'tds:387', 'tds', 'description_rule', 0.9, 'x', NULL, NULL);
        `);
    }
    db.close();
}

describe('contaminant report', () => {
    let tmp: string;
    let db: Database.Database;
    let bare: Database.Database;
    const item = (report: ContaminantReport, id: string): ContaminantItem =>
        report.groups.flatMap(g => g.items).find(i => i.id === id)!;

    before(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contaminants-'));
        fixtureDb(path.join(tmp, 'a.db'), true);
        fixtureDb(path.join(tmp, 'b.db'), false);
        db = new Database(path.join(tmp, 'a.db'), { readonly: true });
        bare = new Database(path.join(tmp, 'b.db'), { readonly: true });
    });
    after(() => {
        db.close();
        bare.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('throws for an unknown food', () => {
        assert.throws(() => getContaminantReportIn(db, 999, 50), FoodNotFoundError);
    });

    it('reports amounts, percent of reference and the meter', () => {
        const lead = item(getContaminantReportIn(db, 100, 100), 'lead');
        assert.equal(lead.status, 'measured');
        assert.equal(lead.perServing!.amount, 1);
        assert.ok(Math.abs(lead.percentOfReference! - (1 / 8.8) * 100) < 1e-9);
        assert.equal(lead.meter!.level, 'moderate');
        assert.match(lead.meter!.text, /Lead: moderate/);
        assert.equal(lead.quality!.samples, 27);
        assert.equal(lead.sources[0].url, 'https://fda.example/tds');
        assert.equal(lead.basedOn!.name, 'Eggs, hard-boiled');
    });

    it('also shows the stricter children\'s lead level', () => {
        const lead = item(getContaminantReportIn(db, 100, 100), 'lead');
        assert.equal(lead.alternates.length, 1);
        assert.ok(Math.abs(lead.alternates[0].percent - (1 / 2.2) * 100) < 1e-9);
    });

    it('never reports a non-detect as zero', () => {
        const cd = item(getContaminantReportIn(db, 100, 100), 'cadmium');
        assert.equal(cd.status, 'not_detected');
        assert.equal(cd.perServing!.amount, null);
        assert.equal(cd.perServing!.upperBound, 0.1);
        assert.match(cd.explanation, /Not detected in all 27 samples/);
    });

    it('marks missing data explicitly, with no numbers', () => {
        const report = getContaminantReportIn(db, 300, 100);
        assert.equal(report.hasData, false);
        assert.equal(report.available, true);
        for (const i of report.groups.flatMap(g => g.items)) {
            assert.equal(i.status, 'no_data');
            assert.equal(i.perServing, null);
            assert.equal(i.meter, null);
            assert.equal(i.percentOfReference, null);
        }
    });

    it('shares one profile between foods and applies each food\'s moisture factor', () => {
        const raw = item(getContaminantReportIn(db, 100, 100), 'lead');
        const dried = item(getContaminantReportIn(db, 200, 100), 'lead');
        assert.equal(raw.basedOn!.profileId, dried.basedOn!.profileId);
        assert.equal(raw.basedOn!.sharedWith, 2);
        assert.ok(Math.abs(dried.perServing!.amount! - 3.8) < 1e-9);
        assert.equal(dried.quality!.moistureAdjusted, true);
        assert.ok(dried.caveats.some(c => c.includes('Scaled up')));
    });

    it('counts total arsenic as an upper bound outside seafood', () => {
        const as = item(getContaminantReportIn(db, 100, 100), 'arsenic');
        assert.equal(as.upperBoundOnly, true);
        assert.ok(as.percentOfReference !== null);
        assert.match(as.explanation, /At most/);
    });

    it('does not rate total arsenic in seafood', () => {
        const as = item(getContaminantReportIn(db, 400, 100), 'arsenic');
        assert.equal(as.status, 'not_rated');
        assert.equal(as.meter, null);
        assert.equal(as.percentOfReference, null);
        assert.equal(as.perServing!.amount, 200);
    });

    it('falls back to a typical serving when grams is missing', () => {
        const report = getContaminantReportIn(db, 100);
        assert.equal(report.serving.source, 'typical');
        assert.equal(report.serving.grams, 50);
    });

    it('treats a database without contaminant tables as unavailable', () => {
        const report = getContaminantReportIn(bare, 100, 50);
        assert.equal(report.available, false);
        assert.deepEqual(report.groups, []);
    });

    it('is not open to SQL injection through the id', () => {
        const hostile = '100 OR 1=1' as unknown as number;
        assert.throws(() => getContaminantReportIn(db, hostile, 50), FoodNotFoundError);
    });
});

describe('real database', () => {
    const skip = !fs.existsSync(FULL_DB) || fs.statSync(FULL_DB).size < 1_000_000;
    let db: Database.Database;
    const has = (d: Database.Database) => (d.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name = 'contaminant_profiles'`).get() as { n: number }).n > 0;
    const fdc = (description: string) => (db.prepare('SELECT fdc_id FROM foods WHERE description = ?').get(description) as { fdc_id: number }).fdc_id;
    const profile = (description: string, family: string) => (db.prepare(
        `SELECT profile_id FROM food_contaminant_profiles WHERE fdc_id = ? AND family = ?`).get(fdc(description), family) as { profile_id: string } | undefined)?.profile_id;

    before(() => {
        if (!skip) db = new Database(FULL_DB, { readonly: true });
    });
    after(() => db?.close());

    it('points egg varieties at one shared profile', { skip }, () => {
        if (!has(db)) return;
        assert.equal(profile('Eggs, Grade A, Large, egg whole', 'tds'), 'tds:37');
        assert.equal(profile('Egg, whole, raw, fresh', 'tds'), 'tds:37');
        assert.equal(profile('Egg, whole, cooked, scrambled', 'tds'), 'tds:37');
    });

    it('rates swordfish well above salmon for mercury', { skip }, () => {
        if (!has(db)) return;
        const merc = (d: string) => getContaminantReportIn(db, fdc(d), 113).groups[0].items.find(i => i.id === 'mercury')!;
        assert.equal(merc('Fish, swordfish, cooked, dry heat').meter!.level, 'high');
        assert.equal(merc('Fish, salmon, Atlantic, farmed, cooked, dry heat').meter!.level, 'low');
    });

    it('never links organ meats to muscle-meat data', { skip }, () => {
        if (!has(db)) return;
        const rows = db.prepare(`SELECT f.description FROM food_contaminant_profiles l JOIN foods f ON f.fdc_id = l.fdc_id
            WHERE l.family = 'tds' AND f.food_category IN ('Beef Products', 'Pork Products') AND lower(f.description) LIKE '%, liver%'`).all();
        assert.deepEqual(rows, []);
    });
});
