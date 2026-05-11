import { Queue, Worker, Job } from 'bullmq';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { createWriteStream } from 'fs';
import { emitToUser } from './socket';
import { getRedis, redisReady } from './redis';

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_PARALLEL = Math.max(1, parseInt(process.env.MAX_PARALLEL_BUILDS || '2', 10));
const DEPLOY_ROOT  = path.resolve(process.cwd(), '.docklet-deploys');
const LOG_TTL      = 60 * 60 * 24 * 2; // 48 h

if (!fs.existsSync(DEPLOY_ROOT)) fs.mkdirSync(DEPLOY_ROOT, { recursive: true });

// ── Port registry ─────────────────────────────────────────────────────────────

const PORT_REGISTRY_FILE = path.join(DEPLOY_ROOT, '.port-registry.json');
interface PortEntry { hostPort: number; containerName: string; containerPort: number; deployId: string; }
const portRegistry = new Map<string, PortEntry>();
const usedPorts    = new Set<number>();

function loadPortRegistry() {
    try {
        const raw = JSON.parse(fs.readFileSync(PORT_REGISTRY_FILE, 'utf8')) as PortEntry[];
        for (const e of raw) { portRegistry.set(e.deployId, e); usedPorts.add(e.hostPort); }
    } catch { /* first run */ }
}
function savePortRegistry() {
    try { fs.writeFileSync(PORT_REGISTRY_FILE, JSON.stringify([...portRegistry.values()], null, 2)); } catch { /* ignore */ }
}
function claimPort(): number {
    let p = 8000;
    while (usedPorts.has(p) && p < 8099) p++;
    if (p >= 8099) throw new Error('No free port in 8000–8098');
    usedPorts.add(p);
    return p;
}
loadPortRegistry();

// ── Deploy record ─────────────────────────────────────────────────────────────

export type BuildMethod = 'docker' | 'railpack';
export type DeployStatus = 'queued' | 'pending' | 'cloning' | 'building' | 'running' | 'failed' | 'success';

export interface DeployRecord {
    id: string;
    repo: string;
    name: string;
    ownerId: string;
    status: DeployStatus;
    buildMethod?: BuildMethod;
    queuePosition?: number;
    startedAt: number;
    finishedAt?: number;
    error?: string;
    hostPort?: number;
    containerPort?: number;
    containerName?: string;
    logs: { stream: 'stdout' | 'stderr' | 'system'; chunk: string; timestamp: number }[];
}

export const deployments = new Map<string, DeployRecord>();

// ── Redis log helpers ─────────────────────────────────────────────────────────

function rLogKey(id: string)    { return `build:${id}:logs`; }
function rStatusKey(id: string) { return `build:${id}:status`; }

function rPushLog(id: string, entry: { stream: string; chunk: string; timestamp: number }) {
    if (!redisReady()) return;
    try {
        const r = getRedis();
        r.rpush(rLogKey(id), JSON.stringify(entry));
        r.expire(rLogKey(id), LOG_TTL);
    } catch { /* ignore */ }
}

function rSetStatus(id: string, status: string) {
    if (!redisReady()) return;
    try { getRedis().set(rStatusKey(id), status, 'EX', LOG_TTL); } catch { /* ignore */ }
}

export async function redisGetLogs(id: string): Promise<DeployRecord['logs']> {
    if (!redisReady()) return [];
    try {
        const items = await getRedis().lrange(rLogKey(id), 0, -1);
        return items.map(s => JSON.parse(s));
    } catch { return []; }
}

// ── Emit helpers ──────────────────────────────────────────────────────────────

export function emitLog(id: string, stream: 'stdout' | 'stderr' | 'system', chunk: string) {
    const entry = { stream, chunk, timestamp: Date.now() };
    const rec = deployments.get(id);
    if (rec) { rec.logs.push(entry); if (rec.logs.length > 1000) rec.logs.shift(); }
    rPushLog(id, entry);
    if (rec?.ownerId) emitToUser(rec.ownerId, 'deploy-log', { id, ...entry });
}

