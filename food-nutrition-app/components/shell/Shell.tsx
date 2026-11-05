'use client';

import Icon from '@/components/ui/Icon';
import ThemeToggle from '@/components/ThemeToggle';
import type { StepId } from '@/hooks/useStep';

export type { StepId };

export function SiteHeader({ onHome }: { onHome: () => void }) {
    return (
        <header className="site-header">
            <div className="container site-header-inner">
                <a href="#" className="brand" onClick={e => { e.preventDefault(); onHome(); }} aria-label="Micronutrient Diary home">
                    <span className="brand-mark"><Icon name="leaf" size={17} strokeWidth={2.4} /></span>
                    Micronutrient Diary
                </a>
                <span className="brand-tagline">Plan a day of food that meets your nutrition goals</span>
                <span className="spacer" />
                <ThemeToggle />
            </div>
        </header>
    );
}

export function Welcome({ onSample, onScratch, loading, error }: { onSample: () => void; onScratch: () => void; loading: boolean; error: string | null }) {
    return (
        <section className="hero fade-in" aria-labelledby="welcome-title">
            <p className="eyebrow">Free · No sign-up · Uses USDA nutrition data</p>
            <h1 id="welcome-title" style={{ marginTop: 8 }}>Eat the foods you like and still hit your nutrition goals.</h1>
            <p>
                Pick some foods, choose what you&apos;re aiming for, and Micronutrient Diary works out how much of each to eat,
                in grams and everyday servings.
            </p>
            <div className="hero-actions">
                <button type="button" className="btn btn-primary btn-lg" onClick={onSample} disabled={loading}>
                    {loading ? <><span className="spinner" /> Building a sample day…</> : <><Icon name="sparkle" /> Try a sample day</>}
                </button>
                <button type="button" className="btn btn-secondary btn-lg" onClick={onScratch}>
                    Start with my own foods <Icon name="arrowRight" size={16} />
                </button>
            </div>
            {error && <p role="alert" className="small" style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</p>}
            <div className="hero-steps" aria-label="How it works">
                {[
                    ['1', 'Pick foods', 'Search thousands of USDA foods.'],
                    ['2', 'Set goals', 'Use a preset or make your own.'],
                    ['3', 'Get your plan', 'Amounts for the whole day.'],
                ].map(([n, t, d]) => (
                    <div className="hero-step" key={n}>
                        <span className="step-num">{n}</span>
                        <span><strong>{t}</strong>{d}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}

interface StepperProps {
    step: StepId;
    onStep: (s: StepId) => void;
    foodsCount: number;
    goalsLabel: string;
    planLabel: string;
    planDone: boolean;
}

export function Stepper({ step, onStep, foodsCount, goalsLabel, planLabel, planDone }: StepperProps) {
    const steps: { id: StepId; title: string; sub: string; done: boolean }[] = [
        { id: 'foods', title: 'Pick foods', sub: foodsCount ? `${foodsCount} chosen` : 'Nothing yet', done: foodsCount > 0 },
        { id: 'goals', title: 'Set goals', sub: goalsLabel, done: foodsCount > 0 && step !== 'foods' },
        { id: 'plan', title: 'Your plan', sub: planLabel, done: planDone },
    ];
    return (
        <nav className="stepper" aria-label="Steps">
            <ol>
                {steps.map((s, i) => (
                    <li key={s.id}>
                        <button type="button" className="step-btn" aria-current={step === s.id ? 'step' : undefined}
                            data-done={s.done && step !== s.id} onClick={() => onStep(s.id)}>
                            <span className="step-num" aria-hidden="true">{s.done && step !== s.id ? <Icon name="check" size={14} strokeWidth={3} /> : i + 1}</span>
                            <span className="step-text">
                                <span className="step-title">{s.title}</span>
                                <span className="step-sub">{s.sub}</span>
                            </span>
                        </button>
                    </li>
                ))}
            </ol>
        </nav>
    );
}

interface ActionBarProps {
    step: StepId;
    foodsCount: number;
    goalsLabel: string;
    goalsCount: number;
    planning: boolean;
    onMakePlan: () => void;
    onNext: () => void;
    onBack: () => void;
}

export function ActionBar({ step, foodsCount, goalsLabel, goalsCount, planning, onMakePlan, onNext, onBack }: ActionBarProps) {
    if (step === 'plan') return null;
    const canPlan = foodsCount > 0;
    return (
        <div className="action-bar" role="region" aria-label="Next step">
            <div className="container action-bar-inner">
                <div className="action-summary">
                    <strong>{foodsCount} {foodsCount === 1 ? 'food' : 'foods'}</strong> · {goalsCount} goals
                    <span className="muted">{canPlan ? goalsLabel : 'Add at least one food to make a plan'}</span>
                </div>
                {step === 'foods'
                    ? <button type="button" className="btn btn-secondary" onClick={onNext} disabled={!canPlan}>Set goals <Icon name="arrowRight" size={16} /></button>
                    : <button type="button" className="btn btn-secondary" onClick={onBack}><Icon name="arrowLeft" size={16} /> Foods</button>}
                <button type="button" className="btn btn-primary btn-lg" onClick={onMakePlan} disabled={!canPlan || planning}>
                    {planning ? <><span className="spinner" /> Planning…</> : <>Make my plan</>}
                </button>
            </div>
        </div>
    );
}
