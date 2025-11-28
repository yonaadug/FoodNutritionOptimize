declare module 'javascript-lp-solver' {
    export interface Model {
        optimize: string;
        opType: 'min' | 'max';
        constraints: Record<string, any>;
        variables: Record<string, any>;
        ints?: Record<string, number>;
    }

    export interface Result {
        feasible: boolean;
        result: number;
        [key: string]: any;
    }

    export function Solve(model: Model): Result;
}
