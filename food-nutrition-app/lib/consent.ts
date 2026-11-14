import { createHmac, timingSafeEqual } from 'node:crypto';
import { MINIMUM_AGE, POLICY_VERSIONS, RETENTION, type PolicyKey, type PolicyVersions } from '@/lib/legal';
import type { SingleTable, TableItem } from '@/lib/user-store/table';
import { userPk } from '@/lib/user-store/user-store';

/**
 * Recorded consent: what a person agreed to and when, kept server-side under their
 * account. It holds the policy versions, the time and how it was given, and nothing about
 * where or on what device (no IP address, no user agent).
 *
 *   USER#<id>  CONSENT                 the latest agreement (read on every sign-in)
 *   USER#<id>  CONSENTLOG#<iso time>   every agreement, oldest first, as evidence
 *
 * Both sit in the user's partition, so exporting includes them (app/api/account/export)
 * and deleting the account removes them with everything else.
 *
 * The flow (docs/LEGAL.md has the reasons):
 *   1. The sign-in form asks for three ticks: Terms and Privacy Policy, age, and separate
 *      consent to consumer health data. It posts them to /api/consent, which (signed out)
 *      sets a short-lived signed cookie, PENDING_COOKIE. Sign-in requests without that
 *      cookie are refused (app/api/auth).
 *   2. After the link or Google returns, /account/sign-in/done records the pending consent
 *      against the account. If it is missing (link opened in another browser) or older than
 *      POLICY_VERSIONS, that page asks again before continuing.
 *   3. History writes are refused for an account with no health-data consent on record.
 */

export const CONSENT_SK = 'CONSENT';
const CONSENT_LOG_PREFIX = 'CONSENTLOG#';
export const PENDING_COOKIE = 'md.consent';
const PENDING_MAX_AGE_SECONDS = RETENTION.consentCookieMinutes * 60;

export type ConsentMethod = 'sign-in-form' | 'sign-in-review';

export interface ConsentRecord {
    versions: PolicyVersions;
    /** The person confirmed they are at least this old. */
    minimumAge: number;
    /** Separate, specific consent to collecting consumer health data (Washington MHMDA, GDPR Art. 9). */
    healthDataConsent: true;
    /** When they agreed. ISO-8601. */
    agreedAt: string;
    method: ConsentMethod;
}

/** What a person ticked, as the browser sends it. */
export interface ConsentInput {
    acceptTerms: boolean;
    ageConfirmed: boolean;
    healthDataConsent: boolean;
    /** The versions shown on the page they ticked, so a policy change mid-way is caught. */
    versions: PolicyVersions;
}

export type ConsentStatus = 'current' | 'outdated' | 'missing';

export class ConsentError extends Error {
    readonly reason: 'incomplete' | 'versions_changed' | 'invalid';
    constructor(reason: ConsentError['reason'], message: string) {
        super(message);
        this.name = 'ConsentError';
        this.reason = reason;
    }
}

const POLICY_KEYS = Object.keys(POLICY_VERSIONS) as PolicyKey[];

function isVersions(v: unknown): v is PolicyVersions {
    if (!v || typeof v !== 'object') return false;
    return POLICY_KEYS.every(k => typeof (v as Record<string, unknown>)[k] === 'string');
}

/** Parse what the browser posted. Throws ConsentError with a message the person can read. */
export function parseConsentInput(body: unknown): ConsentInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ConsentError('invalid', 'Send the boxes you ticked as a JSON object');
    const b = body as Record<string, unknown>;
    if (!isVersions(b.versions)) throw new ConsentError('invalid', 'versions is missing');
    const input: ConsentInput = {
        acceptTerms: b.acceptTerms === true,
        ageConfirmed: b.ageConfirmed === true,
        healthDataConsent: b.healthDataConsent === true,
        versions: { terms: b.versions.terms, privacy: b.versions.privacy, healthData: b.versions.healthData },
    };
    if (!input.acceptTerms || !input.ageConfirmed || !input.healthDataConsent) {
        throw new ConsentError('incomplete', 'Tick all three boxes to continue');
    }
    if (changedPolicies(input.versions).length > 0) {
        throw new ConsentError('versions_changed', 'Our policies changed while this page was open. Reload the page to see the new versions.');
    }
    return input;
}

/** The documents whose agreed version differs from the current one. */
export function changedPolicies(versions: PolicyVersions | null | undefined, current: PolicyVersions = POLICY_VERSIONS): PolicyKey[] {
    return POLICY_KEYS.filter(k => versions?.[k] !== current[k]);
}

