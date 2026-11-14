/**
 * HiGHS (MIT, compiled to WebAssembly by the `highs` package) for the week planner's
 * mixed-integer program. javascript-lp-solver still runs the instant one-day plan; for a week
 * (about 400 integer variables at 30 foods) its branch and bound didn't finish in minutes and
 * didn't honour its timeout (measurements in docs/WEBSITE_WALKTHROUGH.md, "Plan a week").
 *
 * Models are built in javascript-lp-solver's JSON shape (rows and variables by name) and
 * written out here as CPLEX LP text, which is what HiGHS reads.
 */
import type { Highs } from 'highs';

export interface Constraint { min?: number; max?: number; equal?: number }
export interface JsModel {
    optimize: string;
    opType: 'min' | 'max';
    constraints: Record<string, Constraint>;
    variables: Record<string, Record<string, number>>;
    ints?: Record<string, 1>;
    binaries?: Record<string, 1>;
}

export interface SolveOptions {
    /** Seconds. */
    timeLimit?: number;
    /** Relative MIP gap at which a plan counts as good enough. */
    mipGap?: number;
}

export type Solved = Record<string, number> & {
    feasible: boolean;
    /** HiGHS's status text ("Optimal", "Time limit reached", "Infeasible", ...). */
    status: string;
    timeLimited: boolean;
};

let loader: Promise<Highs> | null = null;

/** The solver, loaded once per process (about 3 MB of WebAssembly). */
export function getHighs(): Promise<Highs> {
    loader ??= import('highs').then(m => {
        const load = (m as unknown as { default: (o?: object) => Promise<Highs> }).default ?? (m as unknown as (o?: object) => Promise<Highs>);
        return load();
    }).catch(e => {
        loader = null;
        throw e;
    });
    return loader;
}

function num(n: number): string {
    if (!Number.isFinite(n)) throw new RangeError(`Non-finite coefficient ${n}`);
    return String(Number(n.toPrecision(12)));
}

function expression(terms: [string, number][]): string {
    const parts: string[] = [];
    terms.forEach(([name, c], i) => {
        const sign = c < 0 ? '-' : '+';
        parts.push(`${i === 0 && sign === '+' ? '' : `${sign} `}${num(Math.abs(c))} ${name}`);
    });
    // Short lines: some LP readers cap line length.
    const lines: string[] = [];
    for (let i = 0; i < parts.length; i += 8) lines.push(parts.slice(i, i + 8).join(' '));
    return lines.join('\n   ');
}

/**
 * The model as CPLEX LP text. Returns null when a row with no variables can't hold (the model
 * is infeasible before any solving).
 */
export function toLpText(model: JsModel): { text: string; columns: string[] } | null {
    const names = Object.keys(model.variables);
    const col = new Map(names.map((n, i) => [n, `x${i}`]));
    const rows = new Map<string, [string, number][]>();
    for (const row of Object.keys(model.constraints)) rows.set(row, []);
    const objective: [string, number][] = [];
    const used = new Set<string>();
    for (const [name, coeffs] of Object.entries(model.variables)) {
        const c = col.get(name)!;
        for (const [row, v] of Object.entries(coeffs)) {
            if (!v) continue;
            if (row === model.optimize) { objective.push([c, v]); used.add(c); }
            const terms = rows.get(row);
            if (terms) { terms.push([c, v]); used.add(c); }
        }
    }
    const out: string[] = [model.opType === 'max' ? 'Maximize' : 'Minimize'];
    out.push(` obj: ${objective.length ? expression(objective) : `0 ${col.get(names[0]) ?? 'x0'}`}`);
    out.push('Subject To');
    let r = 0;
    for (const [row, bounds] of Object.entries(model.constraints)) {
        const terms = rows.get(row)!;
        if (terms.length === 0) {
            const lo = bounds.equal ?? bounds.min;
            const hi = bounds.equal ?? bounds.max;
            if ((lo !== undefined && lo > 1e-9) || (hi !== undefined && hi < -1e-9)) return null;
            continue;
        }
        const expr = expression(terms);
        if (bounds.equal !== undefined) out.push(` r${r++}: ${expr} = ${num(bounds.equal)}`);
        else {
            if (bounds.min !== undefined) out.push(` r${r++}: ${expr} >= ${num(bounds.min)}`);
            if (bounds.max !== undefined) out.push(` r${r++}: ${expr} <= ${num(bounds.max)}`);
        }
    }
    if (r === 0 && names.length) out.push(` r0: ${col.get(names[0])} >= 0`);
    const listed = (set: Record<string, 1> | undefined) => Object.keys(set ?? {}).map(n => col.get(n)).filter((c): c is string => !!c && used.has(c));
    const lines = (cols: string[]) => Array.from({ length: Math.ceil(cols.length / 12) }, (_, i) => ` ${cols.slice(i * 12, i * 12 + 12).join(' ')}`);
    const ints = listed(model.ints);
    const bins = listed(model.binaries);
    if (ints.length) out.push('Generals', ...lines(ints));
    if (bins.length) out.push('Binaries', ...lines(bins));
    out.push('End');
    return { text: out.join('\n'), columns: names };
}

