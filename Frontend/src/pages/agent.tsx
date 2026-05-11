import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    Bot, Send, Square, RefreshCw, Star, CheckCircle, XCircle,
    RotateCcw, AlertTriangle, Info, Terminal,
    BookOpen, History, Database, ChevronDown, ChevronRight,
    Play, Loader2, Copy, Check, Search, Tag, Package,
    Trash2, X, Zap, Sun, Moon, Container, PlugZap,
    Layers, FileText, Network, HardDrive, Wrench, Lightbulb,
    ShieldAlert, ListChecks, Eye, EyeOff, Rocket, Activity,
    Cpu, Server, Globe,
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

interface LogSection {
    id: string;
    title: string;
    priority: "critical" | "high" | "normal" | "low";
    entries: { type: string; content: string }[];
}

interface StructuredResult {
    taskType: string;
    intent: string;
    success: boolean;
    summary: string;
    sections: LogSection[];
}

interface ConfirmRequest {
    agentId: string;
    title: string;
    message: string;
}

interface InputFieldSpec {
    id: string;
    label: string;
    type: "text" | "password" | "port" | "select";
    placeholder?: string;
    default?: string;
    required: boolean;
    hint?: string;
    options?: { label: string; value: string }[];
}

interface InputRequest {
    agentId: string;
    title: string;
    description: string;
    fields: InputFieldSpec[];
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

// ── Container list parser & card ─────────────────────────────────────────────

interface ParsedContainer {
    name: string;
    ports: string;
    status: "running" | "exited";
}

function parseContainerBlock(text: string): ParsedContainer[] | null {
    const lower = text.toLowerCase();
    if (!lower.includes("container") || !lower.includes(" - ")) return null;

    const result: ParsedContainer[] = [];

    // Split into running / exited sections
    const runningMatch = text.match(/running containers?:?([\s\S]*?)(?:exited containers?:|$)/i);
    const exitedMatch  = text.match(/exited containers?:?([\s\S]*?)$/i);

    const parseSection = (section: string, status: "running" | "exited") => {
        // Each entry starts with " - " or "- "
        const items = section.split(/\s*-\s+/).filter(s => s.trim().length > 0);
        for (const item of items) {
            const trimmed = item.trim();
            if (!trimmed) continue;
            // name (ports: xxx) or name (no ports)
            const portMatch = trimmed.match(/^([^\s(]+)\s*\(ports?:\s*([^)]+)\)/i);
            const noPort    = trimmed.match(/^([^\s(]+)\s*\(no ports?\)/i);
            const bare      = trimmed.match(/^([^\s(]+)/);
            if (portMatch) {
                result.push({ name: portMatch[1], ports: portMatch[2].trim(), status });
            } else if (noPort) {
                result.push({ name: noPort[1], ports: "", status });
            } else if (bare) {
                result.push({ name: bare[1], ports: "", status });
            }
        }
    };

    if (runningMatch?.[1]) parseSection(runningMatch[1], "running");
    if (exitedMatch?.[1])  parseSection(exitedMatch[1],  "exited");

    return result.length > 0 ? result : null;
}

function ContainerListCard({ containers }: { containers: ParsedContainer[] }) {
    const running = containers.filter(c => c.status === "running");
    const exited  = containers.filter(c => c.status === "exited");

    return (
        <div className="my-2 rounded-lg border border-border overflow-hidden">
            {/* Header */}
            <div className="px-3 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
                <Container className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Containers</span>
                <div className="ml-auto flex items-center gap-2">
                    {running.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                            {running.length} running
                        </span>
                    )}
                    {exited.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-red-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                            {exited.length} exited
                        </span>
                    )}
                </div>
            </div>

            {/* Running */}
            {running.map((c, i) => (
                <div
                    key={`r-${i}`}
                    className="flex items-center gap-3 px-3 py-2.5 border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
                >
                    <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span className="text-sm font-medium text-foreground flex-1 truncate font-mono">{c.name}</span>
                    {c.ports ? (
                        <div className="flex items-center gap-1 shrink-0">
                            <PlugZap className="w-3 h-3 text-muted-foreground" />
                            <span className="text-xs font-mono text-muted-foreground">{c.ports}</span>
                        </div>
                    ) : (
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">no ports</span>
                    )}
                    <Badge className="text-[10px] px-1.5 py-0 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 shrink-0">
                        Running
                    </Badge>
                </div>
            ))}

            {/* Exited — with divider if both sections present */}
            {exited.length > 0 && running.length > 0 && (
                <div className="px-3 py-1 bg-muted/10 border-y border-border/50">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">Exited</span>
                </div>
            )}
            {exited.map((c, i) => (
                <div
                    key={`e-${i}`}
                    className="flex items-center gap-3 px-3 py-2.5 border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors opacity-70"
                >
                    <span className="w-2 h-2 rounded-full bg-red-400/70 shrink-0" />
                    <span className="text-sm font-medium text-foreground/70 flex-1 truncate font-mono">{c.name}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-full border-red-400/30 text-red-400 shrink-0">
                        Exited
                    </Badge>
                </div>
            ))}
        </div>
    );
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
        case "output": {
            const containers = parseContainerBlock(entry.content);
            if (containers) return <ContainerListCard containers={containers} />;
            return (
                <div className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed px-1">
                    {entry.content}
                </div>
            );
        }
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
        default: {
            const containers = parseContainerBlock(entry.content);
            if (containers) return <ContainerListCard containers={containers} />;
            return (
                <div className="flex items-center gap-2 text-muted-foreground py-0.5">
                    <Info className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs">{entry.content}</span>
                </div>
            );
        }
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

// ── DB setup input modal ──────────────────────────────────────────────────────

const DB_ICONS: Record<string, React.ReactNode> = {
    PostgreSQL:    <Database className="w-5 h-5 text-blue-400" />,
    MySQL:         <Database className="w-5 h-5 text-orange-400" />,
    MariaDB:       <Database className="w-5 h-5 text-cyan-400" />,
    MongoDB:       <Database className="w-5 h-5 text-emerald-400" />,
    Redis:         <Cpu className="w-5 h-5 text-red-400" />,
    Elasticsearch: <Search className="w-5 h-5 text-yellow-400" />,
    Cassandra:     <Database className="w-5 h-5 text-violet-400" />,
    MinIO:         <HardDrive className="w-5 h-5 text-amber-400" />,
};

function AgentInputModal({
    request,
    onSubmit,
    onCancel,
    loading,
}: {
    request: InputRequest;
    onSubmit: (values: Record<string, string>) => void;
    onCancel: () => void;
    loading: boolean;
}) {
    const [values, setValues] = useState<Record<string, string>>(() => {
        const init: Record<string, string> = {};
        request.fields.forEach(f => { init[f.id] = f.default ?? ""; });
        return init;
    });
    const [showPw, setShowPw] = useState<Record<string, boolean>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});

