'use client';

import { useState, useMemo } from 'react';
import { NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';
import type { Food } from '@/lib/db';

interface NutrientBreakdownProps {
    optimizationResult: any;
    guaranteedFoods: { food: Food, grams: number }[];
}

export default function NutrientBreakdown({ optimizationResult, guaranteedFoods }: NutrientBreakdownProps) {
    const [selectedNutrient, setSelectedNutrient] = useState('protein_g');

    const breakdown = useMemo(() => {
        if (!optimizationResult) return [];

        const items: { name: string; value: number; type: 'Guaranteed' | 'Optimized'; pct: number }[] = [];
        let totalValue = 0;

        // 1. Guaranteed Foods
        guaranteedFoods.forEach(item => {
            const multiplier = item.grams / 100;
            let val = 0;
            if (selectedNutrient === 'calories') {
                val = (item.food.calories || 0) * multiplier;
            } else {
                // @ts-ignore
                val = (item.food[selectedNutrient] || 0) * multiplier;
            }
            if (val > 0) {
                items.push({
                    name: item.food.description,
                    value: val,
                    type: 'Guaranteed',
                    pct: 0 // calc later
                });
                totalValue += val;
            }
        });

        // 2. Optimized Foods
        optimizationResult.diet.forEach((item: any) => {
            let val = 0;
            if (selectedNutrient === 'calories') {
                val = item.calories;
            } else {
                val = item.nutrients[selectedNutrient] || 0;
            }
            if (val > 0) {
                items.push({
                    name: item.food.description,
                    value: val,
                    type: 'Optimized',
                    pct: 0 // calc later
                });
                totalValue += val;
            }
        });

        // 3. Calc percentages and sort
        if (totalValue > 0) {
            items.forEach(item => {
                item.pct = (item.value / totalValue) * 100;
            });
        }

        return items.sort((a, b) => b.value - a.value);
    }, [optimizationResult, guaranteedFoods, selectedNutrient]);

    const config = NUTRIENT_CONFIG[selectedNutrient];
    const unit = config ? config.unit : (selectedNutrient === 'calories' ? 'kcal' : '');

    return (
        <div style={{ marginBottom: '32px', padding: '20px', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>Nutrient Sources</h4>
                <select
                    value={selectedNutrient}
                    onChange={(e) => setSelectedNutrient(e.target.value)}
                    style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-page)',
                        color: 'var(--text-primary)',
                        fontSize: '14px'
                    }}
                >
                    <option value="calories">Calories</option>
                    {Object.entries(NUTRIENT_CONFIG).map(([key, conf]) => {
                        if (key === 'calories') return null;
                        return (
                            <option key={key} value={key}>{conf.label}</option>
                        );
                    })}
                </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {breakdown.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '13px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
                                    {item.name} <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({item.type})</span>
                                </span>
                                <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                                    {Math.round(item.value)}{unit} <span style={{ color: 'var(--text-secondary)', fontWeight: '400' }}>({Math.round(item.pct)}%)</span>
                                </span>
                            </div>
                            <div style={{
                                height: '6px',
                                width: '100%',
                                background: 'var(--bg-secondary)',
                                borderRadius: '3px',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    width: `${item.pct}%`,
                                    height: '100%',
                                    background: item.type === 'Guaranteed' ? 'var(--text-secondary)' : 'var(--primary)',
                                    borderRadius: '3px'
                                }} />
                            </div>
                        </div>
                    </div>
                ))}
                {breakdown.length === 0 && (
                    <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '13px' }}>No contribution to this nutrient.</p>
                )}
            </div>
        </div>
    );
}
