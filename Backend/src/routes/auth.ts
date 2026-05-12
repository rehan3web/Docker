import express from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { generateToken, authenticateToken } from '../middleware/auth';
import { loadConfig } from '../lib/config';
import { getSetting, setSetting, deleteSetting } from '../lib/settings';
import { getJwtSecret } from '../lib/secret';

const router = express.Router();
const JWT_SECRET = getJwtSecret();
const ENABLE_2FA = process.env.ENABLE_2FA === 'true';
const APP_NAME = 'Docklet';

// Prevent any browser or proxy from caching auth responses
router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function totpVerify(secret: string, code: string): boolean {
    return speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token: code.replace(/\s/g, ''),
        window: 2,
    });
}

function makeQR(username: string, secret: string): Promise<string> {
    const otpauth = speakeasy.otpauthURL({
        secret,
        label: `${APP_NAME}:${encodeURIComponent(username)}`,
        issuer: APP_NAME,
        encoding: 'base32',
    });
    return QRCode.toDataURL(otpauth, { width: 400, errorCorrectionLevel: 'M' });
}

// ── Rate limiter for OTP endpoints ────────────────────────────────────────────

const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: 'Too many attempts — wait 15 minutes and try again' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
});

// ── Partial-token helpers (OTP login step) ────────────────────────────────────

function generatePartialToken(username: string): string {
    return jwt.sign({ username, partial: true }, JWT_SECRET, { expiresIn: '5m' });
}

function verifyPartialToken(token: string): { username: string } | null {
    try {
        const p = jwt.verify(token, JWT_SECRET) as any;
        if (!p.partial) return null;
        return { username: p.username };
    } catch {
        return null;
    }
}

// ── Config / me ───────────────────────────────────────────────────────────────

router.get('/config', (_req, res) => {
    res.json({ username: process.env.ADMIN_USERNAME });
});

router.get('/me', authenticateToken, (req, res) => {
    res.json({ user: (req as any).user });
});

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const config = loadConfig();

    const envUser = (process.env.ADMIN_USERNAME || config?.['x-admin-user'] || '').toString().trim();
    const envPass = (process.env.ADMIN_PASSWORD || config?.['x-admin-pass'] || '').toString().trim();
    const inputUser = (username || '').toString().trim();
    const inputPass = (password || '').toString().trim();

    if (inputUser !== envUser || inputPass !== envPass) {
        return res.status(401).json({ message: 'Invalid credentials' });
    }

    // If 2FA is globally enabled and this admin has configured it, require OTP
    if (ENABLE_2FA) {
        const twoFaEnabled = await getSetting('twofa_enabled');
        if (twoFaEnabled === 'true') {
            const otpToken = generatePartialToken(inputUser);
            return res.json({ requiresOTP: true, otpToken });
        }
    }

    const token = generateToken({ username: inputUser });
    return res.json({ token, user: { username: inputUser } });
});

// ── OTP login verification ────────────────────────────────────────────────────

router.post('/2fa/verify-login', otpLimiter, async (req, res) => {
    if (!ENABLE_2FA) return res.status(400).json({ message: '2FA is disabled' });

    const { otpToken, code } = req.body;
    if (!otpToken || !code) return res.status(400).json({ message: 'otpToken and code required' });

    const partial = verifyPartialToken(otpToken);
    if (!partial) return res.status(401).json({ message: 'Session expired — please log in again' });

    const secret = await getSetting('twofa_secret');
    if (!secret) return res.status(400).json({ message: '2FA not configured' });

    if (!totpVerify(secret, code)) {
        return res.status(401).json({ message: 'Invalid code — check your authenticator app' });
    }

    const token = generateToken({ username: partial.username });
    return res.json({ token, user: { username: partial.username } });
});

// ── 2FA status ────────────────────────────────────────────────────────────────

