import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { linkPrefetch, showsIntent } from './link-intent';

describe('showsIntent', () => {
    it('counts a mouse moving over the link', () => {
        assert.equal(showsIntent('pointerenter', 'mouse'), true);
    });
    it('counts a finger or pen touching down on it (phones have no hover)', () => {
        assert.equal(showsIntent('pointerdown', 'touch'), true);
        assert.equal(showsIntent('pointerdown', 'pen'), true);
    });
    it('counts keyboard focus', () => {
        assert.equal(showsIntent('focus'), true);
    });
    it("leaves a touch's own pointerenter to its pointerdown, and a mouse press to its pointerenter", () => {
        assert.equal(showsIntent('pointerenter', 'touch'), false);
        assert.equal(showsIntent('pointerenter', 'pen'), false);
        assert.equal(showsIntent('pointerdown', 'mouse'), false);
    });
    it('ignores a pointer of unknown type', () => {
        assert.equal(showsIntent('pointerenter', ''), false);
        assert.equal(showsIntent('pointerdown', undefined), false);
    });
});

describe('linkPrefetch', () => {
    it('fetches nothing ahead before intent, however long the link is on screen', () => {
        assert.equal(linkPrefetch(false), false);
        assert.equal(linkPrefetch(false, '_self'), false);
    });
    it('fetches the whole page after intent', () => {
        assert.equal(linkPrefetch(true), true);
        assert.equal(linkPrefetch(true, ''), true);
        assert.equal(linkPrefetch(true, '_self'), true);
    });
    it('never fetches ahead for a link that opens another tab, which loads the page itself', () => {
        assert.equal(linkPrefetch(true, '_blank'), false);
        assert.equal(linkPrefetch(true, 'help'), false);
    });
});

/**
 * Pages aren't cached in front of the server, so every link that fetches its page ahead
 * of time is a server request. next/link does that for every link on screen; IntentLink
 * waits until someone points at, focuses or touches the link. So in-app links go through
 * IntentLink, the only file allowed to import next/link.
 */
describe('in-app links go through IntentLink', () => {
    const root = process.cwd();
    const intentLink = path.join(root, 'components', 'ui', 'IntentLink.tsx');
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) files.push(full);
        }
    };
    for (const dir of ['app', 'components', 'hooks']) walk(path.join(root, dir));

    const importsNextLink = (source: string) =>
        /\bfrom\s*['"]next\/link['"]|\b(?:import|require)\s*\(\s*['"]next\/link['"]\s*\)|^\s*import\s*['"]next\/link['"]/m.test(source);

    it('finds the files to check, and recognises an import of next/link', () => {
        assert.ok(files.length > 50, `only ${files.length} files found under ${root}`);
        assert.ok(files.includes(intentLink), 'components/ui/IntentLink.tsx not found');
        assert.ok(importsNextLink(readFileSync(intentLink, 'utf8')), 'IntentLink should import next/link');
        assert.ok(importsNextLink("import NextLink, { useLinkStatus } from 'next/link';"));
        assert.ok(importsNextLink('const Link = require("next/link");'));
        assert.ok(!importsNextLink("import IntentLink from '@/components/ui/IntentLink';"));
    });

    it('has no other file importing next/link', () => {
        const offenders = files
            .filter(f => f !== intentLink && importsNextLink(readFileSync(f, 'utf8')))
            .map(f => path.relative(root, f));
        assert.deepEqual(offenders, [], 'Use IntentLink from components/ui/IntentLink.tsx for these links');
    });
});
