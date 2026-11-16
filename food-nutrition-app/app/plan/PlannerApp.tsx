'use client';

import IntentLink from '@/components/ui/IntentLink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Food } from '@/lib/food-types';
import { ActionBar, Stepper, Welcome } from '@/components/shell/Shell';
import FoodFinder from '@/components/foods/FoodFinder';
import YourFoods from '@/components/foods/YourFoods';
import ComparisonView from '@/components/ComparisonView';
import Icon from '@/components/ui/Icon';
import { reopenPlan } from '@/components/plan/reopenPlan';
import GoalsStep from '@/components/goals/GoalsStep';
import PlanStep from '@/components/plan/PlanStep';
import { getPlannerSnapshot, plannerActions, usePlannerState } from '@/hooks/usePlannerState';
import { fetchFoodsByFdcIds } from '@/hooks/useFoodSearch';
import { usePlan } from '@/hooks/usePlan';
import { setStep, syncStepFromLocation, useStep, type StepId } from '@/hooks/useStep';
import { notify } from '@/hooks/useToasts';
import { countGoals, presetTitle } from '@/components/planner/goals';
import { shortFoodName } from '@/components/planner/nutrients';
import { loadSampleDay } from '@/components/planner/sampleDay';
import { fetchHistoryItem, fetchLatestHistory, useCurrentUser } from '@/lib/auth/client';
import { nextFromLocation, signInPath } from '@/lib/auth/next-path';
import type { HistoryItem } from '@/lib/user-store/history';
import { scrollBehavior } from '@/lib/navigation-ux';
import InlineScript from '@/components/ui/InlineScript';

/**
 * Runs before the first paint of a full page load: marks a browser that already has a plan
 * in progress, so the welcome panel (for first visits) isn't shown and then taken away.
 * Mirrors what usePlannerState and useStep read.
 */
const RETURNING_SCRIPT = "try{var a=JSON.parse(localStorage.getItem('selectedFoods')||'[]'),b=JSON.parse(localStorage.getItem('guaranteedFoods')||'[]'),h=location.hash.slice(1),s=(h==='foods'||h==='goals'||h==='plan')?h:localStorage.getItem('nc.step');document.documentElement.setAttribute('data-planner',(a.length||b.length||s==='goals'||s==='plan')?'returning':'new')}catch(e){}";

type OpenState = 'opening' | 'signed-out' | 'not-found' | 'too-long' | 'failed' | null;

const OPEN_MESSAGES: Record<Exclude<OpenState, 'opening' | null>, string> = {
    'signed-out': 'Sign in to open this saved plan.',
    'not-found': "We couldn't find that saved plan. It may have been removed.",
    'too-long': 'That plan has too many foods and recipes to keep in full, so it can only be seen in your history.',
    failed: "We couldn't open that saved plan. Check your connection, then try again.",
};

