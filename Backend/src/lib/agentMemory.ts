import { getInfraConnection } from './infraDb';
import { getRedis, redisReady } from './redis';

// ── Schema init ────────────────────────────────────────────────────────────────

export async function initMemoryDb(): Promise<void> {
    const db = await getInfraConnection();

    await db.query(`
        CREATE TABLE IF NOT EXISTS agent_memory (
            id          SERIAL      PRIMARY KEY,
            user_id     VARCHAR(64) NOT NULL,
            session_id  VARCHAR(64),
            role        VARCHAR(16) NOT NULL,
            content     TEXT        NOT NULL,
            task_id     VARCHAR(64),
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_memory_user
        ON agent_memory (user_id, created_at DESC)
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS agent_rag_store (
            id          SERIAL      PRIMARY KEY,
            user_id     VARCHAR(64) NOT NULL,
            task_id     VARCHAR(64),
            intent      TEXT        NOT NULL,
            summary     TEXT        NOT NULL,
            key_facts   TEXT[]      DEFAULT '{}',
            commands    TEXT[]      DEFAULT '{}',
            outcome     VARCHAR(16) DEFAULT 'success',
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_rag_user
        ON agent_rag_store (user_id, created_at DESC)
    `);
}

// ── Conversation memory ────────────────────────────────────────────────────────

export async function saveMemoryTurn(
    userId:    string,
    role:      'user' | 'agent',
    content:   string,
    taskId?:   string,
    sessionId?: string,
): Promise<void> {
    try {
        const db = await getInfraConnection();
        await db.query(
            `INSERT INTO agent_memory (user_id, session_id, role, content, task_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, sessionId ?? null, role, content.slice(0, 4000), taskId ?? null]
        );
        if (redisReady()) getRedis().del(`mem:${userId}`).catch(() => {});
    } catch { /* non-fatal */ }
}

export async function getRecentMemory(
    userId: string,
    limit = 10,
): Promise<Array<{ role: string; content: string }>> {
    if (redisReady()) {
        try {
            const cached = await getRedis().get(`mem:${userId}`);
            if (cached) return JSON.parse(cached);
        } catch { }
    }
    try {
        const db = await getInfraConnection();
        const { rows } = await db.query(
            `SELECT role, content FROM agent_memory
             WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
            [userId, limit]
        );
        const result = rows.reverse();
        if (redisReady())
            getRedis().set(`mem:${userId}`, JSON.stringify(result), 'EX', 300).catch(() => {});
        return result;
    } catch { return []; }
}

// ── RAG store ─────────────────────────────────────────────────────────────────

export async function saveRagEntry(
    userId:   string,
    taskId:   string,
    intent:   string,
    summary:  string,
    keyFacts: string[],
    commands: string[],
    outcome:  'success' | 'failed',
): Promise<void> {
    try {
        const db = await getInfraConnection();
        await db.query(
            `INSERT INTO agent_rag_store
             (user_id, task_id, intent, summary, key_facts, commands, outcome)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                userId, taskId,
                intent.slice(0, 500), summary.slice(0, 2000),
                keyFacts.slice(0, 20), commands.slice(0, 30), outcome,
            ]
        );
        if (redisReady()) getRedis().del(`rag:${userId}`).catch(() => {});
    } catch { /* non-fatal */ }
}

export async function searchRagDocs(
    userId: string,
    query:  string,
    limit = 3,
): Promise<any[]> {
    try {
        const db    = await getInfraConnection();
        const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 8);

        if (!words.length) {
            const { rows } = await db.query(
                `SELECT intent, summary, key_facts, commands, outcome
                 FROM agent_rag_store WHERE user_id = $1
                 ORDER BY created_at DESC LIMIT $2`,
                [userId, limit]
            );
            return rows;
        }

        const conds  = words.map((_, i) => `(intent ILIKE $${i + 2} OR summary ILIKE $${i + 2})`).join(' OR ');
        const params = [userId, ...words.map(w => `%${w}%`), limit];
        const { rows } = await db.query(
            `SELECT intent, summary, key_facts, commands, outcome
             FROM agent_rag_store WHERE user_id = $1 AND (${conds})
             ORDER BY created_at DESC LIMIT $${params.length}`,
            params
        );
        return rows;
    } catch { return []; }
}

export async function getMemoryStats(
    userId: string,
): Promise<{ memoryCount: number; ragCount: number }> {
    try {
        const db      = await getInfraConnection();
        const [m, r]  = await Promise.all([
            db.query(`SELECT COUNT(*) FROM agent_memory    WHERE user_id = $1`, [userId]),
            db.query(`SELECT COUNT(*) FROM agent_rag_store WHERE user_id = $1`, [userId]),
        ]);
        return {
            memoryCount: parseInt(m.rows[0].count, 10),
            ragCount:    parseInt(r.rows[0].count, 10),
        };
    } catch { return { memoryCount: 0, ragCount: 0 }; }
}

export async function clearUserMemory(userId: string): Promise<void> {
    try {
        const db = await getInfraConnection();
        await db.query(`DELETE FROM agent_memory    WHERE user_id = $1`, [userId]);
        await db.query(`DELETE FROM agent_rag_store WHERE user_id = $1`, [userId]);
        if (redisReady()) getRedis().del(`mem:${userId}`).catch(() => {});
    } catch { /* non-fatal */ }
}

// ── Prompt-injection formatters ────────────────────────────────────────────────

export function formatMemoryContext(
    turns: Array<{ role: string; content: string }>,
): string {
    if (!turns.length) return '';
    return turns
        .map(t => `[${t.role === 'user' ? 'User' : 'Agent'}]: ${t.content}`)
        .join('\n');
}

export function formatRagContext(docs: any[]): string {
    if (!docs.length) return '';
    return docs.map(d => {
        const lines = [
            `Task: ${d.intent}`,
            `Outcome: ${d.outcome}`,
            `Summary: ${d.summary}`,
        ];
        if (d.key_facts?.length) lines.push(`Key Facts: ${d.key_facts.join('; ')}`);
        if (d.commands?.length)  lines.push(`Commands Used: ${d.commands.slice(0, 5).join(', ')}`);
        return lines.join('\n');
    }).join('\n---\n');
}
