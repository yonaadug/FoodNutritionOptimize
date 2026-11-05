'use client';

import { recordHistory } from '@/lib/auth/client';

export interface FoodView {
    fdcId: number;
    description: string;
    /** Canonical page path, e.g. /food/173691-salmon-sockeye-raw */
    path: string;
}

/**
 * Called once in the browser each time a food page opens (from
 * components/food/FoodDetail.tsx). It announces the view with the `mnd:food-viewed`
 * window event, and adds it to a signed-in person's history. For signed-out visitors
 * recordHistory does nothing, so nothing is stored or sent off the device.
 */
export function onFoodViewed(view: FoodView): void {
    window.dispatchEvent(new CustomEvent<FoodView>('mnd:food-viewed', { detail: view }));
    void recordHistory({ kind: 'food', itemId: String(view.fdcId), title: view.description, href: view.path });
}
