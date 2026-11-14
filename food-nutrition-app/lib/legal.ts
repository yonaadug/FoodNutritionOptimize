/**
 * One source of truth for the legal pages (/privacy, /health-data-privacy, /terms), the
 * consent asked for at sign-in (lib/consent.ts) and docs/LEGAL.md.
 *
 * DRAFTS. Everything these pages say was written from the code and docs/DECISIONS.md for
 * a lawyer to review. It is not legal advice. While LEGAL_DRAFT is true every page says so.
 *
 * Changing a policy:
 *   1. Edit the page.
 *   2. Bump its version below (and LEGAL_EFFECTIVE_DATE). Accounts that agreed to an older
 *      version are asked again the next time they sign in (lib/consent.ts).
 *   3. Update docs/LEGAL.md if the facts changed.
 *
 * No runtime imports, so client components and tests can use it freely.
 */

/** While true, every legal page and the sign-in form show "Draft, under legal review". */
export const LEGAL_DRAFT = true;

/** When the current versions take effect. ISO date. Set the real date at launch. */
export const LEGAL_EFFECTIVE_DATE = '2026-11-14';

/**
 * The version of each document a person agrees to. Any change here asks every account
 * to agree again at its next sign-in. Format: date, plus "-draft" while LEGAL_DRAFT.
 */
export const POLICY_VERSIONS = {
    terms: '2026-11-14-draft',
    privacy: '2026-11-14-draft',
    healthData: '2026-11-14-draft',
} as const;

export type PolicyKey = keyof typeof POLICY_VERSIONS;
export type PolicyVersions = { [K in PolicyKey]: string };

/**
 * The youngest age allowed to make an account. 13 follows COPPA in the US. Whether the
 * EU should be 16 (GDPR Art. 8), and whether the whole site should be 18 (the roadmap's
 * "no targets for under-18s"), is a question for the lawyer: docs/LEGAL.md.
 */
export const MINIMUM_AGE = 13;

/**
 * Where privacy requests go. PLACEHOLDER: the owner must create this address (or a
 * forwarding rule to their own inbox) before launch. Nothing receives it today.
 */
export const CONTACT_EMAIL = 'privacy@nutritiondictionary.com';

/** PLACEHOLDER: the person or company that runs the site. Never put a real name here without the owner. */
export const OWNER_LEGAL_NAME = '[OWNER LEGAL NAME]';

/** PLACEHOLDER: a postal address for legal notices, if the lawyer says one is needed. */
export const OWNER_POSTAL_ADDRESS = '[OWNER POSTAL ADDRESS, IF REQUIRED]';

/** PLACEHOLDER: which law governs the terms and where disputes go. */
export const GOVERNING_LAW = '[GOVERNING LAW AND VENUE]';

/** PLACEHOLDER: the refund policy for Plus. */
export const REFUND_POLICY = '[REFUND POLICY: TO BE DECIDED WITH YOUR LAWYER]';

/** PLACEHOLDER: an EU/UK representative (GDPR Art. 27), if the lawyer says one is needed. */
export const EU_UK_REPRESENTATIVE = '[EU AND UK REPRESENTATIVE, IF REQUIRED]';

/** Every placeholder the owner must fill before LEGAL_DRAFT can be turned off. */
export const PLACEHOLDERS: readonly { value: string; what: string }[] = [
    { value: OWNER_LEGAL_NAME, what: 'The legal name of the person or company that runs the site' },
    { value: OWNER_POSTAL_ADDRESS, what: 'A postal address for legal notices, if required' },
    { value: GOVERNING_LAW, what: 'Governing law and where disputes are heard' },
    { value: REFUND_POLICY, what: 'The Plus refund policy' },
    { value: EU_UK_REPRESENTATIVE, what: 'An EU and UK representative (GDPR Art. 27), if required' },
    { value: CONTACT_EMAIL, what: 'Set up this mailbox or forwarding (it is a real address the owner must create)' },
];

export const LEGAL_PATHS = {
    privacy: '/privacy',
    healthData: '/health-data-privacy',
    terms: '/terms',
} as const;

export const POLICY_TITLES: Record<PolicyKey, string> = {
    terms: 'Terms of Use',
    privacy: 'Privacy Policy',
    healthData: 'Consumer Health Data Privacy Policy',
};