export function emitStatus(id: string, status: DeployStatus, extra?: Record<string, any>) {
    const rec = deployments.get(id);
    if (rec) rec.status = status;
    rSetStatus(id, status);
    if (rec?.ownerId) emitToUser(rec.ownerId, 'deploy-status', { id, status, ...extra });
}

// ── Spawn helper — always inherits full process env so PATH is correct ────────

function runStreamed(id: string, command: string, args: string[], cwd: string): Promise<number> {
    return new Promise((resolve) => {
        emitLog(id, 'system', `\n$ ${command} ${args.join(' ')}\n`);
        const child = spawn(command, args, { cwd, env: process.env });
        child.stdout.on('data', (d) => emitLog(id, 'stdout', d.toString()));
        child.stderr.on('data', (d) => emitLog(id, 'stderr', d.toString()));
        child.on('error', (err) => { emitLog(id, 'stderr', `\n[spawn error: ${err.message}]\n`); resolve(-1); });
        child.on('close', (code) => resolve(code ?? -1));
    });
}

// ── RailPack + mise auto-install ──────────────────────────────────────────────
// railpack v0.23.0 downloads mise v2026.3.17 to /tmp/railpack/mise/mise-2026.3.17
// at build time. If that download fails on the VPS (network/permissions) the
// build errors. We pre-seed the file every backend startup so railpack always
// finds it without needing to download it itself.

const RAILPACK_VERSION  = 'v0.23.0';
const RAILPACK_INSTALL  = path.join(process.env.HOME || '/root', '.local', 'bin');

// Exact mise version railpack v0.23.0 expects and the path it checks
const MISE_VERSION      = '2026.3.17';
const MISE_RAILPACK_DIR = '/tmp/railpack/mise';
const MISE_RAILPACK_BIN = path.join(MISE_RAILPACK_DIR, `mise-${MISE_VERSION}`);

// Detect host architecture for binary selection
function hostArch(): string {
    const a = process.arch;
    if (a === 'arm64') return 'linux-arm64';
    return 'linux-x64';
}

function railpackInPath(): boolean {
    try { execSync('railpack --version', { stdio: 'ignore', env: process.env }); return true; } catch { return false; }
}

