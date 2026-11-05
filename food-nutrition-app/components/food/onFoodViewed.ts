'use client';

export interface FoodView {
    fdcId: number;
    description: string;
    /** Canonical page path, e.g. /food/173691-salmon-sockeye-raw */
    path: string;
}

/**
 * EXTENSION POINT: food-view history.
 *
 * Called once in the browser each time a food page opens (from
 * components/food/FoodDetail.tsx). Accounts/history should record the view
 * here, e.g. by calling its HistoryStore. For now it only announces the view,
 * so anything can also listen for the `mnd:food-viewed` window event.
 * Nothing is stored or sent off the device by this function.
 */
export function onFoodViewed(view: FoodView): void {
    window.dispatchEvent(new CustomEvent<FoodView>('mnd:food-viewed', { detail: view }));
}
