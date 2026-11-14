import { EntitlementStore } from '@/lib/user-store/entitlements';
import type { SingleTable } from '@/lib/user-store/table';
import { entitlementsFor, historyLimit, type EntitlementRecord, type Entitlements } from './entitlements';
import { photoUsage } from './quota';
import type { PlanSummary } from './types';

/** The record (created on first sight, which starts the trial) and what it allows now. */
export async function loadEntitlements(table: SingleTable, userId: string, now: Date = new Date()): Promise<{ record: EntitlementRecord; entitlements: Entitlements }> {
    const record = await new EntitlementStore(table).ensure(userId, now);
    return { record, entitlements: entitlementsFor(record, now) };
}

export async function planSummary(table: SingleTable, userId: string, billingAvailable: boolean, now: Date = new Date()): Promise<PlanSummary> {
    const { entitlements } = await loadEntitlements(table, userId, now);
    const { plan, features, trial, subscription, hasBillingAccount } = entitlements;
    return {
        plan,
        features,
        trial: { endsAt: trial.endsAt, daysLeft: trial.daysLeft, active: trial.active },
        subscription,
        hasBillingAccount,
        photo: await photoUsage(new EntitlementStore(table), userId, entitlements, now),
        historyLimit: historyLimit(entitlements),
        billingAvailable,
    };
}
