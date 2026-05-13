import bcrypt from 'bcryptjs';
import { executeInfraQuery } from './infraDb';

export interface AppUser {
    id: number;
    username: string;
    password_hash: string;
    role: string;
    features: string[];
    enabled: boolean;
    created_at: Date;
}

export type SafeUser = Omit<AppUser, 'password_hash'>;

export async function initUsersTable(): Promise<void> {
    await executeInfraQuery(`
        CREATE TABLE IF NOT EXISTS app_users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            features TEXT[] NOT NULL DEFAULT '{}',
            enabled BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

export async function listUsers(): Promise<SafeUser[]> {
    const result = await executeInfraQuery(
        'SELECT id, username, role, features, enabled, created_at FROM app_users ORDER BY created_at ASC'
    );
    return result.rows;
}

export async function getUserByUsername(username: string): Promise<AppUser | null> {
    const result = await executeInfraQuery(
        'SELECT * FROM app_users WHERE username = $1',
        [username]
    );
    return result.rows[0] || null;
}

export async function getUserById(id: number): Promise<SafeUser | null> {
    const result = await executeInfraQuery(
        'SELECT id, username, role, features, enabled, created_at FROM app_users WHERE id = $1',
        [id]
    );
    return result.rows[0] || null;
}

export async function createUser(
    username: string,
    password: string,
    role: string,
    features: string[]
): Promise<SafeUser> {
    const hash = await bcrypt.hash(password, 12);
    const result = await executeInfraQuery(
        `INSERT INTO app_users (username, password_hash, role, features)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, role, features, enabled, created_at`,
        [username, hash, role, features]
    );
    return result.rows[0];
}

export async function updateUser(
    id: number,
    updates: {
        username?: string;
        password?: string;
        role?: string;
        features?: string[];
        enabled?: boolean;
    }
): Promise<SafeUser | null> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (updates.username !== undefined) {
        setClauses.push(`username = $${i++}`);
        values.push(updates.username);
    }
    if (updates.password !== undefined) {
        setClauses.push(`password_hash = $${i++}`);
        values.push(await bcrypt.hash(updates.password, 12));
    }
    if (updates.role !== undefined) {
        setClauses.push(`role = $${i++}`);
        values.push(updates.role);
    }
    if (updates.features !== undefined) {
        setClauses.push(`features = $${i++}`);
        values.push(updates.features);
    }
    if (updates.enabled !== undefined) {
        setClauses.push(`enabled = $${i++}`);
        values.push(updates.enabled);
    }

    if (!setClauses.length) return getUserById(id);
    values.push(id);

    const result = await executeInfraQuery(
        `UPDATE app_users SET ${setClauses.join(', ')} WHERE id = $${i}
         RETURNING id, username, role, features, enabled, created_at`,
        values
    );
    return result.rows[0] || null;
}

export async function deleteUser(id: number): Promise<boolean> {
    const result = await executeInfraQuery(
        'DELETE FROM app_users WHERE id = $1',
        [id]
    );
    return (result.rowCount ?? 0) > 0;
}

export async function verifyUserPassword(user: AppUser, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password_hash);
}
