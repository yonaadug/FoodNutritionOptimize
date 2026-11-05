import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { historySummary, isSafeHref } from './history-summary';

describe('historySummary', () => {
    it('shows known nutrients, per serving when the keys say so', () => {
        assert.deepEqual(historySummary({ caloriesPerServing: 320.4, proteinPerServing: 18.25 }), [
            { label: 'Calories', value: '320 kcal per serving' },
            { label: 'Protein', value: '18.3 g per serving' },
        ]);
    });

    it('understands plain keys, an explicit perServing flag and aliases', () => {
        assert.deepEqual(historySummary({ kcal: 208, fat: 13, fibre: 0 }), [
            { label: 'Calories', value: '208 kcal' },
            { label: 'Fat', value: '13 g' },
            { label: 'Fiber', value: '0 g' },
        ]);
        assert.deepEqual(historySummary({ protein: 5, perServing: true }), [{ label: 'Protein', value: '5 g per serving' }]);
    });

    it('prefers a ready-made summary, capped and checked', () => {
        const summary = [{ label: 'Iron', value: '2.1 mg' }, { label: 5, value: 'x' }, ...Array.from({ length: 8 }, (_, i) => ({ label: `L${i}`, value: 'v' }))];
        const facts = historySummary({ summary, calories: 100 });
        assert.equal(facts.length, 5);
        assert.deepEqual(facts[0], { label: 'Iron', value: '2.1 mg' });
        assert.ok(!facts.some(f => f.label === 'Calories'));
    });

    it('shows nothing for missing or unusable data', () => {
        for (const data of [null, undefined, 'x', 5, [], {}, { calories: 'many' }, { calories: Number.NaN }]) assert.deepEqual(historySummary(data), []);
    });
});

describe('isSafeHref', () => {
    it('only allows paths on this site', () => {
        for (const href of ['/', '/food/1']) assert.equal(isSafeHref(href), true);
        for (const href of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '', null]) assert.equal(isSafeHref(href), false);
    });
});
