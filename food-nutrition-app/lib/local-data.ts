/**
 * What a signed-in person leaves behind in this browser. See "Data in this browser" in
 * docs/ACCOUNTS.md for the rule in plain words. In short:
 *
 *   - Anonymous visitors: their work stays in the browser. Nothing here touches it.
 *   - Signing in: anonymous work stays in the browser and is NOT uploaded. It now goes
 *     with that person, who can save it to their account by pressing a button.
 *   - Signing out, or the account being deleted, or the session ending: everything is cleared.
 *   - A different person signing in: everything is cleared first.
 *
 * No runtime imports, so stores and tests can use it freely.
 */

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Everything the site keeps about what a person eats. The theme stays: it belongs to the device. */
export const PERSONAL_KEYS: readonly string[] = [
    // Planner (hooks/usePlannerState.ts, hooks/usePlan.ts, hooks/useStep.ts)
    'selectedFoods', 'guaranteedFoods', 'foodConstraints', 'nc.goals.v2', 'nc.plan.v1', 'nc.step',
    // Legacy planner goals, still read when migrating
    'customConstraints', 'minCalories', 'maxCalories',
    // Week planner (components/week/weekStore.ts)
    'nc.week.v1', 'nc.week.settings.v1', 'nc.week.grocery.v1',
    // Recipe analyzer (lib/recipes/editor.ts)
    'recipes.recent.v1',
    // Recent searches (lib/recent-searches.ts)
    'mnd.recentSearches.v1',
];

/** The user id this browser's data goes with. Absent means anonymous. */
export const LOCAL_OWNER_KEY = 'md.localOwner';

/** Fired on window after clearing, so stores holding a copy in memory drop it too. */
export const LOCAL_DATA_CLEARED_EVENT = 'mnd:local-data-cleared';

export function clearPersonalData(storage: StorageLike | null): void {
    if (!storage) return;
    for (const key of PERSONAL_KEYS) {
        try {
            storage.removeItem(key);
        } catch {
            /* blocked storage: there is nothing to clear */
        }
    }
}

/**
 * Bring this browser's data in line with who is signed in. `userId` is null when the
 * server says nobody is, never when it simply couldn't be reached.
 * Returns whether anything was cleared.
 */
export function reconcileLocalData(storage: StorageLike | null, userId: string | null): boolean {
    if (!storage) return false;
    try {
        const owner = storage.getItem(LOCAL_OWNER_KEY);
        if (userId === null) {
            if (owner === null) return false;
            clearPersonalData(storage);
            storage.removeItem(LOCAL_OWNER_KEY);
            return true;
        }
        const someoneElse = owner !== null && owner !== userId;
        if (someoneElse) clearPersonalData(storage);
        if (owner !== userId) storage.setItem(LOCAL_OWNER_KEY, userId);
        return someoneElse;
    } catch {
        return false;
    }
}
