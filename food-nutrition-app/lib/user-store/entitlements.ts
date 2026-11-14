import type { EntitlementRecord } from '@/lib/billing/entitlements';
import type { ItemKey, SingleTable, TableItem } from './table';

/**
 * Plan storage on the single table (docs/ACCOUNTS.md, "Storage"):
 *
 *   USER#<id>          ENT                     the entitlement record (lib/billing/entitlements.ts)
 *   USER#<id>          USAGE#photo#<counter>   AI photo reads: free#yyyy-mm, plus#yyyy-mm or trial; TTL 400 days
 *   STRIPECUS#<cus>    STRIPECUS               pointer from a Stripe customer to the user (webhooks)
 *   STRIPEEVT#<evt>    STRIPEEVT               a processed webhook event (idempotency); TTL 30 days
 *
 * Everything under USER#<id> goes with the account (UserStore.deleteAccountData), and
 * the ENT item lists the customer pointer in `_ptrs`, so that goes too. A pointer item
 * rather than the GSI1 lookup the AWS design sketched: an index is eventually
 * consistent, and a webhook that arrives a moment after Checkout must find its user.
 */

export const ENT_SK = 'ENT';
export const USAGE_PREFIX = 'USAGE#';
const PHOTO_USAGE = `${USAGE_PREFIX}photo#`;
const USAGE_TTL_SECONDS = 400 * 86_400;
const EVENT_TTL_SECONDS = 30 * 86_400;

const entKey = (userId: string): ItemKey => ({ PK: `USER#${userId}`, SK: ENT_SK });
const customerKey = (customerId: string): ItemKey => ({ PK: `STRIPECUS#${customerId}`, SK: 'STRIPECUS' });
const eventKey = (eventId: string): ItemKey => ({ PK: `STRIPEEVT#${eventId}`, SK: 'STRIPEEVT' });
const usageKey = (userId: string, counter: string): ItemKey => ({ PK: `USER#${userId}`, SK: `${PHOTO_USAGE}${counter}` });

const RECORD_FIELDS = [
    'trialStartedAt', 'stripeCustomerId', 'stripeLivemode', 'subscriptionId', 'subscriptionStatus', 'priceId', 'interval',
    'currentPeriodEnd', 'cancelAtPeriodEnd', 'cancelAt', 'pastDueSince', 'paymentFailedAt', 'updatedAt',
] as const satisfies readonly (keyof EntitlementRecord)[];

/** The record's own fields, without table keys or internal attributes. */
export function toEntitlementRecord(item: TableItem): EntitlementRecord {
    const out: Record<string, unknown> = {};
    for (const field of RECORD_FIELDS) if (item[field] !== undefined) out[field] = item[field];
    return out as unknown as EntitlementRecord;
}

/** Usage items as exported: `{ counter: 'photo#free#2026-11', count }`. */
export function toUsageEntry(item: TableItem): { counter: string; count: number } {
    return { counter: item.SK.slice(USAGE_PREFIX.length), count: typeof item.count === 'number' ? item.count : 0 };
}

export class EntitlementStore {
    readonly table: SingleTable;

    constructor(table: SingleTable) {
        this.table = table;
    }

    async get(userId: string): Promise<EntitlementRecord | null> {
        const item = await this.table.get(entKey(userId));
        return item ? toEntitlementRecord(item) : null;
    }

    /**
     * The record, created on first sight with the trial starting now. For a new account
     * that's its creation; an account from before plans existed gets its trial from its
     * first visit after this shipped. Concurrent first visits agree: only one put wins.
     */
    async ensure(userId: string, now: Date = new Date()): Promise<EntitlementRecord> {
        for (let attempt = 0; attempt < 3; attempt++) {
            const existing = await this.get(userId);
            if (existing) return existing;
            const record: EntitlementRecord = { trialStartedAt: now.toISOString(), updatedAt: now.toISOString() };
            if (await this.table.put({ ...entKey(userId), ...record }, { ifNotExists: true })) return record;
        }
        throw new Error('EntitlementStore.ensure: too much contention');
    }

    /** Compare-and-set. `mutate` may run more than once, so it must be pure. Null when there is no record. */
    async update(userId: string, mutate: (record: EntitlementRecord) => EntitlementRecord): Promise<EntitlementRecord | null> {
        for (let attempt = 0; attempt < 6; attempt++) {
            const item = await this.table.get(entKey(userId));
            if (!item) return null;
            const next = { ...mutate(toEntitlementRecord(item)), updatedAt: new Date().toISOString() };
            const written: TableItem = { ...entKey(userId), ...next };
            if (Array.isArray(item._ptrs)) written._ptrs = item._ptrs;
            if (await this.table.put(written, { ifVersion: item._v ?? 0 })) return next;
        }
        throw new Error('EntitlementStore.update: too much contention');
    }

    /** Point the customer at the user, then record it on the user. The pointer goes when the account does. */
    async linkCustomer(userId: string, customerId: string, livemode: boolean): Promise<EntitlementRecord | null> {
        await this.table.put({ ...customerKey(customerId), userId });
        for (let attempt = 0; attempt < 6; attempt++) {
            const item = await this.table.get(entKey(userId));
            if (!item) return null;
            const pointers = (Array.isArray(item._ptrs) ? (item._ptrs as ItemKey[]) : []).filter(p => !p.PK.startsWith('STRIPECUS#') || p.PK === customerKey(customerId).PK);
            if (!pointers.some(p => p.PK === customerKey(customerId).PK)) pointers.push(customerKey(customerId));
            const record = { ...toEntitlementRecord(item), stripeCustomerId: customerId, stripeLivemode: livemode, updatedAt: new Date().toISOString() };
            if (await this.table.put({ ...entKey(userId), ...record, _ptrs: pointers }, { ifVersion: item._v ?? 0 })) return record;
        }
        throw new Error('EntitlementStore.linkCustomer: too much contention');
    }

    async userIdForCustomer(customerId: string): Promise<string | null> {
        const item = await this.table.get(customerKey(customerId));
        return typeof item?.userId === 'string' ? item.userId : null;
    }

    // ---- photo usage ----

    async usage(userId: string, counter: string): Promise<number> {
        const item = await this.table.get(usageKey(userId, counter));
        return typeof item?.count === 'number' ? item.count : 0;
    }

    /** Atomic add; returns the new count. */
    addUsage(userId: string, counter: string, by: number): Promise<number> {
        return this.table.increment(usageKey(userId, counter), by, USAGE_TTL_SECONDS);
    }

    // ---- webhook idempotency ----

    async eventProcessed(eventId: string): Promise<boolean> {
        return Boolean(await this.table.get(eventKey(eventId)));
    }

    async markEventProcessed(eventId: string, type: string): Promise<void> {
        await this.table.put({
            ...eventKey(eventId),
            type,
            processedAt: new Date().toISOString(),
            expiresAt: Math.floor(Date.now() / 1000) + EVENT_TTL_SECONDS,
        });
    }
}
