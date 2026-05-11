import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { Sun, Moon, Database, Zap, Activity, Users, Clock, Trash2, RefreshCw, CheckCircle2, XCircle, BarChart3, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";

interface RedisStatus {
    connected: boolean;
    reason?: string;
    version?: string;
    uptime?: number;
    usedMemory?: string;
    usedMemoryPeak?: string;
    connectedClients?: number;
    totalCommands?: number;
    dbsize?: number;
    cacheHits?: number;
    cacheMisses?: number;
    hitRate?: number;
    statsHistoryPoints?: number;
    activeSessions?: { id: string; username: string; connectedAt: number }[];
    recentQueries?: { sql: string; durationMs: number; rowCount: number; at: number }[];
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function formatAgo(ts: number): string {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
}

function StatCard({ label, value, icon, sub }: { label: string; value: React.ReactNode; icon: React.ReactNode; sub?: string }) {
    return (
        <Card className="border border-border bg-card">
            <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
                    <span className="text-muted-foreground">{icon}</span>
                </div>
                <div className="text-xl font-semibold text-foreground">{value}</div>
                {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
            </CardContent>
        </Card>
    );
}

export default function RedisPage() {
    const qc = useQueryClient();
    const { theme, toggle } = useTheme();
    const [showAllQueries, setShowAllQueries] = useState(false);

    const { data, isLoading, refetch } = useQuery<RedisStatus>({
        queryKey: ["redis-status"],
        queryFn: () => apiFetch("/redis/status"),
        refetchInterval: 8000,
    });

    const flushCache = useMutation({
        mutationFn: () => apiFetch("/redis/cache", { method: "DELETE" }),
        onSuccess: (d: any) => {
            toast.success(`Flushed ${d.flushed ?? 0} cache keys`);
            qc.invalidateQueries({ queryKey: ["redis-status"] });
        },
        onError: () => toast.error("Failed to flush cache"),
    });

    const clearQueries = useMutation({
        mutationFn: () => apiFetch("/redis/queries", { method: "DELETE" }),
        onSuccess: () => {
            toast.success("Query log cleared");
            qc.invalidateQueries({ queryKey: ["redis-status"] });
        },
        onError: () => toast.error("Failed to clear query log"),
    });

    const connected = data?.connected ?? false;
    const hitRate = data?.hitRate ?? 0;
    const hitRateColor = hitRate >= 80 ? "text-green-500" : hitRate >= 50 ? "text-amber-500" : "text-red-500";
    const queries = data?.recentQueries ?? [];
    const sessions = data?.activeSessions ?? [];
    const displayedQueries = showAllQueries ? queries : queries.slice(0, 5);

    return (
        <div className="min-h-screen bg-background text-foreground flex">
            <DesktopSidebar />
            <div className="flex-1 flex flex-col min-w-0">
                {/* ── Sticky header ── */}
                <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
                    <div className="px-4 h-14 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <MobileSidebarTrigger />
                            <div className="hidden lg:flex items-center gap-3">
                                <div className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 shrink-0">
                                    <Zap className="w-4 h-4 text-red-500" />
                                </div>
                                <span className="font-medium text-sm tracking-tight">Redis Cache</span>
                                {connected && data?.version && (
                                    <Badge variant="outline" className="font-mono text-[10px] uppercase rounded-full px-2 py-0 text-primary bg-primary/10 border-primary/20">
                                        v{data.version}
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {connected ? (
                                <Badge variant="outline" className="text-green-600 border-green-500/30 bg-green-500/10 text-xs rounded-full">
                                    <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="text-red-500 border-red-500/30 bg-red-500/10 text-xs rounded-full">
                                    <XCircle className="w-3 h-3 mr-1" /> Disconnected
                                </Badge>
                            )}
                            <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground" onClick={toggle}>
                                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            </Button>
                            <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={() => refetch()}>
                                <RefreshCw className="w-3.5 h-3.5 mr-2" /> Refresh
                            </Button>
                        </div>
                    </div>
                </header>

                {/* ── Main content ── */}
                <main className="flex-1 p-6 space-y-6 max-w-5xl w-full mx-auto">
                    {isLoading ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="h-24 bg-muted/30 rounded-xl animate-pulse" />
                            ))}
                        </div>
                    ) : !connected ? (
                        <Card className="border-destructive/30 bg-destructive/5">
                            <CardContent className="p-10 text-center">
                                <XCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
                                <p className="text-sm font-medium text-foreground mb-1">Redis not connected</p>
                                <p className="text-xs text-muted-foreground">{data?.reason}</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <>
                            {/* Stats grid */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <StatCard
                                    label="Memory Used"
                                    value={data?.usedMemory ?? "—"}
                                    icon={<Activity className="w-4 h-4" />}
                                    sub={`Peak: ${data?.usedMemoryPeak ?? "—"}`}
                                />
                                <StatCard
                                    label="Cache Hit Rate"
                                    value={<span className={hitRateColor}>{hitRate.toFixed(1)}%</span>}
                                    icon={<Zap className="w-4 h-4" />}
                                    sub={`${data?.cacheHits ?? 0} hits / ${data?.cacheMisses ?? 0} misses`}
                                />
                                <StatCard
                                    label="Total Keys"
                                    value={data?.dbsize ?? 0}
                                    icon={<Database className="w-4 h-4" />}
                                    sub={`${data?.statsHistoryPoints ?? 0} history points`}
                                />
                                <StatCard
                                    label="Uptime"
                                    value={data?.uptime ? formatUptime(data.uptime) : "—"}
                                    icon={<Clock className="w-4 h-4" />}
                                    sub={`${data?.connectedClients ?? 0} connected clients`}
                                />
                            </div>

                            {/* Cache management */}
                            <Card className="border border-border">
                                <CardHeader className="px-5 py-4 border-b border-border flex-row items-center justify-between space-y-0">
                                    <div className="flex items-center gap-2">
                                        <BarChart3 className="w-4 h-4 text-muted-foreground" />
                                        <CardTitle className="text-sm font-medium">Cache Management</CardTitle>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-7 text-xs gap-1.5"
                                        onClick={() => flushCache.mutate()}
                                        disabled={flushCache.isPending}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                        {flushCache.isPending ? "Flushing…" : "Flush Cache"}
                                    </Button>
                                </CardHeader>
                                <CardContent className="p-5">
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                                        {[
                                            { title: "DB Queries", keys: "overview · stats · tables · activity", ttl: "5 – 30 second TTLs" },
                                            { title: "Docker", keys: "containers · status", ttl: "4 – 8 second TTLs" },
                                            { title: "System Stats", keys: "cpu · memory · storage", ttl: "3 second TTL + 60-pt history" },
                                        ].map(({ title, keys, ttl }) => (
                                            <div key={title} className="flex flex-col gap-1 p-3 rounded-lg bg-muted/30 border border-border/50">
                                                <span className="text-xs text-muted-foreground font-medium">{title}</span>
                                                <span className="text-foreground font-mono text-xs">{keys}</span>
                                                <span className="text-xs text-muted-foreground">{ttl}</span>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Active WebSocket sessions */}
                            <Card className="border border-border">
                                <CardHeader className="px-5 py-4 border-b border-border flex-row items-center justify-between space-y-0">
                                    <div className="flex items-center gap-2">
                                        <Users className="w-4 h-4 text-muted-foreground" />
                                        <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
                                        <Badge variant="secondary" className="text-xs h-5">{sessions.length}</Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    {sessions.length === 0 ? (
                                        <div className="p-6 text-center text-xs text-muted-foreground">No active sessions</div>
                                    ) : (
                                        <div className="divide-y divide-border">
                                            {sessions.map(s => (
                                                <div key={s.id} className="flex items-center justify-between px-5 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                                                        <span className="font-mono text-xs text-muted-foreground">{s.id.slice(0, 12)}…</span>
                                                        <span className="text-sm font-medium text-foreground">{s.username}</span>
                                                    </div>
                                                    <span className="text-xs text-muted-foreground">{s.connectedAt ? formatAgo(s.connectedAt) : "—"}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Recent query log */}
                            <Card className="border border-border">
                                <CardHeader className="px-5 py-4 border-b border-border flex-row items-center justify-between space-y-0">
                                    <div className="flex items-center gap-2">
                                        <Terminal className="w-4 h-4 text-muted-foreground" />
                                        <CardTitle className="text-sm font-medium">Recent Query Log</CardTitle>
                                        <Badge variant="secondary" className="text-xs h-5">{queries.length}</Badge>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-destructive"
                                        onClick={() => clearQueries.mutate()}
                                        disabled={clearQueries.isPending || queries.length === 0}
                                    >
                                        <Trash2 className="w-3 h-3" /> Clear
                                    </Button>
                                </CardHeader>
                                <CardContent className="p-0">
                                    {queries.length === 0 ? (
                                        <div className="p-6 text-center text-xs text-muted-foreground">No queries logged yet</div>
                                    ) : (
                                        <>
                                            <div className="divide-y divide-border">
                                                {displayedQueries.map((q, i) => (
                                                    <div key={i} className="px-5 py-3">
                                                        <div className="flex items-center justify-between gap-4">
                                                            <code className="text-xs font-mono text-foreground truncate flex-1">{q.sql}</code>
                                                            <div className="flex items-center gap-3 shrink-0">
                                                                <span className={`text-xs font-mono ${q.durationMs > 200 ? "text-amber-500" : "text-green-500"}`}>
                                                                    {q.durationMs}ms
                                                                </span>
                                                                <span className="text-xs text-muted-foreground">{q.rowCount} rows</span>
                                                                <span className="text-xs text-muted-foreground">{formatAgo(q.at)}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            {queries.length > 5 && (
                                                <div className="p-3 text-center border-t border-border">
                                                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setShowAllQueries(v => !v)}>
                                                        {showAllQueries ? "Show less" : `Show all ${queries.length}`}
                                                    </Button>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        </>
                    )}
                </main>
            </div>
        </div>
    );
}
