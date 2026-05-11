import { getInfraConnection } from './infraDb';

// ── Schema ────────────────────────────────────────────────────────────────────

export async function initAgentDb(): Promise<void> {
    const db = await getInfraConnection();
    await db.query(`
        CREATE TABLE IF NOT EXISTS agent_tasks (
            id          VARCHAR(64) PRIMARY KEY,
            intent      TEXT        NOT NULL,
            status      VARCHAR(32) DEFAULT 'running',
            summary     TEXT,
            log_json    JSONB       DEFAULT '[]'::jsonb,
            retries     INT         DEFAULT 0,
            success     BOOLEAN,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE TABLE IF NOT EXISTS agent_knowledge (
            id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            pattern          TEXT        NOT NULL,
            intent_sample    TEXT        NOT NULL,
            strategy_summary TEXT        NOT NULL,
            steps_json       JSONB       NOT NULL,
            success_count    INT         DEFAULT 1,
            last_used_at     TIMESTAMPTZ DEFAULT NOW(),
            created_at       TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_agent_tasks_created    ON agent_tasks    (created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_agent_knowledge_pattern ON agent_knowledge (pattern)`);
}

// ── Task helpers ──────────────────────────────────────────────────────────────

export async function createTask(id: string, intent: string): Promise<void> {
    try {
        const db = await getInfraConnection();
        await db.query(
            `INSERT INTO agent_tasks (id, intent, status) VALUES ($1, $2, 'running') ON CONFLICT (id) DO NOTHING`,
            [id, intent]
        );
    } catch { /* non-fatal */ }
}

export async function finishTask(
    id: string,
    success: boolean,
    summary: string,
    logLines: string[],
    retries: number
): Promise<void> {
    try {
        const db = await getInfraConnection();
        await db.query(
            `UPDATE agent_tasks
             SET status = $2, success = $3, summary = $4, log_json = $5::jsonb, retries = $6, updated_at = NOW()
             WHERE id = $1`,
            [id, success ? 'completed' : 'failed', success, summary, JSON.stringify(logLines), retries]
        );
    } catch { /* non-fatal */ }
}

export async function listTasks(limit = 40): Promise<any[]> {
    try {
        const db = await getInfraConnection();
        const { rows } = await db.query(
            `SELECT id, intent, status, summary, success, retries, created_at, updated_at
             FROM agent_tasks ORDER BY created_at DESC LIMIT $1`,
            [limit]
        );
        return rows;
    } catch { return []; }
}

export async function getTask(id: string): Promise<any | null> {
    try {
        const db = await getInfraConnection();
        const { rows } = await db.query(`SELECT * FROM agent_tasks WHERE id = $1`, [id]);
        return rows[0] ?? null;
    } catch { return null; }
}

// ── Knowledge helpers ─────────────────────────────────────────────────────────

export async function recordKnowledge(
    pattern: string,
    intentSample: string,
    strategySummary: string,
    stepsJson: object
): Promise<void> {
    try {
        const db = await getInfraConnection();
        await db.query(`
            INSERT INTO agent_knowledge (pattern, intent_sample, strategy_summary, steps_json)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
        `, [pattern, intentSample, strategySummary, JSON.stringify(stepsJson)]);
    } catch { /* non-fatal */ }
}

export async function incrementKnowledge(id: string): Promise<void> {
    try {
        const db = await getInfraConnection();
        await db.query(
            `UPDATE agent_knowledge SET success_count = success_count + 1, last_used_at = NOW() WHERE id = $1`,
            [id]
        );
    } catch { /* non-fatal */ }
}

export async function listKnowledge(limit = 60): Promise<any[]> {
    try {
        const db = await getInfraConnection();
        const { rows } = await db.query(
            `SELECT * FROM agent_knowledge ORDER BY last_used_at DESC LIMIT $1`,
            [limit]
        );
        return rows;
    } catch { return []; }
}

export async function deleteKnowledge(id: string): Promise<void> {
    try {
        const db = await getInfraConnection();
        await db.query(`DELETE FROM agent_knowledge WHERE id = $1`, [id]);
    } catch { /* non-fatal */ }
}

export async function getRelevantKnowledge(intent: string, limit = 3): Promise<any[]> {
    try {
        const db = await getInfraConnection();
        const words = intent.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 6);
        if (!words.length) return [];
        const conditions = words.map((w, i) => `pattern ILIKE $${i + 1}`).join(' OR ');
        const params = words.map(w => `%${w}%`);
        const { rows } = await db.query(
            `SELECT * FROM agent_knowledge WHERE (${conditions}) ORDER BY success_count DESC, last_used_at DESC LIMIT $${params.length + 1}`,
            [...params, limit]
        );
        return rows;
    } catch { return []; }
}
