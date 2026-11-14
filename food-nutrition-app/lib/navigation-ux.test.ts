import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    clientNavigationTarget, locationKey, prefersReducedMotion, RecentCache, ScrollMemory, scrollBehavior, scrollTargetFor, shouldMoveFocus, skeletonFor,
    type ClickFacts,
} from './navigation-ux';

const media = (reduce: boolean) => ({ matchMedia: (q: string) => ({ matches: reduce && q.includes('reduce') }) as MediaQueryList });

describe('prefersReducedMotion', () => {
    it('follows the media query', () => {
        assert.equal(prefersReducedMotion(media(true)), true);
        assert.equal(prefersReducedMotion(media(false)), false);
    });
    it('is false without a window, or when matchMedia throws', () => {
        assert.equal(prefersReducedMotion(undefined), false);
        assert.equal(prefersReducedMotion({ matchMedia: () => { throw new Error('nope'); } }), false);
    });
    it('turns smooth scrolling off', () => {
        assert.equal(scrollBehavior(media(true)), 'auto');
        assert.equal(scrollBehavior(media(false)), 'smooth');
    });
});

describe('locationKey', () => {
    it('keeps the path, query and hash', () => {
        assert.equal(locationKey({ pathname: '/plan', search: '', hash: '#goals' }), '/plan#goals');
        assert.equal(locationKey({ pathname: '/', search: '?q=salmon', hash: '' }), '/?q=salmon');
    });
});

/** A minimal stand-in for DOM nodes: contains() walks up the parents. */
interface FakeNode { parent: FakeNode | null; isConnected: boolean; contains(o: FakeNode | null): boolean }
function node(parent: FakeNode | null = null, connected = true): FakeNode {
    const n: FakeNode = {
        parent,
        isConnected: connected,
        contains: (o: FakeNode | null) => {
            for (let x = o; x; x = x.parent) if (x === n) return true;
            return false;
        },
    };
    return n;
}
const asEl = (n: FakeNode | null) => n as unknown as Element;

describe('shouldMoveFocus', () => {
    const body = node();
    const header = node(body);
    const main = node(body);
    const headerLink = node(header);
    const search = node(main);

    it('moves focus when it was left on nothing or on a removed element', () => {
        assert.equal(shouldMoveFocus(null, asEl(main), asEl(body)), true);
        assert.equal(shouldMoveFocus(asEl(body), asEl(main), asEl(body)), true);
        assert.equal(shouldMoveFocus(asEl(node(main, false)), asEl(main), asEl(body)), true);
    });
    it('moves focus off a header link that stayed put', () => {
        assert.equal(shouldMoveFocus(asEl(headerLink), asEl(main), asEl(body)), true);
    });
    it('moves it on from the content wrapper itself', () => {
        assert.equal(shouldMoveFocus(asEl(main), asEl(main), asEl(body)), true);
    });
    it('leaves focus the new page put inside its content (the search box)', () => {
        assert.equal(shouldMoveFocus(asEl(search), asEl(main), asEl(body)), false);
    });
    it('does nothing without a content area', () => {
        assert.equal(shouldMoveFocus(null, null, asEl(body)), false);
    });
});

describe('scrollTargetFor', () => {
    it('puts Back and Forward where the page was left', () => {
        assert.equal(scrollTargetFor({ traversal: true, remembered: 640, pathChanged: true, hashTargetExists: false }), 640);
        assert.equal(scrollTargetFor({ traversal: true, remembered: undefined, pathChanged: true, hashTargetExists: false }), null);
    });
    it('starts a new page at the top, or at the element its #hash names', () => {
        assert.equal(scrollTargetFor({ traversal: false, remembered: 640, pathChanged: true, hashTargetExists: false }), 0);
        assert.equal(scrollTargetFor({ traversal: false, remembered: undefined, pathChanged: true, hashTargetExists: true }), 'hash');
    });
    it('leaves same-page changes alone (search, the planner step, the recipe id)', () => {
        assert.equal(scrollTargetFor({ traversal: false, remembered: 640, pathChanged: false, hashTargetExists: false }), null);
    });
});

