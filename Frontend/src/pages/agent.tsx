import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    Bot, Send, Square, RefreshCw, Star, CheckCircle, XCircle,
    RotateCcw, AlertTriangle, Info, Terminal,
    BookOpen, History, Database, ChevronDown, ChevronRight,
    Play, Loader2, Copy, Check, Search, Tag, Package,
    Trash2, X, Zap, Sun, Moon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useIsMobile } from "@/hooks/use-mobile";
import { getSocket } from "@/api/socket";
import { apiFetch } from "@/api/client";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogEntry {
    type: "thinking" | "info" | "command" | "output" | "success" | "error" | "ai" | "verify" | "retry" | "docker_missing";
    content: string;
    ts: number;
}

interface AgentTask {
    id: string;
    intent: string;
    status: "running" | "completed" | "failed";
    summary?: string;
    success?: boolean;
    retries: number;
    created_at: string;
    updated_at: string;
}

interface AgentTaskDetail extends AgentTask { log_json: string[] }

interface HubImage {
    name: string;
    is_official: boolean;
    star_count: number;
    pull_count: number;
    short_description: string;
}

interface HubTag {
    name: string;
    full_size: number;
    last_updated: string;
    images: { architecture: string; os: string }[];
}

interface KnowledgeEntry {
    id: string;
    pattern: string;
    intent_sample: string;
    strategy_summary: string;
    success_count: number;
    last_used_at: string;
    created_at: string;
}

// ── Log line renderer (matches ai.tsx style) ──────────────────────────────────

