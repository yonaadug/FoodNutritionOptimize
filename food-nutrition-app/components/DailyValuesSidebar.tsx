'use client';

import { useState } from 'react';

// Daily Values based on FDA recommendations (same as in NutritionLabel.tsx)
const DAILY_VALUES = {
    total_fat_g: 78,
    saturated_g: 20,
    cholesterol_mg: 300,
    sodium_mg: 2300,
    carbohydrate_g: 275,
    fiber_g: 28,
    sugars_g: 50,
    protein_g: 50,
    vitamin_d_ug: 20,
    calcium_mg: 1300,
    iron_mg: 18,
    potassium_mg: 4700,
    vitamin_a_ug: 900,
    vitamin_c_mg: 90,
    vitamin_e_mg: 15,
    vitamin_k_ug: 120,
    thiamin_mg: 1.2,
    riboflavin_mg: 1.3,
    niacin_mg: 16,
    vitamin_b6_mg: 1.7,
    folate_ug: 400,
    vitamin_b12_ug: 2.4,
    magnesium_mg: 420,
    zinc_mg: 11,
    copper_mg: 0.9,
    manganese_mg: 2.3,
    selenium_ug: 55
};

export default function DailyValuesSidebar() {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            {/* Toggle Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    style={{
                        position: 'fixed',
                        right: '0',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'var(--text-primary)',
                        color: 'var(--bg-page)',
                        border: 'none',
                        padding: '12px 8px',
                        borderTopLeftRadius: '8px',
                        borderBottomLeftRadius: '8px',
                        cursor: 'pointer',
                        zIndex: 1000,
                        boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        writingMode: 'vertical-rl',
                        textOrientation: 'mixed'
                    }}
                >
                    <span style={{ fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', whiteSpace: 'nowrap' }}>DAILY VALUES</span>
                    ‹
                </button>
            )}

            {/* Sidebar Panel */}
            <div style={{
                position: 'fixed',
                top: 0,
                right: isOpen ? '0' : '-320px',
                width: '320px',
                height: '100vh',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                boxShadow: '-4px 0 16px rgba(0,0,0,0.1)',
                transition: 'right 0.3s ease',
                zIndex: 999,
                overflowY: 'auto',
                padding: '24px',
                borderLeft: '1px solid var(--border)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>Daily Values</h2>
                    <button
                        onClick={() => setIsOpen(false)}
                        style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', padding: '0 8px', color: 'var(--text-primary)' }}
                    >
                        ×
                    </button>
                </div>

                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '24px' }}>
                    Reference values based on FDA recommendations for adults and children 4 years and older (2,000 calorie diet).
                </p>

                <div style={{ display: 'grid', gap: '12px' }}>
                    {Object.entries(DAILY_VALUES).map(([key, value]) => {
                        const label = key.replace(/_/g, ' ').replace(/(g|mg|ug)$/, '').trim();
                        const unit = key.endsWith('ug') ? 'mcg' : key.endsWith('mg') ? 'mg' : 'g';

                        return (
                            <div key={key} style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                padding: '8px 0',
                                borderBottom: '1px solid var(--border)',
                                fontSize: '14px'
                            }}>
                                <span style={{ textTransform: 'capitalize' }}>{label}</span>
                                <span style={{ fontWeight: 'bold' }}>{value}{unit}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Overlay for mobile */}
            {isOpen && (
                <div
                    onClick={() => setIsOpen(false)}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        background: 'rgba(0,0,0,0.5)',
                        zIndex: 998
                    }}
                />
            )}
        </>
    );
}
