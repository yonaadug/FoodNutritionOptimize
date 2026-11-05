import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteUrl, isNavActive, NAV_ITEMS, SITE_URL } from './nav';

const item = (label: string) => NAV_ITEMS.find(i => i.label === label)!;

describe('NAV_ITEMS', () => {
    it('lists the sections in order, foods first', () => {
        assert.deepEqual(NAV_ITEMS.map(i => [i.label, i.href]), [['Foods', '/'], ['Plan', '/plan'], ['Recipes', '/recipes'], ['Account', '/account']]);
    });
});

describe('isNavActive', () => {
    it('treats food and nutrient pages as part of Foods', () => {
        for (const p of ['/', '/food/123-salmon', '/food/category', '/nutrients/iron']) {
            assert.equal(isNavActive(item('Foods'), p), true, p);
        }
    });
    it('does not light Foods up elsewhere', () => {
        for (const p of ['/plan', '/recipes', '/account/settings', '/foodie']) {
            assert.equal(isNavActive(item('Foods'), p), false, p);
        }
    });
    it('matches a section and its sub-pages, not lookalikes', () => {
        assert.equal(isNavActive(item('Plan'), '/plan'), true);
        assert.equal(isNavActive(item('Plan'), '/plan/'), true);
        assert.equal(isNavActive(item('Plan'), '/plan#goals'), true);
        assert.equal(isNavActive(item('Plan'), '/planner'), false);
        assert.equal(isNavActive(item('Account'), '/account/settings'), true);
    });
    it('copes with a missing path', () => {
        assert.equal(isNavActive(item('Foods'), null), true);
        assert.equal(isNavActive(item('Plan'), undefined), false);
    });
});

describe('absoluteUrl', () => {
    it('joins the site origin and a path', () => {
        assert.equal(absoluteUrl('/plan'), `${SITE_URL}/plan`);
        assert.equal(absoluteUrl('plan'), `${SITE_URL}/plan`);
        assert.ok(!SITE_URL.endsWith('/'));
    });
});
