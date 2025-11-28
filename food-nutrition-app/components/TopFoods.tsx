'use client';

import { useState, useEffect } from 'react';
import { NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';
import type { Food } from '@/lib/db';
import FoodCard from './FoodCard';

interface TopFoodsProps {
    onAddFood: (food: Food) => void;
    onAddGuaranteed: (food: Food) => void;
}

export default function TopFoods({ onAddFood, onAddGuaranteed }: TopFoodsProps) {
    const [selectedNutrient, setSelectedNutrient] = useState('protein_g');
    const [foods, setFoods] = useState<Food[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        async function fetchTopFoods() {
            setLoading(true);
            try {
                const res = await fetch(`/api/foods/top?nutrient=${selectedNutrient}`);
                const data = await res.json();
                if (data.foods) {
                    setFoods(data.foods);
                }
            } catch (error) {
                console.error('Failed to fetch top foods:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchTopFoods();
    }, [selectedNutrient]);

    const config = NUTRIENT_CONFIG[selectedNutrient];

    return (
        <div style={{ marginBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)' }}>Top Foods Explorer</h2>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
                        Discover foods highest in specific nutrients.
                    </p>
                </div>
                <select
                    value={selectedNutrient}
                    onChange={(e) => setSelectedNutrient(e.target.value)}
                    style={{
                        padding: '10px 16px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-card)',
                        color: 'var(--text-primary)',
                        fontSize: '14px',
                        fontWeight: '500',
                        cursor: 'pointer'
                    }}
                >
                    {Object.entries(NUTRIENT_CONFIG).map(([key, conf]) => {
                        if (key === 'calories') return null;
                        return (
                            <option key={key} value={key}>{conf.label}</option>
                        );
                    })}
                </select>
            </div>

            {loading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: '20px',
                    maxHeight: '600px',
                    overflowY: 'auto',
                    paddingRight: '4px' // Space for scrollbar
                }}>
                    {foods.map(food => (
                        <div key={food.id} style={{ position: 'relative' }}>
                            <FoodCard
                                food={food}
                                onSelect={() => onAddFood(food)}
                                onAddGuaranteed={() => onAddGuaranteed(food)}
                                isSelected={false} // Just for display
                            />
                            <div style={{
                                position: 'absolute',
                                top: '12px',
                                right: '12px',
                                background: 'var(--primary)',
                                color: 'white',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: '600',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            }}>
                                {/* @ts-ignore */}
                                {(() => {
                                    const val = (food as any)[selectedNutrient];
                                    if (typeof val !== 'number') return '0';
                                    return val < 10 && val % 1 !== 0 ? val.toFixed(1) : Math.round(val);
                                })()}{config.unit}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
