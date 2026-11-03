declare module 'javascript-lp-solver' {
    export interface Constraint {
        min?: number;
        max?: number;
        equal?: number;
    }

    export interface Model {
        optimize: string;
        opType: 'min' | 'max';
        constraints: Record<string, Constraint>;
        /** variable name -> { attribute (constraint or objective) -> coefficient } */
        variables: Record<string, Record<string, number>>;
        ints?: Record<string, number>;
    }

    export interface Result {
        feasible: boolean;
        bounded?: boolean;
        result: number;
        isIntegral?: boolean;
        /** Non-zero variable values, keyed by variable name. */
        [variable: string]: number | boolean | undefined;
    }

    export function Solve(model: Model): Result;
}
