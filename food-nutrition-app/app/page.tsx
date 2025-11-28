'use client';

import { useState, useEffect } from 'react';
import SearchBar from '@/components/SearchBar';
import FoodCard from '@/components/FoodCard';
import ComparisonView from '@/components/ComparisonView';
import DailyValuesSidebar from '@/components/DailyValuesSidebar';
import ThemeToggle from '@/components/ThemeToggle';
import NutrientBreakdown from '@/components/NutrientBreakdown';
import TopFoods from '@/components/TopFoods';
import type { Food } from '@/lib/db';

import { NUTRIENT_CONFIG, type ConstraintType } from '@/lib/nutrient-defaults';

export default function Home() {
    const [searchResults, setSearchResults] = useState<Food[]>([]);
    const [selectedFoods, setSelectedFoods] = useState<Food[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [currentQuery, setCurrentQuery] = useState('');

    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optimizationResult, setOptimizationResult] = useState<any>(null);

    // customConstraints is now Record<string, { min?: number, max?: number }>
    const [customConstraints, setCustomConstraints] = useState<Record<string, { min?: number, max?: number }>>({});
    const [maxCalories, setMaxCalories] = useState('');
    const [minCalories, setMinCalories] = useState('');
    const [diversityMode, setDiversityMode] = useState(false);
    const [maxFoodAmount, setMaxFoodAmount] = useState('500'); // Default 500g
    const [isLoaded, setIsLoaded] = useState(false);

    const [guaranteedFoods, setGuaranteedFoods] = useState<{ food: Food, grams: number }[]>([]);

    // foodConstraints: Record<foodId, { min?: number, max?: number }>
    const [foodConstraints, setFoodConstraints] = useState<Record<number, { min?: number, max?: number }>>({});

    // Initialize state on mount, prioritizing localStorage
    useEffect(() => {
        const savedFoods = localStorage.getItem('selectedFoods');
        const savedGuaranteed = localStorage.getItem('guaranteedFoods');
        const savedConstraints = localStorage.getItem('customConstraints');
        const savedFoodConstraints = localStorage.getItem('foodConstraints');
        const savedMaxCalories = localStorage.getItem('maxCalories');

        if (savedFoods) setSelectedFoods(JSON.parse(savedFoods));
        if (savedGuaranteed) setGuaranteedFoods(JSON.parse(savedGuaranteed));
        if (savedFoodConstraints) setFoodConstraints(JSON.parse(savedFoodConstraints));
        if (savedMaxCalories) setMaxCalories(savedMaxCalories);
        const savedMinCalories = localStorage.getItem('minCalories');
        if (savedMinCalories) setMinCalories(savedMinCalories);
        const savedMaxFoodAmount = localStorage.getItem('maxFoodAmount');
        if (savedMaxFoodAmount) setMaxFoodAmount(savedMaxFoodAmount);

        if (savedConstraints) {
            const parsed = JSON.parse(savedConstraints);
            const migrated: Record<string, { min?: number, max?: number }> = {};

            Object.entries(parsed).forEach(([key, val]: [string, any]) => {
                // Check format
                if (typeof val === 'object' && (val.min !== undefined || val.max !== undefined)) {
                    // New format
                    migrated[key] = val;
                } else if (typeof val === 'object' && val.value !== undefined) {
                    // Previous format { value, type }
                    if (val.type === 'max') migrated[key] = { max: val.value };
                    else migrated[key] = { min: val.value };
                } else {
                    // Oldest format (value only)
                    const config = NUTRIENT_CONFIG[key];
                    if (config) {
                        if (config.defaultType === 'max') migrated[key] = { max: parseFloat(val) };
                        else migrated[key] = { min: parseFloat(val) };
                    }
                }
            });

            // Merge with defaults
            Object.entries(NUTRIENT_CONFIG).forEach(([key, config]) => {
                if (key !== 'calories' && !migrated[key]) {
                    if (config.defaultType === 'min') migrated[key] = { min: config.defaultValue };
                    else migrated[key] = { max: config.defaultValue };
                }
            });

            setCustomConstraints(migrated);
        } else {
            const defaults: Record<string, { min?: number, max?: number }> = {};
            Object.entries(NUTRIENT_CONFIG).forEach(([key, config]) => {
                if (key !== 'calories') {
                    if (config.defaultType === 'min') defaults[key] = { min: config.defaultValue };
                    else defaults[key] = { max: config.defaultValue };
                }
            });
            setCustomConstraints(defaults);
        }

        setIsLoaded(true);
    }, []);

    // Save to localStorage on change
    useEffect(() => {
        if (isLoaded) {
            localStorage.setItem('selectedFoods', JSON.stringify(selectedFoods));
            localStorage.setItem('guaranteedFoods', JSON.stringify(guaranteedFoods));
            localStorage.setItem('customConstraints', JSON.stringify(customConstraints));
            localStorage.setItem('foodConstraints', JSON.stringify(foodConstraints));
            localStorage.setItem('maxCalories', maxCalories);
            localStorage.setItem('minCalories', minCalories);
            localStorage.setItem('maxFoodAmount', maxFoodAmount);
        }
    }, [selectedFoods, guaranteedFoods, customConstraints, maxCalories, minCalories, isLoaded, maxFoodAmount]);

    const handleSearch = async (query: string, page: number = 1) => {
        if (!query.trim()) {
            setSearchResults([]);
            setTotalPages(0);
            return;
        }

        setIsLoading(true);
        setCurrentQuery(query);
        setCurrentPage(page);

        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}&limit=20`);
            const data = await response.json();
            setSearchResults(data.foods || []);
            setTotalPages(data.totalPages || 0);
        } catch (error) {
            console.error('Search failed:', error);
            setSearchResults([]);
            setTotalPages(0);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            handleSearch(currentQuery, newPage);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const handleSelectFood = (food: Food) => {
        // Toggle selection
        if (selectedFoods.find(f => f.id === food.id)) {
            setSelectedFoods(selectedFoods.filter(f => f.id !== food.id));
        } else {
            setSelectedFoods([...selectedFoods, food]);
        }
        // Reset optimization when selection changes
        setOptimizationResult(null);
    };

    const handleAddFood = (food: Food) => {
        // Add if not already selected
        if (!selectedFoods.find(f => f.id === food.id)) {
            setSelectedFoods([...selectedFoods, food]);
            setOptimizationResult(null);
        }
    };

    const handleAddGuaranteed = (food: Food) => {
        // Check if already exists
        if (!guaranteedFoods.find(item => item.food.id === food.id)) {
            setGuaranteedFoods([...guaranteedFoods, { food, grams: 100 }]); // Default 100g
            setOptimizationResult(null);
        }
    };

    const handleUpdateGuaranteedWeight = (foodId: number, grams: number) => {
        setGuaranteedFoods(guaranteedFoods.map(item =>
            item.food.id === foodId ? { ...item, grams } : item
        ));
        setOptimizationResult(null);
    };

    const handleRemoveGuaranteed = (foodId: number) => {
        setGuaranteedFoods(guaranteedFoods.filter(item => item.food.id !== foodId));
        setOptimizationResult(null);
    };

    const handleRemoveFood = (foodId: number) => {
        setSelectedFoods(selectedFoods.filter(f => f.id !== foodId));
        setOptimizationResult(null);
    };

    const handleConstraintChange = (key: string, field: 'min' | 'max', val: any) => {
        setCustomConstraints(prev => ({
            ...prev,
            [key]: {
                ...prev[key],
                [field]: val
            }
        }));
    };

    const handleOptimize = async () => {
        if (selectedFoods.length === 0 && guaranteedFoods.length === 0) return;

        setIsOptimizing(true);
        setOptimizationResult(null);

        try {
            const res = await fetch('/api/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    foods: selectedFoods,
                    guaranteedFoods,
                    customConstraints,
                    maxCalories: maxCalories || undefined,
                    minCalories: minCalories || undefined,
                    diversityMode,
                    maxFoodAmount: maxFoodAmount || undefined,
                    foodConstraints
                })
            });
            const data = await res.json();
            setOptimizationResult(data);
        } catch (error) {
            console.error('Optimization failed:', error);
            setOptimizationResult({ success: false, message: 'An unexpected error occurred.' });
        } finally {
            setIsOptimizing(false);
        }
    };

    return (
        <main className="container" style={{ paddingTop: '40px', paddingBottom: '80px' }}>
            <ThemeToggle />
            {/* Debug Tab Button */}
            <button
                className="btn-icon"
                style={{
                    position: 'fixed',
                    top: '70px',
                    right: '20px',
                    zIndex: 1000,
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: 'var(--bg-card)',
                    boxShadow: 'var(--shadow-md)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                }}
                onClick={() => {
                    const debugSection = document.getElementById('debug-section');
                    if (debugSection) {
                        debugSection.scrollIntoView({ behavior: 'smooth' });
                        const details = debugSection.querySelector('details');
                        if (details) details.open = true;
                    }
                }}
                title="Go to Debug Section"
            >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
            </button>
            <DailyValuesSidebar />
            {/* Header */}
            <header style={{ textAlign: 'center', marginBottom: '48px' }}>
                <h1 className="hero-title">
                    NutriCompare
                </h1>
                <p className="hero-subtitle">
                    Search and compare nutrition facts for produce, meat, and dairy
                </p>
            </header>

            {/* Search Bar */}
            <SearchBar onSearch={(q) => handleSearch(q, 1)} isLoading={isLoading} />

            {/* Search Results */}
            {searchResults.length > 0 && (
                <section style={{ marginTop: '40px' }}>
                    <h2 className="section-title">
                        Search Results
                    </h2>
                    <div className="grid-auto-fill">
                        {searchResults.map(food => (
                            <FoodCard
                                key={food.id}
                                food={food}
                                onSelect={handleSelectFood}
                                isSelected={selectedFoods.some(f => f.id === food.id)}
                                onAddGuaranteed={handleAddGuaranteed}
                            />
                        ))}
                    </div>

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                        <div style={{
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            gap: '16px',
                            marginTop: '40px'
                        }}>
                            <button
                                onClick={() => handlePageChange(currentPage - 1)}
                                disabled={currentPage === 1}
                                className="btn-secondary"
                                style={{ opacity: currentPage === 1 ? 0.5 : 1 }}
                            >
                                Previous
                            </button>
                            <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>
                                Page {currentPage} of {totalPages}
                            </span>
                            <button
                                onClick={() => handlePageChange(currentPage + 1)}
                                disabled={currentPage === totalPages}
                                className="btn-secondary"
                                style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}
                            >
                                Next
                            </button>
                        </div>
                    )}
                </section>
            )}

            {/* Guaranteed Foods Section */}
            {guaranteedFoods.length > 0 && (
                <section style={{ marginTop: '60px' }}>
                    <h2 className="section-title">Guaranteed Foods (Fixed)</h2>
                    <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                        {guaranteedFoods.map((item) => (
                            <div key={item.food.id} style={{
                                background: 'var(--bg-card)',
                                padding: '16px',
                                borderRadius: '12px',
                                border: '1px solid var(--border)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '12px'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>{item.food.description}</h3>
                                    <button
                                        onClick={() => handleRemoveGuaranteed(item.food.id)}
                                        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px' }}
                                    >
                                        ×
                                    </button>
                                </div>
                                <div>
                                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Weight (grams)</label>
                                    <input
                                        type="number"
                                        value={item.grams}
                                        onChange={(e) => handleUpdateGuaranteedWeight(item.food.id, parseInt(e.target.value) || 0)}
                                        style={{
                                            width: '100%',
                                            padding: '8px',
                                            borderRadius: '6px',
                                            border: '1px solid var(--border)',
                                            background: 'var(--bg-page)',
                                            color: 'var(--text-primary)'
                                        }}
                                    />
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                    {Math.round(item.food.calories * (item.grams / 100))} kcal • {(item.food.protein_g * (item.grams / 100)).toFixed(1)}g Protein
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* Top Foods Explorer */}
            <section style={{ marginTop: '60px' }}>
                <TopFoods
                    onAddFood={handleAddFood}
                    onAddGuaranteed={handleAddGuaranteed}
                />
            </section>

            {/* Comparison View */}
            {(selectedFoods.length > 0 || guaranteedFoods.length > 0) && (
                <section style={{ marginTop: '60px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                        <h2 className="section-title" style={{ marginBottom: 0 }}>
                            Optimizable Candidates ({selectedFoods.length})
                        </h2>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button
                                onClick={() => {
                                    setSelectedFoods([]);
                                    setGuaranteedFoods([]);
                                    setCustomConstraints({});
                                    setMaxCalories('');
                                    setOptimizationResult(null);
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--danger)',
                                    cursor: 'pointer',
                                    fontSize: '14px',
                                    fontWeight: '600'
                                }}
                            >
                                Reset All
                            </button>
                        </div>
                    </div>

                    {/* Optimization Controls */}
                    <div style={{
                        marginBottom: '32px',
                        padding: '20px',
                        background: 'var(--bg-card)',
                        borderRadius: '12px',
                        border: '1px solid var(--border)'
                    }}>
                        <h3 style={{ marginTop: 0, marginBottom: '16px', fontSize: '16px', color: 'var(--text-primary)' }}>Optimization Settings</h3>

                        {/* Top Foods Explorer */}
                        {/* Moved to main view */}

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '32px', alignItems: 'start' }}>
                            {/* Calorie Limits */}
                            <div style={{ gridColumn: '1 / -1', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-primary)' }}>
                                    Calorie Limits (kcal)
                                </label>
                                <div style={{ display: 'flex', gap: '16px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                                            Min Calories
                                        </label>
                                        <input
                                            type="number"
                                            placeholder="No limit"
                                            value={minCalories}
                                            onChange={(e) => setMinCalories(e.target.value)}
                                            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                                            Max Calories
                                        </label>
                                        <input
                                            type="number"
                                            placeholder="No limit (minimize)"
                                            value={maxCalories}
                                            onChange={(e) => setMaxCalories(e.target.value)}
                                            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Diversity Toggle */}
                            <div style={{ gridColumn: '1 / -1', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: '16px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
                                            Diversity Mode
                                        </label>
                                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            Limit each food to a maximum amount to encourage variety.
                                        </p>
                                        {diversityMode && (
                                            <div style={{ marginTop: '12px', maxWidth: '200px' }}>
                                                <label style={{ display: 'block', fontSize: '12px', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                                                    Max per food (grams)
                                                </label>
                                                <input
                                                    type="number"
                                                    placeholder="500"
                                                    value={maxFoodAmount}
                                                    onChange={(e) => setMaxFoodAmount(e.target.value)}
                                                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)' }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '40px', height: '24px', flexShrink: 0 }}>
                                        <input
                                            type="checkbox"
                                            checked={diversityMode}
                                            onChange={(e) => setDiversityMode(e.target.checked)}
                                            style={{ opacity: 0, width: 0, height: 0 }}
                                        />
                                        <span className="slider round" style={{
                                            position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                            backgroundColor: diversityMode ? 'var(--primary)' : '#ccc',
                                            transition: '.4s', borderRadius: '34px'
                                        }}>
                                            <span style={{
                                                position: 'absolute', content: '""', height: '16px', width: '16px',
                                                left: diversityMode ? '20px' : '4px', bottom: '4px',
                                                backgroundColor: 'white', transition: '.4s', borderRadius: '50%'
                                            }} />
                                        </span>
                                    </label>
                                </div>
                            </div>

                            {/* Dynamic Nutrient Constraints */}
                            {Object.entries(NUTRIENT_CONFIG).map(([key, config]) => {
                                if (key === 'calories') return null;
                                const constraint = customConstraints[key] || {
                                    min: config.defaultType === 'min' ? config.defaultValue : undefined,
                                    max: config.defaultType === 'max' ? config.defaultValue : undefined
                                };

                                return (
                                    <div key={key}>
                                        <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                                            {config.label} ({config.unit})
                                        </label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <div style={{ flex: 1 }}>
                                                <input
                                                    type="number"
                                                    placeholder="Min"
                                                    value={constraint.min !== undefined ? constraint.min : ''}
                                                    onChange={(e) => handleConstraintChange(key, 'min', e.target.value ? parseFloat(e.target.value) : undefined)}
                                                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)', fontSize: '13px' }}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <input
                                                    type="number"
                                                    placeholder="Max"
                                                    value={constraint.max !== undefined ? constraint.max : ''}
                                                    onChange={(e) => handleConstraintChange(key, 'max', e.target.value ? parseFloat(e.target.value) : undefined)}
                                                    style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-page)', color: 'var(--text-primary)', fontSize: '13px' }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <button
                            onClick={handleOptimize}
                            disabled={isOptimizing}
                            className="btn-primary"
                            style={{
                                background: 'var(--btn-success-bg)',
                                color: 'var(--btn-success-text)',
                                border: 'none',
                                padding: '10px 24px',
                                borderRadius: '6px',
                                fontWeight: '600',
                                cursor: isOptimizing ? 'wait' : 'pointer',
                                opacity: isOptimizing ? 0.7 : 1,
                                width: '100%'
                            }}
                        >
                            {isOptimizing ? 'Calculating Optimal Diet...' : 'Optimize Diet'}
                        </button>
                    </div>

                    {/* Optimization Results */}
                    {optimizationResult && (
                        <div style={{
                            marginBottom: '32px',
                            padding: '24px',
                            background: optimizationResult.success ? 'var(--success-bg)' : 'var(--danger-bg)',
                            borderRadius: '12px',
                            border: `1px solid ${optimizationResult.success ? 'var(--success)' : 'var(--danger)'}`
                        }}>
                            <h3 style={{
                                marginTop: 0,
                                color: optimizationResult.success ? 'var(--success)' : 'var(--danger)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}>
                                {optimizationResult.success ? (
                                    <>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                            <polyline points="22 4 12 14.01 9 11.01" />
                                        </svg>
                                        Optimized Diet Plan
                                    </>
                                ) : (
                                    <>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10" />
                                            <line x1="12" y1="8" x2="12" y2="12" />
                                            <line x1="12" y1="16" x2="12.01" y2="16" />
                                        </svg>
                                        Optimization Failed
                                    </>
                                )}
                            </h3>

                            {optimizationResult.success ? (
                                <div>
                                    <p style={{ marginBottom: '24px', color: 'var(--text-primary)' }}>
                                        To meet 100% of your daily nutrient requirements with minimum calories (<strong>{optimizationResult.totalCalories} kcal</strong>), consume:
                                    </p>

                                    {/* Constraints Analysis */}
                                    <div style={{ marginBottom: '32px', padding: '16px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                        <h4 style={{ marginTop: 0, marginBottom: '16px', fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>Constraints Analysis</h4>
                                        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                                            {Object.entries(optimizationResult.constraintLimits || {}).map(([key, limits]: [string, any]) => {
                                                const totalVal = key === 'calories'
                                                    ? optimizationResult.totalCalories
                                                    : optimizationResult.totalNutrients[key];

                                                const guaranteedVal = key === 'calories'
                                                    ? optimizationResult.guaranteedStats?.calories || 0
                                                    : optimizationResult.guaranteedStats?.nutrients?.[key] || 0;

                                                const min = limits.min;
                                                const max = limits.max;

                                                // Determine "Target" for progress bar scaling
                                                // If Max exists, that's the 100% mark (or slightly more if exceeded).
                                                // If only Min exists, that's the 100% mark.
                                                const referenceValue = max !== undefined ? max : (min !== undefined ? min : totalVal);
                                                if (referenceValue === 0) return null; // Should not happen usually

                                                const pct = (totalVal / referenceValue) * 100;
                                                const guaranteedPct = (guaranteedVal / referenceValue) * 100;

                                                const label = key.replace(/_/g, ' ').replace(/(g|mg|ug)$/, '').trim();
                                                const unit = key.endsWith('ug') ? 'mcg' : key.endsWith('mg') ? 'mg' : key === 'calories' ? 'kcal' : 'g';

                                                // Status Logic
                                                let isMet = true;
                                                if (min !== undefined && totalVal < min) isMet = false;
                                                if (max !== undefined && totalVal > max) isMet = false;

                                                // Color logic
                                                let barColor = 'var(--success)';
                                                if (max !== undefined && totalVal > max) barColor = 'var(--danger)'; // Exceeded Max
                                                else if (min !== undefined && totalVal < min) barColor = '#eab308'; // Under Min (Yellow)

                                                // Text display
                                                let limitText = '';
                                                if (min !== undefined && max !== undefined) limitText = `${min} - ${max}`;
                                                else if (min !== undefined) limitText = `> ${min}`;
                                                else if (max !== undefined) limitText = `< ${max}`;

                                                return (
                                                    <div key={key} style={{ fontSize: '12px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                            <span style={{ textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
                                                                {label}
                                                            </span>
                                                            <span style={{ fontWeight: '600', color: isMet ? 'var(--success)' : (barColor === '#eab308' ? '#eab308' : 'var(--danger)') }}>
                                                                {Math.round(totalVal)}{unit} <span style={{ color: 'var(--text-muted)', fontWeight: '400' }}>/ {limitText}{unit}</span>
                                                            </span>
                                                        </div>
                                                        <div style={{
                                                            height: '6px',
                                                            width: '100%',
                                                            background: 'var(--bg-card)',
                                                            borderRadius: '3px',
                                                            overflow: 'hidden',
                                                            position: 'relative',
                                                            border: '1px solid var(--border)'
                                                        }}>
                                                            {/* Guaranteed Portion */}
                                                            <div style={{
                                                                position: 'absolute',
                                                                left: 0,
                                                                top: 0,
                                                                bottom: 0,
                                                                width: `${Math.min(100, guaranteedPct)}%`,
                                                                background: 'var(--text-muted)',
                                                                opacity: 0.5
                                                            }} />
                                                            {/* Total Portion (overlaying guaranteed, but we want them stacked visually? No, total includes guaranteed) */}
                                                            {/* Actually, let's just show Total bar. If we want to show guaranteed distinct, we need stacked bars. */}
                                                            {/* Let's do: Guaranteed (Grey) + Optimized (Color) */}

                                                            {/* Re-think: Total bar is the main thing. */}
                                                            <div style={{
                                                                width: `${Math.min(100, pct)}%`,
                                                                height: '100%',
                                                                background: barColor,
                                                                transition: 'width 0.5s ease'
                                                            }} />

                                                            {/* Min Marker if range */}
                                                            {min !== undefined && max !== undefined && (
                                                                <div style={{
                                                                    position: 'absolute',
                                                                    left: `${Math.min(100, (min / max) * 100)}%`,
                                                                    top: 0,
                                                                    bottom: 0,
                                                                    width: '2px',
                                                                    background: 'var(--text-primary)',
                                                                    opacity: 0.5
                                                                }} />
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <NutrientBreakdown
                                        optimizationResult={optimizationResult}
                                        guaranteedFoods={guaranteedFoods}
                                    />


                                    <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                                        {optimizationResult.diet.map((item: any, idx: number) => {
                                            // Calculate percentages for visual bar
                                            const totalMacros = item.nutrients.protein_g + item.nutrients.carbohydrate_g + item.nutrients.total_fat_g;
                                            const pPct = totalMacros ? (item.nutrients.protein_g / totalMacros) * 100 : 0;
                                            const cPct = totalMacros ? (item.nutrients.carbohydrate_g / totalMacros) * 100 : 0;
                                            const fPct = totalMacros ? (item.nutrients.total_fat_g / totalMacros) * 100 : 0;

                                            return (
                                                <div key={idx} style={{
                                                    background: 'var(--bg-card)',
                                                    padding: '16px',
                                                    borderRadius: '8px',
                                                    boxShadow: 'var(--shadow-sm)',
                                                    border: '1px solid var(--border)'
                                                }}>
                                                    <div style={{ fontWeight: 'bold', marginBottom: '4px', fontSize: '16px', color: 'var(--text-primary)' }}>{item.food.description}</div>
                                                    <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '12px', display: 'flex', alignItems: 'baseline' }}>
                                                        <span style={{ color: 'var(--success)', fontWeight: '700', fontSize: '20px' }}>{item.grams}g</span>
                                                        <span style={{ margin: '0 8px', color: 'var(--border)' }}>|</span>
                                                        <span style={{ fontWeight: '500' }}>{item.calories} kcal</span>
                                                    </div>

                                                    {/* Macro Visuals */}
                                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                                        <span>Protein: {item.nutrients.protein_g.toFixed(1)}g</span>
                                                        <span>Carbs: {item.nutrients.carbohydrate_g.toFixed(1)}g</span>
                                                        <span>Fat: {item.nutrients.total_fat_g.toFixed(1)}g</span>
                                                    </div>
                                                    <div style={{
                                                        height: '8px',
                                                        width: '100%',
                                                        background: 'var(--bg-secondary)',
                                                        borderRadius: '4px',
                                                        overflow: 'hidden',
                                                        display: 'flex',
                                                        marginBottom: '12px'
                                                    }}>
                                                        <div style={{ width: `${pPct}%`, background: '#3b82f6' }} title="Protein" />
                                                        <div style={{ width: `${cPct}%`, background: '#22c55e' }} title="Carbs" />
                                                        <div style={{ width: `${fPct}%`, background: '#eab308' }} title="Fat" />
                                                    </div>

                                                    {/* Expandable Details */}
                                                    <details style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                        <summary style={{ cursor: 'pointer', userSelect: 'none', fontWeight: '600' }}>View Micronutrients</summary>
                                                        <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                                                            {Object.entries(item.nutrients).map(([key, val]: [string, any]) => {
                                                                if (['protein_g', 'carbohydrate_g', 'total_fat_g', 'calories'].includes(key)) return null;
                                                                if (val === 0) return null;
                                                                const label = key.replace(/_/g, ' ').replace(/(g|mg|ug)$/, '').trim();
                                                                const unit = key.endsWith('ug') ? 'mcg' : key.endsWith('mg') ? 'mg' : 'g';
                                                                return (
                                                                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                        <span style={{ textTransform: 'capitalize' }}>{label}</span>
                                                                        <span>{val.toFixed(1)}{unit}</span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </details>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6' }} /> Protein</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }} /> Carbs</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#eab308' }} /> Fat</div>
                                    </div>
                                </div>
                            ) : null}
                            {optimizationResult.success === false && (
                                <div style={{ padding: '16px', background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: '8px', color: 'var(--danger)', marginBottom: '24px', whiteSpace: 'pre-line' }}>
                                    {optimizationResult.message}
                                </div>
                            )}

                            {/* Debug Equations (Always Visible) */}
                            {(optimizationResult.debugEquations || optimizationResult.lpModel) && (
                                <div id="debug-section" style={{ marginBottom: '32px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {/* Equations View */}
                                    {optimizationResult.debugEquations && (
                                        <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                            <details>
                                                <summary style={{ cursor: 'pointer', fontWeight: '600', color: 'var(--text-primary)' }}>
                                                    Debug: Optimization Equations
                                                </summary>
                                                <div style={{ marginTop: '16px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: '300px', overflowY: 'auto' }}>
                                                    {optimizationResult.debugEquations.map((eq: string, i: number) => (
                                                        <div key={i} style={{ marginBottom: '4px', paddingBottom: '4px', borderBottom: '1px solid var(--border)' }}>
                                                            {eq}
                                                        </div>
                                                    ))}
                                                </div>
                                            </details>
                                        </div>
                                    )}

                                    {/* LP Model View */}
                                    {optimizationResult.lpModel && (
                                        <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                            <details>
                                                <summary style={{ cursor: 'pointer', fontWeight: '600', color: 'var(--text-primary)' }}>
                                                    Debug: LP Constraints (Raw)
                                                </summary>
                                                <div style={{ marginTop: '16px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', maxHeight: '300px', overflowY: 'auto' }}>
                                                    <pre style={{ margin: 0 }}>
                                                        {JSON.stringify(optimizationResult.lpModel.constraints, null, 2)}
                                                    </pre>
                                                </div>
                                            </details>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <ComparisonView
                        foods={selectedFoods}
                        onRemove={handleRemoveFood}
                        foodConstraints={foodConstraints}
                        onUpdateConstraint={(foodId, type, value) => {
                            setFoodConstraints(prev => ({
                                ...prev,
                                [foodId]: {
                                    ...prev[foodId],
                                    [type]: value
                                }
                            }));
                        }}
                    />
                </section>
            )}

            {/* Empty State */}
            {searchResults.length === 0 && selectedFoods.length === 0 && !isLoading && (
                <div style={{
                    textAlign: 'center',
                    marginTop: '80px',
                    color: 'var(--text-muted)'
                }}>
                    <svg
                        width="120"
                        height="120"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        style={{ margin: '0 auto 24px', opacity: 0.3 }}
                    >
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                    </svg>
                    <p style={{ fontSize: '18px' }}>
                        Search for a food item to get started
                    </p>
                </div>
            )}
        </main>
    );
}
