import type { EntitlementStore } from '@/lib/user-store/entitlements';
import { PHOTO_LIMITS, photoAllowance, type Entitlements, type Plan } from './entitlements';

/**
 * AI photo reads per account (docs/STRIPE_PLAN.md, "Limits"). A read reserves one unit
 * with an atomic increment before the model is called, so concurrent uploads can't
 * overshoot, and gives it back if the read fails. Pasted text never comes here.
 */

export interface PhotoUsage {
    limit: number;
    used: number;
    remaining: number;
    period: 'month' | 'trial';
    resetsAt: string | null;
}

export type Reservation =
    | { ok: true; usage: PhotoUsage; release: () => Promise<void> }
    | { ok: false; usage: PhotoUsage };

function usageOf(limit: number, used: number, period: 'month' | 'trial', resetsAt: string | null): PhotoUsage {
    const clamped = Math.max(0, Math.min(used, limit));
    return { limit, used: clamped, remaining: limit - clamped, period, resetsAt };
}

export async function photoUsage(ents: EntitlementStore, userId: string, entitlements: Pick<Entitlements, 'plan'>, now: Date = new Date()): Promise<PhotoUsage> {
    const a = photoAllowance(entitlements, now);
    return usageOf(a.limit, await ents.usage(userId, a.counter), a.period, a.resetsAt);
}

export async function reservePhotoRead(ents: EntitlementStore, userId: string, entitlements: Pick<Entitlements, 'plan'>, now: Date = new Date()): Promise<Reservation> {
    const a = photoAllowance(entitlements, now);
    const count = await ents.addUsage(userId, a.counter, 1);
    if (count > a.limit) {
        await ents.addUsage(userId, a.counter, -1);
        return { ok: false, usage: usageOf(a.limit, a.limit, a.period, a.resetsAt) };
    }
    let released = false;
    return {
        ok: true,
        usage: usageOf(a.limit, count, a.period, a.resetsAt),
        release: async () => {
            if (released) return;
            released = true;
            await ents.addUsage(userId, a.counter, -1);
        },
    };
}

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

/** The friendly "you've used them" line, shown in place of the photo buttons and returned by the API. */
export function quotaMessage(usage: PhotoUsage, plan: Plan): string {
    const reads = `${usage.limit} photo ${usage.limit === 1 ? 'read' : 'reads'}`;
    const plus = PHOTO_LIMITS.plus.limit;
    if (usage.period === 'trial') return `You've used the ${reads} in your trial. Plus gives you ${plus} a month.`;
    const when = usage.resetsAt ? ` You get ${usage.limit} more on ${dayMonth(usage.resetsAt)}` : '';
    if (plan === 'plus') return `You've used your ${reads} this month.${when}.`;
    return `You've used your ${reads} this month.${when}, or ${plus} a month with Plus.`;
}
