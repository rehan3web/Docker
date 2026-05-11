import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    Bot, Send, Square, RefreshCw, Star, CheckCircle, XCircle,
    RotateCcw, AlertTriangle, Info, Terminal,
    BookOpen, History, Database, ChevronDown, ChevronRight,
    Play, Loader2, Copy, Check, Search, Tag, Package,
    Trash2, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sun, Moon } from "lucide-react";
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

// ── Log line renderer ─────────────────────────────────────────────────────────

const LOG_STYLES: Record<LogEntry["type"], { icon: React.ReactNode; cls: string }> = {
    thinking:       { icon: <Loader2 className="w-3 h-3 animate-spin" />,  cls: "text-blue-400" },
    info:           { icon: <Info className="w-3 h-3" />,                  cls: "text-muted-foreground" },
    command:        { icon: <Terminal className="w-3 h-3" />,              cls: "text-yellow-400 font-mono" },
    output:         { icon: null,                                           cls: "text-muted-foreground font-mono text-[11px]" },
    success:        { icon: <CheckCircle className="w-3 h-3" />,           cls: "text-green-400" },
    error:          { icon: <XCircle className="w-3 h-3" />,               cls: "text-red-400" },
    ai:             { icon: <Bot className="w-3 h-3" />,                   cls: "text-primary" },
    verify:         { icon: <Search className="w-3 h-3" />,                cls: "text-violet-400" },
    retry:          { icon: <RotateCcw className="w-3 h-3" />,             cls: "text-orange-400" },
    docker_missing: { icon: <AlertTriangle className="w-3 h-3" />,         cls: "text-orange-400" },
};

