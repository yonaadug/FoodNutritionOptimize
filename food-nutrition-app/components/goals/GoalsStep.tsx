'use client';

import { useId } from 'react';
import Icon from '@/components/ui/Icon';
import NumberInput from '@/components/ui/NumberInput';
import { plannerActions, type PlannerState } from '@/hooks/usePlannerState';
import { GOAL_PRESETS, countGoals, fdaGoal, isGoalOn, type GoalRange } from '@/components/planner/goals';
import { NUTRIENT_GROUPS, dailyValue, fmtNumber, nutrientLabel, nutrientUnit } from '@/components/planner/nutrients';

export default function GoalsStep({ state }: { state: PlannerState }) {
    const presetsId = useId();
    const fineId = useId();
    const n = countGoals(state.goals);

    return (
        <div className="stack-lg">
            <section className="panel" aria-labelledby={presetsId}>
                <div className="panel-header">
                    <div>
                        <h2 className="panel-title" id={presetsId}>What are you aiming for?</h2>
                        <p className="panel-sub">Pick a starting point. You can fine-tune any goal below.</p>
                    </div>
                </div>
                <div className="preset-grid" role="radiogroup" aria-labelledby={presetsId}>
                    {GOAL_PRESETS.map(p => (
                        <label key={p.id} className="preset-card">
                            <input type="radio" name="goal-preset" value={p.id} checked={state.presetId === p.id}
                                onChange={() => plannerActions.applyPreset(p.id)} />
                            <span className="preset-title">
                                {p.title}
                                {p.id === 'essentials' && <span className="chip chip-success">Recommended</span>}
                                <span className="preset-check"><Icon name="check" size={12} strokeWidth={3} /></span>
                            </span>
                            <span className="preset-blurb">{p.blurb}</span>
                            <span className="tiny muted">{countGoals(p.goals)} goals · {p.calories.min?.toLocaleString()}–{p.calories.max?.toLocaleString()} kcal</span>
                        </label>
                    ))}
                    <label className="preset-card">
                        <input type="radio" name="goal-preset" value="custom" checked={state.presetId === 'custom'}
                            onChange={() => { plannerActions.applyPreset('custom'); const el = document.getElementById(fineId) as HTMLDetailsElement | null; if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }} />
                        <span className="preset-title">
                            Custom
                            <span className="preset-check"><Icon name="check" size={12} strokeWidth={3} /></span>
                        </span>
                        <span className="preset-blurb">Set your own. Any change below switches to Custom automatically.</span>
                        <span className="tiny muted">{state.presetId === 'custom' ? `${n} goals on` : 'Edit goals below'}</span>
                    </label>
                </div>
            </section>

            <section className="panel" aria-label="Calories and portions">
                <div className="setting-row">
                    <div className="setting-text">
                        <div className="setting-title">Daily calories</div>
                        <div className="setting-help">The plan uses the fewest calories that still meet your goals, within this range. Leave a box empty for no limit.</div>
                    </div>
                    <div className="row-wrap">
                        <NumberInput label="Between" unit="" className="input-num" value={state.calories.min} placeholder="no min"
                            onChange={v => plannerActions.setCalories({ ...state.calories, min: v })} />
                        <NumberInput label="and" unit="kcal" className="input-num" value={state.calories.max} placeholder="no max"
                            onChange={v => plannerActions.setCalories({ ...state.calories, max: v })} />
                    </div>
                </div>
                <div className="setting-row">
                    <div className="setting-text">
                        <div className="setting-title">Keep portions realistic</div>
                        <div className="setting-help">Stops the planner from piling on one food (like a kilo of spinach). You can still set limits per food.</div>
                    </div>
                    <div className="row-wrap">
                        <label className="switch">
                            <input type="checkbox" checked={state.portionCap.enabled} aria-label="Keep portions realistic"
                                onChange={e => plannerActions.setPortionCap({ ...state.portionCap, enabled: e.target.checked })} />
                            <span className="switch-track" />
                        </label>
                        {state.portionCap.enabled && (
                            <NumberInput label="At most" unit="g per food" className="input-num" value={state.portionCap.grams}
                                onChange={v => plannerActions.setPortionCap({ ...state.portionCap, grams: v ?? 300 })} />
                        )}
                    </div>
                </div>
            </section>

            <details className="disclosure" id={fineId}>
                <summary>
                    <Icon name="sliders" size={16} /> Fine-tune individual goals
                    <span className="chip" style={{ marginLeft: 'auto' }}>{n} on</span>
                </summary>
                <div className="disclosure-body">
                    <p className="small secondary" style={{ marginBottom: 16 }}>
                        Switch a goal off to ignore it. &ldquo;At least&rdquo; is a minimum to reach and &ldquo;at most&rdquo; is a limit to stay under.
                        FDA Daily Values are shown for reference.
                    </p>
                    {NUTRIENT_GROUPS.map(g => (
                        <div className="goal-group" key={g.id}>
                            <h4>{g.title}</h4>
                            {g.keys.map(k => <GoalRow key={k} nutrient={k} goal={state.goals[k]} />)}
                        </div>
                    ))}
                </div>
            </details>
        </div>
    );
}

function GoalRow({ nutrient, goal }: { nutrient: string; goal: GoalRange | undefined }) {
    const on = isGoalOn(goal);
    const label = nutrientLabel(nutrient);
    const unit = nutrientUnit(nutrient);
    const dv = dailyValue(nutrient);
    const ref = fdaGoal(nutrient);
    const set = (r: GoalRange) => plannerActions.setGoal(nutrient, r);

    return (
        <div className="goal-row" data-on={on}>
            <label className="switch">
                <input type="checkbox" checked={on} aria-label={`${label} goal`}
                    onChange={e => set(e.target.checked ? ref : {})} />
                <span className="switch-track" />
            </label>
            <div>
                <div className="goal-name">{label}</div>
                <div className="goal-ref">FDA Daily Value: {dv !== null ? `${fmtNumber(dv)} ${unit}` : '—'}{ref.max !== undefined ? ' (limit)' : ''}</div>
            </div>
            <div className="goal-inputs" style={{ gridColumn: 'span 2' }}>
                <NumberInput label="At least" unit={unit} value={goal?.min} placeholder="—"
                    onChange={v => set({ ...goal, min: v })} />
                <NumberInput label="At most" unit={unit} value={goal?.max} placeholder="—"
                    onChange={v => set({ ...goal, max: v })} />
            </div>
        </div>
    );
}
