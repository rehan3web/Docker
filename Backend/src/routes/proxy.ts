import express from 'express';
import path from 'path';
import fs from 'fs';
import dns from 'dns';
import { authenticateToken } from '../middleware/auth';
import { getInfraConnection } from '../lib/infraDb';
import { getConnection } from '../lib/db';
import { emitToUser } from '../lib/socket';

const router = express.Router();
const dnsResolver = new dns.promises.Resolver();

const TRAEFIK_CONFIGS_DIR = path.join(process.cwd(), 'traefik-configs');

if (!fs.existsSync(TRAEFIK_CONFIGS_DIR)) {
    try { fs.mkdirSync(TRAEFIK_CONFIGS_DIR, { recursive: true }); } catch { }
}

// ── DB ────────────────────────────────────────────────────────────────────────

let dbReady = false;
async function ensureTable() {
    if (dbReady) return;
    const pool = await getInfraConnection();
    await pool.query(`
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nextbase_proxy_domains')
               AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'docklet_proxy_domains')
            THEN
                ALTER TABLE nextbase_proxy_domains RENAME TO docklet_proxy_domains;
            END IF;
        END
        $$;
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS docklet_proxy_domains (
            id          SERIAL PRIMARY KEY,
            domain      VARCHAR(255) UNIQUE NOT NULL,
            target_port INTEGER NOT NULL,
            verified    BOOLEAN DEFAULT FALSE,
            ssl_enabled BOOLEAN DEFAULT FALSE,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Add target_host column for container-name routing (railpack deploys)
    await pool.query(`
        ALTER TABLE docklet_proxy_domains
        ADD COLUMN IF NOT EXISTS target_host VARCHAR(255) DEFAULT '127.0.0.1'
    `);
    dbReady = true;
}

// ── Server-IP detection ───────────────────────────────────────────────────────

let cachedIp: string | null = null;
async function getServerIp(): Promise<string> {
    if (process.env.SERVER_IP) return process.env.SERVER_IP;
    if (cachedIp) return cachedIp;
    try {
        const r = await fetch('https://api.ipify.org?format=json');
        cachedIp = ((await r.json()) as any).ip;
        return cachedIp!;
    } catch {
        return 'YOUR_SERVER_IP';
    }
}
getServerIp().catch(() => {});

// ── Helpers ───────────────────────────────────────────────────────────────────

function ownerFromReq(req: express.Request): string {
    const u = (req as any).user;
    return String(u?.id ?? u?.username ?? 'anonymous');
}

function isRoot(domain: string): boolean {
    return domain.split('.').length === 2;
}

function domainRule(domain: string): string {
    return isRoot(domain)
        ? `Host(\`${domain}\`) || Host(\`www.${domain}\`)`
        : `Host(\`${domain}\`)`;
}

function safeId(domain: string): string {
    return domain.replace(/[^a-zA-Z0-9]/g, '-');
}

// ── Parent-domain wildcard check ──────────────────────────────────────────────

async function isParentVerified(domain: string): Promise<boolean> {
    const parts = domain.split('.');
    if (parts.length < 3) return false;
    const parent = parts.slice(1).join('.');
    try {
        const pool = await getConnection();
        const { rows } = await pool.query(
            'SELECT 1 FROM verified_domains WHERE domain = $1 AND verified = TRUE LIMIT 1',
            [parent]
        );
        return rows.length > 0;
    } catch {
        return false;
    }
}

// ── Traefik dynamic file-provider config templates ────────────────────────────
// targetHost is either '127.0.0.1' (host-port routing) or a container name
// (container routing via the docklet-apps Docker network).

function traefikHttpOnly(domain: string, targetHost: string, port: number): string {
    const id = safeId(domain);
    const rule = domainRule(domain);
    return `# Managed by Docklet — do not edit manually
http:
  routers:
    ${id}:
      rule: "${rule}"
      entrypoints:
        - web
      service: ${id}-svc

  services:
    ${id}-svc:
      loadBalancer:
        servers:
          - url: "http://${targetHost}:${port}"
`;
}

function traefikHttps(domain: string, targetHost: string, port: number): string {
    const id = safeId(domain);
    const rule = domainRule(domain);
    return `# Managed by Docklet — do not edit manually
http:
  routers:
    ${id}-http:
      rule: "${rule}"
      entrypoints:
        - web
      middlewares:
        - ${id}-redirect
      service: ${id}-svc

    ${id}-https:
      rule: "${rule}"
      entrypoints:
        - websecure
      tls:
        certResolver: letsencrypt
      service: ${id}-svc

  middlewares:
    ${id}-redirect:
      redirectScheme:
        scheme: https
        permanent: true

  services:
    ${id}-svc:
      loadBalancer:
        servers:
          - url: "http://${targetHost}:${port}"
`;
}

async function writeConfig(domain: string, targetHost: string, port: number, ssl: boolean): Promise<void> {
    const configPath = path.join(TRAEFIK_CONFIGS_DIR, `${domain}.yml`);
    fs.writeFileSync(
        configPath,
        ssl ? traefikHttps(domain, targetHost, port) : traefikHttpOnly(domain, targetHost, port)
    );
}

function removeConfig(domain: string): void {
    const configPath = path.join(TRAEFIK_CONFIGS_DIR, `${domain}.yml`);
    try { fs.unlinkSync(configPath); } catch { }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/server-ip', authenticateToken, async (_req, res) => {
    res.json({ ip: await getServerIp() });
});

router.get('/list', authenticateToken, async (_req, res) => {
    try {
        await ensureTable();
        const pool = await getInfraConnection();
        const { rows } = await pool.query('SELECT * FROM docklet_proxy_domains ORDER BY created_at DESC');
        res.json({ domains: rows });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/create', authenticateToken, async (req, res) => {
    const { domain, targetPort, targetHost: rawHost } = req.body || {};
    if (!domain || typeof domain !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
        return res.status(400).json({ message: 'Valid domain required (e.g. example.com or app.example.com)' });
    }
    const port = Number(targetPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return res.status(400).json({ message: 'Valid port (1–65535) required' });
    }
    // targetHost defaults to 127.0.0.1 for host-port routes; container name for railpack routes
    const targetHost: string = (typeof rawHost === 'string' && rawHost.trim()) ? rawHost.trim() : '127.0.0.1';

    try {
        await ensureTable();
        const pool = await getInfraConnection();

        const autoVerify = await isParentVerified(domain.toLowerCase());

        const { rows } = await pool.query(
            `INSERT INTO docklet_proxy_domains (domain, target_port, target_host, verified, ssl_enabled)
             VALUES ($1, $2, $3, $4, $4)
             ON CONFLICT (domain) DO UPDATE
               SET target_port = $2,
                   target_host = $3,
                   verified    = GREATEST(docklet_proxy_domains.verified, $4),
                   ssl_enabled = GREATEST(docklet_proxy_domains.ssl_enabled, $4),
                   updated_at  = NOW()
             RETURNING *`,
            [domain.toLowerCase(), port, targetHost, autoVerify]
        );

        await writeConfig(domain.toLowerCase(), targetHost, port, autoVerify);

        res.json({ domain: rows[0], autoVerified: autoVerify });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/verify/:id', authenticateToken, async (req, res) => {
    try {
        await ensureTable();
        const pool = await getInfraConnection();
        const { rows } = await pool.query('SELECT * FROM docklet_proxy_domains WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ message: 'Domain not found' });
        const domain: string = rows[0].domain;
        const serverIp = await getServerIp();

        let found: string[] = [];
        let ok = false;
        try {
            found = await dnsResolver.resolve4(domain);
            ok = found.includes(serverIp);
        } catch (e: any) {
            return res.status(400).json({ verified: false, message: `DNS lookup failed: ${e.message}`, found: [], expected: serverIp });
        }

        if (!ok) {
            return res.status(400).json({
                verified: false,
                message: `A record not pointing to this server (${serverIp}). Found: ${found.join(', ') || 'none'}`,
                found,
                expected: serverIp,
            });
        }

        await pool.query('UPDATE docklet_proxy_domains SET verified = TRUE, updated_at = NOW() WHERE id = $1', [req.params.id]);
        res.json({ verified: true, ip: serverIp });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/ssl/:id', authenticateToken, async (req, res) => {
    try {
        await ensureTable();
        const pool = await getInfraConnection();
        const { rows } = await pool.query('SELECT * FROM docklet_proxy_domains WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ message: 'Domain not found' });
        if (!rows[0].verified) return res.status(400).json({ message: 'Domain must be DNS-verified first' });

        const domain: string   = rows[0].domain;
        const port: number     = rows[0].target_port;
        const targetHost: string = rows[0].target_host || '127.0.0.1';
        const domainId = req.params.id;
        const userId = ownerFromReq(req);

        await writeConfig(domain, targetHost, port, true);
        await pool.query('UPDATE docklet_proxy_domains SET ssl_enabled = TRUE, updated_at = NOW() WHERE id = $1', [domainId]);

        emitToUser(userId, 'ssl-status', {
            id: `ssl_${domainId}`, domain, status: 'success',
            message: `TLS enabled — Traefik will provision the Let's Encrypt cert automatically on first HTTPS request`,
        });

        res.json({ ok: true, message: `TLS enabled for ${domain}` });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/reload', authenticateToken, async (_req, res) => {
    try {
        await ensureTable();
        const pool = await getInfraConnection();
        const { rows } = await pool.query('SELECT * FROM docklet_proxy_domains');
        let autoFixed = 0;
        for (const row of rows) {
            let ssl = row.ssl_enabled ?? false;
            const targetHost = row.target_host || '127.0.0.1';
            if (!row.verified) {
                const parentOk = await isParentVerified(row.domain);
                if (parentOk) {
                    await pool.query(
                        'UPDATE docklet_proxy_domains SET verified = TRUE, ssl_enabled = TRUE, updated_at = NOW() WHERE id = $1',
                        [row.id]
                    );
                    ssl = true;
                    autoFixed++;
                }
            }
            await writeConfig(row.domain, targetHost, row.target_port, ssl);
        }
        res.json({ ok: true, rewritten: rows.length, autoFixed });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        await ensureTable();
        const pool = await getInfraConnection();
        const { rows } = await pool.query('DELETE FROM docklet_proxy_domains WHERE id = $1 RETURNING *', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ message: 'Domain not found' });
        removeConfig(rows[0].domain);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/traefik-snippet', authenticateToken, async (req, res) => {
    const email = (req.query.email as string) || 'admin@example.com';
    const snippet = `  traefik:
    image: traefik:v3.0
    container_name: docklet-traefik
    restart: unless-stopped
    command:
      - "--api.insecure=false"
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--providers.file.directory=/traefik-configs"
      - "--providers.file.watch=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge=true"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
      - "--certificatesresolvers.letsencrypt.acme.email=${email}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "./letsencrypt:/letsencrypt"
      - "./traefik-configs:/traefik-configs:ro"
    networks:
      - proxy

networks:
  proxy:
    external: true`;
    res.json({ snippet, email });
});

export default router;
