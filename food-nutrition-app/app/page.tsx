'use client';

import { useCallback, useRef, useState } from 'react';
import type { Food } from '@/lib/db';
import { ActionBar, SiteHeader, Stepper, Welcome, type StepId } from '@/components/shell/Shell';
import FoodFinder from '@/components/foods/FoodFinder';
import YourFoods from '@/components/foods/YourFoods';
import ComparisonView from '@/components/ComparisonView';
import GoalsStep from '@/components/goals/GoalsStep';
import PlanStep from '@/components/plan/PlanStep';
import { getPlannerSnapshot, plannerActions, usePlannerState } from '@/hooks/usePlannerState';
import { usePlan } from '@/hooks/usePlan';
import { countGoals, presetTitle } from '@/components/planner/goals';
import { loadSampleDay } from '@/components/planner/sampleDay';

export default function Home() {
    const state = usePlannerState();
    const plan = usePlan(state);
    const [step, setStep] = useState<StepId>('foods');
    const [comparing, setComparing] = useState(false);
    const [sampleLoading, setSampleLoading] = useState(false);
    const [sampleError, setSampleError] = useState<string | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const foodsCount = state.foods.length + state.fixedFoods.length;
    const goalsCount = countGoals(state.goals);
    const goalsLabel = presetTitle(state.presetId);
    const showWelcome = state.hydrated && foodsCount === 0 && step === 'foods';

    const go = useCallback((s: StepId) => {
        setStep(s);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const isAdded = (id: number) => state.foods.some(f => f.id === id) || state.fixedFoods.some(f => f.food.id === id);
    const toggleFood = (food: Food) => (isAdded(food.id) ? plannerActions.removeFood(food.id) : plannerActions.addFood(food));

    const makePlan = () => {
        go('plan');
        plan.run();
    };

    const trySample = async () => {
        setSampleLoading(true);
        setSampleError(null);
        try {
            const foods = await loadSampleDay();
            if (foods.length < 3) throw new Error('not enough foods');
            plannerActions.addFoods(foods);
            if (state.presetId === 'custom' || state.presetId === 'fda') plannerActions.applyPreset('essentials');
            go('plan');
            plan.run(getPlannerSnapshot());
        } catch {
            setSampleError("Couldn't load the sample day. Check that the app's server is running, then try again.");
        } finally {
            setSampleLoading(false);
        }
    };

    const planLabel = plan.status === 'success' ? (plan.stale ? 'Out of date' : 'Ready')
        : plan.status === 'infeasible' ? 'Needs changes'
            : plan.status === 'loading' ? 'Working…' : 'Not made yet';

    return (
        <>
            <a href="#main" className="skip-link">Skip to content</a>
            <SiteHeader onHome={() => go('foods')} />
            <main id="main" className="container main">
                {showWelcome && (
                    <Welcome onSample={trySample} loading={sampleLoading} error={sampleError}
                        onScratch={() => searchRef.current?.focus()} />
                )}

                <Stepper step={step} onStep={go} foodsCount={foodsCount} goalsLabel={`${goalsLabel} · ${goalsCount} goals`}
                    planLabel={planLabel} planDone={plan.status === 'success' && !plan.stale} />

                {step === 'foods' && (
                    <div className="stack-lg">
                        <div className="layout-2col">
                            <FoodFinder isAdded={isAdded} onToggle={toggleFood} searchInputRef={searchRef} />
                            <div className="sticky-col">
                                <YourFoods foods={state.foods} fixedFoods={state.fixedFoods} foodLimits={state.foodLimits}
                                    onCompare={() => { setComparing(true); requestAnimationFrame(() => document.getElementById('compare')?.scrollIntoView({ behavior: 'smooth' })); }}
                                    onTrySample={trySample} sampleLoading={sampleLoading} />
                            </div>
                        </div>
                        {comparing && (
                            <ComparisonView foods={[...state.foods, ...state.fixedFoods.map(f => f.food)]} onClose={() => setComparing(false)} />
                        )}
                    </div>
                )}

                {step === 'goals' && <GoalsStep state={state} />}

                {step === 'plan' && (
                    <PlanStep state={state} status={plan.status} result={plan.result} error={plan.error} stale={plan.stale}
                        fixedAtRun={plan.fixedAtRun} onRun={() => plan.run()} onEditFoods={() => go('foods')} onEditGoals={() => go('goals')} />
                )}
            </main>

            <ActionBar step={step} foodsCount={foodsCount} goalsLabel={goalsLabel} goalsCount={goalsCount}
                planning={plan.status === 'loading'} onMakePlan={makePlan} onNext={() => go('goals')} onBack={() => go('foods')} />
        </>
    );
}