const FEASIBLE = new Set(['Optimal', 'Time limit reached', 'Iteration limit reached', 'Target for objective reached', 'Bound on objective reached']);

/** Solve a model; values come back under the model's own variable names. */
export async function solveWithHighs(model: JsModel, opts: SolveOptions = {}): Promise<Solved> {
    const lp = toLpText(model);
    const empty = { feasible: false, status: 'Infeasible', timeLimited: false } as Solved;
    if (!lp) return empty;
    if (lp.columns.length === 0) return { ...empty, feasible: true, status: 'Optimal' } as Solved;
    const highs = await getHighs();
    const res = highs.solve(lp.text, {
        output_flag: false,
        ...(opts.timeLimit !== undefined ? { time_limit: opts.timeLimit } : {}),
        ...(opts.mipGap !== undefined ? { mip_rel_gap: opts.mipGap } : {}),
    });
    const columns = (res as { Columns?: Record<string, { Primal?: number }> }).Columns ?? {};
    const hasValues = Object.values(columns).some(c => typeof c?.Primal === 'number' && Number.isFinite(c.Primal));
    const out = {
        feasible: FEASIBLE.has(res.Status) && hasValues,
        status: res.Status,
        timeLimited: res.Status === 'Time limit reached',
    } as Solved;
    if (out.feasible) {
        lp.columns.forEach((name, i) => {
            const v = columns[`x${i}`]?.Primal;
            if (typeof v === 'number' && Number.isFinite(v)) out[name] = v;
        });
        out.result = res.ObjectiveValue;
        // A stop at a limit can come back with values that aren't a solution (no incumbent yet).
        if (res.Status !== 'Optimal' && !satisfies(model, out)) out.feasible = false;
    }
    return out;
}

/** Whether values meet every row and integrality of a model, within solver tolerances. */
export function satisfies(model: JsModel, values: Record<string, number>, tol = 1e-5): boolean {
    const activity: Record<string, number> = {};
    for (const [name, coeffs] of Object.entries(model.variables)) {
        const v = values[name] ?? 0;
        if (v < -tol) return false;
        if (!v) continue;
        for (const [row, c] of Object.entries(coeffs)) activity[row] = (activity[row] ?? 0) + c * v;
    }
    for (const [row, b] of Object.entries(model.constraints)) {
        const a = activity[row] ?? 0;
        const slack = tol * Math.max(1, Math.abs(b.min ?? 0), Math.abs(b.max ?? 0), Math.abs(b.equal ?? 0));
        if (b.equal !== undefined && Math.abs(a - b.equal) > slack) return false;
        if (b.min !== undefined && a < b.min - slack) return false;
        if (b.max !== undefined && a > b.max + slack) return false;
    }
    for (const name of [...Object.keys(model.ints ?? {}), ...Object.keys(model.binaries ?? {})]) {
        const v = values[name] ?? 0;
        if (Math.abs(v - Math.round(v)) > 1e-4) return false;
        if (model.binaries?.[name] && v > 1 + 1e-4) return false;
    }
    return true;
}
