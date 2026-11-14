import { FREE_HISTORY_LIMIT, PHOTO_LIMITS, type Feature } from './entitlements';

/** Plain words for each Plus feature, used by gates, /plus and server errors. Safe to import anywhere. */
export const FEATURE_COPY: Record<Feature, { name: string; what: string }> = {
    weekPlanner: {
        name: 'The week planner',
        what: 'Plan a whole week of meals at once, with a grocery list for the shop.',
    },
    planContaminants: {
        name: 'The whole-plan contaminant check',
        what: 'See the metals and pesticide residues across a whole plan, not one food at a time.',
    },
    photoQuota: {
        name: 'More photo reads',
        what: `Read ${PHOTO_LIMITS.plus.limit} recipe photos a month with AI, instead of ${PHOTO_LIMITS.free.limit}.`,
    },
    unlimitedHistory: {
        name: 'All your saved plans and recipes',
        what: `Keep every plan and recipe on every device, not just your latest ${FREE_HISTORY_LIMIT}.`,
    },
};

/** The order /plus lists them in. */
export const FEATURE_ORDER: Feature[] = ['weekPlanner', 'planContaminants', 'photoQuota', 'unlimitedHistory'];

export const ALWAYS_FREE = [
    'Every food page and contaminant meter',
    'The one-day meal planner',
    'Recipes you paste in, read by our built-in reader',
    'Exporting all your data, any time',
];
