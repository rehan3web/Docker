import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    Bot, Send, Square, RefreshCw, Star, CheckCircle, XCircle,
    Clock, ChevronRight, Trash2, Search, Tag, Package,
    Cpu, Zap, RotateCcw, AlertTriangle, Info, Terminal,
    BookOpen, History, Database, ChevronDown, ExternalLink,
    Play, Loader2, Copy, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
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

interface AgentTaskDetail extends AgentTask {
    log_json: string[];
}

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

const LOG_STYLES: Record<LogEntry["type"], { icon: React.ReactNode; cls: string; prefix: string }> = {
    thinking: { icon: <Loader2 className="w-3 h-3 animate-spin" />, cls: "text-blue-400", prefix: "thinking" },
    info:     { icon: <Info className="w-3 h-3" />,               cls: "text-muted-foreground", prefix: "info" },
    command:  { icon: <Terminal className="w-3 h-3" />,            cls: "text-yellow-400 font-mono", prefix: "$" },
    output:   { icon: null,                                        cls: "text-muted-foreground font-mono text-[11px]", prefix: "" },
    success:  { icon: <CheckCircle className="w-3 h-3" />,        cls: "text-green-400", prefix: "ok" },
    error:    { icon: <XCircle className="w-3 h-3" />,            cls: "text-red-400", prefix: "error" },
    ai:       { icon: <Bot className="w-3 h-3" />,                cls: "text-primary", prefix: "agent" },
    verify:   { icon: <Search className="w-3 h-3" />,             cls: "text-violet-400", prefix: "verify" },
    retry:    { icon: <RotateCcw className="w-3 h-3" />,          cls: "text-orange-400", prefix: "retry" },
    docker_missing: { icon: <AlertTriangle className="w-3 h-3" />, cls: "text-orange-400", prefix: "docker" },
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
    if (d < 60_000) return "just now";
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
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
        setLoading(true);
        setResults([]);
        setSelectedImage(null);
        setTags([]);
        try {
            const data = await apiFetch<{ results: HubImage[] }>(`/agent/hub/search?q=${encodeURIComponent(q)}&limit=8`);
            setResults(data.results || []);
        } catch (e: any) {
            toast.error(e.message || "Search failed");
        } finally {
            setLoading(false);
        }
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
        } catch (e: any) {
            toast.error(e.message || "Failed to load tags");
        } finally {
            setTagsLoading(false);
        }
    }, []);

    const selectImage = (img: HubImage) => {
        setSelectedImage(img);
        loadTags(img, 1);
    };

    return (
        <div className="flex flex-col h-full gap-3">
            {/* Search bar */}
            <div className="flex gap-2">
                <Input
                    placeholder="Search Docker Hub images…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && search(query)}
                    className="h-8 text-xs"
                />
                <Button size="sm" variant="outline" className="h-8 px-3 shrink-0" onClick={() => search(query)} disabled={loading}>
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                </Button>
            </div>

            {/* Results or tag view */}
            {selectedImage ? (
                <div className="flex flex-col gap-2 flex-1 min-h-0">
                    <div className="flex items-center gap-2">
                        <button onClick={() => { setSelectedImage(null); setTags([]); }} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                            ← back
                        </button>
                        <span className="text-xs font-semibold truncate">{selectedImage.name}</span>
                        {selectedImage.is_official && <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-500/40 text-green-500">Official</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{selectedImage.short_description}</div>
                    <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Tags ({tagsLoading && tags.length === 0 ? "…" : tags.length})</div>
                    <div className="overflow-y-auto flex-1 space-y-1 pr-1">
                        {tagsLoading && tags.length === 0 && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                                <Loader2 className="w-3 h-3 animate-spin" /> Loading tags…
                            </div>
                        )}
                        {tags.map(tag => {
                            const imageRef = `${selectedImage.name}:${tag.name}`;
                            const arch = tag.images?.[0]?.architecture ?? "?";
                            return (
                                <div key={tag.name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/30 hover:bg-muted/60 group">
                                    <Tag className="w-3 h-3 text-muted-foreground shrink-0" />
                                    <span className="text-xs font-mono flex-1 truncate">{tag.name}</span>
                                    <span className="text-[10px] text-muted-foreground">{arch}</span>
                                    <span className="text-[10px] text-muted-foreground">{fmtBytes(tag.full_size)}</span>
                                    <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                                        <CopyButton text={imageRef} />
                                        <button
                                            onClick={() => onInsert(`Use the image ${imageRef}`)}
                                            className="text-muted-foreground hover:text-primary transition-colors"
                                            title="Use in prompt"
                                        >
                                            <Play className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {hasMore && (
                            <Button size="sm" variant="ghost" className="w-full h-7 text-xs" onClick={() => loadTags(selectedImage, tagPage + 1)} disabled={tagsLoading}>
                                {tagsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Load more"}
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="overflow-y-auto flex-1 space-y-1 pr-1">
                    {results.length === 0 && !loading && (
                        <div className="text-xs text-muted-foreground text-center py-6">Search for any Docker image above</div>
                    )}
                    {results.map(img => (
                        <button
                            key={img.name}
                            onClick={() => selectImage(img)}
                            className="w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors group"
                        >
                            <Package className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-semibold">{img.name}</span>
                                    {img.is_official && <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-500/40 text-green-500">Official</Badge>}
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Star className="w-2.5 h-2.5" />{img.star_count.toLocaleString()}</span>
                                </div>
                                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{img.short_description || "No description"}</p>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5 opacity-0 group-hover:opacity-100" />
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
        try {
            const data = await apiFetch<AgentTask[]>("/agent/tasks");
            setTasks(data);
        } catch { /* ignore */ } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggleDetail = async (id: string) => {
        if (expanded === id) { setExpanded(null); setDetail(null); return; }
        setExpanded(id);
        setDetailLoading(true);
        try {
            const d = await apiFetch<AgentTaskDetail>(`/agent/tasks/${id}`);
            setDetail(d);
        } catch { setDetail(null); } finally { setDetailLoading(false); }
    };

    return (
        <div className="flex flex-col h-full gap-2">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Recent Tasks</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={load}>
                    <RefreshCw className="w-3 h-3 mr-1" />Refresh
                </Button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-1 pr-1">
                {loading && <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>}
                {!loading && tasks.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">No tasks yet</div>}
                {tasks.map(t => (
                    <div key={t.id} className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
                        <button
                            onClick={() => toggleDetail(t.id)}
                            className="w-full text-left flex items-start gap-2 px-2.5 py-2 hover:bg-muted/40 transition-colors"
                        >
                            <div className="shrink-0 mt-0.5">
                                {t.status === "running"   && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />}
                                {t.status === "completed" && <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
                                {t.status === "failed"    && <XCircle className="w-3.5 h-3.5 text-red-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{t.intent}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-muted-foreground">{fmtRelative(t.created_at)}</span>
                                    {t.retries > 0 && <span className="text-[10px] text-orange-400">{t.retries} retry</span>}
                                    {t.summary && <span className="text-[10px] text-muted-foreground truncate">{t.summary}</span>}
                                </div>
                            </div>
                            <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform mt-0.5", expanded === t.id && "rotate-180")} />
                        </button>
                        {expanded === t.id && (
                            <div className="border-t border-border/40 px-2.5 py-2">
                                {detailLoading && <div className="text-xs text-muted-foreground">Loading logs…</div>}
                                {detail && detail.id === t.id && (
                                    <>
                                        <div className="bg-black/40 rounded-lg p-2 max-h-40 overflow-y-auto space-y-0.5 mb-2">
                                            {(detail.log_json || []).map((line, i) => (
                                                <div key={i} className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all">{line}</div>
                                            ))}
                                        </div>
                                        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => onRerun(t.intent)}>
                                            <RotateCcw className="w-2.5 h-2.5 mr-1" />Re-run
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
        try {
            const data = await apiFetch<KnowledgeEntry[]>("/agent/knowledge");
            setEntries(data);
        } catch { /* ignore */ } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const remove = async (id: string) => {
        try {
            await apiFetch(`/agent/knowledge/${id}`, { method: "DELETE" });
            setEntries(prev => prev.filter(e => e.id !== id));
            toast.success("Knowledge entry removed");
        } catch { toast.error("Failed to delete"); }
    };

    return (
        <div className="flex flex-col h-full gap-2">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Learned Fixes & Patterns</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={load}>
                    <RefreshCw className="w-3 h-3 mr-1" />Refresh
                </Button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-1.5 pr-1">
                {loading && <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>}
                {!loading && entries.length === 0 && (
                    <div className="text-xs text-muted-foreground py-6 text-center">
                        No learned patterns yet.<br />
                        <span className="text-[11px]">Successful fixes are stored here automatically.</span>
                    </div>
                )}
                {entries.map(e => (
                    <div key={e.id} className="rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2">
                        <div className="flex items-start gap-2">
                            <BookOpen className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-semibold">{e.pattern}</span>
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-green-500/30 text-green-500">
                                        ✓ {e.success_count}×
                                    </Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{e.strategy_summary}</p>
                                <p className="text-[10px] text-muted-foreground mt-1">Last: {fmtRelative(e.last_used_at)}</p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                                <button
                                    onClick={() => onInsert(e.intent_sample)}
                                    className="text-muted-foreground hover:text-primary transition-colors"
                                    title="Use as prompt"
                                >
                                    <Play className="w-3 h-3" />
                                </button>
                                <button
                                    onClick={() => remove(e.id)}
                                    className="text-muted-foreground hover:text-red-400 transition-colors"
                                    title="Delete"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Suggested prompts ─────────────────────────────────────────────────────────

const SUGGESTIONS = [
    "Install MongoDB on port 27017",
    "Deploy Redis with a password",
    "Set up PostgreSQL 16",
    "Install Grafana on port 3000",
    "Check which containers are running",
    "Stop and remove the mysql container",
    "Restart the nginx container",
    "Show logs for container",
    "Deploy n8n workflow automation",
    "Install Elasticsearch",
];

// ── Main page ─────────────────────────────────────────────────────────────────

type RightTab = "hub" | "history" | "knowledge";

export default function AgentPage() {
    const { theme, toggleTheme } = useTheme();
    const [prompt, setPrompt] = useState("");
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [running, setRunning] = useState(false);
    const [agentId, setAgentId] = useState<string | null>(null);
    const [dockerMissing, setDockerMissing] = useState(false);
    const [rightTab, setRightTab] = useState<RightTab>("hub");
    const [historyKey, setHistoryKey] = useState(0);

    const logEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const currentAgentId = useRef<string | null>(null);

    useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

    useEffect(() => {
        const socket = getSocket();

        const onLog = (data: { agentId: string; type: LogEntry["type"]; content: string }) => {
            if (currentAgentId.current && data.agentId !== currentAgentId.current) return;
            setLogs(prev => [...prev, { type: data.type, content: data.content, ts: Date.now() }]);
        };

        const onDone = (data: { agentId: string; success: boolean; summary: string; dockerMissing?: boolean }) => {
            if (currentAgentId.current && data.agentId !== currentAgentId.current) return;
            setRunning(false);
            if (data.dockerMissing) {
                setDockerMissing(true);
            } else if (data.success) {
                toast.success("Task completed successfully");
                setHistoryKey(k => k + 1);
            } else {
                toast.error("Task ended with errors");
                setHistoryKey(k => k + 1);
            }
        };

        socket.on("agent:log", onLog);
        socket.on("agent:done", onDone);
        return () => { socket.off("agent:log", onLog); socket.off("agent:done", onDone); };
    }, []);

    const run = useCallback(async (text?: string) => {
        const msg = (text ?? prompt).trim();
        if (!msg || running) return;

        setLogs([]);
        setRunning(true);
        setDockerMissing(false);
        setPrompt("");

        const newId = `ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        currentAgentId.current = newId;
        setAgentId(newId);

        try {
            const res = await apiFetch<any>("/agent/run", {
                method: "POST",
                body: JSON.stringify({ message: msg, agentId: newId }),
            });
            if (res.dockerMissing) {
                setDockerMissing(true);
                setRunning(false);
            }
        } catch (e: any) {
            toast.error(e.message || "Failed to start agent");
            setRunning(false);
        }
    }, [prompt, running]);

    const cancel = useCallback(async () => {
        if (!agentId) return;
        try {
            await apiFetch("/agent/cancel", { method: "POST", body: JSON.stringify({ agentId }) });
            setRunning(false);
        } catch { /* ignore */ }
    }, [agentId]);

    const installDocker = useCallback(async () => {
        setDockerMissing(false);
        setRunning(true);
        setLogs([]);
        const newId = `ag_docker_${Date.now()}`;
        currentAgentId.current = newId;
        setAgentId(newId);
        await apiFetch("/agent/install-docker", { method: "POST", body: JSON.stringify({ agentId: newId }) });
    }, []);

    const insertPrompt = useCallback((text: string) => {
        setPrompt(text);
        textareaRef.current?.focus();
    }, []);

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <DesktopSidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <header className="flex items-center gap-3 px-4 h-12 border-b border-border/60 bg-background/95 backdrop-blur shrink-0">
                    <MobileSidebarTrigger />
                    <Bot className="w-4 h-4 text-primary shrink-0" />
                    <h1 className="font-semibold text-sm">DevOps Agent</h1>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">AI-Powered</Badge>
                    <div className="ml-auto flex items-center gap-2">
                        <Button variant="ghost" size="icon" className="w-8 h-8" onClick={toggleTheme}>
                            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        </Button>
                    </div>
                </header>

                {/* Main body */}
                <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* Left — log terminal + prompt */}
                    <div className="flex flex-col flex-1 min-w-0 border-r border-border/40">
                        {/* Log stream */}
                        <div className="flex-1 overflow-y-auto p-4 bg-black/30 min-h-0">
                            {logs.length === 0 && !running && (
                                <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
                                    <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
                                        <Bot className="w-7 h-7 text-primary" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold">Agentic DevOps Engine</p>
                                        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                                            Describe any Docker task in plain English. The agent searches DockerHub dynamically,
                                            plans the steps, executes them, verifies the result, and self-heals on failure.
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 justify-center max-w-md">
                                        {SUGGESTIONS.slice(0, 6).map(s => (
                                            <button
                                                key={s}
                                                onClick={() => insertPrompt(s)}
                                                className="text-[11px] px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {logs.map((entry, i) => <LogLine key={i} entry={entry} />)}
                            {dockerMissing && (
                                <div className="mt-4 p-3 rounded-xl border border-orange-500/30 bg-orange-500/10">
                                    <p className="text-xs font-semibold text-orange-400 flex items-center gap-2">
                                        <AlertTriangle className="w-3.5 h-3.5" />Docker Not Available
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1 mb-3">Docker is not installed or not running on this host.</p>
                                    <Button size="sm" variant="outline" className="h-7 text-xs border-orange-500/40 text-orange-400 hover:bg-orange-500/10" onClick={installDocker}>
                                        <Zap className="w-3 h-3 mr-1.5" />Install Docker Automatically
                                    </Button>
                                </div>
                            )}
                            <div ref={logEndRef} />
                        </div>

                        {/* Prompt area */}
                        <div className="border-t border-border/60 p-3 bg-background/95 space-y-2 shrink-0">
                            {/* Suggestion chips */}
                            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                                {SUGGESTIONS.slice(6).map(s => (
                                    <button
                                        key={s}
                                        onClick={() => insertPrompt(s)}
                                        className="text-[10px] px-2 py-0.5 rounded-full bg-muted/60 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap shrink-0"
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
                                    onKeyDown={e => {
                                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); }
                                    }}
                                    placeholder="Describe a Docker task… e.g. 'Install MongoDB on port 27017'"
                                    rows={2}
                                    className="flex-1 resize-none text-xs rounded-lg border border-border bg-muted/30 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                                    disabled={running}
                                />
                                {running ? (
                                    <Button variant="destructive" size="icon" className="h-full px-3 py-2 shrink-0 rounded-lg" onClick={cancel}>
                                        <Square className="w-4 h-4" />
                                    </Button>
                                ) : (
                                    <Button variant="default" size="icon" className="h-full px-3 py-2 shrink-0 rounded-lg" onClick={() => run()} disabled={!prompt.trim()}>
                                        <Send className="w-4 h-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right — tabbed panels */}
                    <div className="w-80 xl:w-96 shrink-0 flex flex-col min-h-0">
                        {/* Tab bar */}
                        <div className="flex border-b border-border/60 bg-background/90 shrink-0">
                            {([
                                { id: "hub"       as RightTab, label: "DockerHub", icon: <Database className="w-3.5 h-3.5" /> },
                                { id: "history"   as RightTab, label: "History",   icon: <History  className="w-3.5 h-3.5" /> },
                                { id: "knowledge" as RightTab, label: "Knowledge", icon: <BookOpen className="w-3.5 h-3.5" /> },
                            ]).map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setRightTab(tab.id)}
                                    className={cn(
                                        "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors border-b-2",
                                        rightTab === tab.id
                                            ? "border-primary text-foreground"
                                            : "border-transparent text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {tab.icon}{tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Tab content */}
                        <div className="flex-1 min-h-0 overflow-hidden p-3">
                            {rightTab === "hub"       && <DockerHubPanel onInsert={insertPrompt} />}
                            {rightTab === "history"   && <HistoryPanel key={historyKey} onRerun={run} />}
                            {rightTab === "knowledge" && <KnowledgePanel onInsert={insertPrompt} />}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