    const dbKey = request.title.split(" ")[0];
    const icon = DB_ICONS[dbKey] ?? <Database className="w-5 h-5 text-primary" />;

    function validate() {
        const e: Record<string, string> = {};
        request.fields.forEach(f => {
            if (f.required && !values[f.id]?.trim()) e[f.id] = "Required";
        });
        setErrors(e);
        return Object.keys(e).length === 0;
    }

    function handleSubmit(ev: React.FormEvent) {
        ev.preventDefault();
        if (validate()) onSubmit(values);
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-border bg-muted/20 shrink-0">
                    <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 shrink-0">{icon}</div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{request.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{request.description}</p>
                    </div>
                    <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Fields */}
                <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                    <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
                        {request.fields.map(field => (
                            <div key={field.id} className="space-y-1.5">
                                <label className="text-xs font-medium text-foreground flex items-center gap-1">
                                    {field.label}
                                    {field.required && <span className="text-destructive">*</span>}
                                </label>

                                {field.type === "select" ? (
                                    <div className="grid grid-cols-1 gap-1.5">
                                        {field.options?.map(opt => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setValues(v => ({ ...v, [field.id]: opt.value }))}
                                                className={cn(
                                                    "text-left px-3 py-2.5 rounded-lg border text-sm transition-all",
                                                    values[field.id] === opt.value
                                                        ? "border-primary bg-primary/10 text-foreground"
                                                        : "border-border bg-muted/20 text-muted-foreground hover:border-primary/40 hover:bg-muted/40"
                                                )}
                                            >
                                                <span className="font-medium">{opt.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="relative">
                                        <input
                                            type={field.type === "password" && !showPw[field.id] ? "password" : "text"}
                                            value={values[field.id] ?? ""}
                                            onChange={e => {
                                                setValues(v => ({ ...v, [field.id]: e.target.value }));
                                                if (errors[field.id]) setErrors(e2 => ({ ...e2, [field.id]: "" }));
                                            }}
                                            placeholder={field.placeholder}
                                            inputMode={field.type === "port" ? "numeric" : "text"}
                                            className={cn(
                                                "w-full h-9 rounded-lg border bg-muted/30 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground",
                                                field.type === "password" ? "pr-9" : "",
                                                errors[field.id] ? "border-destructive" : "border-border"
                                            )}
                                        />
                                        {field.type === "password" && (
                                            <button
                                                type="button"
                                                onClick={() => setShowPw(s => ({ ...s, [field.id]: !s[field.id] }))}
                                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                            >
                                                {showPw[field.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                            </button>
                                        )}
                                    </div>
                                )}

                                {field.hint && !errors[field.id] && (
                                    <p className="text-[11px] text-muted-foreground">{field.hint}</p>
                                )}
                                {errors[field.id] && (
                                    <p className="text-[11px] text-destructive">{errors[field.id]}</p>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 px-5 pb-5 pt-3 border-t border-border shrink-0">
                        <Button type="button" variant="outline" className="flex-1 h-9 gap-1.5" onClick={onCancel} disabled={loading}>
                            <X className="w-3.5 h-3.5" />Cancel
                        </Button>
                        <Button type="submit" className="flex-1 h-9 gap-1.5" disabled={loading}>
                            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                            Set Up Database
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// ── Destructive-action confirmation modal ─────────────────────────────────────

function AgentConfirmModal({
    request,
    onConfirm,
    onCancel,
    loading,
}: {
    request: ConfirmRequest;
    onConfirm: () => void;
    onCancel: () => void;
    loading: boolean;
}) {
    return (
        /* Backdrop */
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-background shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-destructive/20 bg-destructive/5">
                    <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20 shrink-0">
                        <AlertTriangle className="w-5 h-5 text-destructive" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{request.title}</p>
                        <p className="text-[11px] text-destructive font-medium mt-0.5">Agent paused — waiting for your decision</p>
                    </div>
                </div>

                {/* Body */}
                <div className="px-5 py-4">
                    <div className="text-sm text-foreground/90 whitespace-pre-line leading-relaxed">
                        {request.message}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 px-5 pb-5">
                    <Button
                        variant="outline"
                        className="flex-1 h-9 gap-2 border-border text-muted-foreground hover:text-foreground"
                        onClick={onCancel}
                        disabled={loading}
                    >
                        <X className="w-3.5 h-3.5" />Cancel — keep existing
                    </Button>
                    <Button
                        variant="destructive"
                        className="flex-1 h-9 gap-2"
                        onClick={onConfirm}
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Yes, proceed
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ── Structured result view ────────────────────────────────────────────────────

const TASK_TYPE_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    deployment:     { icon: <Rocket className="w-4 h-4" />,   label: "Deployment",     color: "text-blue-400 bg-blue-400/10 border-blue-400/30" },
    docker:         { icon: <Container className="w-4 h-4" />, label: "Docker",         color: "text-cyan-400 bg-cyan-400/10 border-cyan-400/30" },
    debugging:      { icon: <Activity className="w-4 h-4" />, label: "Debugging",      color: "text-orange-400 bg-orange-400/10 border-orange-400/30" },
    monitoring:     { icon: <Cpu className="w-4 h-4" />,      label: "Monitoring",     color: "text-violet-400 bg-violet-400/10 border-violet-400/30" },
    database:       { icon: <Database className="w-4 h-4" />, label: "Database",       color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30" },
    networking:     { icon: <Globe className="w-4 h-4" />,    label: "Networking",     color: "text-sky-400 bg-sky-400/10 border-sky-400/30" },
    infrastructure: { icon: <Server className="w-4 h-4" />,   label: "Infrastructure", color: "text-amber-400 bg-amber-400/10 border-amber-400/30" },
    inspection:     { icon: <ListChecks className="w-4 h-4" />, label: "Inspection",   color: "text-primary bg-primary/10 border-primary/30" },
    general:        { icon: <Bot className="w-4 h-4" />,       label: "Agent",         color: "text-primary bg-primary/10 border-primary/30" },
};

const SECTION_CONFIG: Record<string, { icon: React.ReactNode; border: string; bg: string; badge: string; defaultOpen: boolean }> = {
    errors:          { icon: <ShieldAlert className="w-3.5 h-3.5" />,  border: "border-destructive/40", bg: "bg-destructive/5", badge: "bg-destructive/10 text-destructive border-destructive/30", defaultOpen: true },
    warnings:        { icon: <AlertTriangle className="w-3.5 h-3.5" />, border: "border-amber-500/40",  bg: "bg-amber-500/5",   badge: "bg-amber-500/10 text-amber-500 border-amber-500/30",   defaultOpen: true },
    results:         { icon: <CheckCircle className="w-3.5 h-3.5" />,  border: "border-primary/30",    bg: "bg-primary/5",     badge: "bg-primary/10 text-primary border-primary/20",          defaultOpen: true },
    summary:         { icon: <Bot className="w-3.5 h-3.5" />,          border: "border-border",        bg: "bg-muted/20",      badge: "bg-muted text-muted-foreground border-border",           defaultOpen: true },
    fixes:           { icon: <Wrench className="w-3.5 h-3.5" />,       border: "border-border",        bg: "bg-muted/10",      badge: "bg-muted text-muted-foreground border-border",           defaultOpen: false },
    recommendations: { icon: <Lightbulb className="w-3.5 h-3.5" />,   border: "border-border",        bg: "bg-muted/10",      badge: "bg-muted text-muted-foreground border-border",           defaultOpen: false },
    execution:       { icon: <Terminal className="w-3.5 h-3.5" />,     border: "border-border/50",     bg: "bg-muted/5",       badge: "bg-muted/60 text-muted-foreground border-border",        defaultOpen: false },
};

function SectionEntry({ type, content }: { type: string; content: string }) {
    const containers = parseContainerBlock(content);
    if (containers) return <ContainerListCard containers={containers} />;

    switch (type) {
        case "command":
            return (
                <div className="my-1 bg-muted/40 border border-border rounded-md px-3 py-1.5 font-mono text-xs text-foreground break-all">
                    $ {content}
                </div>
            );
        case "output":
            return (
                <div className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {content}
                </div>
            );
        case "success":
            return (
                <div className="flex items-start gap-2 text-primary py-0.5">
                    <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="text-sm">{content}</span>
                </div>
            );
        case "error":
            return (
                <div className="flex items-start gap-2 text-destructive py-0.5">
                    <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="text-sm font-mono whitespace-pre-wrap">{content}</span>
                </div>
            );
        case "retry":
            return (
                <div className="flex items-center gap-2 py-0.5">
                    <RotateCcw className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="text-sm text-amber-500">{content}</span>
                </div>
            );
        case "ai":
        default:
            return (
                <p className="text-sm text-foreground/90 leading-relaxed py-0.5">{content}</p>
            );
    }
}

function ResultSection({ section }: { section: LogSection }) {
    const cfg = SECTION_CONFIG[section.id] ?? SECTION_CONFIG.summary;
    const [open, setOpen] = useState(cfg.defaultOpen);

    return (
        <div className={cn("rounded-lg border overflow-hidden", cfg.border)}>
            {/* Section header */}
            <button
                onClick={() => setOpen(v => !v)}
                className={cn("w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/30", cfg.bg)}
            >
                <span className={cn("shrink-0", section.id === "errors" ? "text-destructive" : section.id === "warnings" ? "text-amber-500" : section.id === "results" ? "text-primary" : "text-muted-foreground")}>
                    {cfg.icon}
                </span>
                <span className="text-sm font-medium flex-1">{section.title}</span>
                <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full border", cfg.badge)}>
                    {section.entries.length}
                </span>
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
            </button>

            {/* Section content */}
            {open && (
                <div className={cn("px-3 py-3 space-y-1.5 border-t", cfg.border, "border-opacity-50")}>
                    {section.entries.map((e, i) => (
                        <SectionEntry key={i} type={e.type} content={e.content} />
                    ))}
                </div>
            )}
        </div>
    );
}

function StructuredResultView({
    result,
    rawLogs,
    onNewTask,
}: {
    result: StructuredResult;
    rawLogs: LogEntry[];
    onNewTask: () => void;
}) {
    const [showRaw, setShowRaw] = useState(false);
    const taskCfg = TASK_TYPE_CONFIG[result.taskType] ?? TASK_TYPE_CONFIG.general;

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="p-4 space-y-3">
                {/* Task type + status banner */}
                <div className={cn("rounded-xl border p-4", result.success ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5")}>
                    <div className="flex items-start gap-3">
                        <div className={cn("p-2 rounded-lg border shrink-0", taskCfg.color)}>
                            {taskCfg.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className={cn("text-[10px] font-semibold px-2 py-0 rounded-full uppercase tracking-wider", taskCfg.color)}>
                                    {taskCfg.label}
                                </Badge>
                                {result.success ? (
                                    <Badge variant="outline" className="text-[10px] px-2 py-0 rounded-full bg-primary/10 text-primary border-primary/20">
                                        ✓ Completed
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="text-[10px] px-2 py-0 rounded-full bg-destructive/10 text-destructive border-destructive/30">
                                        ✗ Failed
                                    </Badge>
                                )}
                            </div>
                            <p className="text-sm font-medium text-foreground mt-1.5 leading-snug">{result.intent}</p>
                            {result.summary && result.summary !== result.intent && (
                                <p className="text-xs text-muted-foreground mt-1">{result.summary}</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Sections */}
                {result.sections.map(s => (
                    <ResultSection key={s.id} section={s} />
                ))}

                {/* Raw log toggle */}
                <div className="rounded-lg border border-border/50 overflow-hidden">
                    <button
                        onClick={() => setShowRaw(v => !v)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
                    >
                        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium text-muted-foreground flex-1">Raw Execution Log</span>
                        <span className="text-[10px] text-muted-foreground">{rawLogs.length} lines</span>
                        {showRaw ? <EyeOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <Eye className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    </button>
                    {showRaw && (
                        <div className="border-t border-border/50 p-3 space-y-0.5 max-h-80 overflow-y-auto bg-background">
                            {rawLogs.map((entry, i) => <LogLine key={i} entry={entry} />)}
                        </div>
                    )}
                </div>

                {/* New task button */}
                <Button variant="outline" className="w-full gap-2 h-9" onClick={onNewTask}>
                    <Send className="w-3.5 h-3.5" />New Task
                </Button>
            </div>
        </div>
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
    structuredResult, onClearResult,
}: {
    logs: LogEntry[]; running: boolean; dockerMissing: boolean;
    onInstallDocker: () => void; prompt: string; setPrompt: (v: string) => void;
    onRun: (text?: string) => void; onCancel: () => void;
    textareaRef: React.RefObject<HTMLTextAreaElement>; isMobile: boolean;
    structuredResult: StructuredResult | null;
    onClearResult: () => void;
}) {
    const logEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

    // Show structured result if available and not actively running
    const showStructured = !!structuredResult && !running;

    return (
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
            {/* Output area — live log OR structured result */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">

                {/* Header bar */}
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="flex gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-border" />
                            <span className="w-2 h-2 rounded-full bg-border" />
                            <span className="w-2 h-2 rounded-full bg-border" />
                        </div>
                        <Terminal className="w-3.5 h-3.5 text-muted-foreground ml-1" />
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            {showStructured ? "Result" : "Live Output"}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
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
                </div>

                {/* Structured result view */}
                {showStructured && (
                    <StructuredResultView
                        result={structuredResult}
                        rawLogs={logs}
                        onNewTask={onClearResult}
                    />
                )}

                {/* Live log view — shown while running or when no result yet */}
                {!showStructured && (
                    <div className="flex-1 overflow-y-auto min-h-0">
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
                )}
            </div>

            {/* Prompt bar — hidden when showing structured result (use "New Task" button instead) */}
            {!showStructured && (
                <div className="border-t border-border px-4 py-3 bg-background space-y-2 shrink-0">
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
            )}
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
    const [running, setRunning]             = useState(false);
    const [agentId, setAgentId]             = useState<string | null>(null);
    const [dockerMissing, setDockerMissing] = useState(false);
    const [historyKey, setHistoryKey]       = useState(0);
    const [openSheet, setOpenSheet]         = useState<Sheet>(null);
    const [structuredResult, setStructuredResult] = useState<StructuredResult | null>(null);
    const [confirmRequest, setConfirmRequest]     = useState<ConfirmRequest | null>(null);
    const [confirmLoading, setConfirmLoading]     = useState(false);
    const [inputRequest, setInputRequest]         = useState<InputRequest | null>(null);
    const [inputLoading, setInputLoading]         = useState(false);

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
        const onStructured = (data: { agentId: string } & StructuredResult) => {
            if (currentAgent.current && data.agentId !== currentAgent.current) return;
            setStructuredResult({
                taskType: data.taskType,
                intent:   data.intent,
                success:  data.success,
                summary:  data.summary,
                sections: data.sections,
            });
        };
        const onConfirmRequired = (data: { agentId: string; title: string; message: string }) => {
            if (currentAgent.current && data.agentId !== currentAgent.current) return;
            setConfirmRequest({ agentId: data.agentId, title: data.title, message: data.message });
        };
        const onInputRequired = (data: InputRequest) => {
            if (currentAgent.current && data.agentId !== currentAgent.current) return;
            setInputRequest(data);
        };
        socket.on("agent:log", onLog);
        socket.on("agent:done", onDone);
        socket.on("agent:structured_result", onStructured);
        socket.on("agent:confirm_required", onConfirmRequired);
        socket.on("agent:input_required", onInputRequired);
        return () => {
            socket.off("agent:log", onLog);
            socket.off("agent:done", onDone);
            socket.off("agent:structured_result", onStructured);
            socket.off("agent:confirm_required", onConfirmRequired);
            socket.off("agent:input_required", onInputRequired);
        };
    }, []);

    const run = useCallback(async (text?: string) => {
        const msg = (text ?? prompt).trim();
        if (!msg || running) return;
        setLogs([]); setRunning(true); setDockerMissing(false); setPrompt(""); setStructuredResult(null);
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

    const clearResult = useCallback(() => {
        setStructuredResult(null);
        setLogs([]);
        setTimeout(() => textareaRef.current?.focus(), 50);
    }, []);

    const sendConfirm = useCallback(async (confirmed: boolean) => {
        if (!confirmRequest) return;
        setConfirmLoading(true);
        try {
            await apiFetch("/agent/confirm", {
                method: "POST",
                body: JSON.stringify({ agentId: confirmRequest.agentId, confirmed }),
            });
        } catch { /* non-fatal */ }
        setConfirmLoading(false);
        setConfirmRequest(null);
    }, [confirmRequest]);

    const sendInput = useCallback(async (values: Record<string, string>) => {
        if (!inputRequest) return;
        setInputLoading(true);
        try {
            await apiFetch("/agent/input", {
                method: "POST",
                body: JSON.stringify({ agentId: inputRequest.agentId, values }),
            });
        } catch { /* non-fatal */ }
        setInputLoading(false);
        setInputRequest(null);
    }, [inputRequest]);

    const cancelInput = useCallback(async () => {
        if (!inputRequest) return;
        setInputLoading(true);
        try {
            await apiFetch("/agent/input", {
                method: "POST",
                body: JSON.stringify({ agentId: inputRequest.agentId, values: null }),
            });
        } catch { /* non-fatal */ }
        setInputLoading(false);
        setInputRequest(null);
        setRunning(false);
    }, [inputRequest]);

    const chatProps = {
        logs, running, dockerMissing, onInstallDocker: installDocker,
        prompt, setPrompt, onRun: run, onCancel: cancel,
        textareaRef, isMobile: !!isMobile,
        structuredResult, onClearResult: clearResult,
    };

    return (
        <div className="min-h-screen bg-background text-foreground flex">
            {inputRequest && (
                <AgentInputModal
                    request={inputRequest}
                    onSubmit={sendInput}
                    onCancel={cancelInput}
                    loading={inputLoading}
                />
            )}
            {confirmRequest && (
                <AgentConfirmModal
                    request={confirmRequest}
                    onConfirm={() => sendConfirm(true)}
                    onCancel={() => sendConfirm(false)}
                    loading={confirmLoading}
                />
            )}
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
