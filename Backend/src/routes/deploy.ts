import express from 'express';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import {
    deployments, DeployRecord,
    emitLog, emitStatus,
    enqueueBuild, redisGetLogs,
    DEPLOY_ROOT, portRegistry, usedPorts,
} from '../lib/buildQueue';

// ── Multer: disk storage for zip uploads ─────────────────────────────────────

const UPLOAD_TMP = path.join(DEPLOY_ROOT, '.upload-tmp');

const zipUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            fs.mkdirSync(UPLOAD_TMP, { recursive: true });
            cb(null, UPLOAD_TMP);
        },
        filename: (_req, _file, cb) => {
            cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.zip`);
        },
    }),
    fileFilter: (_req, file, cb) => {
        const ok = file.mimetype === 'application/zip' ||
                   file.mimetype === 'application/x-zip-compressed' ||
                   file.mimetype === 'application/octet-stream' ||
                   file.originalname.toLowerCase().endsWith('.zip');
        if (ok) cb(null, true);
        else cb(new Error('Only .zip files are accepted'));
    },
    limits: { fileSize: 512 * 1024 * 1024 },   // 512 MB
});

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

// ── Upload deploy ─────────────────────────────────────────────────────────────
// POST /deploy/upload — accepts a .zip, extracts it, then queues a build
// (skips git clone; if Dockerfile present → docker build, else → railpack).

router.post('/upload', authenticateToken, zipUpload.single('file'), async (req: express.Request, res: express.Response) => {
    if (!req.file) return res.status(400).json({ message: 'No .zip file provided' });

    const zipPath     = req.file.path;
    const id          = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rawName     = req.file.originalname.replace(/\.zip$/i, '') || 'project';
    const projectName = safeName(rawName);
    const extractDir  = path.join(DEPLOY_ROOT, `${projectName}-${id}`);

    // Extract synchronously (zip extraction is fast enough for management use)
    try {
        fs.mkdirSync(extractDir, { recursive: true });
        execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });
    } catch (err: any) {
        try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* ignore */ }
        try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
        return res.status(400).json({ message: `Failed to extract zip: ${err.stderr?.toString().trim() || err.message}` });
    }
    try { fs.unlinkSync(zipPath); } catch { /* ignore */ }

    // Many repos are zipped as a single top-level folder — drill into it
    let sourceDir = extractDir;
    try {
        const entries = fs.readdirSync(extractDir).filter(e => !e.startsWith('.'));
        if (entries.length === 1) {
            const only = path.join(extractDir, entries[0]);
            if (fs.statSync(only).isDirectory()) sourceDir = only;
        }
    } catch { /* ignore */ }

    const record: DeployRecord = {
        id,
        repo: req.file.originalname,
        name: projectName,
        ownerId: ownerIdFromReq(req),
        status: 'queued',
        startedAt: Date.now(),
        logs: [],
        sourceDir,
    };

    deployments.set(id, record);
    res.json({ id, name: projectName });

    await enqueueBuild(id);
});

export default router;
