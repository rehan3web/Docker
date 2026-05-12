import React, { useEffect, useRef, useState } from "react";
import { DesktopSidebar, MobileSidebarTrigger, IconSettings } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sun, Moon, Copy, Check, AlertTriangle, Globe, Lock, PauseCircle, PlayCircle, RefreshCw, Loader2, Shield, QrCode, Key, CheckCircle2, XCircle, ShieldOff, Sparkles, ChevronDown, ExternalLink, Trash2, Cpu } from "lucide-react";
import { cn, copyToClipboard } from "@/lib/utils";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import {
    pauseDatabase, resumeDatabase, resetDatabase,
    useGetConnectionConfig, exposeDatabase, unexposeDatabase,
    type ConnectionConfig, type ExposeResult,
    twoFaStatus, twoFaSetup, twoFaEnable, twoFaDisable, twoFaChange, twoFaChangeConfirm,
    useGetAiSettings, saveAiSettings, deleteAiSettings,
} from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { NVIDIA_MODELS } from "@/lib/ai-models";

// ── Copy button ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const handle = () => {
        copyToClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button onClick={handle} className="shrink-0 p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="Copy">
            {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    );
}

// ── Connection row ─────────────────────────────────────────────────────────────

function ConnRow({ label, icon, value, highlight }: { label: string; icon: React.ReactNode; value: string; highlight?: boolean }) {
    return (
        <div className={cn("flex items-center gap-3 px-5 py-3", highlight && "bg-primary/5")}>
            <div className="flex items-center gap-1.5 shrink-0">
                {icon}
                <span className={cn("text-[10px] font-semibold uppercase tracking-widest w-12", highlight ? "text-primary" : "text-muted-foreground")}>{label}</span>
            </div>
            <code className={cn("flex-1 text-[12px] font-mono bg-muted/30 rounded-lg px-3 py-2 truncate", highlight ? "text-foreground bg-primary/10 border border-primary/20" : "text-muted-foreground")}>{value}</code>
            <CopyButton text={value} />
        </div>
    );
}

// ── Connection card ────────────────────────────────────────────────────────────

