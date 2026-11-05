'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/Icon';
import { usePlannerState } from '@/hooks/usePlannerState';

const LEGACY_HASH = /^#(foods|goals|plan)$/;

/** The planner used to live at /, so old bookmarks like /#plan move to /plan#plan. */
export function LegacyPlannerRedirect() {
    const router = useRouter();
    useEffect(() => {
        const check = () => {
            if (LEGACY_HASH.test(window.location.hash)) router.replace(`/plan${window.location.hash}`);
        };
        check();
        window.addEventListener('hashchange', check);
        return () => window.removeEventListener('hashchange', check);
    }, [router]);
    return null;
}

/** The secondary way in to the planner; it notices a plan already in progress. */
export default function PlanNudge() {
    const state = usePlannerState();
    const count = state.foods.length + state.fixedFoods.length;
    return (
        <Link href="/plan" className="plan-link">
            {count > 0
                ? <>Continue your plan ({count} {count === 1 ? 'food' : 'foods'})</>
                : <>Plan a day</>}
            <Icon name="arrowRight" size={15} />
        </Link>
    );
}
