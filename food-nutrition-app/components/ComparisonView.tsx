'use client';

import { useState } from 'react';
import type { Food } from '@/lib/db';
import NutritionLabel from './NutritionLabel';

interface ComparisonViewProps {
    foods: Food[];
    onRemove: (foodId: number) => void;
    foodConstraints?: Record<number, { min?: number, max?: number }>;
    onUpdateConstraint?: (foodId: number, type: 'min' | 'max', value: number | undefined) => void;
}

export default function ComparisonView({ foods, onRemove, foodConstraints, onUpdateConstraint }: ComparisonViewProps) {
    const [unitModes, setUnitModes] = useState<Record<number, 'g' | 'serving'>>({});

    const toggleUnit = (foodId: number) => {
        setUnitModes(prev => ({
            ...prev,
            [foodId]: (prev[foodId] === 'g' ? 'serving' : 'g')
        }));
    };

    const getServingInfo = (food: Food) => {
        if (!food.serving_sizes?.length) return { weight: 100, label: '100g' };
        // Prioritize RACC, then largest
        let ref = food.serving_sizes.find(s => s.label.toUpperCase().includes('RACC'));
        if (!ref) ref = food.serving_sizes.reduce((p, c) => (p.weight_g > c.weight_g) ? p : c);
        return { weight: ref.weight_g, label: ref.label };
    };

    return (
        <div>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '24px'
            }}>
                <h2 style={{
                    fontSize: '24px',
                    fontWeight: '700',
                    color: 'var(--text-primary)'
                }}>
                    Comparison ({foods.length})
                </h2>
                {foods.length > 1 && (
                    <p style={{
                        fontSize: '14px',
                        color: 'var(--text-secondary)'
                    }}>
                        Compare nutrition facts side by side
                    </p>
                )}
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(foods.length, 3)}, 1fr)`,
                gap: '24px',
                overflowX: foods.length > 3 ? 'auto' : 'visible',
                paddingBottom: '16px'
            }}>
                {foods.map(food => {
                    const constraint = foodConstraints?.[food.id] || {};
                    const hasServings = food.serving_sizes && food.serving_sizes.length > 0;
                    // Default to serving if available, unless explicitly set to 'g'
                    const mode = unitModes[food.id] || (hasServings ? 'serving' : 'g');
                    const { weight: servingWeight, label: servingLabel } = getServingInfo(food);

                    const getDisplayValue = (grams: number | undefined) => {
                        if (grams === undefined) return '';
                        if (mode === 'g') return Math.round(grams);
                        // Round to 1 decimal for servings
                        return Number((grams / servingWeight).toFixed(2));
                    };

                    const handleUpdate = (type: 'min' | 'max', valStr: string) => {
                        if (!valStr) {
                            onUpdateConstraint?.(food.id, type, undefined);
                            return;
                        }
                        const val = parseFloat(valStr);
                        let grams = val;
                        if (mode === 'serving') {
                            grams = val * servingWeight;
                        }
                        onUpdateConstraint?.(food.id, type, grams);
                    };

                    return (
                        <div key={food.id} style={{ minWidth: '320px' }}>
                            <div className="card" style={{ padding: '24px' }}>
                                <button
                                    onClick={() => onRemove(food.id)}
                                    className="btn-icon"
                                    style={{
                                        position: 'absolute',
                                        top: '16px',
                                        right: '16px'
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>

                                <h3 style={{
                                    fontSize: '18px',
                                    fontWeight: '700',
                                    marginBottom: '8px',
                                    paddingRight: '40px',
                                    color: 'var(--text-primary)'
                                }}>
                                    {food.description}
                                </h3>

                                <p style={{
                                    fontSize: '13px',
                                    color: 'var(--text-muted)',
                                    marginBottom: '16px'
                                }}>
                                    {food.food_category}
                                </p>

                                {/* Constraints Inputs */}
                                {onUpdateConstraint && (
                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px',
                                        marginBottom: '20px',
                                        padding: '12px',
                                        background: 'var(--bg-secondary)',
                                        borderRadius: '8px'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                            <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)' }}>
                                                Limits ({mode === 'serving' ? 'Servings' : 'Grams'})
                                            </span>
                                            {hasServings && (
                                                <button
                                                    onClick={() => toggleUnit(food.id)}
                                                    style={{
                                                        fontSize: '10px',
                                                        padding: '2px 6px',
                                                        background: 'var(--bg-card)',
                                                        border: '1px solid var(--border)',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        color: 'var(--text-primary)'
                                                    }}
                                                >
                                                    Switch to {mode === 'serving' ? 'Grams' : 'Servings'}
                                                </button>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', gap: '12px' }}>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                                                    Min
                                                </label>
                                                <input
                                                    type="number"
                                                    placeholder="0"
                                                    value={getDisplayValue(constraint.min)}
                                                    onChange={(e) => handleUpdate('min', e.target.value)}
                                                    style={{
                                                        width: '100%',
                                                        padding: '6px',
                                                        borderRadius: '4px',
                                                        border: '1px solid var(--border)',
                                                        fontSize: '13px'
                                                    }}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                                                    Max
                                                </label>
                                                <input
                                                    type="number"
                                                    placeholder={mode === 'serving' ? "1" : "∞"}
                                                    value={getDisplayValue(constraint.max)}
                                                    onChange={(e) => handleUpdate('max', e.target.value)}
                                                    style={{
                                                        width: '100%',
                                                        padding: '6px',
                                                        borderRadius: '4px',
                                                        border: '1px solid var(--border)',
                                                        fontSize: '13px'
                                                    }}
                                                />
                                            </div>
                                        </div>

                                        {mode === 'serving' && (
                                            <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                                1 Serving = {servingLabel} ({Math.round(servingWeight)}g)
                                            </p>
                                        )}

                                        {/* Serving Sizes List */}
                                        {hasServings && (
                                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '8px' }}>
                                                <p style={{ fontSize: '10px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                                    Available Portions:
                                                </p>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                    {food.serving_sizes!.map(s => (
                                                        <span
                                                            key={s.id}
                                                            style={{
                                                                fontSize: '10px',
                                                                padding: '2px 6px',
                                                                background: 'var(--bg-card)',
                                                                border: '1px solid var(--border)',
                                                                borderRadius: '4px',
                                                                color: 'var(--text-muted)',
                                                                cursor: 'pointer'
                                                            }}
                                                            title={`${s.weight_g}g`}
                                                        >
                                                            {s.label}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <NutritionLabel food={food} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
