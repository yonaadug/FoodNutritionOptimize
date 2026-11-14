import Link from 'next/link';
import Icon from '@/components/ui/Icon';

/**
 * "Plan a week" from the day plan.
 *
 * PLUS-GATE: weekPlanner (UI entry). Self-contained: wrapping this is the whole gate.
 */
export default function WeekPlanEntry() {
    return (
        <section className="panel" data-testid="week-plan-entry" aria-labelledby="week-plan-entry-title">
            <div className="row-wrap" style={{ alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                    <h3 className="panel-title" id="week-plan-entry-title">Plan a whole week</h3>
                    <p className="small secondary" style={{ marginTop: 4 }}>
                        Seven days from these foods and goals, with different foods on different days, leftovers for recipes, and a grocery list.
                    </p>
                </div>
                <Link href="/plan/week" className="btn btn-primary" data-testid="plan-week-link">
                    <Icon name="sparkle" size={16} /> Plan a week
                </Link>
            </div>
        </section>
    );
}