function ConnectionCard({ title, localStr, publicStr, exposed, onExpose, onUnexpose, exposeLoading }: {
    title: string; localStr: string; publicStr: string;
    exposed: boolean; onExpose: () => void; onUnexpose: () => void; exposeLoading: boolean;
}) {
    return (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                        <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <ellipse cx="12" cy="5" rx="9" ry="3" />
                            <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
                            <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
                        </svg>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{title}</span>
                </div>
                <button
                    onClick={exposed ? onUnexpose : onExpose}
                    disabled={exposeLoading}
                    className={cn(
                        "flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-all",
                        exposed ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted/60 border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/30",
                        exposeLoading && "opacity-60 cursor-not-allowed"
                    )}
                >
                    {exposeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : exposed ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    {exposeLoading ? "Working..." : exposed ? "Remove Public" : "Expose Public"}
                </button>
            </div>
            <div className="flex flex-col divide-y divide-border">
                <ConnRow label="Local" icon={<Lock className="w-3 h-3 text-muted-foreground/60" />} value={localStr} />
                {exposed && <ConnRow label="Public" icon={<Globe className="w-3 h-3 text-primary/70" />} value={publicStr} highlight />}
            </div>
        </div>
    );
}

// ── Connection section ────────────────────────────────────────────────────────

function ConnectionSection() {
    const qc = useQueryClient();
    const { data: cfg, isLoading } = useGetConnectionConfig();
    const [exposeLoading, setExposeLoading] = useState(false);
    const [liveExposed, setLiveExposed] = useState<ExposeResult | null>(null);
    const exposed = liveExposed?.exposed ?? cfg?.exposed ?? false;
    const directPublic = liveExposed?.directPublic ?? cfg?.directPublic ?? "";
    const poolerPublic = liveExposed?.poolerPublic ?? cfg?.poolerPublic ?? "";

    const handleExpose = async () => {
        setExposeLoading(true);
        try {
            const result = await exposeDatabase();
            setLiveExposed(result);
            const modeLabel = result.mode === 'docker' ? 'Docker containers restarted' :
                result.mode === 'docker-config-updated' ? 'postgres.yml updated — restart containers to apply' :
                    'postgres.yml updated — run docker compose up -d --force-recreate postgres pgbouncer';
            toast.custom((t) => (<Alert variant="success" title="Public Access Enabled" description={`${modeLabel}. Connect via ${result.serverIp}:${result.directPublicPort}`} onClose={() => toast.dismiss(t)} />));
            qc.invalidateQueries({ queryKey: ["admin-connection-config"] });
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" title="Expose Failed" description={err.message} onClose={() => toast.dismiss(t)} />));
        } finally { setExposeLoading(false); }
    };

    const handleUnexpose = async () => {
        setExposeLoading(true);
        try {
            const result = await unexposeDatabase();
            setLiveExposed({ exposed: false });
            toast.custom((t) => (<Alert variant="warning" title="Public Access Removed" description={(result as any).note || "postgres.yml restored to local-only binding."} onClose={() => toast.dismiss(t)} />));
            qc.invalidateQueries({ queryKey: ["admin-connection-config"] });
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" title="Error" description={err.message} onClose={() => toast.dismiss(t)} />));
        } finally { setExposeLoading(false); }
    };

    if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm py-4"><Loader2 className="w-4 h-4 animate-spin" />Loading connection config…</div>;

    const directLocal = cfg?.directLocal ?? `postgresql://postgres@127.0.0.1:5432/postgres`;
    const poolerLocal = cfg?.poolerLocal ?? `postgresql://postgres@127.0.0.1:6543/postgres`;

    return (
        <div className="flex flex-col gap-4">
            <ConnectionCard title={`Direct Connection${cfg ? ` · ${cfg.containerName}` : ''}`} localStr={directLocal} publicStr={directPublic} exposed={exposed} onExpose={handleExpose} onUnexpose={handleUnexpose} exposeLoading={exposeLoading} />
            <ConnectionCard title={`Pooler Connection${cfg ? ` · ${cfg.poolerContainer}` : ''}`} localStr={poolerLocal} publicStr={poolerPublic} exposed={exposed} onExpose={handleExpose} onUnexpose={handleUnexpose} exposeLoading={exposeLoading} />
            {cfg && (
                <div className="flex items-center gap-4 px-1 text-[11px] text-muted-foreground/60 font-mono">
                    <span>Server IP: <span className="text-foreground/70">{cfg.serverIp}</span></span>
                    <span>·</span>
                    <span>DB: <span className="text-foreground/70">{cfg.db}</span></span>
                    <span>·</span>
                    <span>User: <span className="text-foreground/70">{cfg.user}</span></span>
                </div>
            )}
        </div>
    );
}

// ── Pause database card ───────────────────────────────────────────────────────

function PauseDatabaseCard() {
    const [paused, setPaused] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleToggle = async () => {
        setLoading(true);
        try {
            if (paused) {
                await resumeDatabase();
                setPaused(false);
                toast.custom((t) => (<Alert variant="success" title="Database Resumed" description="Your database is now active and accepting connections." onClose={() => toast.dismiss(t)} />));
            } else {
                await pauseDatabase();
                setPaused(true);
                toast.custom((t) => (<Alert variant="warning" title="Database Paused" description="All connections have been suspended. Resume to restore access." onClose={() => toast.dismiss(t)} />));
            }
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" title="Error" description={err.message} onClose={() => toast.dismiss(t)} />));
        } finally { setLoading(false); }
    };

    return (
        <div className={cn("border rounded-xl overflow-hidden transition-colors", paused ? "border-yellow-500/30 bg-yellow-500/5" : "border-border bg-card")}>
            <div className={cn("flex items-center justify-between px-5 py-4 border-b", paused ? "border-yellow-500/20 bg-yellow-500/10" : "border-border bg-muted/20")}>
                <div className="flex items-center gap-2">
                    <div className={cn("p-1.5 rounded-lg border", paused ? "bg-yellow-500/10 border-yellow-500/30" : "bg-primary/10 border-primary/20")}>
                        {paused ? <PauseCircle className="w-3.5 h-3.5 text-yellow-500" /> : <PlayCircle className="w-3.5 h-3.5 text-primary" />}
                    </div>
                    <span className="text-sm font-semibold text-foreground">Pause Database</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className={cn("w-1.5 h-1.5 rounded-full", paused ? "bg-yellow-500" : "bg-primary animate-pulse")} />
                    <span className={cn("text-[10px] font-semibold uppercase tracking-widest", paused ? "text-yellow-500" : "text-primary")}>{paused ? "Paused" : "Running"}</span>
                </div>
            </div>
            <div className="px-5 py-4 flex items-start justify-between gap-6">
                <p className="text-sm text-muted-foreground leading-relaxed">
                    {paused ? "Database is currently paused. All connections are suspended. Resume to restore access." : "Pausing the database will suspend all active connections. No data will be lost."}
                </p>
                <Button size="sm" variant="outline" className={cn("shrink-0 h-8 px-4 text-xs font-medium gap-1.5 transition-colors", paused ? "border-primary/40 text-primary hover:bg-primary/10" : "border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/10")} onClick={handleToggle} disabled={loading}>
                    {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : paused ? <PlayCircle className="w-3.5 h-3.5" /> : <PauseCircle className="w-3.5 h-3.5" />}
                    {loading ? (paused ? "Resuming..." : "Pausing...") : paused ? "Resume Database" : "Pause Database"}
                </Button>
            </div>
        </div>
    );
}

// ── Reset database card ───────────────────────────────────────────────────────

function ResetDatabaseCard() {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const canConfirm = input === "DELETE";

    const handleReset = async () => {
        if (!canConfirm) return;
        setLoading(true);
        try {
            const result = await resetDatabase();
            setConfirmOpen(false);
            setInput("");
            toast.custom((t) => (<Alert variant="error" title="Database Reset" description={`${result.dropped} table(s) dropped. Database has been reset.`} onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" title="Reset Failed" description={err.message} onClose={() => toast.dismiss(t)} />));
        } finally { setLoading(false); }
    };

    return (
        <div className="border border-destructive/25 rounded-xl bg-destructive/5 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-destructive/20">
                <div className="p-1.5 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                </div>
                <span className="text-sm font-semibold text-foreground">Reset Database</span>
            </div>
            <div className="px-5 py-4 flex items-start justify-between gap-6">
                <p className="text-sm text-muted-foreground leading-relaxed">Permanently erase all data, tables, and schemas. This action cannot be undone.</p>
                {!confirmOpen ? (
                    <Button variant="destructive" size="sm" className="shrink-0 h-8 px-4 text-xs font-medium" onClick={() => setConfirmOpen(true)}>Reset Database</Button>
                ) : (
                    <div className="flex flex-col gap-3 w-full max-w-sm">
                        <p className="text-xs text-muted-foreground">Type <span className="font-mono font-bold text-foreground">DELETE</span> to confirm</p>
                        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="DELETE" className="font-mono text-sm h-9" autoFocus onPaste={(e) => e.preventDefault()} />
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => { setConfirmOpen(false); setInput(""); }}>Cancel</Button>
                            <Button variant="destructive" size="sm" className="flex-1 h-8 text-xs gap-1.5" disabled={!canConfirm || loading} onClick={handleReset}>
                                {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                                {loading ? "Resetting..." : "Confirm Reset"}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── 2FA section ───────────────────────────────────────────────────────────────

type TwoFAStatus = { featureEnabled: boolean; configured: boolean; enabled: boolean };
type TwoFAView = "loading" | "disabled" | "setup" | "active" | "change";

function OtpInput({ value, onChange, autoFocus }: { value: string[]; onChange: (v: string[]) => void; autoFocus?: boolean }) {
    const refs = useRef<(HTMLInputElement | null)[]>([]);

    const handleInput = (idx: number, val: string) => {
        const digit = val.replace(/\D/g, "").slice(-1);
        const next = [...value];
        next[idx] = digit;
        onChange(next);
        if (digit && idx < 5) refs.current[idx + 1]?.focus();
    };

    const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
        if (e.key === "Backspace" && !value[idx] && idx > 0) refs.current[idx - 1]?.focus();
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        const next = ["", "", "", "", "", ""];
        for (let i = 0; i < text.length; i++) next[i] = text[i];
        onChange(next);
        refs.current[Math.min(text.length, 5)]?.focus();
    };

    return (
        <div className="flex gap-2" onPaste={handlePaste}>
            {value.map((digit, idx) => (
                <input
                    key={idx}
                    ref={el => { refs.current[idx] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleInput(idx, e.target.value)}
                    onKeyDown={e => handleKeyDown(idx, e)}
                    autoFocus={autoFocus && idx === 0}
                    className={cn(
                        "w-10 h-11 text-center text-base font-mono font-semibold rounded-xl border bg-muted/5 outline-none transition-all",
                        "border-border focus:border-primary focus:ring-2 focus:ring-primary/20",
                        digit ? "border-primary/40 bg-primary/5" : ""
                    )}
                />
            ))}
        </div>
    );
}

function TwoFASection() {
    const [status, setStatus] = useState<TwoFAStatus | null>(null);
    const [view, setView] = useState<TwoFAView>("loading");

    // Setup / change shared state
    const [qrDataUrl, setQrDataUrl] = useState("");
    const [secret, setSecret] = useState("");
    const [showSecret, setShowSecret] = useState(false);
    const [secretCopied, setSecretCopied] = useState(false);

    // OTP inputs
    const [otp, setOtp] = useState(["", "", "", "", "", ""]);
    const [otpError, setOtpError] = useState<string | null>(null);

    // Password confirm (disable / change)
    const [password, setPassword] = useState("");
    const [passwordError, setPasswordError] = useState<string | null>(null);

    // Loading flags
    const [generating, setGenerating] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Change flow sub-step
    const [changeStep, setChangeStep] = useState<"password" | "qr">("password");

    // Disable confirmation panel
    const [disableOpen, setDisableOpen] = useState(false);

    const resetOtp = () => { setOtp(["", "", "", "", "", ""]); setOtpError(null); };

    useEffect(() => {
        twoFaStatus()
            .then(s => {
                setStatus(s);
                if (!s.featureEnabled) setView("disabled");
                else if (!s.configured) setView("setup");
                else setView("active");
            })
            .catch(() => {
                setStatus({ featureEnabled: false, configured: false, enabled: false });
                setView("disabled");
            });
    }, []);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const data = await twoFaSetup();
            setQrDataUrl(data.qrDataUrl);
            setSecret(data.secret);
            setShowSecret(false);
        } catch (err: any) {
            toast.custom((t) => (<Alert variant="error" title="Error" description={err.message} onClose={() => toast.dismiss(t)} />));
        } finally { setGenerating(false); }
    };

    const handleEnable = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = otp.join("");
        if (code.length < 6) { setOtpError("Enter the full 6-digit code"); return; }
        setSubmitting(true);
        setOtpError(null);
        try {
            await twoFaEnable(code);
            setStatus(s => s ? { ...s, configured: true, enabled: true } : s);
            setView("active");
            resetOtp();
            setQrDataUrl("");
            setSecret("");
            toast.custom((t) => (<Alert variant="success" title="2FA Enabled" description="Two-factor authentication is now active on your account." onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            setOtpError(err.message || "Invalid code");
            resetOtp();
        } finally { setSubmitting(false); }
    };

    const handleDisable = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password) { setPasswordError("Password required"); return; }
        setSubmitting(true);
        setPasswordError(null);
        try {
            await twoFaDisable(password);
            setStatus(s => s ? { ...s, configured: false, enabled: false } : s);
            setView("setup");
            setPassword("");
            setQrDataUrl("");
            setSecret("");
            toast.custom((t) => (<Alert variant="warning" title="2FA Disabled" description="Two-factor authentication has been removed from your account." onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            setPasswordError(err.message || "Incorrect password");
        } finally { setSubmitting(false); }
    };

    const handleChangeStart = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password) { setPasswordError("Password required"); return; }
        setSubmitting(true);
        setPasswordError(null);
        try {
            const data = await twoFaChange(password);
            setQrDataUrl(data.qrDataUrl);
            setSecret(data.secret);
            setShowSecret(false);
            setChangeStep("qr");
            resetOtp();
        } catch (err: any) {
            setPasswordError(err.message || "Incorrect password");
        } finally { setSubmitting(false); }
    };

    const handleChangeConfirm = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = otp.join("");
        if (code.length < 6) { setOtpError("Enter the full 6-digit code"); return; }
        setSubmitting(true);
        setOtpError(null);
        try {
            await twoFaChangeConfirm(code);
            setView("active");
            setPassword("");
            setQrDataUrl("");
            setSecret("");
            setChangeStep("password");
            resetOtp();
            toast.custom((t) => (<Alert variant="success" title="2FA Updated" description="Your authenticator has been successfully changed." onClose={() => toast.dismiss(t)} />));
        } catch (err: any) {
            setOtpError(err.message || "Invalid code");
            resetOtp();
        } finally { setSubmitting(false); }
    };

    const handleCopySecret = () => {
        copyToClipboard(secret);
        setSecretCopied(true);
        setTimeout(() => setSecretCopied(false), 2000);
    };

    if (view === "loading") {
        return (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading 2FA status…
            </div>
        );
    }

    if (view === "disabled") {
        return (
            <div className="border border-border rounded-xl bg-card overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-5">
                    <div className="p-2 rounded-xl bg-muted/50 border border-border shrink-0">
                        <ShieldOff className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-foreground">Two-Factor Authentication Disabled</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Set <code className="font-mono bg-muted px-1 rounded">ENABLE_2FA=true</code> in your <code className="font-mono bg-muted px-1 rounded">.env</code> file and restart the backend to enable 2FA.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (view === "setup") {
        return (
            <div className="border border-border rounded-xl bg-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                            <Shield className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <span className="text-sm font-semibold text-foreground">Setup Two-Factor Authentication</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Not Configured</span>
                    </div>
                </div>
                <div className="p-5 space-y-5">
                    {!qrDataUrl ? (
                        <>
                            <p className="text-sm text-muted-foreground">
                                Add an extra layer of security by requiring a time-based one-time password at login. Works with Google Authenticator, Authy, Microsoft Authenticator, and 1Password.
                            </p>
                            <Button onClick={handleGenerate} disabled={generating} className="h-9 px-4 gap-2 text-xs font-medium rounded-xl bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none">
                                {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
                                {generating ? "Generating…" : "Generate QR Code"}
                            </Button>
                        </>
                    ) : (
                        <form onSubmit={handleEnable} className="space-y-5">
                            <div className="flex gap-6 flex-wrap">
                                <div className="flex flex-col items-center gap-2">
                                    <div className="p-2 bg-white rounded-xl border border-border shadow-sm">
                                        <img src={qrDataUrl} alt="2FA QR Code" className="w-56 h-56" />
                                    </div>
                                    <p className="text-[11px] text-muted-foreground text-center">Scan with your authenticator app</p>
                                </div>
                                <div className="flex-1 min-w-48 space-y-3 flex flex-col justify-center">
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Manual key</span>
                                            <button type="button" onClick={() => setShowSecret(v => !v)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">{showSecret ? "Hide" : "Show"}</button>
                                        </div>
                                        <div className="flex items-center gap-2 bg-muted/30 border border-border rounded-lg px-3 py-2">
                                            <code className="flex-1 text-[11px] font-mono text-foreground tracking-widest break-all">
                                                {showSecret ? secret : secret.replace(/./g, "•")}
                                            </code>
                                            <button type="button" onClick={handleCopySecret} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted">
                                                {secretCopied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                                        Store this key safely — you'll need it if you ever lose access to your authenticator app.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <p className="text-xs font-medium text-muted-foreground">Enter the 6-digit code from your app to confirm</p>
                                {otpError && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{otpError}</div>}
                                <OtpInput value={otp} onChange={setOtp} autoFocus />
                            </div>

                            <div className="flex gap-3">
                                <Button type="submit" disabled={submitting || otp.join("").length < 6} className="h-9 px-4 gap-2 text-xs font-medium rounded-xl bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none">
                                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
                                    {submitting ? "Activating…" : "Activate 2FA"}
                                </Button>
                                <Button type="button" variant="outline" size="sm" className="h-9 px-4 text-xs" onClick={() => { setQrDataUrl(""); setSecret(""); resetOtp(); }}>
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        );
    }

    if (view === "change") {
        return (
            <div className="border border-border rounded-xl bg-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/20">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                            <Shield className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <span className="text-sm font-semibold text-foreground">Change Authenticator</span>
                    </div>
                </div>
                <div className="p-5 space-y-4">
                    {changeStep === "password" ? (
                        <form onSubmit={handleChangeStart} className="space-y-4">
                            <p className="text-sm text-muted-foreground">Confirm your password to generate a new authenticator secret.</p>
                            {passwordError && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{passwordError}</div>}
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                                <Input type="password" placeholder="Current password" value={password} onChange={e => setPassword(e.target.value)} className="pl-9 h-9 text-sm" autoFocus />
                            </div>
                            <div className="flex gap-3">
                                <Button type="submit" disabled={submitting} className="h-9 px-4 gap-2 text-xs font-medium rounded-xl bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none">
                                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                                    {submitting ? "Verifying…" : "Generate New QR"}
                                </Button>
                                <Button type="button" variant="outline" size="sm" className="h-9 px-4 text-xs" onClick={() => { setView("active"); setPassword(""); setPasswordError(null); }}>Cancel</Button>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleChangeConfirm} className="space-y-5">
                            <div className="flex gap-6 flex-wrap">
                                <div className="flex flex-col items-center gap-2">
                                    <div className="p-2 bg-white rounded-xl border border-border shadow-sm">
                                        <img src={qrDataUrl} alt="2FA QR Code" className="w-56 h-56" />
                                    </div>
                                    <p className="text-[11px] text-muted-foreground text-center">Scan with your authenticator app</p>
                                </div>
                                <div className="flex-1 min-w-48 space-y-3 flex flex-col justify-center">
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">New key</span>
                                            <button type="button" onClick={() => setShowSecret(v => !v)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">{showSecret ? "Hide" : "Show"}</button>
                                        </div>
                                        <div className="flex items-center gap-2 bg-muted/30 border border-border rounded-lg px-3 py-2">
                                            <code className="flex-1 text-[11px] font-mono text-foreground tracking-widest break-all">
                                                {showSecret ? secret : secret.replace(/./g, "•")}
                                            </code>
                                            <button type="button" onClick={handleCopySecret} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted">
                                                {secretCopied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-muted-foreground">Enter the 6-digit code from your new authenticator entry</p>
                                {otpError && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{otpError}</div>}
                                <OtpInput value={otp} onChange={setOtp} autoFocus />
                            </div>
                            <div className="flex gap-3">
                                <Button type="submit" disabled={submitting || otp.join("").length < 6} className="h-9 px-4 gap-2 text-xs font-medium rounded-xl bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none">
                                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
                                    {submitting ? "Saving…" : "Confirm New 2FA"}
                                </Button>
                                <Button type="button" variant="outline" size="sm" className="h-9 px-4 text-xs" onClick={() => { setChangeStep("password"); resetOtp(); setQrDataUrl(""); setSecret(""); }}>Back</Button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        );
    }

    // ── Active state ───────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-4">
            {/* Status card */}
            <div className="border border-primary/20 rounded-xl bg-primary/5 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-primary/10 border border-primary/20">
                            <Shield className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-foreground">Two-Factor Authentication Active</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Your account is protected with TOTP-based 2FA.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                        <span className="text-[11px] font-semibold text-primary uppercase tracking-widest">Enabled</span>
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3">
                <Button
                    variant="outline"
                    className="justify-start gap-2 h-9 px-4 text-xs font-medium"
                    onClick={() => { setView("change"); setChangeStep("password"); setPassword(""); setPasswordError(null); resetOtp(); }}
                >
                    <Key className="w-3.5 h-3.5" /> Change Authenticator
                </Button>

                {!disableOpen ? (
                    <Button variant="outline" className="justify-start gap-2 h-9 px-4 text-xs font-medium border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive/50" onClick={() => { setDisableOpen(true); setPassword(""); setPasswordError(null); }}>
                        <XCircle className="w-3.5 h-3.5" /> Disable 2FA
                    </Button>
                ) : (
                    <form onSubmit={handleDisable} className="border border-destructive/20 rounded-xl bg-destructive/5 p-4 space-y-3">
                        <p className="text-xs text-muted-foreground">Enter your password to disable two-factor authentication.</p>
                        {passwordError && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{passwordError}</div>}
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                            <Input type="password" placeholder="Current password" value={password} onChange={e => setPassword(e.target.value)} className="pl-9 h-9 text-sm" autoFocus />
                        </div>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => setDisableOpen(false)}>Cancel</Button>
                            <Button type="submit" variant="destructive" size="sm" className="flex-1 h-8 text-xs gap-1.5" disabled={submitting}>
                                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                {submitting ? "Disabling…" : "Confirm Disable"}
                            </Button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

// ── AI Configuration section ───────────────────────────────────────────────────

function AiConfigSection() {
    const qc = useQueryClient();
    const { data: settings, isLoading } = useGetAiSettings();
    const configured = settings?.configured ?? false;

    const [apiKey, setApiKey] = useState("");
    const [model, setModel]   = useState("");
    const [saving, setSaving]     = useState(false);
    const [deleting, setDeleting] = useState(false);

    const activeModel = model || settings?.model || NVIDIA_MODELS[0].value;
    const selModel    = NVIDIA_MODELS.find(m => m.value === activeModel) ?? NVIDIA_MODELS[0];

    async function handleSave() {
        if (!apiKey.trim() || apiKey.trim().length < 8) {
            toast.error("Please enter a valid NVIDIA API key (at least 8 characters).");
            return;
        }
        setSaving(true);
        try {
            await saveAiSettings(apiKey.trim(), model || undefined);
            toast.success("AI configured successfully!");
            setApiKey("");
            qc.invalidateQueries({ queryKey: ["ai-settings"] });
        } catch (err: any) { toast.error(err.message || "Failed to save settings"); }
        finally { setSaving(false); }
    }

    async function handleDelete() {
        setDeleting(true);
        try {
            await deleteAiSettings();
            toast.success("AI settings removed.");
            setModel("");
            qc.invalidateQueries({ queryKey: ["ai-settings"] });
        } catch (err: any) { toast.error(err.message || "Failed to remove settings"); }
        finally { setDeleting(false); }
    }

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading AI settings…
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Status */}
            {configured && settings?.apiKeyMasked && (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
                    <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-primary">AI is active</p>
                        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                            {settings.apiKeyMasked} · {settings.model}
                        </p>
                    </div>
                    <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-primary/10 text-primary border-primary/20 shrink-0">
                        Configured
                    </Badge>
                </div>
            )}

            {/* API Key */}
            <div className="border border-border rounded-xl bg-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border bg-muted/20 flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-foreground">
                        NVIDIA API Key{configured && <span className="text-muted-foreground font-normal ml-1">(enter a new one to replace)</span>}
                    </span>
                </div>
                <div className="p-5 flex flex-col gap-4">
                    <div className="space-y-1.5">
                        <Input
                            type="password"
                            placeholder="nvapi-…"
                            value={apiKey}
                            onChange={e => setApiKey(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
                            className="h-9 text-xs font-mono"
                        />
                        <p className="text-[11px] text-muted-foreground">
                            Get your free key at{" "}
                            <a href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer"
                               className="text-primary hover:underline inline-flex items-center gap-0.5">
                                build.nvidia.com <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                        </p>
                    </div>

                    {/* Model */}
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Default Model</label>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full h-9 text-xs justify-between font-sans px-3">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Cpu className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="truncate">{selModel.label}</span>
                                        <span className="text-muted-foreground shrink-0 text-[11px]">{selModel.provider}</span>
                                        {selModel.thinking && (
                                            <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 border-primary/30 text-primary bg-primary/5">Thinking</Badge>
                                        )}
                                    </div>
                                    <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-50 ml-2" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[340px] rounded-xl p-1.5 shadow-lg">
                                <p className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Thinking / Reasoning</p>
                                {NVIDIA_MODELS.filter(m => m.thinking).map(m => (
                                    <DropdownMenuItem key={m.value} className="px-2.5 py-2 rounded-lg cursor-pointer gap-2 text-xs" onClick={() => setModel(m.value)}>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={cn("font-medium truncate", m.value === activeModel && "text-primary")}>{m.label}</span>
                                                {m.value === activeModel && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                                            </div>
                                            <span className="text-muted-foreground text-[11px]">{m.provider}</span>
                                        </div>
                                        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 border-primary/30 text-primary bg-primary/5">Thinking</Badge>
                                    </DropdownMenuItem>
                                ))}
                                <div className="my-1 border-t border-border/50" />
                                <p className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Fast / Instruction</p>
                                {NVIDIA_MODELS.filter(m => !m.thinking).map(m => (
                                    <DropdownMenuItem key={m.value} className="px-2.5 py-2 rounded-lg cursor-pointer gap-2 text-xs" onClick={() => setModel(m.value)}>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={cn("font-medium truncate", m.value === activeModel && "text-primary")}>{m.label}</span>
                                                {m.value === activeModel && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                                            </div>
                                            <span className="text-muted-foreground text-[11px]">{m.provider}</span>
                                        </div>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <p className="text-[11px] text-muted-foreground">This sets the default model used by AI Chat. You can override per-session in the chat.</p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={handleSave} disabled={saving || !apiKey.trim()}>
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            {configured ? "Update Key" : "Save & Activate"}
                        </Button>
                        {configured && (
                            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10" onClick={handleDelete} disabled={deleting}>
                                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                Remove Key
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Settings page ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
    const { theme, toggle } = useTheme();
    const [tab, setTab] = useState<"database" | "2fa" | "ai">("database");

    return (
        <div className="min-h-screen bg-background text-foreground flex">
            <DesktopSidebar />
            <div className="flex-1 flex flex-col min-w-0">
                <header className="h-18 border-b border-border bg-background flex items-center justify-between px-6 shrink-0 sticky top-0 z-10">
                    <div className="flex items-center gap-4">
                        <MobileSidebarTrigger />
                        <div className="flex items-center gap-2">
                            <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                                <IconSettings className="w-4 h-4 text-primary" />
                            </div>
                            <h1 className="text-sm font-semibold tracking-tight">Settings</h1>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={toggle} aria-label="Toggle theme">
                        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </Button>
                </header>
                <main className="flex-1 px-6 py-8 max-w-3xl w-full mx-auto flex flex-col gap-8">
                    <div>
                        <h2 className="text-xl font-bold text-foreground tracking-tight">Settings</h2>
                        <p className="text-sm text-muted-foreground mt-1">Manage your database connections and configuration.</p>
                    </div>

                    {/* Tab bar */}
                    <div className="flex gap-1 border border-border rounded-xl p-1 bg-muted/20 w-fit">
                        {(["database", "2fa", "ai"] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={cn(
                                    "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-all",
                                    tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {t === "database" && <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" /></svg>}
                                {t === "2fa" && <Shield className="w-3.5 h-3.5" />}
                                {t === "ai" && <Sparkles className="w-3.5 h-3.5" />}
                                {t === "database" ? "Database" : t === "2fa" ? "2FA" : "AI"}
                            </button>
                        ))}
                    </div>

                    {tab === "database" && (
                        <>
                            <section className="flex flex-col gap-4">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Database Connection</h3>
                                    <div className="flex-1 h-px bg-border" />
                                </div>
                                <ConnectionSection />
                            </section>
                            <section className="flex flex-col gap-4">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Database Management</h3>
                                    <div className="flex-1 h-px bg-border" />
                                </div>
                                <PauseDatabaseCard />
                            </section>
                            <section className="flex flex-col gap-4">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Danger Zone</h3>
                                    <div className="flex-1 h-px bg-destructive/30" />
                                </div>
                                <ResetDatabaseCard />
                            </section>
                        </>
                    )}

                    {tab === "2fa" && (
                        <section className="flex flex-col gap-4">
                            <div className="flex items-center gap-3">
                                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Two-Factor Authentication</h3>
                                <div className="flex-1 h-px bg-border" />
                            </div>
                            <TwoFASection />
                        </section>
                    )}

                    {tab === "ai" && (
                        <section className="flex flex-col gap-4">
                            <div className="flex items-center gap-3">
                                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">AI Configuration</h3>
                                <div className="flex-1 h-px bg-border" />
                            </div>
                            <AiConfigSection />
                        </section>
                    )}
                </main>
            </div>
        </div>
    );
}
