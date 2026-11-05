import type { Metadata } from 'next';
import PlannerApp from './PlannerApp';

export const metadata: Metadata = {
    title: 'Plan a day that meets your nutrition goals',
    description: 'Pick foods you like, choose your nutrition goals, and get a day of eating, in grams and household servings, that meets them.',
    alternates: { canonical: '/plan' },
};

export default function PlanPage() {
    return <PlannerApp />;
}
