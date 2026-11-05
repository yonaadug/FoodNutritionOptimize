import { nowSeconds, type SingleTable } from '@/lib/user-store/table';
import { AccountError } from './http';
import { pseudonym } from './log';

/**
 * Fixed-window counters in the single table (RL#<scope>#<id> / W#<window>), as in the
 * AWS design. A counter survives cold starts and is shared across Lambda instances,
 * which an in-memory limiter is not. The id is stored as a keyed hash, so the table
 * holds no raw IP addresses. Sign-in endpoints are limited by Better Auth itself
 * (lib/auth/auth.ts); this covers the app's own routes and the per-email send limit.
 */

export interface RateRule {
    limit: number;
    windowSeconds: number;
}

export const RATE_RULES = {
    /** Reads of the signed-in user's data. */
    readUser: { limit: 240, windowSeconds: 60 },
    readIp: { limit: 600, windowSeconds: 60 },
    /** A person browsing records a page at a time; well above that means a script. */
    writeUser: { limit: 120, windowSeconds: 60 },
    writeIp: { limit: 300, windowSeconds: 60 },
    /** Export reads a whole partition; delete is one-shot. */
    exportUser: { limit: 5, windowSeconds: 3600 },
    deleteUser: { limit: 5, windowSeconds: 3600 },
    /** Sign-in emails to one address, however many IPs ask. Stops mailbox flooding. */
    signInEmail: { limit: 5, windowSeconds: 3600 },
} as const satisfies Record<string, RateRule>;

/** Count this request and report whether it is within the rule. */
export async function hit(table: SingleTable, scope: string, id: string, rule: RateRule, secret: string): Promise<{ allowed: boolean; retryAfter: number }> {
    const now = nowSeconds();
    const window = Math.floor(now / rule.windowSeconds);
    const count = await table.increment(
        { PK: `RL#${scope}#${pseudonym(id, secret)}`, SK: `W#${window}` },
        1,
        rule.windowSeconds * 2,
    );
    const retryAfter = (window + 1) * rule.windowSeconds - now;
    return { allowed: count <= rule.limit, retryAfter };
}

/** Like `hit`, but a refused request becomes a 429 with Retry-After. */
export async function enforce(table: SingleTable, scope: string, id: string, rule: RateRule, secret: string): Promise<void> {
    const { allowed, retryAfter } = await hit(table, scope, id, rule, secret);
    if (allowed) return;
    const err = new AccountError(429, 'rate_limited', 'Too many requests. Please slow down and try again shortly.');
    err.retryAfter = retryAfter;
    throw err;
}
