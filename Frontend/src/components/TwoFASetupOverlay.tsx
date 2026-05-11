import React, { useEffect, useRef, useState } from "react";
import { Shield, Copy, Check, QrCode, Key, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/utils";
import { getToken, twoFaStatus, twoFaSetup, twoFaEnable } from "@/api/client";

type Phase = "loading" | "hidden" | "intro" | "qr" | "done";

export default function TwoFASetupOverlay() {
    const [phase, setPhase] = useState<Phase>("loading");
    const [qrDataUrl, setQrDataUrl] = useState("");
    const [secret, setSecret] = useState("");
    const [showSecret, setShowSecret] = useState(false);
    const [copied, setCopied] = useState(false);
    const [otp, setOtp] = useState(["", "", "", "", "", ""]);
    const [otpError, setOtpError] = useState<string | null>(null);
    const [enabling, setEnabling] = useState(false);
    const [generating, setGenerating] = useState(false);
    const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

    useEffect(() => {
        if (!getToken()) { setPhase("hidden"); return; }
        twoFaStatus()
            .then(s => {
                if (s.featureEnabled && !s.configured) setPhase("intro");
                else setPhase("hidden");
            })
            .catch(() => setPhase("hidden"));
    }, []);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const data = await twoFaSetup();
            setQrDataUrl(data.qrDataUrl);
            setSecret(data.secret);
            setPhase("qr");
        } catch (err: any) {
            console.error("2FA setup failed:", err.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleEnable = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = otp.join("");
        if (code.length < 6) { setOtpError("Enter the full 6-digit code"); return; }
        setEnabling(true);
        setOtpError(null);
        try {
            await twoFaEnable(code);
            setPhase("done");
        } catch (err: any) {
            setOtpError(err.message || "Invalid code");
            setOtp(["", "", "", "", "", ""]);
            otpRefs.current[0]?.focus();
        } finally {
            setEnabling(false);
        }
    };

    const handleOtpInput = (idx: number, value: string) => {
        const digit = value.replace(/\D/g, "").slice(-1);
        const next = [...otp];
        next[idx] = digit;
        setOtp(next);
        if (digit && idx < 5) otpRefs.current[idx + 1]?.focus();
    };

    const handleOtpKeyDown = (idx: number, e: React.KeyboardEvent) => {
        if (e.key === "Backspace" && !otp[idx] && idx > 0) otpRefs.current[idx - 1]?.focus();
    };

    const handleOtpPaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        const next = ["", "", "", "", "", ""];
        for (let i = 0; i < text.length; i++) next[i] = text[i];
        setOtp(next);
        otpRefs.current[Math.min(text.length, 5)]?.focus();
    };

    const handleCopy = () => {
        copyToClipboard(secret);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (phase === "loading" || phase === "hidden") return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Header */}
                <div className="flex flex-col items-center mb-6 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                        <Shield className="w-6 h-6 text-primary" />
                    </div>
                    <h1 className="text-xl font-bold tracking-tight text-foreground">Secure Your Account</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Two-factor authentication is required. Set it up to continue.
                    </p>
                </div>

                <div className="border border-border rounded-2xl bg-card overflow-hidden shadow-sm">
                    {phase === "intro" && (
                        <div className="p-6 space-y-5">
                            <div className="space-y-3">
                                {[
                                    { icon: QrCode, label: "Scan a QR code with your authenticator app" },
                                    { icon: Key, label: "Or enter the secret key manually" },
                                    { icon: Shield, label: "Confirm with a 6-digit code to activate" },
                                ].map(({ icon: Icon, label }) => (
                                    <div key={label} className="flex items-center gap-3">
                                        <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                                            <Icon className="w-3.5 h-3.5 text-primary" />
                                        </div>
                                        <span className="text-sm text-muted-foreground">{label}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[11px] text-muted-foreground/60 bg-muted/30 rounded-lg px-3 py-2">
                                Works with Google Authenticator, Authy, Microsoft Authenticator, and 1Password.
                            </p>
                            <Button
                                onClick={handleGenerate}
                                disabled={generating}
                                className="w-full h-10 gap-2 rounded-xl text-xs font-medium bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                            >
                                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                                {generating ? "Generating…" : "Set Up 2FA"}
                            </Button>
                        </div>
                    )}

                    {phase === "qr" && (
                        <form onSubmit={handleEnable} className="p-6 space-y-5">
                            <div className="flex flex-col items-center gap-3">
                                <div className="p-2 bg-white rounded-xl border border-border shadow-sm">
                                    <img src={qrDataUrl} alt="2FA QR Code" className="w-56 h-56" />
                                </div>
                                <p className="text-[11px] text-muted-foreground text-center">
                                    Scan this QR code with your authenticator app
                                </p>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Manual key</span>
                                    <button type="button" onClick={() => setShowSecret(v => !v)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                                        {showSecret ? "Hide" : "Show"}
                                    </button>
                                </div>
                                <div className="flex items-center gap-2 bg-muted/30 border border-border rounded-lg px-3 py-2">
                                    <code className="flex-1 text-[12px] font-mono text-foreground tracking-widest">
                                        {showSecret ? secret : secret.replace(/./g, "•")}
                                    </code>
                                    <button type="button" onClick={handleCopy} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted">
                                        {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">Verify — enter the 6-digit code</p>
                                {otpError && (
                                    <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{otpError}</div>
                                )}
                                <div className="flex gap-2 justify-center" onPaste={handleOtpPaste}>
                                    {otp.map((digit, idx) => (
                                        <input
                                            key={idx}
                                            ref={el => { otpRefs.current[idx] = el; }}
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={1}
                                            value={digit}
                                            onChange={e => handleOtpInput(idx, e.target.value)}
                                            onKeyDown={e => handleOtpKeyDown(idx, e)}
                                            className={cn(
                                                "w-10 h-11 text-center text-base font-mono font-semibold rounded-xl border bg-muted/5 outline-none transition-all",
                                                "border-border focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                digit ? "border-primary/40 bg-primary/5" : ""
                                            )}
                                            autoFocus={idx === 0}
                                        />
                                    ))}
                                </div>
                            </div>

                            <Button
                                type="submit"
                                disabled={enabling || otp.join("").length < 6}
                                className="w-full h-10 gap-2 rounded-xl text-xs font-medium bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                            >
                                {enabling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                                {enabling ? "Activating…" : "Activate 2FA"}
                            </Button>
                        </form>
                    )}

                    {phase === "done" && (
                        <div className="p-6 flex flex-col items-center gap-4 text-center">
                            <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                                <CheckCircle2 className="w-7 h-7 text-primary" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-foreground">2FA Enabled Successfully</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Your account is now protected. You'll need your authenticator app on future logins.
                                </p>
                            </div>
                            <Button
                                onClick={() => setPhase("hidden")}
                                className="w-full h-10 gap-2 rounded-xl text-xs font-medium bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] border border-black/10 dark:border-white/10 shadow-none"
                            >
                                Continue to Dashboard
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