/**
 * How long things are kept. Retention for photos, logs and backups is the owner's
 * decision of 2026-11-14 (docs/DECISIONS.md); lib/legal.test.ts checks they still match.
 * The rest comes from the code (lib/auth/auth.ts, lib/auth/rate-limit.ts, lib/ai/rate-limit.ts).
 */
export const RETENTION = {
    /** Uploaded photos. The app sends them straight to the AI and doesn't save them; this is the ceiling. */
    photosDays: 1,
    /** Server logs (CloudWatch). */
    logsDays: 14,
    /** DynamoDB point-in-time recovery: deleted data can stay in backups this long. */
    backupsDays: 35,
    /** Sessions, renewed at most once a day while used. */
    sessionDays: 30,
    /** Sign-in links. */
    signInLinkMinutes: 15,
    /** History items per kind (foods, recipes, plans) before the oldest are removed. */
    historyItemsPerKind: 500,
    /** The per-IP counters the recipe reader keeps in server memory. */
    aiRateLimitHours: 24,
    /** Better Auth's sign-in rate-limit counters, which are keyed by IP address. */
    signInRateLimitMinutes: 5,
    /** The short-lived cookie that carries the boxes ticked on the sign-in page to the account. */
    consentCookieMinutes: 30,
} as const;

/** Plus, as decided on 2026-11-14 (docs/DECISIONS.md). Keep in step with the billing code. */
export const PLUS = {
    monthlyPrice: '$5.99',
    annualPrice: '$39.99',
    trialDays: 14,
} as const;

export interface StorageEntry {
    key: string;
    what: string;
    /** Cleared on sign-out, account deletion or a different person signing in (lib/local-data.ts). */
    personal: boolean;
}

/**
 * Everything the site keeps in the browser's localStorage. lib/legal.test.ts checks that
 * every key in lib/local-data.ts's PERSONAL_KEYS is listed, so a new key can't go unmentioned.
 */
export const BROWSER_STORAGE: readonly StorageEntry[] = [
    { key: 'theme', what: 'Light or dark mode', personal: false },
    { key: 'md.signedIn', what: 'A hint that this browser is signed in, so pages don\'t ask the server when nobody is', personal: false },
    { key: 'md.localOwner', what: 'Which account the data in this browser belongs to', personal: false },
    { key: 'selectedFoods', what: 'Foods you added to the planner', personal: true },
    { key: 'guaranteedFoods', what: 'Fixed amounts you set in the planner', personal: true },
    { key: 'foodConstraints', what: 'Per-food limits you set in the planner', personal: true },
    { key: 'nc.goals.v2', what: 'Your planner goals: preset, nutrient goals, calories, portion size', personal: true },
    { key: 'nc.plan.v1', what: 'Your last plan', personal: true },
    { key: 'nc.step', what: 'Which planner step you were on', personal: true },
    { key: 'customConstraints', what: 'Planner goals saved by an older version of the site', personal: true },
    { key: 'minCalories', what: 'Calorie range saved by an older version of the site', personal: true },
    { key: 'maxCalories', what: 'Calorie range saved by an older version of the site', personal: true },
    { key: 'recipes.recent.v1', what: 'Recipes you analyzed recently, with their ingredients', personal: true },
    { key: 'mnd.recentSearches.v1', what: 'Your recent food searches', personal: true },
];

export interface CookieEntry {
    name: string;
    what: string;
    lasts: string;
}

/** Cookies. All first-party and strictly necessary; there are no advertising or analytics cookies. */
export const COOKIES: readonly CookieEntry[] = [
    {
        name: 'md.session_token',
        what: 'Keeps you signed in. Called __Secure-md.session_token on the live site. Scripts can\'t read it (httpOnly)',
        lasts: `${RETENTION.sessionDays} days, renewed while you use the site; removed when you sign out`,
    },
    {
        name: 'md.state',
        what: 'Protects the Google sign-in step against forgery. Only set if you choose Google',
        lasts: '5 minutes',
    },
    {
        name: 'md.consent',
        what: 'Carries the boxes you ticked on the sign-in page to your account once you finish signing in. Holds the policy versions and the time, signed so it can\'t be altered',
        lasts: `${RETENTION.consentCookieMinutes} minutes, or until you finish signing in`,
    },
];

/** "14 November 2026" for an ISO date, in UTC so the server and browser agree. */
export function formatLegalDate(iso: string): string {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
