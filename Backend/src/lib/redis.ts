import Redis from 'ioredis';

let client: Redis | null = null;
let lastError: string | null = null;
let initialized = false;

export function getRedis(): Redis {
    if (client) return client;
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL not configured');
    client = new Redis(url, {
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
        commandTimeout: 3000,
        lazyConnect: true,
        enableReadyCheck: true,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 500, 2000)),
    });
    client.on('error', (err) => { lastError = err.message; });
    client.on('ready', () => { lastError = null; });
    return client;
}

export function redisReady(): boolean {
    try { return getRedis().status === 'ready'; } catch { return false; }
}

export function getLastError(): string | null { return lastError; }

// ── Cache helpers ──────────────────────────────────────────────────────────────

export async function cacheGet<T>(key: string): Promise<T | null> {
    if (!redisReady()) return null;
    try {
        const val = await getRedis().get(`cache:${key}`);
        if (val === null) { getRedis().incr('stats:misses').catch(() => {}); return null; }
        getRedis().incr('stats:hits').catch(() => {});
        return JSON.parse(val) as T;
    } catch { return null; }
}

export async function cacheSet(key: string, value: unknown, ttlSec: number): Promise<void> {
    if (!redisReady()) return;
    try { await getRedis().set(`cache:${key}`, JSON.stringify(value), 'EX', ttlSec); } catch { }
}

export async function cacheDel(...keys: string[]): Promise<void> {
    if (!redisReady()) return;
    try { await getRedis().del(...keys.map(k => `cache:${k}`)); } catch { }
}

// ── Query logging ──────────────────────────────────────────────────────────────

export async function logQuery(sql: string, durationMs: number, rowCount: number): Promise<void> {
    if (!redisReady()) return;
    try {
        const entry = JSON.stringify({ sql: sql.slice(0, 400), durationMs, rowCount, at: Date.now() });
        const r = getRedis();
        await r.lpush('recent_queries', entry);
        await r.ltrim('recent_queries', 0, 49);
    } catch { }
}

// ── Session tracking ───────────────────────────────────────────────────────────

export async function trackSession(socketId: string, username: string, connected: boolean): Promise<void> {
    if (!redisReady()) return;
    try {
        const r = getRedis();
        if (connected) {
            await r.hset('active_sessions', socketId, JSON.stringify({ username, connectedAt: Date.now() }));
        } else {
            await r.hdel('active_sessions', socketId);
        }
    } catch { }
}

// ── Stats history (persisted across restarts) ──────────────────────────────────

export async function pushStatsHistory(point: object): Promise<void> {
    if (!redisReady()) return;
    try {
        const r = getRedis();
        await r.rpush('stats_history', JSON.stringify(point));
        await r.ltrim('stats_history', -60, -1);
    } catch { }
}

export async function getStatsHistory(): Promise<any[]> {
    if (!redisReady()) return [];
    try {
        const items = await getRedis().lrange('stats_history', 0, -1);
        return items.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
}

// ── Init ───────────────────────────────────────────────────────────────────────

export function initRedis(): void {
    if (initialized) return;
    initialized = true;
    if (!process.env.REDIS_URL) {
        console.log('[Redis] REDIS_URL not set — caching disabled');
        return;
    }
    try {
        getRedis().connect()
            .then(() => console.log('[Redis] Connected'))
            .catch((e: any) => console.warn('[Redis] Connect failed:', e.message));
    } catch (e: any) {
        console.warn('[Redis] Init error:', e.message);
    }
}