/** The three-step meal planner (foods, goals, plan). State lives in localStorage; the step in the #hash. */
export default function PlannerApp() {
    const state = usePlannerState();
    const plan = usePlan(state);
    const step = useStep();
    const [comparing, setComparing] = useState(false);
    const [sampleLoading, setSampleLoading] = useState(false);
    const [sampleError, setSampleError] = useState<string | null>(null);
    // After "Clear all" the welcome panel stays away, so the page doesn't jump.
    const [welcomeDismissed, setWelcomeDismissed] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const [openState, setOpenState] = useState<OpenState>(null);
    const { user } = useCurrentUser();
    const [latestPlan, setLatestPlan] = useState<HistoryItem | null>(null);
    // Steps fade in when the visitor moves between them, not on the first paint.
    const [stepMoved, setStepMoved] = useState(false);

    // Arriving from another page ("Add to my plan" links to /plan#foods): honour the address.
    useEffect(() => { syncStepFromLocation(); }, []);

    const foodsCount = state.foods.length + state.fixedFoods.length;

    // Saved copies of foods can be older than the data: a food has one set of values everywhere.
    const refreshed = useRef(false);
    useEffect(() => {
        if (!state.hydrated || refreshed.current) return;
        refreshed.current = true;
        const ids = [...state.foods, ...state.fixedFoods.map(f => f.food)].filter(f => !f.recipe).map(f => f.fdc_id);
        if (ids.length > 0) fetchFoodsByFdcIds(ids).then(plannerActions.refreshFoods).catch(() => { /* the saved copies still work */ });
    }, [state.hydrated, state.foods, state.fixedFoods]);

    const openPlanItem = useCallback(async (item: HistoryItem) => {
        setOpenState('opening');
        setLatestPlan(null);
        const outcome = await reopenPlan(item);
        setOpenState(outcome === 'opened' ? null : outcome);
    }, []);

    // A history row links to /plan?open=<id>: make that plan the current one, on this or any device.
    const handledOpen = useRef(false);
    useEffect(() => {
        if (handledOpen.current) return;
        handledOpen.current = true;
        const id = new URLSearchParams(window.location.search).get('open');
        if (!id) return;
        void (async () => {
            setOpenState('opening');
            const found = await fetchHistoryItem('plan', id);
            // Keep the address when signed out, so signing in comes back here and opens it.
            if (found.status === 'signed-out') {
                setOpenState('signed-out');
                return;
            }
            window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.hash}`);
            if (found.status === 'ok') await openPlanItem(found.item);
            else setOpenState(found.status);
        })();
    }, [openPlanItem]);

    // Signed in, with an empty planner (a second browser, or after signing out and back in): offer the last plan.
    useEffect(() => {
        if (!user || !state.hydrated || foodsCount > 0) return;
        let current = true;
        fetchLatestHistory('plan', 1).then(items => { if (current) setLatestPlan(items[0] ?? null); }).catch(() => { /* just an offer */ });
        return () => { current = false; };
    }, [user, state.hydrated, foodsCount]);

    // No foods left means there is no plan (Clear all has its own Undo, which brings it back).
    useEffect(() => {
        if (state.hydrated && foodsCount === 0 && plan.runInfo && plan.status !== 'loading') plan.reset();
    }, [state.hydrated, foodsCount, plan]);

    const goalsCount = countGoals(state.goals);
    const goalsLabel = presetTitle(state.presetId);
    const showWelcome = state.hydrated && foodsCount === 0 && step === 'foods' && !welcomeDismissed;

    const go = useCallback((s: StepId) => {
        setStepMoved(true);
        setStep(s);
        window.scrollTo({ top: 0, behavior: scrollBehavior() });
    }, []);

    const isAdded = (id: number) => state.foods.some(f => f.id === id) || state.fixedFoods.some(f => f.food.id === id);
    const toggleFood = (food: Food) => {
        if (isAdded(food.id)) {
            plannerActions.removeFood(food.id);
            notify(`Removed ${shortFoodName(food.description)}.`, { tone: 'info', ms: 3000 });
        } else {
            plannerActions.addFood(food);
        }
    };

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

    const showSavedOffer = !!latestPlan && foodsCount === 0 && openState === null;
    const planLabel = plan.status === 'success' ? (plan.stale ? 'Out of date' : 'Ready')
        : plan.status === 'infeasible' ? (plan.stale ? 'Out of date' : 'Needs changes')
            : plan.status === 'loading' ? 'Working…'
                : plan.status === 'error' ? 'Try again' : 'Not made yet';

    // Until this browser's saved plan has been read (the server's HTML, and hydration), show the
    // page's frame with a placeholder for the step, so nothing appears and then jumps away.
    if (!state.hydrated) {
        const noop = () => {};
        return (
            <main className="container main" data-step={step}>
                <InlineScript html={RETURNING_SCRIPT} />
                <div className="planner-welcome-slot">
                    <Welcome onSample={noop} onScratch={noop} loading={false} error={null} />
                </div>
                <Stepper step={step} onStep={noop} foodsCount={0} goalsLabel={`${goalsLabel} · ${goalsCount} ${goalsCount === 1 ? 'goal' : 'goals'}`}
                    planLabel={planLabel} planDone={false} />
                <div className="skeleton sk-panel planner-pending" aria-hidden="true" />
            </main>
        );
    }

    return (
        <>
            <main className="container main" data-step={step}>
                {/* The welcome panel has the page's heading; once it's gone this one takes over. */}
                {!showWelcome && <h1 className="sr-only">Plan your day</h1>}

                {openState === 'opening' && (
                    <div className="callout callout-info" role="status" style={{ marginBottom: 16 }}>
                        <span className="spinner" style={{ color: 'var(--primary)' }} /> Opening your saved plan…
                    </div>
                )}
                {openState !== null && openState !== 'opening' && (
                    <div className="callout callout-warn" role="alert" style={{ marginBottom: 16 }} data-testid="open-plan-error">
                        <span className="callout-icon"><Icon name="alert" /></span>
                        <span>
                            {OPEN_MESSAGES[openState]}{' '}
                            {openState === 'signed-out' && <IntentLink href={signInPath(typeof window === 'undefined' ? null : nextFromLocation(window.location))}>Sign in</IntentLink>}
                        </span>
                    </div>
                )}
                {showSavedOffer && (
                    <div className="callout callout-info" role="note" style={{ marginBottom: 16 }} data-testid="saved-plan-offer">
                        <span className="callout-icon"><Icon name="info" /></span>
                        <div className="row-wrap" style={{ flex: 1 }}>
                            <span style={{ flex: 1, minWidth: 200 }}><span className="callout-title">Your last plan:</span> {latestPlan.title}</span>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void openPlanItem(latestPlan)}>Open it</button>
                        </div>
                    </div>
                )}

                {showWelcome && (
                    <Welcome onSample={trySample} loading={sampleLoading} error={sampleError}
                        onScratch={() => searchRef.current?.focus()} />
                )}

                <Stepper step={step} onStep={go} foodsCount={foodsCount} goalsLabel={`${goalsLabel} · ${goalsCount} ${goalsCount === 1 ? 'goal' : 'goals'}`}
                    planLabel={planLabel} planDone={plan.status === 'success' && !plan.stale} />

                <div key={step} className={stepMoved ? 'step-panel' : undefined}>
                {step === 'foods' && (
                    <div className="stack-lg">
                        <div className="layout-2col">
                            <FoodFinder isAdded={isAdded} onToggle={toggleFood} searchInputRef={searchRef} />
                            <div className="sticky-col">
                                <YourFoods foods={state.foods} fixedFoods={state.fixedFoods} foodLimits={state.foodLimits}
                                    onCompare={() => { setComparing(true); requestAnimationFrame(() => document.getElementById('compare')?.scrollIntoView({ behavior: scrollBehavior() })); }}
                                    onCleared={() => setWelcomeDismissed(true)}
                                    onTrySample={trySample} sampleLoading={sampleLoading} sampleError={showWelcome ? null : sampleError} />
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
                        runInfo={plan.runInfo} finished={plan.finished}
                        onRun={() => plan.run()} onEditFoods={() => go('foods')} onEditGoals={() => go('goals')}
                        onTrySample={trySample} sampleLoading={sampleLoading} sampleError={sampleError} />
                )}
                </div>
            </main>

            <ActionBar step={step} foodsCount={foodsCount} goalsLabel={goalsLabel} goalsCount={goalsCount}
                planning={plan.status === 'loading'} onMakePlan={makePlan} onNext={() => go('goals')} onBack={() => go('foods')} />
        </>
    );
}
