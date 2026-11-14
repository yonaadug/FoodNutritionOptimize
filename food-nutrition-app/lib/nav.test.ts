import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { absoluteUrl, isAccountPath, isNavActive, NAV_ITEMS, SITE_URL } from './nav';

const item = (label: string) => NAV_ITEMS.find(i => i.label === label)!;

describe('NAV_ITEMS', () => {
    it('lists the sections in order, foods first', () => {
        assert.deepEqual(NAV_ITEMS.map(i => [i.label, i.href]), [['Foods', '/'], ['Plan', '/plan'], ['Recipes', '/recipes']]);
    });
    it('leaves account pages to the account menu, so none of the sections light up there', () => {
        for (const p of ['/account', '/account/history', '/account/sign-in']) {
            assert.deepEqual(NAV_ITEMS.filter(i => isNavActive(i, p)), [], p);
        }
    });
});

describe('isNavActive', () => {
    it('treats food and nutrient pages as part of Foods', () => {
        for (const p of ['/', '/?q=salmon', '/food/123-salmon', '/food/category', '/food/category/finfish-and-shellfish-products', '/nutrients', '/nutrients/iron', '/methodology', '/methodology#sources']) {
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
        assert.equal(isNavActive(item('Recipes'), '/recipes/saved'), true);
    });
    it('copes with a missing path', () => {
        assert.equal(isNavActive(item('Foods'), null), true);
        assert.equal(isNavActive(item('Plan'), undefined), false);
    });
});

describe('isAccountPath', () => {
    it('covers every account page, nested ones included', () => {
        for (const p of ['/account', '/account/', '/account/history', '/account/sign-in', '/account/sign-in?next=/plan', '/account/sign-in/confirm']) {
            assert.equal(isAccountPath(p), true, p);
        }
    });
    it('is false elsewhere, including lookalikes', () => {
        for (const p of ['/', '/accounts', '/plan', '/food/1-account', null, undefined]) {
            assert.equal(isAccountPath(p), false, String(p));
        }
    });
    it('never overlaps a header section, so only one thing is marked current', () => {
        for (const p of ['/account/history', '/account/sign-in']) {
            assert.equal(isAccountPath(p) && NAV_ITEMS.some(i => isNavActive(i, p)), false, p);
        }
    });
});

describe('absoluteUrl', () => {
    it('joins the site origin and a path', () => {
        assert.equal(absoluteUrl('/plan'), `${SITE_URL}/plan`);
        assert.equal(absoluteUrl('plan'), `${SITE_URL}/plan`);
        assert.ok(!SITE_URL.endsWith('/'));
    });
});
