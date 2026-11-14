import type { Metadata } from 'next';
import WeekPlannerApp from '@/components/week/WeekPlannerApp';

export const metadata: Metadata = {
    title: 'Plan a week of eating, with a grocery list',
    description: 'Seven days from the foods you like that meet your nutrition goals, with variety, leftovers and a grocery list by aisle.',
    alternates: { canonical: '/plan/week' },
};

// PLUS-GATE: weekPlanner (route). The page is one component, so wrapping it is the gate.
export default function WeekPage() {
    return <WeekPlannerApp />;
}
