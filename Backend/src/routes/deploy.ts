import express from 'express';
import { authenticateToken } from '../middleware/auth';
import {
    deployments, DeployRecord,
    emitLog, emitStatus,
    enqueueBuild, redisGetLogs,
    DEPLOY_ROOT, portRegistry, usedPorts,
} from '../lib/buildQueue';

const router = express.Router();

function ownerIdFromReq(req: express.Request): string {
    const u = (req as any).user;
    return String(u?.id ?? u?.username ?? 'anonymous');
}

function safeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'project';
}

function deriveProjectName(repo: string): string {
    try { return repo.replace(/\.git$/i, '').replace(/\/+$/g, '').split('/').pop() || 'project'; }
    catch { return 'project'; }
}

// ── List deployments ──────────────────────────────────────────────────────────

router.get('/list', authenticateToken, (req, res) => {
    const ownerId = ownerIdFromReq(req);
    res.json({
        deployments: Array.from(deployments.values())
            .filter(d => d.ownerId === ownerId)
            .map(d => ({
                id: d.id, repo: d.repo, name: d.name, status: d.status,
                buildMethod: d.buildMethod, queuePosition: d.queuePosition,
                startedAt: d.startedAt, finishedAt: d.finishedAt, error: d.error,
                hostPort: d.hostPort, containerPort: d.containerPort, containerName: d.containerName, proxyNetwork: d.proxyNetwork,
            })),
    });
});

// ── Get deployment detail ─────────────────────────────────────────────────────

router.get('/:id', authenticateToken, (req, res) => {
    const rec = deployments.get(String(req.params.id));
    if (!rec) return res.status(404).json({ message: 'Deployment not found' });
    if (rec.ownerId !== ownerIdFromReq(req)) return res.status(403).json({ message: 'Forbidden' });
    res.json(rec);
});

// ── Get cached logs from Redis (survives frontend refresh) ────────────────────

router.get('/:id/logs', authenticateToken, async (req, res) => {
    const id  = String(req.params.id);
    const rec = deployments.get(id);
    if (!rec) return res.status(404).json({ message: 'Deployment not found' });
    if (rec.ownerId !== ownerIdFromReq(req)) return res.status(403).json({ message: 'Forbidden' });

    // Prefer Redis cached logs (survive reload); fall back to in-memory
    const cached = await redisGetLogs(id);
    res.json({ logs: cached.length > 0 ? cached : rec.logs });
});

// ── Submit new deployment ─────────────────────────────────────────────────────

router.post('/github', authenticateToken, async (req, res) => {
    const { repo } = req.body || {};
    if (!repo || typeof repo !== 'string' || !/^https?:\/\//i.test(repo)) {
        return res.status(400).json({ message: 'A valid HTTP(S) Git repository URL is required.' });
    }

    const id            = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const projectName   = safeName(deriveProjectName(repo));

    const record: DeployRecord = {
        id, repo, name: projectName,
        ownerId: ownerIdFromReq(req),
        status: 'queued',
        startedAt: Date.now(),
        logs: [],
    };

    deployments.set(id, record);
    res.json({ id, name: projectName });

    await enqueueBuild(id);
});

export default router;