function LogLine({ entry }: { entry: LogEntry }) {
    switch (entry.type) {
        case "thinking":
            return (
                <div className="flex items-center gap-2 text-muted-foreground py-0.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span className="text-xs italic">{entry.content}</span>
                </div>
            );
        case "ai":
            return (
                <div className="flex gap-2 items-start py-1">
                    <Bot className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground/90">{entry.content}</span>
                </div>
            );
        case "command":
            return (
                <div className="my-1.5">
                    <div className="bg-muted/40 border border-border rounded-lg px-3 py-2 font-mono text-xs text-foreground break-all">
                        $ {entry.content}
                    </div>
                </div>
            );
        case "output":
            return (
                <div className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed px-1">
                    {entry.content}
                </div>
            );
        case "success":
            return (
                <div className="flex items-center gap-2 text-primary py-0.5">
                    <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs font-medium">{entry.content}</span>
                </div>
            );
        case "error":
            return (
                <div className="flex items-start gap-2 text-destructive py-0.5">
                    <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="text-xs font-mono whitespace-pre-wrap">{entry.content}</span>
                </div>
            );
        case "verify":
            return (
                <div className="flex items-center gap-2 py-1">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20">
                        <Search className="w-3 h-3 text-primary" />
                        <span className="text-xs font-medium text-primary">{entry.content}</span>
                    </div>
                </div>
            );
        case "retry":
            return (
                <div className="flex items-center gap-2 py-1">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border border-border">
                        <RotateCcw className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">{entry.content}</span>
                    </div>
                </div>
            );
        case "docker_missing":
            return (
                <div className="flex items-center gap-2 text-amber-500 py-0.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs">{entry.content}</span>
                </div>
            );
        default:
            return (
                <div className="flex items-center gap-2 text-muted-foreground py-0.5">
                    <Info className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs">{entry.content}</span>
                </div>
            );
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(b: number) {
    if (!b) return "?";
    if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`;
    if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
    return `${(b / 1e3).toFixed(0)} KB`;
}

function fmtRelative(iso: string) {
    const d = Date.now() - new Date(iso).getTime();
    if (d < 60_000)     return "just now";
    if (d < 3_600_000)  return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    return `${Math.floor(d / 86_400_000)}d ago`;
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
        >
            {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    );
}

// ── DockerHub panel ───────────────────────────────────────────────────────────

function DockerHubPanel({ onInsert }: { onInsert: (text: string) => void }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<HubImage[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedImage, setSelectedImage] = useState<HubImage | null>(null);
    const [tags, setTags] = useState<HubTag[]>([]);
    const [tagsLoading, setTagsLoading] = useState(false);
    const [tagPage, setTagPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);

    const search = useCallback(async (q: string) => {
        if (!q.trim()) return;
        setLoading(true); setResults([]); setSelectedImage(null); setTags([]);
        try {
            const data = await apiFetch<{ results: HubImage[] }>(`/agent/hub/search?q=${encodeURIComponent(q)}&limit=8`);
            setResults(data.results || []);
        } catch (e: any) { toast.error(e.message || "Search failed"); }
        finally { setLoading(false); }
    }, []);

    const loadTags = useCallback(async (img: HubImage, page = 1) => {
        setTagsLoading(true);
        if (page === 1) setTags([]);
        try {
            const data = await apiFetch<{ results: HubTag[]; next: string | null }>(
                `/agent/hub/tags?image=${encodeURIComponent(img.name)}&page=${page}&limit=20`
            );
            setTags(prev => page === 1 ? (data.results || []) : [...prev, ...(data.results || [])]);
            setHasMore(!!data.next);
            setTagPage(page);
        } catch (e: any) { toast.error(e.message || "Failed to load tags"); }
        finally { setTagsLoading(false); }
    }, []);

    return (
        <div className="flex flex-col h-full gap-3">
            <div className="flex gap-2">
                <Input
                    placeholder="Search Docker Hub images…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && search(query)}
                    className="h-9 text-sm"
                />
                <Button variant="outline" className="h-9 px-3 shrink-0" onClick={() => search(query)} disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </Button>
            </div>

            {selectedImage ? (
                <div className="flex flex-col gap-2 flex-1 min-h-0">
                    <div className="flex items-center gap-2">
                        <button onClick={() => { setSelectedImage(null); setTags([]); }} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                            ← back
                        </button>
                        <span className="text-sm font-medium tracking-tight truncate flex-1">{selectedImage.name}</span>
                        {selectedImage.is_official && <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-full bg-primary/10 text-primary border-primary/20">Official</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{selectedImage.short_description}</p>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Tags</p>
                    <div className="overflow-y-auto flex-1 space-y-1.5">
                        {tagsLoading && tags.length === 0 && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                                <Loader2 className="w-4 h-4 animate-spin" /> Loading tags…
                            </div>
                        )}
                        {tags.map(tag => {
                            const imageRef = `${selectedImage.name}:${tag.name}`;
                            const arch = tag.images?.[0]?.architecture ?? "?";
                            return (
                                <div key={tag.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/60 border border-border/50 transition-colors">
                                    <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span className="text-xs font-mono flex-1 truncate">{tag.name}</span>
                                    <span className="text-[10px] text-muted-foreground">{arch}</span>
                                    <span className="text-[10px] text-muted-foreground">{fmtBytes(tag.full_size)}</span>
                                    <CopyButton text={imageRef} />
                                    <button onClick={() => onInsert(`Use the image ${imageRef}`)} className="text-muted-foreground hover:text-primary transition-colors" title="Use in prompt">
                                        <Play className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            );
                        })}
                        {hasMore && (
                            <Button variant="ghost" className="w-full h-9 text-xs" onClick={() => loadTags(selectedImage, tagPage + 1)} disabled={tagsLoading}>
                                {tagsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Load more tags"}
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="overflow-y-auto flex-1 space-y-1.5">
                    {results.length === 0 && !loading && (
                        <div className="text-sm text-muted-foreground text-center py-10">Search for any Docker image above</div>
                    )}
                    {results.map(img => (
                        <button
                            key={img.name}
                            onClick={() => { setSelectedImage(img); loadTags(img, 1); }}
                            className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg bg-muted/30 hover:bg-muted/60 border border-border/50 transition-colors group"
                        >
                            <Package className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium">{img.name}</span>
                                    {img.is_official && <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-full bg-primary/10 text-primary border-primary/20">Official</Badge>}
                                    <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Star className="w-3 h-3" />{img.star_count.toLocaleString()}</span>
                                </div>
                                <p className="text-xs text-muted-foreground truncate mt-0.5">{img.short_description || "No description"}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── History panel ─────────────────────────────────────────────────────────────

function HistoryPanel({ onRerun }: { onRerun: (intent: string) => void }) {
    const [tasks, setTasks] = useState<AgentTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [detail, setDetail] = useState<AgentTaskDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try { const d = await apiFetch<AgentTask[]>("/agent/tasks"); setTasks(d); }
        catch { } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggleDetail = async (id: string) => {
        if (expanded === id) { setExpanded(null); setDetail(null); return; }
        setExpanded(id); setDetailLoading(true);
        try { const d = await apiFetch<AgentTaskDetail>(`/agent/tasks/${id}`); setDetail(d); }
        catch { setDetail(null); } finally { setDetailLoading(false); }
    };

    return (
        <div className="flex flex-col h-full gap-3">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Recent Tasks</span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1.5" onClick={load}>
                    <RefreshCw className="w-3.5 h-3.5" />Refresh
                </Button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-1.5">
                {loading && <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>}
                {!loading && tasks.length === 0 && <div className="text-sm text-muted-foreground py-10 text-center">No tasks yet</div>}
                {tasks.map(t => (
                    <div key={t.id} className="rounded-lg border border-border bg-card overflow-hidden">
                        <button onClick={() => toggleDetail(t.id)} className="w-full text-left flex items-start gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors">
                            <div className="shrink-0 mt-0.5">
                                {t.status === "running"   && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />}
                                {t.status === "completed" && <CheckCircle className="w-3.5 h-3.5 text-primary" />}
                                {t.status === "failed"    && <XCircle className="w-3.5 h-3.5 text-destructive" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{t.intent}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-muted-foreground">{fmtRelative(t.created_at)}</span>
                                    {t.retries > 0 && <span className="text-xs text-amber-500">{t.retries} retry</span>}
                                </div>
                                {t.summary && <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.summary}</p>}
                            </div>
                            <ChevronDown className={cn("w-4 h-4 text-muted-foreground shrink-0 transition-transform mt-0.5", expanded === t.id && "rotate-180")} />
                        </button>
                        {expanded === t.id && (
                            <div className="border-t border-border px-3 py-2.5 space-y-2 bg-muted/20">
                                {detailLoading && <div className="text-xs text-muted-foreground">Loading logs…</div>}
                                {detail && detail.id === t.id && (
                                    <>
                                        <div className="bg-background border border-border rounded-lg p-3 max-h-48 overflow-y-auto space-y-0.5">
                                            {(detail.log_json || []).map((line, i) => (
                                                <div key={i} className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all">{line}</div>
                                            ))}
                                        </div>
                                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => onRerun(t.intent)}>
                                            <RotateCcw className="w-3 h-3" />Re-run
                                        </Button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Knowledge panel ───────────────────────────────────────────────────────────

function KnowledgePanel({ onInsert }: { onInsert: (text: string) => void }) {
    const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try { const d = await apiFetch<KnowledgeEntry[]>("/agent/knowledge"); setEntries(d); }
        catch { } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const remove = async (id: string) => {
        try {
            await apiFetch(`/agent/knowledge/${id}`, { method: "DELETE" });
            setEntries(prev => prev.filter(e => e.id !== id));
            toast.success("Pattern removed");
        } catch { toast.error("Failed to delete"); }
    };

    return (
        <div className="flex flex-col h-full gap-3">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Learned Fixes & Patterns</span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1.5" onClick={load}>
                    <RefreshCw className="w-3.5 h-3.5" />Refresh
                </Button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-1.5">
                {loading && <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>}
                {!loading && entries.length === 0 && (
                    <div className="text-sm text-muted-foreground py-10 text-center">
                        No patterns yet.<br />
                        <span className="text-xs">Successful fixes are stored automatically.</span>
                    </div>
                )}
                {entries.map(e => (
                    <div key={e.id} className="rounded-lg border border-border bg-card px-3 py-2.5">
                        <div className="flex items-start gap-3">
                            <BookOpen className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium truncate">{e.pattern}</span>
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-full bg-primary/10 text-primary border-primary/20">✓ {e.success_count}×</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.strategy_summary}</p>
                                <p className="text-xs text-muted-foreground mt-1">{fmtRelative(e.last_used_at)}</p>
                            </div>
                            <div className="flex gap-1.5 shrink-0">
                                <button onClick={() => onInsert(e.intent_sample)} className="text-muted-foreground hover:text-primary transition-colors" title="Use as prompt">
                                    <Play className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => remove(e.id)} className="text-muted-foreground hover:text-destructive transition-colors" title="Delete">
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Mobile bottom sheet ───────────────────────────────────────────────────────

type Sheet = "hub" | "history" | "knowledge" | null;

function BottomSheet({ open, title, icon, onClose, children }: {
    open: boolean; title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode;
}) {
    useEffect(() => {
        document.body.style.overflow = open ? "hidden" : "";
        return () => { document.body.style.overflow = ""; };
    }, [open]);

    return (
        <>
            <div
                onClick={onClose}
                className={cn(
                    "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300",
                    open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                )}
            />
            <div
                className={cn(
                    "fixed inset-x-0 bottom-0 z-50 flex flex-col bg-background rounded-t-2xl shadow-2xl border-t border-border",
                    "transition-transform duration-300 ease-out",
                    open ? "translate-y-0" : "translate-y-full"
                )}
                style={{ height: "88dvh" }}
            >
                <div className="flex justify-center pt-3 pb-1 shrink-0">
                    <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                </div>
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
                    <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">{icon}</div>
                    <h2 className="font-semibold text-sm tracking-tight flex-1">{title}</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden px-4 py-4">
                    {children}
                </div>
            </div>
        </>
    );
}

// ── Suggestions ───────────────────────────────────────────────────────────────

const SUGGESTIONS = [
    "Install MongoDB on port 27017",
    "Deploy Redis with a password",
    "Set up PostgreSQL 16",
    "Install Grafana on port 3000",
    "Check which containers are running",
    "Stop and remove the mysql container",
    "Restart the nginx container",
    "Deploy n8n workflow automation",
    "Install Elasticsearch",
];

// ── Chat / log area ───────────────────────────────────────────────────────────

function ChatArea({
    logs, running, dockerMissing, onInstallDocker,
    prompt, setPrompt, onRun, onCancel, textareaRef, isMobile,
}: {
    logs: LogEntry[]; running: boolean; dockerMissing: boolean;
    onInstallDocker: () => void; prompt: string; setPrompt: (v: string) => void;
    onRun: (text?: string) => void; onCancel: () => void;
    textareaRef: React.RefObject<HTMLTextAreaElement>; isMobile: boolean;
}) {
    const logEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

    return (
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
            {/* Log area */}
            <div className="flex-1 overflow-y-auto min-h-0">
                {/* Terminal header bar */}
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between sticky top-0 z-10">
                    <div className="flex items-center gap-2">
                        <div className="flex gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-border" />
                            <span className="w-2.5 h-2.5 rounded-full bg-border" />
                            <span className="w-2.5 h-2.5 rounded-full bg-border" />
                        </div>
                        <Terminal className="w-3.5 h-3.5 text-muted-foreground ml-1" />
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Agent Output</span>
                    </div>
                    {running && (
                        <div className="flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                            </span>
                            <span className="text-[10px] text-primary font-medium">Running</span>
                        </div>
                    )}
                </div>

                <div className="p-4 space-y-0.5">
                    {logs.length === 0 && !running && (
                        <div className="flex flex-col items-center justify-center gap-6 text-center py-12 px-4">
                            <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20">
                                <Bot className="w-8 h-8 text-primary" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-normal tracking-tight text-foreground">DevOps Agent</h2>
                                <p className="text-sm text-muted-foreground mt-2 max-w-xs leading-relaxed">
                                    Describe any Docker task in plain English. The agent searches DockerHub live,
                                    plans steps, executes, verifies, and self-heals on failure.
                                </p>
                            </div>
                            <div className={cn("grid gap-2 w-full max-w-sm", isMobile ? "grid-cols-2" : "grid-cols-1")}>
                                {SUGGESTIONS.slice(0, isMobile ? 6 : 5).map(s => (
                                    <button
                                        key={s}
                                        onClick={() => onRun(s)}
                                        className="text-xs text-left px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted/50 hover:border-primary/30 transition-all text-muted-foreground hover:text-foreground"
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {logs.map((entry, i) => <LogLine key={i} entry={entry} />)}

                    {dockerMissing && (
                        <div className="mt-4 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
                            <p className="text-sm font-semibold text-amber-500 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />Docker Not Available
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 mb-3">Docker is not installed or not running on this host.</p>
                            <Button variant="outline" className="h-8 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/10 gap-2" onClick={onInstallDocker}>
                                <Zap className="w-3.5 h-3.5" />Install Docker Automatically
                            </Button>
                        </div>
                    )}
                    <div ref={logEndRef} />
                </div>
            </div>

            {/* Prompt bar */}
            <div className="border-t border-border px-4 py-3 bg-background space-y-2 shrink-0">
                {/* Scrollable quick chips */}
                <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: "none" }}>
                    {SUGGESTIONS.map(s => (
                        <button
                            key={s}
                            onClick={() => onRun(s)}
                            className="text-xs px-2.5 py-1 rounded-full border border-border bg-muted/40 hover:bg-muted hover:border-primary/30 text-muted-foreground hover:text-foreground transition-all whitespace-nowrap shrink-0"
                        >
                            {s}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2">
                    <textarea
                        ref={textareaRef}
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onRun(); } }}
                        placeholder="Describe a Docker task… (Enter to run, Shift+Enter for newline)"
                        rows={2}
                        className="flex-1 resize-none text-sm rounded-lg border border-border bg-muted/30 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground font-sans"
                        disabled={running}
                    />
                    {running ? (
                        <Button variant="destructive" size="icon" className="h-auto w-10 shrink-0 rounded-lg" onClick={onCancel}>
                            <Square className="w-4 h-4" />
                        </Button>
                    ) : (
                        <Button size="icon" className="h-auto w-10 shrink-0 rounded-lg" onClick={() => onRun()} disabled={!prompt.trim()}>
                            <Send className="w-4 h-4" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Desktop right panel ───────────────────────────────────────────────────────

type RightTab = "hub" | "history" | "knowledge";

function DesktopRightPanel({ onInsert, historyKey, onRerun }: {
    onInsert: (t: string) => void; historyKey: number; onRerun: (t: string) => void;
}) {
    const [tab, setTab] = useState<RightTab>("hub");

    const tabs = [
        { id: "hub"       as RightTab, label: "DockerHub", icon: <Database className="w-3.5 h-3.5" /> },
        { id: "history"   as RightTab, label: "History",   icon: <History className="w-3.5 h-3.5" /> },
        { id: "knowledge" as RightTab, label: "Knowledge", icon: <BookOpen className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="w-80 xl:w-96 shrink-0 flex flex-col min-h-0 border-l border-border">
            <div className="flex border-b border-border shrink-0">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors border-b-2",
                            tab === t.id
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {t.icon}{t.label}
                    </button>
                ))}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden p-4">
                {tab === "hub"       && <DockerHubPanel onInsert={onInsert} />}
                {tab === "history"   && <HistoryPanel key={historyKey} onRerun={onRerun} />}
                {tab === "knowledge" && <KnowledgePanel onInsert={onInsert} />}
            </div>
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AgentPage() {
    const { theme, toggleTheme } = useTheme();
    const isMobile = useIsMobile();

    const [prompt, setPrompt] = useState("");
    const [logs, setLogs]     = useState<LogEntry[]>([]);
    const [running, setRunning]       = useState(false);
    const [agentId, setAgentId]       = useState<string | null>(null);
    const [dockerMissing, setDockerMissing] = useState(false);
    const [historyKey, setHistoryKey] = useState(0);
    const [openSheet, setOpenSheet]   = useState<Sheet>(null);

    const textareaRef  = useRef<HTMLTextAreaElement>(null);
    const currentAgent = useRef<string | null>(null);

    useEffect(() => {
        const socket = getSocket();
        const onLog = (data: { agentId: string; type: LogEntry["type"]; content: string }) => {
            if (currentAgent.current && data.agentId !== currentAgent.current) return;
            setLogs(prev => [...prev, { type: data.type, content: data.content, ts: Date.now() }]);
        };
        const onDone = (data: { agentId: string; success: boolean; summary: string; dockerMissing?: boolean }) => {
            if (currentAgent.current && data.agentId !== currentAgent.current) return;
            setRunning(false);
            if (data.dockerMissing)  { setDockerMissing(true); }
            else if (data.success)   { toast.success("Task completed"); setHistoryKey(k => k + 1); }
            else                     { toast.error("Task ended with errors"); setHistoryKey(k => k + 1); }
        };
        socket.on("agent:log", onLog);
        socket.on("agent:done", onDone);
        return () => { socket.off("agent:log", onLog); socket.off("agent:done", onDone); };
    }, []);

    const run = useCallback(async (text?: string) => {
        const msg = (text ?? prompt).trim();
        if (!msg || running) return;
        setLogs([]); setRunning(true); setDockerMissing(false); setPrompt("");
        const id = `ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        currentAgent.current = id; setAgentId(id);
        setOpenSheet(null);
        try {
            const res = await apiFetch<any>("/agent/run", { method: "POST", body: JSON.stringify({ message: msg, agentId: id }) });
            if (res.dockerMissing) { setDockerMissing(true); setRunning(false); }
        } catch (e: any) { toast.error(e.message || "Failed to start agent"); setRunning(false); }
    }, [prompt, running]);

    const cancel = useCallback(async () => {
        if (!agentId) return;
        try { await apiFetch("/agent/cancel", { method: "POST", body: JSON.stringify({ agentId }) }); setRunning(false); }
        catch { }
    }, [agentId]);

    const installDocker = useCallback(async () => {
        setDockerMissing(false); setRunning(true); setLogs([]);
        const id = `ag_docker_${Date.now()}`;
        currentAgent.current = id; setAgentId(id);
        await apiFetch("/agent/install-docker", { method: "POST", body: JSON.stringify({ agentId: id }) });
    }, []);

    const insertPrompt = useCallback((text: string) => {
        setPrompt(text);
        setOpenSheet(null);
        textareaRef.current?.focus();
    }, []);

    const sheetConfig: Record<string, { title: string; icon: React.ReactNode; content: React.ReactNode }> = {
        hub:       { title: "DockerHub",  icon: <Database className="w-4 h-4 text-primary" />,  content: <DockerHubPanel onInsert={insertPrompt} /> },
        history:   { title: "History",   icon: <History className="w-4 h-4 text-primary" />,   content: <HistoryPanel key={historyKey} onRerun={run} /> },
        knowledge: { title: "Knowledge", icon: <BookOpen className="w-4 h-4 text-primary" />,  content: <KnowledgePanel onInsert={insertPrompt} /> },
    };

    const bottomNavItems = [
        { id: "hub"       as Sheet, label: "DockerHub", icon: <Database className="w-5 h-5" /> },
        { id: "history"   as Sheet, label: "History",   icon: <History className="w-5 h-5" /> },
        { id: "knowledge" as Sheet, label: "Knowledge", icon: <BookOpen className="w-5 h-5" /> },
    ];

    const chatProps = {
        logs, running, dockerMissing, onInstallDocker: installDocker,
        prompt, setPrompt, onRun: run, onCancel: cancel,
        textareaRef, isMobile: !!isMobile,
    };

    return (
        <div className="min-h-screen bg-background text-foreground flex">
            <DesktopSidebar />

            <div className="flex-1 flex flex-col min-w-0">
                {/* Header — matches every other page exactly */}
                <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
                    <div className="px-4 h-14 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <MobileSidebarTrigger />
                            <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                                <Bot className="w-4 h-4 text-primary" />
                            </div>
                            <h1 className="font-semibold text-sm tracking-tight">DevOps Agent</h1>
                            <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-primary/10 text-primary border-primary/20">AI</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost" size="icon"
                                className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground"
                                onClick={toggleTheme}
                            >
                                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            </Button>
                        </div>
                    </div>
                </header>

                {isMobile ? (
                    /* ── MOBILE ── */
                    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ paddingBottom: 64 }}>
                            <ChatArea {...chatProps} />
                        </div>

                        {/* Bottom nav */}
                        <nav className="fixed bottom-0 left-0 right-0 z-30 flex bg-background/95 backdrop-blur-md border-t border-border" style={{ height: 64 }}>
                            {bottomNavItems.map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setOpenSheet(prev => prev === item.id ? null : item.id)}
                                    className={cn(
                                        "flex-1 flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                                        openSheet === item.id ? "text-primary" : "text-muted-foreground"
                                    )}
                                >
                                    <span className={cn("transition-colors", openSheet === item.id && "text-primary")}>
                                        {item.icon}
                                    </span>
                                    {item.label}
                                </button>
                            ))}
                        </nav>

                        {/* Sheets */}
                        {Object.entries(sheetConfig).map(([id, cfg]) => (
                            <BottomSheet key={id} open={openSheet === id} title={cfg.title} icon={cfg.icon} onClose={() => setOpenSheet(null)}>
                                {cfg.content}
                            </BottomSheet>
                        ))}
                    </div>
                ) : (
                    /* ── DESKTOP ── */
                    <div className="flex flex-1 min-h-0 overflow-hidden">
                        <ChatArea {...chatProps} />
                        <DesktopRightPanel onInsert={insertPrompt} historyKey={historyKey} onRerun={run} />
                    </div>
                )}
            </div>
        </div>
    );
}
