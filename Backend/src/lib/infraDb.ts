import { Pool } from 'pg';
import { executeSysQuery } from './db';

const INFRA_DB = 'dockelt_data';

let infraPool: Pool | null = null;

async function ensureInfraDbExists(): Promise<void> {
    try {
        await executeSysQuery(`CREATE DATABASE ${INFRA_DB} TEMPLATE template0`);
        console.log(`[InfraDB] Created database "${INFRA_DB}"`);
    } catch (err: any) {
        const msg = String(err.message || '');
        if (
            err.code !== '42P04' &&
            err.code !== '23505' &&
            !msg.includes('already exists')
        ) {
            throw err;
        }
        // Database already exists — that's fine
    }
}

/**
 * Build a Pool that connects DIRECTLY to PostgreSQL (not PgBouncer).
 *
 * PgBouncer only knows the primary application database.  Any connection to
 * a different database (dockelt_data, template1, postgres …) must bypass it
 * and talk to the PostgreSQL server on POSTGRES_DIRECT_HOST:POSTGRES_DIRECT_PORT.
 *
 * In the Docker Compose deployment those vars are set to the "postgres" service
 * name.  In Replit / plain-env deployments there is no PgBouncer, so we fall
 * back to PGHOST/PGPORT which point straight to PostgreSQL anyway.
 */
function buildDirectPool(database: string): Pool {
    const directHost = process.env.POSTGRES_DIRECT_HOST || process.env.PGHOST || process.env.DB_HOST || 'localhost';
    const directPort = parseInt(process.env.POSTGRES_DIRECT_PORT || process.env.PGPORT || process.env.DB_PORT || '5432', 10);

    if (process.env.DATABASE_URL) {
        // In DATABASE_URL environments (Replit managed PG) there is no PgBouncer,
        // so we can safely reuse the URL after swapping the database name.
        // If POSTGRES_DIRECT_HOST is explicitly set we also swap the host so
        // that DDL goes around any intermediate proxy.
        const url = new URL(process.env.DATABASE_URL);
        url.pathname = `/${database}`;
        if (process.env.POSTGRES_DIRECT_HOST) {
            url.hostname = process.env.POSTGRES_DIRECT_HOST;
            url.port = String(directPort);
        }
        return new Pool({
            connectionString: url.toString(),
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            application_name: 'docklet-infra',
        });
    }

    return new Pool({
        user:     process.env.PGUSER     || process.env.DB_USER  || 'postgres',
        host:     directHost,
        database,
        password: process.env.PGPASSWORD || process.env.PASSWORD || 'postgres',
        port:     directPort,
        application_name: 'docklet-infra',
    });
}

async function ensureIndexes(pool: Pool): Promise<void> {
    const indexes: [string, string][] = [
        ['idx_docklet_settings_key',          'CREATE INDEX IF NOT EXISTS idx_docklet_settings_key ON nextbase_settings (key)'],
        ['idx_container_domains_name',         'CREATE INDEX IF NOT EXISTS idx_container_domains_name ON container_domains (container_name)'],
        ['idx_container_domains_domain',       'CREATE INDEX IF NOT EXISTS idx_container_domains_domain ON container_domains (domain)'],
        ['idx_container_schedules_name',       'CREATE INDEX IF NOT EXISTS idx_container_schedules_name ON container_schedules (container_name)'],
        ['idx_container_schedules_enabled',    'CREATE INDEX IF NOT EXISTS idx_container_schedules_enabled ON container_schedules (container_name, enabled)'],
        ['idx_schedule_logs_schedule',         'CREATE INDEX IF NOT EXISTS idx_schedule_logs_schedule ON container_schedule_logs (schedule_id, created_at DESC)'],
        ['idx_container_backups_name',         'CREATE INDEX IF NOT EXISTS idx_container_backups_name ON container_backups (container_name)'],
        ['idx_container_backups_created',      'CREATE INDEX IF NOT EXISTS idx_container_backups_created ON container_backups (container_name, created_at DESC)'],
        ['idx_verified_domains_domain',        'CREATE INDEX IF NOT EXISTS idx_verified_domains_domain ON verified_domains (domain)'],
        ['idx_verified_domains_verified',      'CREATE INDEX IF NOT EXISTS idx_verified_domains_verified ON verified_domains (verified)'],
        ['idx_proxy_domains_domain',           'CREATE INDEX IF NOT EXISTS idx_proxy_domains_domain ON docklet_proxy_domains (domain)'],
        ['idx_proxy_domains_verified',         'CREATE INDEX IF NOT EXISTS idx_proxy_domains_verified ON docklet_proxy_domains (verified)'],
        ['idx_container_env_vars_container',   'CREATE INDEX IF NOT EXISTS idx_container_env_vars_container ON container_env_vars (container_name)'],
        ['idx_container_env_history_name',     'CREATE INDEX IF NOT EXISTS idx_container_env_history_name ON container_env_history (container_name, applied_at DESC)'],
        ['idx_deploy_jobs_user',               'CREATE INDEX IF NOT EXISTS idx_deploy_jobs_user ON deploy_jobs (user_id, created_at DESC)'],
    ];

    for (const [, sql] of indexes) {
        try { await pool.query(sql); } catch { /* table may not exist yet — skip */ }
    }
    console.log('[InfraDB] Indexes ensured');
}

export async function getInfraConnection(): Promise<Pool> {
    if (infraPool) return infraPool;

    await ensureInfraDbExists();

    infraPool = buildDirectPool(INFRA_DB);
    // Run index migrations in the background — non-blocking
    ensureIndexes(infraPool).catch(err => console.warn('[InfraDB] Index migration warning:', err.message));
    return infraPool;
}

export async function resetInfraPool(): Promise<void> {
    if (infraPool) {
        try { await infraPool.end(); } catch { /* ignore */ }
        infraPool = null;
    }
}

export async function executeInfraQuery(query: string, params: any[] = []) {
    const p = await getInfraConnection();
    const start = Date.now();
    try {
        const result = await p.query(query, params);
        const duration = Date.now() - start;
        return {
            rows:     result.rows,
            fields:   result.fields,
            rowCount: result.rowCount,
            duration,
        };
    } catch (error: any) {
        console.error('[InfraDB] Query Error:', {
            query,
            params,
            errorMessage: error.message,
            detail:       error.detail,
        });
        throw {
            message:  error.message,
            detail:   error.detail,
            position: error.position,
            duration: Date.now() - start,
        };
    }
}