// Download via wget (reliable in Alpine + most Linux distros); fallback to Node https
function downloadFile(url: string, dest: string): Promise<void> {
    // Try wget first — handles redirects, SSL, and large files correctly
    try {
        execSync(`wget -q --show-progress -O "${dest}" "${url}" 2>&1`, { stdio: 'pipe', timeout: 120_000 });
        const size = fs.statSync(dest).size;
        if (size < 1024) throw new Error(`wget produced suspiciously small file (${size} bytes)`);
        return Promise.resolve();
    } catch (wgetErr: any) {
        // Fallback: Node https with redirect following
        return new Promise((resolve, reject) => {
            const follow = (u: string, depth = 0) => {
                if (depth > 5) { reject(new Error('Too many redirects')); return; }
                https.get(u, (res) => {
                    if ([301, 302, 303, 307, 308].includes(res.statusCode!)) {
                        res.resume(); follow(res.headers.location!, depth + 1); return;
                    }
                    if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${u}`)); return; }
                    const file = createWriteStream(dest);
                    res.pipe(file);
                    file.on('finish', () => file.close(() => resolve()));
                    file.on('error', reject);
                    res.on('error', reject);
                }).on('error', reject);
            };
            follow(url);
        });
    }
}

// Build-time helper: logs to both console and deploy log stream
function blogLog(id: string, msg: string) {
    console.log(`[BuildQueue] ${msg}`);
    emitLog(id, 'system', msg + '\n');
}

// Pre-seed mise at the exact path railpack expects.
// /tmp is ephemeral so this must run before each railpack build.
async function ensureMise(id: string): Promise<void> {
    if (fs.existsSync(MISE_RAILPACK_BIN)) {
        blogLog(id, `mise ${MISE_VERSION} ready`);
        return;
    }

    const arch    = hostArch();
    const miseUrl = `https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-${arch}`;
    blogLog(id, `Downloading mise ${MISE_VERSION} (${arch})...`);

    // /tmp/railpack might be a stale file from a previous extraction — remove it
    try {
        const st = fs.statSync('/tmp/railpack');
        if (!st.isDirectory()) { fs.unlinkSync('/tmp/railpack'); blogLog(id, 'Removed stale /tmp/railpack file'); }
    } catch { /* doesn't exist — fine */ }

    fs.mkdirSync(MISE_RAILPACK_DIR, { recursive: true });

    try {
        await downloadFile(miseUrl, MISE_RAILPACK_BIN);
        fs.chmodSync(MISE_RAILPACK_BIN, 0o755);
        const sizeMB = (fs.statSync(MISE_RAILPACK_BIN).size / 1_048_576).toFixed(1);
        blogLog(id, `mise ${MISE_VERSION} ready (${sizeMB} MB) at ${MISE_RAILPACK_BIN}`);
    } catch (err: any) {
        blogLog(id, `ERROR: mise download failed — ${err.message}`);
        try { fs.unlinkSync(MISE_RAILPACK_BIN); } catch { /* partial file */ }
    }
}

async function ensureRailpack(id: string): Promise<void> {
    // Seed mise before checking/installing railpack
    await ensureMise(id);

    if (railpackInPath()) {
        blogLog(id, 'railpack already installed');
        return;
    }

    const arch        = hostArch();
    const railpackUrl = `https://github.com/railwayapp/railpack/releases/download/${RAILPACK_VERSION}/railpack-${RAILPACK_VERSION}-x86_64-unknown-linux-musl.tar.gz`;
    blogLog(id, `Installing railpack ${RAILPACK_VERSION}...`);

    try {
        fs.mkdirSync(RAILPACK_INSTALL, { recursive: true });
        const tarPath = path.join(RAILPACK_INSTALL, 'railpack.tar.gz');
        await downloadFile(railpackUrl, tarPath);
        execSync(`tar -xzf "${tarPath}" -C "${RAILPACK_INSTALL}"`, { stdio: 'pipe' });
        fs.unlinkSync(tarPath);
        fs.chmodSync(path.join(RAILPACK_INSTALL, 'railpack'), 0o755);

        const cur = process.env.PATH || '';
        if (!cur.includes(RAILPACK_INSTALL)) process.env.PATH = `${RAILPACK_INSTALL}:${cur}`;

        if (railpackInPath()) {
            blogLog(id, `railpack ${RAILPACK_VERSION} installed`);
        } else {
            blogLog(id, 'ERROR: railpack install completed but binary not found in PATH');
        }
    } catch (err: any) {
        blogLog(id, `ERROR: railpack install failed — ${err.message}`);
    }
}

// ── Build logic ───────────────────────────────────────────────────────────────

function parseExposedPort(dockerfilePath: string): number | null {
    try {
        let last: number | null = null;
        for (const line of fs.readFileSync(dockerfilePath, 'utf8').split('\n')) {
            const m = line.trim().match(/^EXPOSE\s+(\d+)/i);
            if (m) last = parseInt(m[1], 10);
        }
        return last;
    } catch { return null; }
}

function dockerAvailable() {
    try { return fs.existsSync('/var/run/docker.sock'); } catch { return false; }
}

async function runBuild(id: string) {
    const record = deployments.get(id);
    if (!record) return;

    const projectName   = record.name;
    const cloneDir      = path.join(DEPLOY_ROOT, `${projectName}-${id}`);
    const imageTag      = `docklet-${projectName}-${id}`.toLowerCase();
    const containerName = `nb-${projectName}-${id}`.toLowerCase();

    try {
        // 1. Clone
        emitStatus(id, 'cloning');
        emitLog(id, 'system', `Cloning ${record.repo} into ${cloneDir}\n`);
        const cloneCode = await runStreamed(id, 'git', ['clone', '--depth', '1', record.repo, cloneDir], DEPLOY_ROOT);
        if (cloneCode !== 0) {
            record.error = `git clone failed (exit ${cloneCode})`;
            record.finishedAt = Date.now();
            return emitStatus(id, 'failed', { error: record.error });
        }

        if (!dockerAvailable()) {
            record.error = 'Docker socket not found. Mount /var/run/docker.sock.';
            record.finishedAt = Date.now();
            emitLog(id, 'stderr', `\n[${record.error}]\n`);
            return emitStatus(id, 'failed', { error: record.error });
        }

        // 2. Detect build method
        const dockerfilePath = path.join(cloneDir, 'Dockerfile');
        const hasDockerfile  = fs.existsSync(dockerfilePath);

        if (hasDockerfile) {
            // ── Docker build ──────────────────────────────────────────────────
            record.buildMethod = 'docker';
            emitLog(id, 'system', '\nDockerfile found → using Docker build\n');

            const containerPort = parseExposedPort(dockerfilePath);
            let hostPort: number | null = null;
            if (containerPort) {
                try {
                    hostPort = claimPort();
                    record.containerPort = containerPort;
                    record.hostPort      = hostPort;
                    emitLog(id, 'system', `Detected EXPOSE ${containerPort} → host port ${hostPort}\n`);
                } catch (e: any) {
                    emitLog(id, 'system', `Warning: ${e.message} — starting without port binding\n`);
                }
            } else {
                emitLog(id, 'system', 'No EXPOSE in Dockerfile — starting without port binding\n');
            }

            emitStatus(id, 'building');
            emitLog(id, 'system', `\nBuilding image ${imageTag}\n`);
            const buildCode = await runStreamed(id, 'docker', ['build', '-t', imageTag, '.'], cloneDir);
            if (buildCode !== 0) {
                if (hostPort) usedPorts.delete(hostPort);
                record.error = `docker build failed (exit ${buildCode})`;
                record.finishedAt = Date.now();
                return emitStatus(id, 'failed', { error: record.error });
            }

            await _startContainer(id, record, containerName, imageTag, hostPort, containerPort);

        } else {
            // ── RailPack build ────────────────────────────────────────────────
            record.buildMethod = 'railpack';
            emitLog(id, 'system', '\nNo Dockerfile found → using RailPack auto-detect build\n');

            // Ensure railpack binary + mise are ready (build-time only — not at startup)
            await ensureRailpack(id);

            if (!railpackInPath()) {
                record.error = 'railpack not available — install failed';
                record.finishedAt = Date.now();
                emitLog(id, 'stderr', `\n[${record.error}]\n`);
                return emitStatus(id, 'failed', { error: record.error });
            }

            emitStatus(id, 'building');
            emitLog(id, 'system', `\nRailPack auto-detecting runtime and building image ${imageTag}...\n`);
            const rpCode = await runStreamed(id, 'railpack', ['build', '--name', imageTag, '--progress', 'plain', '.'], cloneDir);
            if (rpCode !== 0) {
                record.error = `railpack build failed (exit ${rpCode})`;
                record.finishedAt = Date.now();
                return emitStatus(id, 'failed', { error: record.error });
            }

            emitLog(id, 'system', '\nRailPack build complete — starting container\n');
            await _startContainer(id, record, containerName, imageTag, null, null);
        }

    } catch (err: any) {
        record.status     = 'failed';
        record.error      = err?.message || String(err);
        record.finishedAt = Date.now();
        emitLog(id, 'stderr', `\n[deploy failed: ${record.error}]\n`);
        emitStatus(id, 'failed', { error: record.error });
    }
}

async function _startContainer(
    id: string, record: DeployRecord,
    containerName: string, imageTag: string,
    hostPort: number | null, containerPort: number | null,
) {
    emitStatus(id, 'running');
    emitLog(id, 'system', `\nStarting container ${containerName}\n`);
    record.containerName = containerName;

    const runArgs = ['run', '-d', '--name', containerName];
    if (hostPort && containerPort) runArgs.push('-p', `${hostPort}:${containerPort}`);
    runArgs.push(imageTag);

    const runCode = await runStreamed(id, 'docker', runArgs, DEPLOY_ROOT);
    if (runCode !== 0) {
        if (hostPort) usedPorts.delete(hostPort);
        record.error      = `docker run failed (exit ${runCode})`;
        record.finishedAt = Date.now();
        return emitStatus(id, 'failed', { error: record.error });
    }

    if (hostPort && containerPort) {
        portRegistry.set(id, { hostPort, containerName, containerPort, deployId: id });
        savePortRegistry();
    }

    record.status     = 'success';
    record.finishedAt = Date.now();
    const portMsg     = hostPort ? ` — accessible on host port ${hostPort}` : '';
    emitLog(id, 'system', `\nDeployment successful: container ${containerName} is running${portMsg}.\n`);
    emitStatus(id, 'success', { containerName, imageTag, hostPort, containerPort, buildMethod: record.buildMethod });
}

// ── Queue system ──────────────────────────────────────────────────────────────

let bullQueue: Queue | null   = null;
let bullWorker: Worker | null = null;

let memRunning = 0;
const memQueue: string[] = [];

async function memWorkerRun(id: string) {
    memRunning++;
    updateQueuePositions();
    try { await runBuild(id); } finally {
        memRunning--;
        const next = memQueue.shift();
        if (next) { const r = deployments.get(next); if (r) r.queuePosition = undefined; memWorkerRun(next); }
        updateQueuePositions();
    }
}

function updateQueuePositions() {
    memQueue.forEach((id, i) => { const r = deployments.get(id); if (r) r.queuePosition = i + 1; });
}

export async function initBuildQueue(): Promise<void> {
    if (redisReady()) {
        try {
            const connOpts = { host: 'docklet-redis', port: 6379 };
            bullQueue  = new Queue('builds', { connection: connOpts });
            bullWorker = new Worker('builds', async (job: Job) => {
                await runBuild(job.data.id);
            }, { connection: connOpts, concurrency: MAX_PARALLEL });

            bullWorker.on('failed', (job, err) => {
                if (!job) return;
                const rec = deployments.get(job.data.id);
                if (rec && rec.status !== 'failed') {
                    rec.status = 'failed'; rec.error = err.message; rec.finishedAt = Date.now();
                    emitStatus(job.data.id, 'failed', { error: err.message });
                }
            });

            console.log(`[BuildQueue] BullMQ ready (max ${MAX_PARALLEL} parallel builds)`);
        } catch (e: any) {
            console.warn('[BuildQueue] BullMQ init failed — using in-memory queue:', e.message);
            bullQueue = null; bullWorker = null;
        }
    } else {
        console.log(`[BuildQueue] in-memory queue (max ${MAX_PARALLEL} parallel builds)`);
    }
}

export async function enqueueBuild(id: string): Promise<void> {
    const rec = deployments.get(id);
    if (!rec) return;

    if (bullQueue) {
        rec.status = 'queued';
        rSetStatus(id, 'queued');
        await bullQueue.add('build', { id }, { attempts: 2, backoff: { type: 'fixed', delay: 5000 } });
        const waiting = await bullQueue.getWaitingCount();
        rec.queuePosition = waiting;
        if (rec.ownerId) emitToUser(rec.ownerId, 'deploy-status', { id, status: 'queued', queuePosition: waiting });
    } else {
        if (memRunning < MAX_PARALLEL) {
            rec.status = 'pending';
            memWorkerRun(id);
        } else {
            rec.status = 'queued';
            rec.queuePosition = memQueue.length + 1;
            memQueue.push(id);
            if (rec.ownerId) emitToUser(rec.ownerId, 'deploy-status', { id, status: 'queued', queuePosition: rec.queuePosition });
        }
    }
}

export { DEPLOY_ROOT, portRegistry, usedPorts };
