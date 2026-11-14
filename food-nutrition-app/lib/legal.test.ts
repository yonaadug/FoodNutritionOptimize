import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAGIC_LINK_TTL_SECONDS } from '@/lib/auth/auth';
import { LOCAL_OWNER_KEY, PERSONAL_KEYS } from '@/lib/local-data';
import { HISTORY_LIMITS } from '@/lib/user-store/history';
import {
    BROWSER_STORAGE, CONTACT_EMAIL, COOKIES, formatLegalDate, LEGAL_DRAFT, LEGAL_EFFECTIVE_DATE, LEGAL_PATHS, MINIMUM_AGE,
    OWNER_LEGAL_NAME, PLACEHOLDERS, PLUS, POLICY_VERSIONS, RETENTION,
} from './legal';

/**
 * The legal pages promise facts about the code and the owner's decisions. These tests
 * fail when one side changes without the other.
 */

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(appDir, '..');
const read = (p: string) => readFileSync(path.join(appDir, p), 'utf8');

const PAGES = {
    privacy: 'app/privacy/page.tsx',
    healthData: 'app/health-data-privacy/page.tsx',
    terms: 'app/terms/page.tsx',
} as const;

describe('legal: one source of truth', () => {
    it('has a version for each document, marked as a draft while LEGAL_DRAFT is on', () => {
        for (const [key, version] of Object.entries(POLICY_VERSIONS)) {
            assert.match(version, /^\d{4}-\d{2}-\d{2}/, key);
            assert.equal(version.endsWith('-draft'), LEGAL_DRAFT, `${key}: drafts say so in the version`);
        }
        assert.match(LEGAL_EFFECTIVE_DATE, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(formatLegalDate('2026-11-14'), 'November 14, 2026');
    });

    it('never ships a real owner name by accident, and has no placeholders once out of draft', () => {
        if (LEGAL_DRAFT) assert.equal(OWNER_LEGAL_NAME, '[OWNER LEGAL NAME]', 'only the owner fills this in');
        assert.match(CONTACT_EMAIL, /@nutritiondictionary\.com$/);
        if (!LEGAL_DRAFT) {
            for (const p of PLACEHOLDERS) assert.ok(!p.value.startsWith('['), `fill in: ${p.what}`);
        }
        assert.ok(MINIMUM_AGE >= 13, 'COPPA: never below 13');
    });

    it('retention and Plus match the owner\'s decisions', () => {
        const decisions = readFileSync(path.join(repoDir, 'docs/DECISIONS.md'), 'utf8');
        assert.match(decisions, new RegExp(`photos deleted after ${RETENTION.photosDays} day`));
        assert.match(decisions, new RegExp(`logs kept ${RETENTION.logsDays} days`));
        assert.match(decisions, new RegExp(`backups \\(point-in-time recovery\\) ${RETENTION.backupsDays} days`));
        assert.match(decisions, new RegExp(`within ${RETENTION.backupsDays} days`));
        assert.ok(decisions.includes(`${PLUS.monthlyPrice}/month or ${PLUS.annualPrice}/year`));
        assert.match(decisions, new RegExp(`${PLUS.trialDays}-day "reverse trial" with no card`));
        assert.match(decisions, new RegExp(`Sessions:\\*\\* ${RETENTION.sessionDays} days`));
    });

    it('retention matches the code', () => {
        assert.equal(RETENTION.signInLinkMinutes * 60, MAGIC_LINK_TTL_SECONDS);
        assert.equal(RETENTION.historyItemsPerKind, HISTORY_LIMITS.itemsPerKind);
        const auth = read('lib/auth/auth.ts');
        assert.match(auth, new RegExp(`SESSION_TTL_SECONDS = ${RETENTION.sessionDays} \\* 24 \\* 60 \\* 60`));
        // Better Auth's sign-in counters are keyed by raw IP; the longest window is the magic link's.
        assert.match(auth, new RegExp(`rateLimit: \\{ window: ${RETENTION.signInRateLimitMinutes * 60}, max: \\d+ \\}`));
        assert.match(read('lib/ai/rate-limit.ts'), new RegExp(`const DAY = ${RETENTION.aiRateLimitHours} \\* 60 \\* MINUTE`));
    });

    it('lists every cookie name the auth code can set', () => {
        assert.match(read('lib/auth/auth.ts'), /cookiePrefix: 'md'/);
        const names = COOKIES.map(c => c.name);
        assert.ok(names.includes('md.session_token'));
        assert.ok(names.includes('md.state'), 'Google sign-in state');
        assert.match(read('lib/consent.ts'), /PENDING_COOKIE = 'md\.consent'/);
        assert.ok(names.includes('md.consent'));
    });

    it('lists every personal browser-storage key, so a new one can\'t go unmentioned', () => {
        const listed = new Map(BROWSER_STORAGE.map(s => [s.key, s]));
        for (const key of PERSONAL_KEYS) {
            assert.ok(listed.has(key), `${key} is missing from BROWSER_STORAGE`);
            assert.equal(listed.get(key)!.personal, true, `${key} is cleared on sign-out, so it is personal`);
        }
        assert.ok(listed.has(LOCAL_OWNER_KEY));
        assert.ok(listed.has('md.signedIn'));
        assert.ok(listed.has('theme'));
    });
});

describe('legal: pages', () => {
    for (const [policy, file] of Object.entries(PAGES)) {
        it(`${file} uses the shared frame, and every contents entry has a heading`, () => {
            const src = read(file);
            assert.ok(src.includes(`policy="${policy}"`), 'renders LegalPage for its own policy');
            const ids = [...src.matchAll(/\{ id: '([a-z-]+)', title:/g)].map(m => m[1]);
            assert.ok(ids.length >= 8, 'has a table of contents');
            for (const id of ids) assert.ok(src.includes(`id="${id}"`), `#${id} has a heading`);
            if (!LEGAL_DRAFT) assert.ok(!src.includes('<Placeholder>['), 'an inline placeholder is still unfilled');
        });
    }

    it('the frame shows the draft note, which says it is not legal advice', () => {
        assert.match(read('components/legal/LegalPage.tsx'), /<DraftNote \/>/);
        const note = read('components/legal/DraftNote.tsx');
        assert.match(note, /if \(!LEGAL_DRAFT\) return null/);
        assert.match(note, /Draft, under legal review/);
        assert.match(note, /not legal advice/);
    });

    it('the privacy policy names every processor and the backup window', () => {
        const src = read(PAGES.privacy);
        for (const name of ['Amazon Web Services', 'Amazon SES', 'Amazon Bedrock', 'Google', 'Stripe', 'Cloudflare']) {
            assert.ok(src.includes(name), name);
        }
        assert.ok(src.includes('id="backups"'));
        assert.ok(src.includes('RETENTION.backupsDays'));
        assert.ok(src.includes('https://aws.amazon.com/bedrock/faqs/'), 'cites the Bedrock no-training statement');
    });

    it('the health data policy says it doesn\'t sell', () => {
        const src = read(PAGES.healthData);
        assert.match(src, /We don&apos;t sell consumer health data/);
        assert.ok(src.includes('RCW 19.373'));
    });

    it('the terms disclose auto-renewal, the trial and cancellation', () => {
        const src = read(PAGES.terms);
        assert.match(src, /renews automatically/);
        assert.match(src, /PLUS\.trialDays/);
        assert.match(src, /Cancel any time in the subscription portal/);
        assert.match(src, /REFUND_POLICY/);
    });

    it('the footer links all three on every page', () => {
        const footer = read('components/shell/SiteFooter.tsx');
        for (const key of Object.keys(LEGAL_PATHS)) assert.ok(footer.includes(`LEGAL_PATHS.${key}`), key);
        assert.match(read('app/layout.tsx'), /<SiteFooter \/>/);
    });
});