export function consentStatus(record: ConsentRecord | null, current: PolicyVersions = POLICY_VERSIONS): ConsentStatus {
    if (!record) return 'missing';
    return changedPolicies(record.versions, current).length === 0 && record.minimumAge >= MINIMUM_AGE ? 'current' : 'outdated';
}

function toRecord(item: TableItem | null): ConsentRecord | null {
    if (!item || !isVersions(item.versions) || item.healthDataConsent !== true || typeof item.agreedAt !== 'string') return null;
    return {
        versions: { terms: item.versions.terms, privacy: item.versions.privacy, healthData: item.versions.healthData },
        minimumAge: Number(item.minimumAge) || 0,
        healthDataConsent: true,
        agreedAt: item.agreedAt,
        method: item.method === 'sign-in-review' ? 'sign-in-review' : 'sign-in-form',
    };
}

export async function getConsent(table: SingleTable, userId: string): Promise<ConsentRecord | null> {
    return toRecord(await table.get({ PK: userPk(userId), SK: CONSENT_SK }));
}

/** Whether any health-data consent is on record. History writes need this (lib/consent-http.ts). */
export async function hasHealthDataConsent(table: SingleTable, userId: string): Promise<boolean> {
    return (await getConsent(table, userId)) !== null;
}

/**
 * Record an agreement to the current versions. The log entry is written first, so the
 * evidence exists even if the summary write fails. Writes go through the same table API
 * as everything else, so this works on SQLite and DynamoDB alike.
 */
export async function recordConsent(table: SingleTable, userId: string, method: ConsentMethod, now: Date = new Date()): Promise<ConsentRecord> {
    const record: ConsentRecord = {
        versions: { ...POLICY_VERSIONS },
        minimumAge: MINIMUM_AGE,
        healthDataConsent: true,
        agreedAt: now.toISOString(),
        method,
    };
    const pk = userPk(userId);
    await table.put({ PK: pk, SK: `${CONSENT_LOG_PREFIX}${record.agreedAt}`, ...record });
    await table.put({ PK: pk, SK: CONSENT_SK, ...record });
    return record;
}

/** Every agreement on record, oldest first. For the account export. */
export async function listConsentLog(table: SingleTable, userId: string): Promise<ConsentRecord[]> {
    const out: ConsentRecord[] = [];
    let cursor: string | undefined;
    do {
        const page = await table.query({ pk: userPk(userId), skPrefix: CONSENT_LOG_PREFIX, limit: 100, cursor });
        for (const item of page.items) {
            const r = toRecord(item);
            if (r) out.push(r);
        }
        cursor = page.cursor;
    } while (cursor);
    return out;
}

// ---- the pending cookie: from the sign-in form to the account ----

interface PendingPayload {
    v: PolicyVersions;
    /** Issued at, epoch seconds. */
    t: number;
}

function sign(data: string, secret: string): string {
    return createHmac('sha256', `consent:${secret}`).update(data).digest('base64url');
}

/** A signed cookie value saying "the boxes were ticked for these versions at this time". */
export function encodePendingConsent(secret: string, now: Date = new Date()): string {
    const payload: PendingPayload = { v: { ...POLICY_VERSIONS }, t: Math.floor(now.getTime() / 1000) };
    const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${data}.${sign(data, secret)}`;
}

/**
 * Whether a pending-consent cookie is genuine, recent and for the current versions.
 * Anything else (tampered, expired, from before a policy change) reads as no consent.
 */
export function readPendingConsent(value: string | null | undefined, secret: string, now: Date = new Date()): boolean {
    if (!value || value.length > 1024) return false;
    const dot = value.indexOf('.');
    if (dot <= 0) return false;
    const data = value.slice(0, dot);
    const given = Buffer.from(value.slice(dot + 1), 'utf8');
    const expected = Buffer.from(sign(data, secret), 'utf8');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as PendingPayload;
        const age = Math.floor(now.getTime() / 1000) - payload.t;
        if (!Number.isFinite(age) || age < -60 || age > PENDING_MAX_AGE_SECONDS) return false;
        return isVersions(payload.v) && changedPolicies(payload.v).length === 0;
    } catch {
        return false;
    }
}

/** The value of one cookie from a Cookie header. */
export function cookieValue(cookieHeader: string | null | undefined, name: string): string | null {
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
}

export function pendingCookieHeader(value: string, secure: boolean): string {
    return `${PENDING_COOKIE}=${value}; Path=/; Max-Age=${PENDING_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearPendingCookieHeader(secure: boolean): string {
    return `${PENDING_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
