import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { METHODOLOGY_URL } from './contaminants';

const ROOT = path.join(import.meta.dirname, '..');
const DOC = path.join(ROOT, '..', 'docs', 'CONTAMINANT_DATA.md');
const page = fs.readFileSync(path.join(ROOT, 'app', 'methodology', 'page.tsx'), 'utf8');

describe('the methodology page', () => {
    it('is on this site (regression: the links went to a GitHub page that returned 404)', () => {
        assert.equal(METHODOLOGY_URL, '/methodology');
        for (const file of ['components/contaminants/ContaminantPanel.tsx', 'components/shell/SiteFooter.tsx', 'lib/contaminants.ts']) {
            assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /github\.com/, file);
        }
        assert.match(fs.readFileSync(path.join(ROOT, 'components/shell/SiteFooter.tsx'), 'utf8'), /href="\/methodology"/);
    });

    it('cites every source in docs/CONTAMINANT_DATA.md, so the two stay in step', { skip: !fs.existsSync(DOC) && 'docs not in this checkout' }, () => {
        const doc = fs.readFileSync(DOC, 'utf8').split('## For developers')[0];
        const urls = Array.from(doc.matchAll(/\]\((https?:[^)\s]+)\)/g), m => m[1]);
        assert.ok(urls.length > 20);
        for (const url of new Set(urls)) assert.ok(page.includes(url), url);
    });

    it('covers each section of that document, and none of its developer notes', { skip: !fs.existsSync(DOC) && 'docs not in this checkout' }, () => {
        const doc = fs.readFileSync(DOC, 'utf8').split('## For developers')[0];
        const headings = Array.from(doc.matchAll(/^#{1,3} (.+)$/gm), m => m[1]);
        for (const heading of headings) assert.ok(page.includes(heading), heading);
        assert.doesNotMatch(page, /extract_sources|build_contaminants|verify_data_integrity/);
    });

    it('explains the † used for values from an older USDA entry, and links people can land on it', () => {
        assert.match(page, /id="older-entries"/);
        assert.match(page, /id="similar-foods"/);
    });
});

describe('every food link goes somewhere', () => {
    it('foodHref: a page for a USDA food, the analyzer for a recipe, nothing otherwise', async () => {
        const { foodHref } = await import('./food-page');
        assert.equal(foodHref({ fdc_id: 171689, description: 'Apples, raw' }), '/food/171689-apples-raw');
        assert.equal(foodHref({
            fdc_id: -5, description: 'Recipe: Soup',
            recipe: { id: 'a b', servingGrams: 100, uncounted: [], incomplete: [], fingerprint: 'x' },
        }), '/recipes?id=a%20b');
        assert.equal(foodHref({ fdc_id: -5, description: 'Mystery' }), null);
    });
});
