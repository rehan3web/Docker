import express from 'express';
import { authenticateToken } from '../middleware/auth';
import {
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    getUserById,
    getUserByUsername,
} from '../lib/usersDb';

const router = express.Router();

function requireAdmin(req: any, res: any, next: any) {
    if (!req.user?.isAdmin) {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
}

router.use(authenticateToken, requireAdmin);

router.get('/', async (_req, res) => {
    try {
        const users = await listUsers();
        res.json({ users });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/', async (req, res) => {
    const { username, password, role, features } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'username and password are required' });
    }
    const existing = await getUserByUsername(username);
    if (existing) {
        return res.status(409).json({ message: 'Username already exists' });
    }
    try {
        const user = await createUser(
            String(username).trim(),
            String(password),
            String(role || 'user').trim(),
            Array.isArray(features) ? features : []
        );
        res.status(201).json({ user });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.put('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid id' });

    const { username, password, role, features, enabled } = req.body;

    if (username) {
        const existing = await getUserByUsername(username);
        if (existing && existing.id !== id) {
            return res.status(409).json({ message: 'Username already taken' });
        }
    }

    try {
        const user = await updateUser(id, {
            ...(username !== undefined && { username: String(username).trim() }),
            ...(password !== undefined && password !== '' && { password: String(password) }),
            ...(role !== undefined && { role: String(role).trim() }),
            ...(features !== undefined && { features: Array.isArray(features) ? features : [] }),
            ...(enabled !== undefined && { enabled: Boolean(enabled) }),
        });
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json({ user });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.patch('/:id/toggle', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid id' });

    const existing = await getUserById(id);
    if (!existing) return res.status(404).json({ message: 'User not found' });

    try {
        const user = await updateUser(id, { enabled: !existing.enabled });
        res.json({ user });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid id' });

    try {
        const ok = await deleteUser(id);
        if (!ok) return res.status(404).json({ message: 'User not found' });
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

export default router;
