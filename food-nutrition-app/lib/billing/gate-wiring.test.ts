import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The Plus features stay behind Plus on the server and in the UI (docs/DECISIONS.md). */
describe('Plus features are gated', () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

    it('their API routes check the plan before doing any work', () => {
        for (const [file, feature] of [['app/api/plan/week/route.ts', 'weekPlanner'], ['app/api/plan/contaminants/route.ts', 'planContaminants']]) {
            const source = read(file);
            assert.match(source, new RegExp(`export const POST = plusRoute\\('${feature}'`), file);
            assert.doesNotMatch(source, /export (async )?function POST/, `${file} must not export an ungated POST`);
        }
    });

    it('their UI entry points are wrapped', () => {
        assert.match(read('app/plan/week/page.tsx'), /<PlusGate feature="weekPlanner"><WeekPlannerApp \/><\/PlusGate>/);
        const planStep = read('components/plan/PlanStep.tsx');
        assert.match(planStep, /<PlusGate feature="planContaminants"[^>]*>\s*<PlanContaminants /);
        assert.match(planStep, /<PlusGate feature="weekPlanner"[^>]*>\s*<WeekPlanEntry \/>/);
        assert.match(read('components/week/WeekPlannerApp.tsx'), /<PlusGate feature="planContaminants"[^>]*>\s*<PlanContaminants /);
    });
});
