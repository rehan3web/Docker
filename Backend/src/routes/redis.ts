import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { getRedis, redisReady, getLastError } from '../lib/redis';

const router = express.Router();
router.use(authenticateToken);

router.get('/status', async (_req, res) => {
    if (!redisReady()) {
        return res.json({ connected: false, reason: getLastError() || 'Connecting…' });
    }
    try {
        const r = getRedis();
        const [info, dbsize, hits, misses, sessions, queryItems, histLen] = await Promise.all([
            r.info(),
            r.dbsize(),
            r.get('stats:hits').then(v => parseInt(v || '0')),
            r.get('stats:misses').then(v => parseInt(v || '0')),
            r.hgetall('active_sessions').catch(() => ({})),
            r.lrange('recent_queries', 0, 19).catch(() => [] as string[]),
            r.llen('stats_history').catch(() => 0),
        ]);

        const infoMap: Record<string, string> = {};
        info.split('\r\n').forEach(line => {
            const idx = line.indexOf(':');
            if (idx > 0) infoMap[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        });

        const total = hits + misses;
        const hitRate = total > 0 ? Math.round((hits / total) * 10000) / 100 : 0;

        const activeSessions = Object.entries(sessions || {}).map(([id, val]) => {
            try { return { id, ...JSON.parse(val as string) }; } catch { return { id }; }
        });

        const recentQueries = queryItems
            .map(q => { try { return JSON.parse(q); } catch { return null; } })
            .filter(Boolean);

        res.json({
            connected: true,
            version: infoMap['redis_version'] || '?',
            uptime: parseInt(infoMap['uptime_in_seconds'] || '0'),
            usedMemory: infoMap['used_memory_human'] || '?',
            usedMemoryPeak: infoMap['used_memory_peak_human'] || '?',
            connectedClients: parseInt(infoMap['connected_clients'] || '0'),
            totalCommands: parseInt(infoMap['total_commands_processed'] || '0'),
            keyspaceHits: parseInt(infoMap['keyspace_hits'] || '0'),
            keyspaceMisses: parseInt(infoMap['keyspace_misses'] || '0'),
            dbsize,
            cacheHits: hits,
            cacheMisses: misses,
            hitRate,
            activeSessions,
            recentQueries,
            statsHistoryPoints: histLen,
        });
    } catch (err: any) {
        res.json({ connected: false, reason: err.message });
    }
});

router.delete('/cache', async (_req, res) => {
    try {
        const r = getRedis();
        const keys = await r.keys('cache:*');
        if (keys.length) await r.del(...keys);
        await r.del('stats:hits', 'stats:misses');
        res.json({ ok: true, flushed: keys.length });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/queries', async (_req, res) => {
    try {
        await getRedis().del('recent_queries');
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
