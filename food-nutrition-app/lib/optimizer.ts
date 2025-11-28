import solver from 'javascript-lp-solver';
import type { Food } from '@/lib/db';
import { NUTRIENT_CONFIG } from '@/lib/nutrient-defaults';

export interface OptimizationParams {
    foods: Food[];
    guaranteedFoods?: { food: Food, grams: number }[];
    customConstraints?: Record<string, any>;
    maxCalories?: string | number;
    minCalories?: string | number;
    diversityMode?: boolean;
    maxFoodAmount?: string | number;
    foodConstraints?: Record<number, { min?: number, max?: number }>;
}

export interface OptimizationResult {
    success: boolean;
    message?: string;
    diet?: any[];
    guaranteedStats?: any;
    totalCalories?: number;
    totalNutrients?: any;
    constraintLimits?: any;
    debugEquations?: string[];
    lpModel?: any;
    error?: string;
}

export function optimizeDiet(params: OptimizationParams): OptimizationResult {
    const { foods, guaranteedFoods = [], customConstraints, maxCalories, minCalories, diversityMode, maxFoodAmount, foodConstraints } = params;

    if ((!foods || foods.length === 0) && (!guaranteedFoods || guaranteedFoods.length === 0)) {
        return { success: false, error: 'No foods selected' };
    }

    // 0. Calculate nutrients from Guaranteed Foods
    const guaranteedNutrients: Record<string, number> = {};
    let guaranteedCalories = 0;

    // Initialize with 0
    for (const nutrient of Object.keys(NUTRIENT_CONFIG)) {
        if (nutrient === 'calories') continue;
        guaranteedNutrients[nutrient] = 0;
    }

    if (guaranteedFoods.length > 0) {
        guaranteedFoods.forEach((item: { food: Food, grams: number }) => {
            const multiplier = item.grams / 100;
            guaranteedCalories += (item.food.calories || 0) * multiplier;

            for (const nutrient of Object.keys(NUTRIENT_CONFIG)) {
                if (nutrient === 'calories') continue;
                // @ts-ignore
                const val = item.food[nutrient];
                if (typeof val === 'number') {
                    guaranteedNutrients[nutrient] += val * multiplier;
                }
            }
        });
    }

    // If we only have guaranteed foods and no optimizable foods, just return the stats
    if (!foods || foods.length === 0) {
        return {
            success: true,
            diet: [],
            guaranteedStats: {
                calories: Math.round(guaranteedCalories),
                nutrients: guaranteedNutrients
            },
            totalCalories: Math.round(guaranteedCalories),
            totalNutrients: guaranteedNutrients,
            message: 'Only guaranteed foods provided.'
        };
    }

    // 1. Define the model for the LP solver
    const model = {
        optimize: 'calories',
        opType: 'min' as const, // Minimize calories
        constraints: {} as Record<string, any>,
        variables: {} as Record<string, any>,
    };

    // 2. Set constraints (Daily Values) - Adjusted for Guaranteed Foods
    const constraintLimits: Record<string, { min?: number, max?: number }> = {};

    // Iterate over all nutrients in config
    for (const [nutrient, config] of Object.entries(NUTRIENT_CONFIG)) {
        if (nutrient === 'calories') continue;

        const guaranteedAmount = guaranteedNutrients[nutrient] || 0;

        // Determine effective Min and Max
        // Start with defaults
        let minLimit: number | undefined = config.defaultType === 'min' ? config.defaultValue : undefined;
        let maxLimit: number | undefined = config.defaultType === 'max' ? config.defaultValue : undefined;

        // Override with custom constraints
        if (customConstraints && customConstraints[nutrient]) {
            const custom = customConstraints[nutrient];
            // Check if new format { min, max }
            if (typeof custom === 'object' && (custom.min !== undefined || custom.max !== undefined)) {
                // It's the new dual format (or partial)
                if (custom.min !== undefined && custom.min !== '') minLimit = parseFloat(custom.min);
                else if (custom.min === '') minLimit = undefined; // Explicitly cleared

                if (custom.max !== undefined && custom.max !== '') maxLimit = parseFloat(custom.max);
                else if (custom.max === '') maxLimit = undefined; // Explicitly cleared
            }
            // Fallback for old format { value, type } or just value
            else if (typeof custom === 'object' && custom.value !== undefined) {
                const val = parseFloat(custom.value);
                if (custom.type === 'max') { maxLimit = val; minLimit = undefined; }
                else { minLimit = val; maxLimit = undefined; }
            } else if (typeof custom === 'number' || typeof custom === 'string') {
                const val = parseFloat(custom as string);
                if (config.defaultType === 'max') { maxLimit = val; minLimit = undefined; }
                else { minLimit = val; maxLimit = undefined; }
            }
        }

        // Apply constraints to model
        // Note: LP solver treats 'min' as >= and 'max' as <=
        if (minLimit !== undefined) {
            model.constraints[nutrient] = { ...model.constraints[nutrient], min: Math.max(0, minLimit - guaranteedAmount) };
        }
        if (maxLimit !== undefined) {
            model.constraints[nutrient] = { ...model.constraints[nutrient], max: maxLimit - guaranteedAmount };
        }

        if (minLimit !== undefined || maxLimit !== undefined) {
            constraintLimits[nutrient] = { min: minLimit, max: maxLimit };
        }
    }

    // Add Calorie constraints if provided (legacy or explicit)
    // Add Calorie constraints if provided (legacy or explicit)
    if (maxCalories || minCalories) {
        if (maxCalories) {
            const maxCal = typeof maxCalories === 'string' ? parseFloat(maxCalories) : maxCalories;
            model.constraints.constraint_calories = { ...model.constraints.constraint_calories, max: maxCal - guaranteedCalories };
            constraintLimits['calories'] = { ...constraintLimits['calories'], max: maxCal };
        }
        if (minCalories) {
            const minCal = typeof minCalories === 'string' ? parseFloat(minCalories) : minCalories;
            model.constraints.constraint_calories = { ...model.constraints.constraint_calories, min: Math.max(0, minCal - guaranteedCalories) };
            constraintLimits['calories'] = { ...constraintLimits['calories'], min: minCal };
        }
    } else if (customConstraints && customConstraints['calories']) {
        const custom = customConstraints['calories'];
        let minCal: number | undefined;
        let maxCal: number | undefined;

        if (typeof custom === 'object' && (custom.min !== undefined || custom.max !== undefined)) {
            if (custom.min !== undefined && custom.min !== '') minCal = parseFloat(custom.min);
            if (custom.max !== undefined && custom.max !== '') maxCal = parseFloat(custom.max);
        } else {
            // Legacy fallback
            const val = typeof custom === 'object' ? parseFloat(custom.value) : parseFloat(custom);
            const type = typeof custom === 'object' ? custom.type : 'max';
            if (type === 'max') maxCal = val;
            else minCal = val;
        }

        if (minCal !== undefined) model.constraints.constraint_calories = { ...model.constraints.constraint_calories, min: Math.max(0, minCal - guaranteedCalories) };
        if (maxCal !== undefined) model.constraints.constraint_calories = { ...model.constraints.constraint_calories, max: maxCal - guaranteedCalories };

        if (minCal !== undefined || maxCal !== undefined) {
            constraintLimits['calories'] = { min: minCal, max: maxCal };
        }
    }

    // 3. Define variables (each food is a variable)
    foods.forEach((food: Food) => {
        // Sanitize food name for variable key
        const key = `food_${food.id}`;

        // We optimize for 100g units initially because data is per 100g
        model.variables[key] = {
            calories: food.calories || 0,
            constraint_calories: food.calories || 0, // Duplicate for constraints to avoid conflict with objective
            [key]: 1 // Ensure we can track this specific variable if needed
        };

        // --- Constraint Logic ---
        let maxUnits: number | undefined;
        let minUnits: number | undefined;

        // 1. Default Limit: 3 Servings (if serving sizes exist)
        if (food.serving_sizes && food.serving_sizes.length > 0) {
            // Find reference serving. Prioritize "RACC", then largest by weight.
            let refServing = food.serving_sizes.find(s => s.label.toUpperCase().includes('RACC'));
            if (!refServing) {
                refServing = food.serving_sizes.reduce((prev, current) => (prev.weight_g > current.weight_g) ? prev : current);
            }

            if (refServing && refServing.weight_g > 0) {
                maxUnits = (3 * refServing.weight_g) / 100;
                console.log(`[Optimizer] Food ${food.id} (${food.description}): Default limit = 3 servings (${3 * refServing.weight_g}g)`);
            }
        } else {
            // Fallback if no serving size data: Default to 300g (3 units)
            maxUnits = 3;
            console.log(`[Optimizer] Food ${food.id} (${food.description}): No serving sizes. Default limit = 300g`);
        }

        // 2. Diversity Mode Global Limit (Tightens the default limit if active)
        if (diversityMode && maxFoodAmount) {
            const diversityMax = (typeof maxFoodAmount === 'string' ? parseFloat(maxFoodAmount) : maxFoodAmount) / 100;
            if (maxUnits !== undefined) {
                maxUnits = Math.min(maxUnits, diversityMax);
            } else {
                maxUnits = diversityMax;
            }
        }

        // 3. User Specific Constraints (Override EVERYTHING)
        if (foodConstraints && foodConstraints[food.id]) {
            const constraint = foodConstraints[food.id];
            if (constraint.min !== undefined && constraint.min > 0) {
                minUnits = constraint.min / 100;
            }
            if (constraint.max !== undefined && constraint.max > 0) {
                // User explicit max overrides calculated defaults
                maxUnits = constraint.max / 100;
            }
        }

        if (maxUnits !== undefined || minUnits !== undefined) {
            model.constraints[key] = {};
            if (maxUnits !== undefined) model.constraints[key].max = maxUnits;
            if (minUnits !== undefined) model.constraints[key].min = minUnits;
        }

        // Map nutrient values to the variable
        for (const nutrient of Object.keys(NUTRIENT_CONFIG)) {
            if (nutrient === 'calories') continue;
            // @ts-ignore - dynamic access
            let val = food[nutrient];
            if (typeof val !== 'number') val = 0;
            model.variables[key][nutrient] = val;
        }
    });

    // 4. Solve
    const results = solver.Solve(model);

    if (!results.feasible) {
        // --- INFEASIBILITY DIAGNOSTICS ---
        const diagnostics: string[] = [];

        // Check 1: Do guaranteed foods ALONE violate any MAX constraints?
        for (const [nutrient, limits] of Object.entries(constraintLimits)) {
            if (limits.max !== undefined) {
                // guaranteedNutrients already calculated
                const guaranteedVal = nutrient === 'calories' ? guaranteedCalories : (guaranteedNutrients[nutrient] || 0);
                if (guaranteedVal > limits.max) {
                    const label = NUTRIENT_CONFIG[nutrient]?.label || nutrient;
                    const unit = NUTRIENT_CONFIG[nutrient]?.unit || (nutrient === 'calories' ? 'kcal' : '');
                    diagnostics.push(`Guaranteed foods already exceed ${label} limit (${Math.round(guaranteedVal)}${unit} > ${limits.max}${unit}).`);
                }
            }
        }

        // Check 2: If guaranteed foods are fine (or even if not, let's see what else is wrong), run Diagnostic Solve
        // We create a relaxed model where every constraint can be violated for a penalty.
        const diagnosticModel = JSON.parse(JSON.stringify(model));
        diagnosticModel.optimize = 'penalty';
        diagnosticModel.opType = 'min';
        diagnosticModel.variables = { ...model.variables }; // Copy existing food vars

        // Add slack variables for each constraint
        Object.entries(model.constraints).forEach(([key, constraint]: [string, any]) => {
            if (constraint.min !== undefined) {
                diagnosticModel.variables[`shortage_${key}`] = {
                    [key]: 1,
                    penalty: 100, // Penalty per unit of shortage
                    _isSlack: true,
                    _nutrient: key,
                    _type: 'min'
                };
            }
            if (constraint.max !== undefined) {
                diagnosticModel.variables[`excess_${key}`] = {
                    [key]: -1,
                    penalty: 100, // Penalty per unit of excess
                    _isSlack: true,
                    _nutrient: key,
                    _type: 'max'
                };
            }
        });

        const diagResults = solver.Solve(diagnosticModel);

        // Analyze diagnostic results
        Object.entries(diagResults).forEach(([key, val]) => {
            if (key.startsWith('shortage_') && val > 0.001) {
                const nutrient = key.replace('shortage_', '');

                if (nutrient.startsWith('food_')) {
                    const foodId = parseInt(nutrient.replace('food_', ''));
                    const food = foods.find(f => f.id === foodId);
                    const name = food ? food.description : nutrient;
                    diagnostics.push(`Cannot meet minimum requirement for ${name} (short by ${Math.round(val * 100)}g).`);
                } else {
                    const label = NUTRIENT_CONFIG[nutrient]?.label || nutrient;
                    const unit = NUTRIENT_CONFIG[nutrient]?.unit || '';
                    diagnostics.push(`Cannot meet ${label} target (short by ${Math.round(val)}${unit}).`);
                }
            }
            if (key.startsWith('excess_') && val > 0.001) {
                const nutrient = key.replace('excess_', '');

                if (nutrient.startsWith('food_')) {
                    const foodId = parseInt(nutrient.replace('food_', ''));
                    const food = foods.find(f => f.id === foodId);
                    const name = food ? food.description : nutrient;
                    diagnostics.push(`Cannot stay under limit for ${name} (exceeds by ${Math.round(val * 100)}g).`);
                } else {
                    const label = NUTRIENT_CONFIG[nutrient]?.label || nutrient;
                    const unit = NUTRIENT_CONFIG[nutrient]?.unit || '';
                    diagnostics.push(`Cannot stay under ${label} limit (exceeds by ${Math.round(val)}${unit}).`);
                }
            }
        });

        let message = 'No combination of these foods can meet all daily requirements.';
        if (diagnostics.length > 0) {
            // Deduplicate and limit
            const unique = Array.from(new Set(diagnostics));
            message = `Optimization Failed:\n• ${unique.slice(0, 5).join('\n• ')}`;
            if (unique.length > 5) message += `\n...and ${unique.length - 5} more issues.`;
        }

        // Generate simple debug equations for failure case (just the limits)
        const debugEquations: string[] = [];
        Object.entries(model.constraints).forEach(([nutrient, limits]: [string, any]) => {
            // @ts-ignore
            const label = NUTRIENT_CONFIG[nutrient]?.label || nutrient;
            let eq = `${label}:`;
            if (limits.min !== undefined) eq += ` >= ${Math.round(limits.min)}`;
            if (limits.max !== undefined) eq += ` <= ${Math.round(limits.max)}`;
            debugEquations.push(eq);
        });

        return {
            success: false,
            message: message,
            lpModel: model,
            debugEquations
        };
    }

    // 5. Format results
    const optimizedDiet: any[] = [];
    let optimizedCalories = 0;
    const totalNutrients = { ...guaranteedNutrients }; // Start with guaranteed

    for (const [key, value] of Object.entries(results)) {
        if (key.startsWith('food_')) {
            const foodId = parseInt(key.replace('food_', ''));
            const food = foods.find((f: Food) => f.id === foodId);
            if (food && typeof value === 'number') {
                // value is the multiplier for 100g. So if value is 1.5, that's 150g.
                const grams = Math.round(value * 100);
                if (grams > 0) {
                    const contribution: any = {
                        calories: Math.round(food.calories * value),
                        protein_g: (food.protein_g || 0) * value,
                        carbohydrate_g: (food.carbohydrate_g || 0) * value,
                        total_fat_g: (food.total_fat_g || 0) * value
                    };

                    // Calculate all other nutrients
                    for (const nutrient of Object.keys(NUTRIENT_CONFIG)) {
                        if (nutrient === 'calories') continue;
                        if (!['protein_g', 'carbohydrate_g', 'total_fat_g'].includes(nutrient)) {
                            // @ts-ignore
                            contribution[nutrient] = (food[nutrient] || 0) * value;
                        }
                    }

                    optimizedDiet.push({
                        food,
                        grams,
                        calories: contribution.calories,
                        nutrients: contribution
                    });

                    optimizedCalories += contribution.calories;
                }
            }
        }
    }

    // Re-calculate totals from scratch to be 100% sure
    const finalTotalNutrients: any = { ...guaranteedNutrients };
    optimizedDiet.forEach(item => {
        for (const [key, val] of Object.entries(item.nutrients)) {
            finalTotalNutrients[key] = (finalTotalNutrients[key] || 0) + (val as number);
        }
    });

    // Generate Debug Equations
    const debugEquations: string[] = [];

    // Helper to format food name
    const fmtFood = (name: string) => {
        // Take first part of name and truncate
        return `[${name.split(',')[0].substring(0, 15).trim()}]`;
    };

    // 1. Objective Function (Calories)
    // Show active foods contributing to total calories
    const objParts = optimizedDiet.map(item => {
        return `${Math.round(item.food.calories)} * ${fmtFood(item.food.description)}`;
    });
    if (objParts.length > 0) {
        debugEquations.push(`Minimize Calories: ${objParts.join(' + ')}`);
    }

    // 2. Constraints
    // Show how the active foods satisfy the constraints
    Object.entries(model.constraints).forEach(([nutrient, limits]: [string, any]) => {
        // Filter to active foods that contribute to this nutrient
        const parts = optimizedDiet
            .filter(item => (item.food as any)[nutrient] > 0)
            .map(item => {
                const val = (item.food as any)[nutrient];
                const valStr = val < 1 ? val.toFixed(2) : Math.round(val).toString();
                return `${valStr} * Amt${fmtFood(item.food.description)}`;
            });

        if (parts.length > 0) {
            const lhs = parts.join(' + ');
            const label = NUTRIENT_CONFIG[nutrient]?.label || nutrient;

            let eq = `${label}: ${lhs}`;

            // Add the constraint bounds
            if (limits.min !== undefined) {
                eq += ` >= ${Math.round(limits.min)}`;
            }
            if (limits.max !== undefined) {
                if (limits.min !== undefined) eq += ` AND `;
                eq += ` <= ${Math.round(limits.max)}`;
            } else if (limits.min === undefined && limits.max !== undefined) {
                eq += ` <= ${Math.round(limits.max)}`;
            }

            debugEquations.push(eq);
        }
    });

    return {
        success: true,
        diet: optimizedDiet,
        guaranteedStats: {
            calories: Math.round(guaranteedCalories),
            nutrients: guaranteedNutrients
        },
        totalCalories: Math.round(guaranteedCalories + optimizedCalories),
        totalNutrients: finalTotalNutrients,
        constraintLimits,
        debugEquations,
        lpModel: model
    };
}
