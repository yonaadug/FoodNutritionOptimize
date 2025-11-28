'use client';

import type { Food } from '@/lib/db';

interface FoodCardProps {
    food: Food;
    onSelect: (food: Food) => void;
    isSelected: boolean;
    onAddGuaranteed?: (food: Food) => void;
}

export default function FoodCard({ food, onSelect, isSelected, onAddGuaranteed }: FoodCardProps) {
    return (
        <div
            className="card"
            style={{
                background: isSelected
                    ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.15))'
                    : 'var(--bg-card)',
                borderColor: isSelected ? 'var(--accent-primary)' : 'var(--border)',
                padding: '20px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
            }}
            onMouseEnter={(e) => {
                if (!isSelected) {
                    e.currentTarget.style.borderColor = 'var(--accent-primary)';
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-hover)';
                }
            }}
            onMouseLeave={(e) => {
                if (!isSelected) {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                }
            }}
        >
            <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => onSelect(food)}>
                {isSelected && (
                    <div style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        background: 'var(--accent-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </div>
                )}

                <h3 style={{
                    fontSize: '16px',
                    fontWeight: '700',
                    marginBottom: '8px',
                    color: 'var(--text-primary)',
                    paddingRight: isSelected ? '32px' : '0'
                }}>
                    {food.description}
                </h3>

                <p style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    marginBottom: '16px'
                }}>
                    {food.food_category} • {food.data_type}
                </p>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '12px',
                    marginBottom: '16px'
                }}>
                    <NutrientPill label="Calories" value={Math.round(food.calories)} unit="kcal" />
                    <NutrientPill label="Protein" value={food.protein_g.toFixed(1)} unit="g" />
                    <NutrientPill label="Carbs" value={food.carbohydrate_g.toFixed(1)} unit="g" />
                    <NutrientPill label="Fat" value={food.total_fat_g.toFixed(1)} unit="g" />
                </div>

                {/* Serving Sizes */}
                {food.serving_sizes && food.serving_sizes.length > 0 && (
                    <div style={{ marginBottom: '16px' }}>
                        <p style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            Servings:
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {food.serving_sizes.slice(0, 3).map(s => (
                                <span
                                    key={s.id}
                                    style={{
                                        fontSize: '10px',
                                        padding: '2px 6px',
                                        background: 'var(--bg-secondary)',
                                        border: '1px solid var(--border)',
                                        borderRadius: '4px',
                                        color: 'var(--text-muted)'
                                    }}
                                    title={`${s.weight_g}g`}
                                >
                                    {s.label} ({Math.round(s.weight_g)}g)
                                </span>
                            ))}
                            {food.serving_sizes.length > 3 && (
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', padding: '2px' }}>
                                    +{food.serving_sizes.length - 3} more
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Actions */}
            {onAddGuaranteed && (
                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect(food);
                        }}
                        style={{
                            flex: 1,
                            padding: '8px',
                            borderRadius: '6px',
                            border: '1px solid var(--border)',
                            background: isSelected ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                            color: isSelected ? 'white' : 'var(--text-primary)',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer'
                        }}
                    >
                        {isSelected ? 'Selected' : 'Add to Optimize'}
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onAddGuaranteed(food);
                        }}
                        style={{
                            flex: 1,
                            padding: '8px',
                            borderRadius: '6px',
                            border: '1px solid var(--border)',
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer'
                        }}
                    >
                        Add Fixed
                    </button>
                </div>
            )}
        </div>
    );
}

function NutrientPill({ label, value, unit }: { label: string; value: string | number; unit: string }) {
    return (
        <div className="pill">
            <div style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                marginBottom: '2px'
            }}>
                {label}
            </div>
            <div style={{
                fontSize: '14px',
                fontWeight: '700',
                color: 'var(--text-primary)'
            }}>
                {value} <span style={{ fontSize: '11px', fontWeight: '400' }}>{unit}</span>
            </div>
        </div>
    );
}