router.get('/2fa/status', authenticateToken, async (_req, res) => {
    const configured = !!(await getSetting('twofa_secret'));
    const enabled = (await getSetting('twofa_enabled')) === 'true';
    res.json({ featureEnabled: ENABLE_2FA, configured, enabled });
});

// ── Setup: generate secret + QR ──────────────────────────────────────────────

router.post('/2fa/setup', authenticateToken, async (_req, res) => {
    if (!ENABLE_2FA) return res.status(400).json({ message: '2FA is disabled' });

    const username = process.env.ADMIN_USERNAME || 'admin';
    const secretObj = speakeasy.generateSecret({ name: `${APP_NAME}:${username}` });
    const secret = secretObj.base32;
    const qrDataUrl = await makeQR(username, secret);

    await setSetting('twofa_pending_secret', secret);
    res.json({ secret, qrDataUrl });
});

// ── Enable: verify OTP + activate ────────────────────────────────────────────

router.post('/2fa/enable', authenticateToken, otpLimiter, async (req, res) => {
    if (!ENABLE_2FA) return res.status(400).json({ message: '2FA is disabled' });

    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'OTP code required' });

    const pendingSecret = await getSetting('twofa_pending_secret');
    if (!pendingSecret) return res.status(400).json({ message: 'No setup in progress — generate a QR code first' });

    if (!totpVerify(pendingSecret, code)) {
        return res.status(400).json({ message: 'Invalid code — check your authenticator app' });
    }

    await setSetting('twofa_secret', pendingSecret);
    await setSetting('twofa_enabled', 'true');
    await deleteSetting('twofa_pending_secret');
    res.json({ ok: true });
});

// ── Disable: verify password + clear ─────────────────────────────────────────

router.post('/2fa/disable', authenticateToken, async (req, res) => {
    if (!ENABLE_2FA) return res.status(400).json({ message: '2FA is disabled' });

    const { password } = req.body;
    const envPass = (process.env.ADMIN_PASSWORD || '').toString().trim();
    if (!password || password.toString().trim() !== envPass) {
        return res.status(401).json({ message: 'Incorrect password' });
    }

    await setSetting('twofa_enabled', 'false');
    await deleteSetting('twofa_secret');
    await deleteSetting('twofa_pending_secret');
    res.json({ ok: true });
});

// ── Change: verify password + generate new secret ─────────────────────────────

router.post('/2fa/change', authenticateToken, async (req, res) => {
    if (!ENABLE_2FA) return res.status(400).json({ message: '2FA is disabled' });

    const { password } = req.body;
    const envPass = (process.env.ADMIN_PASSWORD || '').toString().trim();
    if (!password || password.toString().trim() !== envPass) {
        return res.status(401).json({ message: 'Incorrect password' });
    }

    const username = process.env.ADMIN_USERNAME || 'admin';
    const secretObj = speakeasy.generateSecret({ name: `${APP_NAME}:${username}` });
    const secret = secretObj.base32;
    const qrDataUrl = await makeQR(username, secret);

    await setSetting('twofa_pending_secret', secret);
    res.json({ secret, qrDataUrl });
});

// ── Change confirm: verify new OTP + swap ────────────────────────────────────

router.post('/2fa/change-confirm', authenticateToken, otpLimiter, async (req, res) => {
    if (!ENABLE_2FA) return res.status(400).json({ message: '2FA is disabled' });

    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'OTP code required' });

    const pendingSecret = await getSetting('twofa_pending_secret');
    if (!pendingSecret) return res.status(400).json({ message: 'No change in progress' });

    if (!totpVerify(pendingSecret, code)) {
        return res.status(400).json({ message: 'Invalid code — check your authenticator app' });
    }

    await setSetting('twofa_secret', pendingSecret);
    await deleteSetting('twofa_pending_secret');
    res.json({ ok: true });
});

// ── Change password (managed via env vars) ────────────────────────────────────

router.post('/change-password', authenticateToken, (_req, res) => {
    res.status(400).json({ message: 'Password changes are managed via environment variables.' });
});

export default router;
