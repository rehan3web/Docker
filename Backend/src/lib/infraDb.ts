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

export async function getInfraConnection(): Promise<Pool> {
    if (infraPool) return infraPool;

    await ensureInfraDbExists();

    infraPool = buildDirectPool(INFRA_DB);
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
