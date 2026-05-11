import React, { useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { Eye, EyeOff, Lock, User, ArrowRight, Sun, Moon, Github, Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { login, twoFaVerifyLogin } from "@/api/client";

type Step = "credentials" | "otp";

export default function LoginPage() {
    const [, setLocation] = useLocation();
    const { theme, toggle } = useTheme();
    const [step, setStep] = useState<Step>("credentials");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [otpToken, setOtpToken] = useState("");
    const [otp, setOtp] = useState(["", "", "", "", "", ""]);
    const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

    const handleCredentials = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        try {
            const result = await login(username, password);
            if (result.requiresOTP) {
                setOtpToken(result.otpToken);
                setStep("otp");
            } else {
                setLocation("/");
            }
        } catch (err: any) {
            setError(err.message || "Invalid credentials");
        } finally {
            setIsLoading(false);
        }
    };

    const handleOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = otp.join("");
        if (code.length < 6) { setError("Enter the full 6-digit code"); return; }
        setIsLoading(true);
        setError(null);
        try {
            await twoFaVerifyLogin(otpToken, code);
            setLocation("/");
        } catch (err: any) {
            setError(err.message || "Invalid code");
            setOtp(["", "", "", "", "", ""]);
            otpRefs.current[0]?.focus();
        } finally {
            setIsLoading(false);
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
        if (e.key === "Backspace" && !otp[idx] && idx > 0) {
            otpRefs.current[idx - 1]?.focus();
        }
    };

    const handleOtpPaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        const next = ["", "", "", "", "", ""];
        for (let i = 0; i < text.length; i++) next[i] = text[i];
        setOtp(next);
        const focusIdx = Math.min(text.length, 5);
        otpRefs.current[focusIdx]?.focus();
    };

    return (
        <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4 relative overflow-hidden">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <Button variant="ghost" size="icon" className="w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" asChild>
                    <a href="https://github.com/rehanweb3/DBCraft-2.0" target="_blank" rel="noreferrer"><Github className="w-4 h-4" /></a>
                </Button>
                <Button variant="ghost" size="icon" className="w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={toggle}>
                    {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
            </div>
            <div className="w-full max-w-[400px] z-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col items-center mb-6 text-center">
                    <div className="h-16 flex items-center justify-center mb-2">
                        <img
                            src={theme === "dark" ? "/dark.png" : "/white.png"}
                            alt="Docklet"
                            className="max-h-full w-auto object-contain"
                        />
                    </div>
                </div>

                {step === "credentials" ? (
                    <Card className="bg-background border-border shadow-none rounded-2xl overflow-hidden">
                        <form onSubmit={handleCredentials}>
                            <CardHeader className="space-y-1 pt-8">
                                <CardTitle className="text-lg font-medium tracking-tight">Sign in</CardTitle>
                                <CardDescription className="text-xs">Enter your credentials to access your dashboard</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {error && (
                                    <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</div>
                                )}
                                <div className="space-y-2">
                                    <Label htmlFor="username" className="text-xs font-medium text-muted-foreground">Username</Label>
                                    <div className="relative group">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground/50 group-focus-within:text-primary transition-colors">
                                            <User className="w-3.5 h-3.5" />
                                        </div>
                                        <Input id="username" type="text" placeholder="admin" required value={username} onChange={e => setUsername(e.target.value)} className="pl-9 h-10 border-border bg-muted/5 focus:bg-background transition-all shadow-none" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">Password</Label>
                                    <div className="relative group">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground/50 group-focus-within:text-primary transition-colors">
                                            <Lock className="w-3.5 h-3.5" />
                                        </div>
                                        <Input id="password" type={showPassword ? "text" : "password"} placeholder="••••••••" required value={password} onChange={e => setPassword(e.target.value)} className="pl-9 pr-10 h-10 border-border bg-muted/5 focus:bg-background transition-all shadow-none" />
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                                            {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                        </button>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="pb-8 pt-2 flex flex-col gap-3">
                                <Button type="submit" disabled={isLoading} className={cn("w-full h-10 gap-2 rounded-xl text-xs font-medium transition-all border border-black/10 dark:border-white/10 shadow-none", "bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47]")}>
                                    {isLoading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <>Sign In <ArrowRight className="w-3.5 h-3.5" /></>}
                                </Button>
                                <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center w-full">
                                    Forgot password?
                                </Link>
                            </CardFooter>
                        </form>
                    </Card>
                ) : (
                    <Card className="bg-background border-border shadow-none rounded-2xl overflow-hidden">
                        <form onSubmit={handleOtp}>
                            <CardHeader className="space-y-1 pt-8">
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20">
                                        <Shield className="w-4 h-4 text-primary" />
                                    </div>
                                    <CardTitle className="text-lg font-medium tracking-tight">Two-Factor Verification</CardTitle>
                                </div>
                                <CardDescription className="text-xs">Open your authenticator app and enter the 6-digit code</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                {error && (
                                    <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</div>
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
                                                "w-11 h-12 text-center text-lg font-mono font-semibold rounded-xl border bg-muted/5 outline-none transition-all",
                                                "border-border focus:border-primary focus:ring-2 focus:ring-primary/20",
                                                digit ? "border-primary/40 bg-primary/5" : ""
                                            )}
                                            autoFocus={idx === 0}
                                        />
                                    ))}
                                </div>
                                <p className="text-[10px] text-muted-foreground/60 text-center">
                                    Compatible with Google Authenticator, Authy, and 1Password
                                </p>
                            </CardContent>
                            <CardFooter className="pb-8 pt-2 flex flex-col gap-3">
                                <Button type="submit" disabled={isLoading || otp.join("").length < 6} className={cn("w-full h-10 gap-2 rounded-xl text-xs font-medium transition-all border border-black/10 dark:border-white/10 shadow-none", "bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47]")}>
                                    {isLoading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <>Verify <ArrowRight className="w-3.5 h-3.5" /></>}
                                </Button>
                                <button type="button" onClick={() => { setStep("credentials"); setError(null); setOtp(["", "", "", "", "", ""]); }} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto">
                                    <ArrowLeft className="w-3 h-3" /> Back to login
                                </button>
                            </CardFooter>
                        </form>
                    </Card>
                )}
            </div>
            <div className="absolute bottom-6 w-full text-center">
                <p className="text-[10px] text-muted-foreground/40 font-mono tracking-widest uppercase">© 2026 Docklet · All Rights Reserved</p>
            </div>
        </div>
    );
}
