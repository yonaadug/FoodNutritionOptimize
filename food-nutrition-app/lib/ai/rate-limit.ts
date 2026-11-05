/**
 * Simple abuse limits for model-backed requests: per-IP fixed windows and a daily
 * spend cap.
 *
 * These live in this process's memory, so on Lambda each instance counts on its
 * own and a cold start resets them. They are a speed bump, not the billing
 * control: the real caps are the DynamoDB counters planned in
 * docs/aws/AWS_HOSTING_DESIGN.md section 3.7, plus an AWS Budget.
 */

type Env = Record<string, string | undefined>;

export const DEFAULT_PER_MINUTE = 10;
export const DEFAULT_PER_DAY = 50;
export const DEFAULT_DAILY_BUDGET_USD = 1;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_TRACKED_IPS = 10_000;

interface Window { start: number; count: number }
interface Entry { minute: Window; day: Window }

export interface RateLimitResult { allowed: boolean; retryAfterSeconds: number }

function positiveNumber(raw: string | undefined, fallback: number): number {
    const n = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

export class RateLimiter {
    perMinute: number;
    perDay: number;
    private entries = new Map<string, Entry>();

    constructor(perMinute: number, perDay: number) {
        this.perMinute = perMinute;
        this.perDay = perDay;
    }

    /** Count one request. A limit of 0 turns that limit off. */
    check(key: string, now: number = Date.now()): RateLimitResult {
        let e = this.entries.get(key);
        if (!e) {
            if (this.entries.size >= MAX_TRACKED_IPS) this.prune(now);
            e = { minute: { start: now, count: 0 }, day: { start: now, count: 0 } };
            this.entries.set(key, e);
        }
        if (now - e.minute.start >= MINUTE) e.minute = { start: now, count: 0 };
        if (now - e.day.start >= DAY) e.day = { start: now, count: 0 };
        if (this.perDay > 0 && e.day.count >= this.perDay) {
            return { allowed: false, retryAfterSeconds: Math.ceil((e.day.start + DAY - now) / 1000) };
        }
        if (this.perMinute > 0 && e.minute.count >= this.perMinute) {
            return { allowed: false, retryAfterSeconds: Math.ceil((e.minute.start + MINUTE - now) / 1000) };
        }
        e.minute.count++;
        e.day.count++;
        return { allowed: true, retryAfterSeconds: 0 };
    }

    private prune(now: number) {
        for (const [k, e] of this.entries) {
            if (now - e.day.start >= DAY) this.entries.delete(k);
        }
        // Still full (a flood of distinct addresses): start over rather than grow without bound.
        if (this.entries.size >= MAX_TRACKED_IPS) this.entries.clear();
    }
}

let limiter: RateLimiter | null = null;

export function getRateLimiter(env: Env = process.env): RateLimiter {
    return (limiter ??= new RateLimiter(
        positiveNumber(env.AI_RATE_LIMIT_PER_MINUTE, DEFAULT_PER_MINUTE),
        positiveNumber(env.AI_RATE_LIMIT_PER_DAY, DEFAULT_PER_DAY),
    ));
}

/**
 * The address to rate-limit by. CloudFront's viewer header when present, else the
 * right-most X-Forwarded-For entry, which is the one our own proxy added; anything
 * further left is whatever the client chose to send. Only used as a counter key,
 * and never logged.
 */
export function clientIp(headers: Headers): string {
    const viewer = headers.get('cloudfront-viewer-address');
    if (viewer) return viewer.replace(/:\d+$/, '');
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
        const parts = forwarded.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length) return parts[parts.length - 1];
    }
    return headers.get('x-real-ip')?.trim() || 'unknown';
}

let spend = { day: '', usd: 0 };

function today(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

/** Add to today's estimated spend. */
export function recordSpend(usd: number, now: number = Date.now()): void {
    const day = today(now);
    if (spend.day !== day) spend = { day, usd: 0 };
    spend.usd += usd;
}

/** Has today's estimated spend reached AI_DAILY_BUDGET_USD? A budget of 0 turns the cap off. */
export function overDailyBudget(env: Env = process.env, now: number = Date.now()): boolean {
    const budget = positiveNumber(env.AI_DAILY_BUDGET_USD, DEFAULT_DAILY_BUDGET_USD);
    if (budget === 0) return false;
    if (spend.day !== today(now)) return false;
    return spend.usd >= budget;
}

/** For tests. */
export function resetLimits(): void {
    limiter = null;
    spend = { day: '', usd: 0 };
}
