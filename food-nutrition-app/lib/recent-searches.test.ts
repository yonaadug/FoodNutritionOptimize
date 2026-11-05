import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanQuery, parseRecent, pushRecent, RECENT_SEARCHES_MAX, removeRecent } from './recent-searches';

describe('pushRecent', () => {
    it('puts the newest first', () => {
        assert.deepEqual(pushRecent(['oats'], 'salmon'), ['salmon', 'oats']);
    });
    it('moves a repeat to the front, ignoring case, and keeps the new spelling', () => {
        assert.deepEqual(pushRecent(['oats', 'salmon'], 'SALMON'), ['SALMON', 'oats']);
    });
    it('caps the list', () => {
        const long = Array.from({ length: RECENT_SEARCHES_MAX }, (_, i) => `food ${i}`);
        const next = pushRecent(long, 'new');
        assert.equal(next.length, RECENT_SEARCHES_MAX);
        assert.equal(next[0], 'new');
        assert.ok(!next.includes(`food ${RECENT_SEARCHES_MAX - 1}`));
    });
    it('ignores very short or blank queries', () => {
        assert.deepEqual(pushRecent(['oats'], ' a '), ['oats']);
        assert.deepEqual(pushRecent(['oats'], '   '), ['oats']);
    });
    it('does not change the list it was given', () => {
        const list = ['oats'];
        pushRecent(list, 'salmon');
        assert.deepEqual(list, ['oats']);
    });
});

describe('cleanQuery', () => {
    it('tidies whitespace and length', () => {
        assert.equal(cleanQuery('  black   beans '), 'black beans');
        assert.equal(cleanQuery('x'.repeat(200)).length, 80);
    });
});

describe('removeRecent', () => {
    it('removes regardless of case', () => {
        assert.deepEqual(removeRecent(['Oats', 'salmon'], 'oats'), ['salmon']);
    });
});

describe('parseRecent', () => {
    it('reads what was stored', () => {
        assert.deepEqual(parseRecent(JSON.stringify(['oats', 'salmon'])), ['oats', 'salmon']);
    });
    it('treats anything unexpected as empty', () => {
        for (const bad of [null, undefined, '', 'not json', '{"a":1}', '42']) {
            assert.deepEqual(parseRecent(bad), [], String(bad));
        }
    });
    it('drops entries that are not usable strings', () => {
        assert.deepEqual(parseRecent(JSON.stringify(['oats', 3, null, 'x', ' egg '])), ['oats', 'egg']);
    });
    it('applies the cap', () => {
        const stored = JSON.stringify(Array.from({ length: 30 }, (_, i) => `food ${i}`));
        assert.equal(parseRecent(stored).length, RECENT_SEARCHES_MAX);
    });
});
