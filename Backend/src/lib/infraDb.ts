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
    }
}

export async function getInfraConnection(): Promise<Pool> {
    if (infraPool) return infraPool;

    await ensureInfraDbExists();

    if (process.env.DATABASE_URL) {
        const url = new URL(process.env.DATABASE_URL);
        url.pathname = `/${INFRA_DB}`;
        infraPool = new Pool({
            connectionString: url.toString(),
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            application_name: 'docklet-infra',
        });
    } else {
        infraPool = new Pool({
            user:     process.env.PGUSER     || process.env.DB_USER  || 'postgres',
            host:     process.env.PGHOST     || process.env.DB_HOST  || 'localhost',
            database: INFRA_DB,
            password: process.env.PGPASSWORD || process.env.PASSWORD || 'postgres',
            port:     parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10),
            application_name: 'docklet-infra',
        });
    }

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