describe('ScrollMemory', () => {
    it('remembers the latest position per address, rounded and never negative', () => {
        const m = new ScrollMemory();
        m.save('/a', 10.4);
        m.save('/a', 120.6);
        m.save('/b', -5);
        assert.equal(m.get('/a'), 121);
        assert.equal(m.get('/b'), 0);
        assert.equal(m.get('/c'), undefined);
    });
    it('forgets the oldest address past its limit', () => {
        const m = new ScrollMemory(2);
        m.save('/a', 1);
        m.save('/b', 2);
        m.save('/a', 3);
        m.save('/c', 4);
        assert.equal(m.get('/b'), undefined);
        assert.equal(m.get('/a'), 3);
        assert.equal(m.get('/c'), 4);
    });
});

describe('skeletonFor', () => {
    it('picks the skeleton shaped like each page that reads the database', () => {
        assert.equal(skeletonFor('/'), 'home');
        assert.equal(skeletonFor('/?q=salmon'), 'home');
        assert.equal(skeletonFor('/food/2684440-salmon-sockeye-wild-caught-raw'), 'food');
        assert.equal(skeletonFor('/food/171689'), 'food');
        assert.equal(skeletonFor('/food/category'), 'link-index');
        assert.equal(skeletonFor('/nutrients/'), 'link-index');
        assert.equal(skeletonFor('/food/category/finfish-and-shellfish-products?page=2'), 'food-list');
        assert.equal(skeletonFor('/nutrients/vitamin-d'), 'food-list');
        assert.equal(skeletonFor('/account'), 'account');
        assert.equal(skeletonFor('/account/history'), 'account');
        assert.equal(skeletonFor('/account/sign-in?next=/plan'), 'account');
    });
    it('has none for pages built ahead of time, which open at once', () => {
        for (const p of ['/plan', '/plan#goals', '/recipes', '/recipes?id=abc', '/methodology', '/accounts']) {
            assert.equal(skeletonFor(p), null, p);
        }
    });
});

describe('clientNavigationTarget', () => {
    const here = new URL('https://nano.test/food/1-apple');
    const click = (over: Partial<ClickFacts> = {}): ClickFacts => ({
        href: 'https://nano.test/food/2-pear', target: '', download: false, defaultPrevented: true, button: 0, modifier: false, ...over,
    });

    it('returns the address of a link the router is handling', () => {
        assert.equal(clientNavigationTarget(click(), here)?.pathname, '/food/2-pear');
        assert.equal(clientNavigationTarget(click({ href: 'https://nano.test/food/1-apple?x=1' }), here)?.search, '?x=1');
    });
    it('ignores links the browser handles: not prevented, new tabs, downloads, modifier keys, other buttons', () => {
        assert.equal(clientNavigationTarget(click({ defaultPrevented: false }), here), null);
        assert.equal(clientNavigationTarget(click({ target: '_blank' }), here), null);
        assert.equal(clientNavigationTarget(click({ download: true }), here), null);
        assert.equal(clientNavigationTarget(click({ modifier: true }), here), null);
        assert.equal(clientNavigationTarget(click({ button: 1 }), here), null);
    });
    it('ignores other sites and the same page (a #hash, like the skip link)', () => {
        assert.equal(clientNavigationTarget(click({ href: 'https://fdc.nal.usda.gov/x' }), here), null);
        assert.equal(clientNavigationTarget(click({ href: 'https://nano.test/food/1-apple#main' }), here), null);
        assert.equal(clientNavigationTarget(click({ href: 'not a url' }), here), null);
    });
});

describe('RecentCache', () => {
    it('returns what was stored and evicts the least recently stored', () => {
        const c = new RecentCache<number>(2);
        c.set('x', 1);
        c.set('y', 2);
        c.set('z', 3);
        assert.equal(c.get('x'), undefined);
        assert.equal(c.get('y'), 2);
        assert.equal(c.get('z'), 3);
    });
});
