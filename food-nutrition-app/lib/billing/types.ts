import type { Entitlements, Feature, Plan } from './entitlements';
import type { PhotoUsage } from './quota';

/** What the browser is told about a plan (as `user.plan` in GET /api/me). No Stripe ids. Safe to import anywhere. */
export interface PlanSummary {
    plan: Plan;
    features: Record<Feature, boolean>;
    trial: { endsAt: string; daysLeft: number; active: boolean };
    subscription: Entitlements['subscription'];
    /** A Stripe customer exists, so "Manage subscription" can open the Customer Portal. */
    hasBillingAccount: boolean;
    photo: PhotoUsage;
    /** Plans and recipes shown; null is all of them. */
    historyLimit: number | null;
    /** Stripe is configured here, so upgrade buttons work. */
    billingAvailable: boolean;
}