function LogLine({ entry }: { entry: LogEntry }) {
    const s = LOG_STYLES[entry.type] ?? LOG_STYLES.info;
    return (
        <div className={cn("flex gap-2 items-start py-0.5 text-xs font-mono leading-relaxed", s.cls)}>
            <span className="shrink-0 mt-0.5 opacity-60">{s.icon ?? <span className="w-3 h-3 inline-block" />}</span>
            <span className="break-all whitespace-pre-wrap">{entry.content}</span>
        </div>
    );
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
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
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
                        <button onClick={() => { setSelectedImage(null); setTags([]); }} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                            ← back
                        </button>
                        <span className="text-sm font-semibold truncate flex-1">{selectedImage.name}</span>
                        {selectedImage.is_official && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/40 text-green-500">Official</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{selectedImage.short_description}</p>
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Tags</p>
                    <div className="overflow-y-auto flex-1 space-y-1">
                        {tagsLoading && tags.length === 0 && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                                <Loader2 className="w-4 h-4 animate-spin" /> Loading tags…
                            </div>
                        )}
                        {tags.map(tag => {
                            const imageRef = `${selectedImage.name}:${tag.name}`;
                            const arch = tag.images?.[0]?.architecture ?? "?";
                            return (
                                <div key={tag.name} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors">
                                    <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                    <span className="text-sm font-mono flex-1 truncate">{tag.name}</span>
                                    <span className="text-xs text-muted-foreground">{arch}</span>
                                    <span className="text-xs text-muted-foreground">{fmtBytes(tag.full_size)}</span>
                                    <CopyButton text={imageRef} />
                                    <button onClick={() => onInsert(`Use the image ${imageRef}`)} className="text-muted-foreground hover:text-primary transition-colors" title="Use in prompt">
                                        <Play className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            );
                        })}
                        {hasMore && (
                            <Button variant="ghost" className="w-full h-9 text-sm" onClick={() => loadTags(selectedImage, tagPage + 1)} disabled={tagsLoading}>
                                {tagsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load more tags"}
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="overflow-y-auto flex-1 space-y-2">
                    {results.length === 0 && !loading && (
                        <div className="text-sm text-muted-foreground text-center py-10">Search for any Docker image above</div>
                    )}
                    {results.map(img => (
                        <button
                            key={img.name}
                            onClick={() => { setSelectedImage(img); loadTags(img, 1); }}
                            className="w-full text-left flex items-start gap-3 px-3 py-3 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors"
                        >
                            <Package className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold">{img.name}</span>
                                    {img.is_official && <Badge variant="outline" className="text-[10px] px-1.5 border-green-500/40 text-green-500">Official</Badge>}
                                    <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Star className="w-3 h-3" />{img.star_count.toLocaleString()}</span>
                                </div>
                                <p className="text-xs text-muted-foreground truncate mt-0.5">{img.short_description || "No description"}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
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
        catch { /* ignore */ } finally { setLoading(false); }
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
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Tasks</span>
                <Button size="sm" variant="ghost" className="h-8 px-3 text-xs gap-1.5" onClick={load}>
                    <RefreshCw className="w-3.5 h-3.5" />Refresh
                </Button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2">
                {loading && <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>}
                {!loading && tasks.length === 0 && <div className="text-sm text-muted-foreground py-10 text-center">No tasks yet</div>}
                {tasks.map(t => (
                    <div key={t.id} className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden">
                        <button onClick={() => toggleDetail(t.id)} className="w-full text-left flex items-start gap-3 px-3 py-3 hover:bg-muted/40 transition-colors">
                            <div className="shrink-0 mt-0.5">
                                {t.status === "running"   && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                                {t.status === "completed" && <CheckCircle className="w-4 h-4 text-green-400" />}
                                {t.status === "failed"    && <XCircle className="w-4 h-4 text-red-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{t.intent}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-muted-foreground">{fmtRelative(t.created_at)}</span>
                                    {t.retries > 0 && <span className="text-xs text-orange-400">{t.retries} retry</span>}
                                </div>
                                {t.summary && <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.summary}</p>}
                            </div>
                            <ChevronDown className={cn("w-4 h-4 text-muted-foreground shrink-0 transition-transform mt-0.5", expanded === t.id && "rotate-180")} />
                        </button>
                        {expanded === t.id && (
                            <div className="border-t border-border/40 px-3 py-3 space-y-2">
                                {detailLoading && <div className="text-sm text-muted-foreground">Loading logs…</div>}
                                {detail && detail.id === t.id && (
                                    <>
                                        <div className="bg-black/50 rounded-xl p-3 max-h-48 overflow-y-auto space-y-0.5">
                                            {(detail.log_json || []).map((line, i) => (
                                                <div key={i} className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">{line}</div>
                                            ))}
                                        </div>
                                        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => onRerun(t.intent)}>
                                            <RotateCcw className="w-3.5 h-3.5" />Re-run
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
        catch { /* ignore */ } finally { setLoading(false); }
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
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Learned Fixes & Patterns</span>
                <Button size="sm" variant="ghost" className="h-8 px-3 text-xs gap-1.5" onClick={load}>
                    <RefreshCw className="w-3.5 h-3.5" />Refresh
                </Button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2">
                {loading && <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>}
                {!loading && entries.length === 0 && (
                    <div className="text-sm text-muted-foreground py-10 text-center">
                        No patterns yet.<br />
                        <span className="text-xs">Successful fixes are stored automatically.</span>
                    </div>
                )}
                {entries.map(e => (
                    <div key={e.id} className="rounded-xl border border-border/50 bg-muted/20 px-3 py-3">
                        <div className="flex items-start gap-3">
                            <BookOpen className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold truncate">{e.pattern}</span>
                                    <Badge variant="outline" className="text-[10px] px-1.5 border-green-500/30 text-green-500">✓ {e.success_count}×</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.strategy_summary}</p>
                                <p className="text-xs text-muted-foreground mt-1">{fmtRelative(e.last_used_at)}</p>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <button onClick={() => onInsert(e.intent_sample)} className="text-muted-foreground hover:text-primary transition-colors" title="Use as prompt">
                                    <Play className="w-4 h-4" />
                                </button>
                                <button onClick={() => remove(e.id)} className="text-muted-foreground hover:text-red-400 transition-colors" title="Delete">
                                    <Trash2 className="w-4 h-4" />
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

function BottomSheet({
    open, title, icon, onClose, children,
}: {
    open: boolean;
    title: string;
    icon: React.ReactNode;
    onClose: () => void;
    children: React.ReactNode;
}) {
    // Lock body scroll when sheet is open
    useEffect(() => {
        if (open) document.body.style.overflow = "hidden";
        else       document.body.style.overflow = "";
        return () => { document.body.style.overflow = ""; };
    }, [open]);

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                className={cn(
                    "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300",
                    open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                )}
            />
            {/* Sheet */}
            <div
                className={cn(
                    "fixed inset-x-0 bottom-0 z-50 flex flex-col bg-background rounded-t-2xl shadow-2xl border-t border-border/60",
                    "transition-transform duration-300 ease-out",
                    open ? "translate-y-0" : "translate-y-full"
                )}
                style={{ height: "88dvh" }}
            >
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1 shrink-0">
                    <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                </div>
                {/* Sheet header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 shrink-0">
                    <span className="text-primary">{icon}</span>
                    <h2 className="font-semibold text-base flex-1">{title}</h2>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-muted">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                {/* Sheet content */}
                <div className="flex-1 min-h-0 overflow-hidden px-4 py-4">
                    {children}
                </div>
            </div>
        </>
    );
}

// ── Suggestion chips ──────────────────────────────────────────────────────────

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
    logs,
    running,
    dockerMissing,
    onInstallDocker,
    prompt,
    setPrompt,
    onRun,
    onCancel,
    textareaRef,
    isMobile,
}: {
    logs: LogEntry[];
    running: boolean;
    dockerMissing: boolean;
    onInstallDocker: () => void;
    prompt: string;
    setPrompt: (v: string) => void;
    onRun: (text?: string) => void;
    onCancel: () => void;
    textareaRef: React.RefObject<HTMLTextAreaElement>;
    isMobile: boolean;
}) {
    const logEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

    return (
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
            {/* Log stream */}
            <div className="flex-1 overflow-y-auto p-4 bg-black/20 min-h-0">
                {logs.length === 0 && !running && (
                    <div className="h-full flex flex-col items-center justify-center gap-5 text-center px-4">
                        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                            <Bot className="w-8 h-8 text-primary" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold">Agentic DevOps Engine</p>
                            <p className="text-xs text-muted-foreground mt-1.5 max-w-xs leading-relaxed">
                                Describe any Docker task in plain English. The agent searches DockerHub live,
                                plans steps, executes, verifies, and self-heals on failure.
                            </p>
                        </div>
                        {/* Suggestion pills — 2 columns on mobile */}
                        <div className={cn("grid gap-2 w-full max-w-sm", isMobile ? "grid-cols-2" : "grid-cols-1")}>
                            {SUGGESTIONS.slice(0, isMobile ? 6 : 5).map(s => (
                                <button
                                    key={s}
                                    onClick={() => onRun(s)}
                                    className="text-xs px-3 py-2 rounded-xl bg-muted/60 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground transition-colors text-left"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {logs.map((entry, i) => <LogLine key={i} entry={entry} />)}
                {dockerMissing && (
                    <div className="mt-4 p-4 rounded-xl border border-orange-500/30 bg-orange-500/10">
                        <p className="text-sm font-semibold text-orange-400 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />Docker Not Available
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 mb-3">Docker is not installed or not running on this host.</p>
                        <Button variant="outline" className="h-9 text-xs border-orange-500/40 text-orange-400 hover:bg-orange-500/10 gap-2" onClick={onInstallDocker}>
                            <Zap className="w-3.5 h-3.5" />Install Docker Automatically
                        </Button>
                    </div>
                )}
                <div ref={logEndRef} />
            </div>

            {/* Prompt bar */}
            <div className="border-t border-border/60 p-3 bg-background/95 backdrop-blur space-y-2 shrink-0">
                {/* Scrollable chips */}
                <div className="flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
                    {SUGGESTIONS.slice(5).map(s => (
                        <button
                            key={s}
                            onClick={() => onRun(s)}
                            className="text-xs px-2.5 py-1 rounded-full bg-muted/70 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap shrink-0"
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
                        placeholder="Describe a Docker task…"
                        rows={2}
                        className="flex-1 resize-none text-sm rounded-xl border border-border bg-muted/30 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                        disabled={running}
                    />
                    {running ? (
                        <Button variant="destructive" className="h-auto px-4 py-2 shrink-0 rounded-xl" onClick={onCancel}>
                            <Square className="w-5 h-5" />
                        </Button>
                    ) : (
                        <Button variant="default" className="h-auto px-4 py-2 shrink-0 rounded-xl" onClick={() => onRun()} disabled={!prompt.trim()}>
                            <Send className="w-5 h-5" />
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
    onInsert: (t: string) => void;
    historyKey: number;
    onRerun: (t: string) => void;
}) {
    const [tab, setTab] = useState<RightTab>("hub");

    const tabs = [
        { id: "hub"       as RightTab, label: "DockerHub", icon: <Database className="w-3.5 h-3.5" /> },
        { id: "history"   as RightTab, label: "History",   icon: <History className="w-3.5 h-3.5" /> },
        { id: "knowledge" as RightTab, label: "Knowledge", icon: <BookOpen className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="w-80 xl:w-96 shrink-0 flex flex-col min-h-0 border-l border-border/40">
            <div className="flex border-b border-border/60 shrink-0">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors border-b-2",
                            tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {t.icon}{t.label}
                    </button>
                ))}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden p-3">
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
    const [logs, setLogs]   = useState<LogEntry[]>([]);
    const [running, setRunning] = useState(false);
    const [agentId, setAgentId] = useState<string | null>(null);
    const [dockerMissing, setDockerMissing] = useState(false);
    const [historyKey, setHistoryKey] = useState(0);
    const [openSheet, setOpenSheet] = useState<Sheet>(null);

    const textareaRef   = useRef<HTMLTextAreaElement>(null);
    const currentAgent  = useRef<string | null>(null);

    // Socket listeners
    useEffect(() => {
        const socket = getSocket();
        const onLog = (data: { agentId: string; type: LogEntry["type"]; content: string }) => {
            if (currentAgent.current && data.agentId !== currentAgent.current) return;
            setLogs(prev => [...prev, { type: data.type, content: data.content, ts: Date.now() }]);
        };
        const onDone = (data: { agentId: string; success: boolean; summary: string; dockerMissing?: boolean }) => {
            if (currentAgent.current && data.agentId !== currentAgent.current) return;
            setRunning(false);
            if (data.dockerMissing) { setDockerMissing(true); }
            else if (data.success) { toast.success("Task completed"); setHistoryKey(k => k + 1); }
            else { toast.error("Task ended with errors"); setHistoryKey(k => k + 1); }
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
        currentAgent.current = id;
        setAgentId(id);
        // Close sheet on mobile when a task starts
        setOpenSheet(null);
        try {
            const res = await apiFetch<any>("/agent/run", { method: "POST", body: JSON.stringify({ message: msg, agentId: id }) });
            if (res.dockerMissing) { setDockerMissing(true); setRunning(false); }
        } catch (e: any) { toast.error(e.message || "Failed to start agent"); setRunning(false); }
    }, [prompt, running]);

    const cancel = useCallback(async () => {
        if (!agentId) return;
        try { await apiFetch("/agent/cancel", { method: "POST", body: JSON.stringify({ agentId }) }); setRunning(false); }
        catch { /* ignore */ }
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

    // ── Mobile bottom nav config ──────────────────────────────────────────────
    const bottomNavItems = [
        { id: "hub"       as Sheet, label: "DockerHub", icon: <Database className="w-5 h-5" /> },
        { id: "history"   as Sheet, label: "History",   icon: <History className="w-5 h-5" /> },
        { id: "knowledge" as Sheet, label: "Knowledge", icon: <BookOpen className="w-5 h-5" /> },
    ];

    const sheetConfig: Record<string, { title: string; icon: React.ReactNode; content: React.ReactNode }> = {
        hub:       { title: "DockerHub",  icon: <Database className="w-5 h-5" />,  content: <DockerHubPanel onInsert={insertPrompt} /> },
        history:   { title: "History",   icon: <History className="w-5 h-5" />,   content: <HistoryPanel key={historyKey} onRerun={run} /> },
        knowledge: { title: "Knowledge", icon: <BookOpen className="w-5 h-5" />,  content: <KnowledgePanel onInsert={insertPrompt} /> },
    };

    // ─────────────────────────────────────────────────────────────────────────

    const chatProps = {
        logs, running, dockerMissing,
        onInstallDocker: installDocker,
        prompt, setPrompt,
        onRun: run, onCancel: cancel,
        textareaRef, isMobile: !!isMobile,
    };

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <DesktopSidebar />

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <header className="flex items-center gap-3 px-4 h-12 border-b border-border/60 bg-background/95 backdrop-blur shrink-0">
                    <MobileSidebarTrigger />
                    <Bot className="w-4 h-4 text-primary shrink-0" />
                    <h1 className="font-semibold text-sm">DevOps Agent</h1>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">AI</Badge>
                    {running && (
                        <div className="flex items-center gap-1.5 ml-1">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                            </span>
                            <span className="text-[11px] text-green-400 font-medium">Running</span>
                        </div>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={toggleTheme}>
                            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        </Button>
                    </div>
                </header>

                {/* Body */}
                {isMobile ? (
                    /* ── MOBILE: full-screen chat + bottom nav ── */
                    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                        {/* Chat takes full height minus bottom nav */}
                        <div className="flex-1 flex flex-col min-h-0 pb-[64px]">
                            <ChatArea {...chatProps} />
                        </div>

                        {/* Fixed bottom navigation bar */}
                        <nav className="fixed bottom-0 left-0 right-0 z-30 flex items-stretch bg-background/95 backdrop-blur border-t border-border/60 safe-bottom" style={{ height: 64 }}>
                            {bottomNavItems.map(item => (
                                <button
                                    key={item.id}
                                    onClick={() => setOpenSheet(prev => prev === item.id ? null : item.id)}
                                    className={cn(
                                        "flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors",
                                        openSheet === item.id ? "text-primary" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    <span className={cn("transition-colors", openSheet === item.id ? "text-primary" : "text-muted-foreground")}>
                                        {item.icon}
                                    </span>
                                    {item.label}
                                </button>
                            ))}
                        </nav>

                        {/* Bottom sheets */}
                        {Object.entries(sheetConfig).map(([id, cfg]) => (
                            <BottomSheet
                                key={id}
                                open={openSheet === id}
                                title={cfg.title}
                                icon={cfg.icon}
                                onClose={() => setOpenSheet(null)}
                            >
                                {cfg.content}
                            </BottomSheet>
                        ))}
                    </div>
                ) : (
                    /* ── DESKTOP: split left/right ── */
                    <div className="flex flex-1 min-h-0 overflow-hidden">
                        <ChatArea {...chatProps} />
                        <DesktopRightPanel
                            onInsert={insertPrompt}
                            historyKey={historyKey}
                            onRerun={run}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
