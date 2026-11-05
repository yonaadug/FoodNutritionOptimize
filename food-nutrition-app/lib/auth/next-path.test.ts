import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { afterSignInPath, nextFromLocation, safeNextPath, signInPath } from './next-path';

describe('safeNextPath: only same-site relative paths', () => {
    it('keeps ordinary pages, with their query and hash', () => {
        for (const path of ['/', '/recipes', '/recipes?id=6f1c2a54-9f0b', '/plan#plan', '/?q=salmon', '/food/171689-apples-raw', '/account/history']) {
            assert.equal(safeNextPath(path), path);
        }
    });

    it('rejects anything that could leave the site', () => {
        for (const bad of [
            'https://evil.example', 'http://evil.example/recipes', '//evil.example', '///evil.example', '/\\evil.example', '\\\\evil.example',
            'javascript:alert(1)', 'data:text/html,x', 'evil.example', '', ' /recipes', '/recipes\n', '/rec\tipes', '/%2f%2fevil.example', '/%5cevil.example',
            '/%2Fevil.example', '/..//evil.example', '/recipes/../..//evil.example', '/./x', '/%2e%2e//evil.example', '/a b',
        ]) {
            assert.equal(safeNextPath(bad), '/account', JSON.stringify(bad));
        }
    });

    it('rejects non-strings and very long values', () => {
        for (const bad of [undefined, null, 42, {}, ['/recipes'], `/${'a'.repeat(600)}`]) {
            assert.equal(safeNextPath(bad), '/account');
        }
    });

    it('never returns to the sign-in pages or an API route', () => {
        for (const bad of ['/account/sign-in', '/account/sign-in?next=/x', '/account/sign-in/done?next=/x', '/account/sign-in/confirm?token=x', '/api/auth/sign-out', '/api/history']) {
            assert.equal(safeNextPath(bad), '/account', bad);
        }
    });

    it('uses the fallback it is given', () => {
        assert.equal(safeNextPath('https://evil.example', '/'), '/');
    });
});

describe('sign-in links', () => {
    it('signInPath carries the page, encoded', () => {
        assert.equal(signInPath('/recipes?id=abc'), '/account/sign-in?next=%2Frecipes%3Fid%3Dabc');
        assert.equal(signInPath('/account'), '/account/sign-in', 'the default needs no parameter');
        assert.equal(signInPath(null), '/account/sign-in');
        assert.equal(signInPath('https://evil.example'), '/account/sign-in');
    });

    it('nextFromLocation is the page someone is on, except the sign-in pages', () => {
        assert.equal(nextFromLocation({ pathname: '/recipes', search: '?id=abc', hash: '' }), '/recipes?id=abc');
        assert.equal(nextFromLocation({ pathname: '/plan', search: '', hash: '#plan' }), '/plan#plan');
        assert.equal(nextFromLocation({ pathname: '/', search: '', hash: '' }), '/');
        assert.equal(nextFromLocation({ pathname: '/account/sign-in', search: '?next=/x', hash: '' }), null);
    });

    it('afterSignInPath goes through the page that finishes signing in, keeping the destination', () => {
        assert.equal(afterSignInPath('/recipes?id=abc'), '/account/sign-in/done?next=%2Frecipes%3Fid%3Dabc');
        assert.equal(afterSignInPath('https://evil.example'), '/account/sign-in/done?next=%2Faccount');
    });
});
