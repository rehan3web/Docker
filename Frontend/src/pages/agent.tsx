import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    Bot, Send, Square, RefreshCw, Star, CheckCircle, XCircle,
    RotateCcw, AlertTriangle, Info, Terminal,
    BookOpen, History, Database, ChevronDown, ChevronRight,
    Play, Loader2, Copy, Check, Search, Tag, Package,
    Trash2, X, Zap, Sun, Moon, Container, PlugZap,
    Layers, FileText, Network, HardDrive, Wrench, Lightbulb,
    ShieldAlert, ListChecks, Eye, EyeOff, Rocket, Activity,
    Cpu, Server, Globe, Clock, BrainCircuit, ListOrdered,
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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

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

interface ChatMessage {
    id: string;
    userText: string;
    sections: LogSection[];
    done: boolean;
    success: boolean;
    taskType: string;
    intent: string;
    summary: string;
    rawLogs: LogEntry[];
    status: "running" | "queued" | "done" | "failed" | "cancelled";
    queueId?: string;
    queuePosition?: number;
    usedMemory?: boolean;
    memoryCount?: number;
    ragCount?: number;
}

interface ConfirmRequest {
    agentId: string;
    title: string;
    message: string;
    showNewPortOption?: boolean;
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

// ── Shared markdown renderer (same style as ai.tsx) ───────────────────────────

function AgentMarkdown({ content }: { content: string }) {
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const copyCode = (text: string, id: string) => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };
    return (
        <div className="text-sm leading-relaxed text-foreground/90 prose prose-neutral dark:prose-invert max-w-none prose-sm">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    code({ node, inline, className, children, ...props }: any) {
                        const langMatch = /language-(\w+)/.exec(className || "");
                        const codeStr = String(children).replace(/\n$/, "");
                        const codeId = codeStr.slice(0, 24);
                        if (!inline && langMatch) {
                            return (
                                <div className="relative my-3 rounded-xl overflow-hidden border border-border bg-zinc-950 shadow-lg">
                                    <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-white/5">
                                        <div className="flex items-center gap-2">
                                            <div className="flex gap-1.5">
                                                <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                                                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                                                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                                            </div>
                                            <span className="text-[10px] font-bold text-white/40 tracking-widest uppercase ml-1">{langMatch[1]}</span>
                                        </div>
                                        <button
                                            onClick={() => copyCode(codeStr, codeId)}
                                            className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/10 transition-colors text-white/50 hover:text-white text-[11px] font-medium"
                                        >
                                            {copiedId === codeId
                                                ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copied</>
                                                : <><Copy className="w-3.5 h-3.5" /> Copy</>
                                            }
                                        </button>
                                    </div>
                                    <SyntaxHighlighter
                                        style={vscDarkPlus}
                                        language={langMatch[1]}
                                        PreTag="div"
                                        customStyle={{ margin: 0, padding: "1.25rem", fontSize: "13px", lineHeight: "1.6", background: "transparent" }}
                                        {...props}
                                    >
                                        {codeStr}
                                    </SyntaxHighlighter>
                                </div>
                            );
                        }
                        return (
                            <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[13px] font-mono" {...props}>
                                {children}
                            </code>
                        );
                    },
                    p:          ({ children }) => <p className="mb-3 last:mb-0 leading-7">{children}</p>,
                    ul:         ({ children }) => <ul className="mb-3 space-y-1 pl-4 list-disc">{children}</ul>,
                    ol:         ({ children }) => <ol className="mb-3 space-y-1 pl-4 list-decimal">{children}</ol>,
                    li:         ({ children }) => <li className="leading-6">{children}</li>,
                    h1:         ({ children }) => <h1 className="text-base font-bold mt-4 mb-2">{children}</h1>,
                    h2:         ({ children }) => <h2 className="text-sm font-bold mt-3 mb-1.5">{children}</h2>,
                    h3:         ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
                    blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-4 text-muted-foreground italic my-3">{children}</blockquote>,
                    table:      ({ children }) => (
                        <div className="my-3 overflow-x-auto rounded-lg border border-border">
                            <table className="text-xs w-full">{children}</table>
                        </div>
                    ),
                    th: ({ children }) => <th className="px-3 py-2 bg-muted/50 font-semibold text-left border-b border-border">{children}</th>,
                    td: ({ children }) => <td className="px-3 py-2 border-b border-border/50">{children}</td>,
                    a:  ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline underline-offset-2">{children}</a>
                    ),
                }}
            >
                {content}
            </ReactMarkdown>
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
                    <AgentMarkdown content={entry.content} />
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

// ── Live log → section routing ────────────────────────────────────────────────

const LOG_SECTION_MAP: Record<string, { id: string; title: string }> = {
    thinking:       { id: "planning",     title: "Planning"     },
    info:           { id: "status",       title: "Status"       },
    command:        { id: "commands",     title: "Commands"     },
    output:         { id: "commands",     title: "Commands"     },
    success:        { id: "results",      title: "Results"      },
    error:          { id: "errors",       title: "Errors"       },
    ai:             { id: "summary",      title: "Task Summary" },
    verify:         { id: "verification", title: "Verification" },
    retry:          { id: "warnings",     title: "Warnings"     },
    docker_missing: { id: "errors",       title: "Errors"       },
};
function logSectionFor(type: string) {
    return LOG_SECTION_MAP[type] ?? { id: "status", title: "Status" };
}

// ── History detail modal ───────────────────────────────────────────────────────

function HistoryDetailModal({ task, onClose, onRerun }: {
    task: AgentTask;
    onClose: () => void;
    onRerun: (intent: string) => void;
}) {
    const [detail, setDetail] = useState<AgentTaskDetail | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch<AgentTaskDetail>(`/agent/tasks/${task.id}`)
            .then(d => setDetail(d))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [task.id]);

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
            <div className="flex items-center gap-3 px-4 h-14 border-b border-border shrink-0">
                <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted">
                    <X className="w-5 h-5" />
                </button>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{task.intent}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtRelative(task.created_at)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {task.status === "completed" && <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-primary/10 text-primary border-primary/20">✓ Done</Badge>}
                    {task.status === "failed"    && <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-destructive/10 text-destructive border-destructive/30">✗ Failed</Badge>}
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => { onRerun(task.intent); onClose(); }}>
                        <RotateCcw className="w-3 h-3" />Re-run
                    </Button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
                <div className="max-w-3xl mx-auto space-y-4">
                    <div className="flex justify-end">
                        <div className="max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed">
                            {task.intent}
                        </div>
                    </div>
                    <div className="flex gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                            <Bot className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                            {loading && <div className="text-sm text-muted-foreground py-2">Loading…</div>}
                            {detail && (
                                <div className="rounded-xl border border-border bg-muted/10 overflow-hidden">
                                    <div className="p-3 space-y-0.5 max-h-[70vh] overflow-y-auto">
                                        {(detail.log_json || []).map((line, i) => {
                                            let type: LogEntry["type"] = "info";
                                            let content = line;
                                            if (line.startsWith("$ "))           { type = "command"; content = line.slice(2); }
                                            else if (line.startsWith("[ok] "))    { type = "success"; content = line.slice(5); }
                                            else if (line.startsWith("[error] ")) { type = "error";   content = line.slice(8); }
                                            else if (line.startsWith("[ai] "))    { type = "ai";      content = line.slice(5); }
                                            else if (line.startsWith("[info] "))  { type = "info";    content = line.slice(7); }
                                            return <LogLine key={i} entry={{ type, content, ts: 0 }} />;
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── History panel ─────────────────────────────────────────────────────────────

function HistoryPanel({ onRerun }: { onRerun: (intent: string) => void }) {
    const [tasks, setTasks] = useState<AgentTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewTask, setViewTask] = useState<AgentTask | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try { const d = await apiFetch<AgentTask[]>("/agent/tasks"); setTasks(d); }
        catch { } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <>
            {viewTask && (
                <HistoryDetailModal task={viewTask} onClose={() => setViewTask(null)} onRerun={onRerun} />
            )}
            <div className="flex flex-col h-full gap-3">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Recent Tasks</span>
                </div>
                <div className="overflow-y-auto flex-1 space-y-1.5">
                    {loading && <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>}
                    {!loading && tasks.length === 0 && <div className="text-sm text-muted-foreground py-10 text-center">No tasks yet</div>}
                    {tasks.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setViewTask(t)}
                            className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors"
                        >
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
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        </button>
                    ))}
                </div>
            </div>
        </>
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
    onNewPort,
    onCancel,
    loading,
}: {
    request: ConfirmRequest;
    onConfirm: () => void;
    onNewPort: () => void;
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
                <div className={`grid gap-2 px-5 pb-5 ${request.showNewPortOption ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {request.showNewPortOption && (
                        <Button
                            className="h-9 gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={onNewPort}
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            Use Different Port — keep existing running
                        </Button>
                    )}
                    <div className={`flex gap-2 ${request.showNewPortOption ? '' : 'contents'}`}>
                        <Button
                            variant="outline"
                            className="flex-1 h-9 gap-2 border-border text-muted-foreground hover:text-foreground"
                            onClick={onCancel}
                            disabled={loading}
                        >
                            <X className="w-3.5 h-3.5" />Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            className="flex-1 h-9 gap-2"
                            onClick={onConfirm}
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Remove & Replace
                        </Button>
                    </div>
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
    planning:        { icon: <Search className="w-3.5 h-3.5" />,       border: "border-border/50",     bg: "bg-muted/5",       badge: "bg-muted/60 text-muted-foreground border-border",        defaultOpen: true  },
    status:          { icon: <Info className="w-3.5 h-3.5" />,         border: "border-border/50",     bg: "bg-muted/5",       badge: "bg-muted/60 text-muted-foreground border-border",        defaultOpen: true  },
    commands:        { icon: <Terminal className="w-3.5 h-3.5" />,     border: "border-border/50",     bg: "bg-muted/5",       badge: "bg-muted/60 text-muted-foreground border-border",        defaultOpen: true  },
    verification:    { icon: <CheckCircle className="w-3.5 h-3.5" />,  border: "border-border/50",     bg: "bg-muted/5",       badge: "bg-muted/60 text-muted-foreground border-border",        defaultOpen: true  },
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
            return <AgentMarkdown content={content} />;
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

// ── Raw log toggle ────────────────────────────────────────────────────────────

function RawLogToggle({ logs }: { logs: LogEntry[] }) {
    const [show, setShow] = useState(false);
    if (logs.length === 0) return null;
    return (
        <div className="rounded-lg border border-border/50 overflow-hidden">
            <button
                onClick={() => setShow(v => !v)}
                className="w-full flex items-center gap-2 px-3 py-2 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
            >
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium text-muted-foreground flex-1">Raw Execution Log</span>
                <span className="text-[10px] text-muted-foreground">{logs.length} lines</span>
                {show ? <EyeOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <Eye className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            </button>
            {show && (
                <div className="border-t border-border/50 p-3 space-y-0.5 max-h-60 overflow-y-auto bg-background">
                    {logs.map((entry, i) => <LogLine key={i} entry={entry} />)}
                </div>
            )}
        </div>
    );
}

// ── Chat message view (one user + agent pair) ─────────────────────────────────

function ChatMessageView({ message, isLast, running, onCancelQueue }: {
    message: ChatMessage;
    isLast: boolean;
    running: boolean;
    onCancelQueue?: (queueId: string) => void;
}) {
    const isQueued    = message.status === "queued";
    const isStreaming = message.status === "running" && !message.done;

    return (
        <div className="flex flex-col gap-3">
            {/* User bubble */}
            <div className="flex justify-end">
                <div className="relative max-w-[85%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed">
                    {message.userText}
                </div>
            </div>

            {/* Agent response */}
            <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                    {isQueued
                        ? <Clock className="w-3.5 h-3.5 text-amber-400" />
                        : isStreaming
                        ? <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                        : <Bot className="w-3.5 h-3.5 text-primary" />
                    }
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                    {isQueued ? (
                        /* ── Queued waiting state ── */
                        <div className="flex items-center gap-3 py-2 px-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                            <ListOrdered className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <span className="text-xs font-semibold text-amber-400">
                                    Queued #{message.queuePosition}
                                </span>
                                <span className="text-xs text-muted-foreground ml-2">
                                    — waiting for current task to finish
                                </span>
                            </div>
                            {message.queueId && onCancelQueue && (
                                <button
                                    onClick={() => onCancelQueue(message.queueId!)}
                                    title="Remove from queue"
                                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0 p-0.5 rounded"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    ) : (
                        <>
                            {/* Sections — build up in real-time */}
                            {message.sections.map(section => (
                                <ResultSection key={section.id} section={section} />
                            ))}

                            {/* Typing dots while waiting for first log */}
                            {isStreaming && message.sections.length === 0 && (
                                <div className="flex items-center gap-1 py-2 px-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                                </div>
                            )}

                            {/* Raw log after task completes */}
                            {message.done && <RawLogToggle logs={message.rawLogs} />}
                        </>
                    )}
                </div>
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
    messages, running, dockerMissing, onInstallDocker,
    prompt, setPrompt, onRun, onCancel, onCancelQueue, textareaRef, isMobile, queueCount,
}: {
    messages: ChatMessage[]; running: boolean; dockerMissing: boolean;
    onInstallDocker: () => void; prompt: string; setPrompt: (v: string) => void;
    onRun: (text?: string) => void; onCancel: () => void;
    onCancelQueue: (queueId: string) => void;
    textareaRef: React.RefObject<HTMLTextAreaElement>; isMobile: boolean;
    queueCount: number;
}) {
    const bottomRef = useRef<HTMLDivElement>(null);
    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

    return (
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
            {/* Scrollable message list */}
            <div className="flex-1 overflow-y-auto min-h-0">
                <div className="p-4 space-y-6 max-w-3xl mx-auto">
                    {/* Empty state */}
                    {messages.length === 0 && !running && (
                        <div className="flex flex-col items-center justify-center gap-6 text-center py-16 px-4">
                            <div className="p-3 rounded-2xl bg-primary/10 border border-primary/20">
                                <Bot className="w-8 h-8 text-primary" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-normal tracking-tight text-foreground">Docklet Agent</h2>
                                <p className="text-sm text-muted-foreground mt-2 max-w-xs leading-relaxed">
                                    Describe any Docker task in plain English. The agent plans, executes, and self-heals.
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

                    {/* Message pairs */}
                    {messages.map((msg, i) => (
                        <ChatMessageView
                            key={msg.id}
                            message={msg}
                            isLast={i === messages.length - 1}
                            running={running}
                            onCancelQueue={onCancelQueue}
                        />
                    ))}

                    {/* Docker missing banner */}
                    {dockerMissing && (
                        <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
                            <p className="text-sm font-semibold text-amber-500 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />Docker Not Available
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 mb-3">Docker is not installed or not running on this host.</p>
                            <Button variant="outline" className="h-8 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/10 gap-2" onClick={onInstallDocker}>
                                <Zap className="w-3.5 h-3.5" />Install Docker Automatically
                            </Button>
                        </div>
                    )}

                    <div ref={bottomRef} />
                </div>
            </div>

            {/* Prompt bar — always visible */}
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
                {/* Queue indicator strip */}
                {queueCount > 0 && (
                    <div className="flex items-center gap-2 px-1 text-xs text-amber-400">
                        <ListOrdered className="w-3.5 h-3.5 shrink-0" />
                        <span>{queueCount} message{queueCount > 1 ? "s" : ""} waiting in queue</span>
                    </div>
                )}
                <div className="flex gap-2 items-end">
                    <textarea
                        ref={textareaRef}
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onRun(); } }}
                        placeholder={running
                            ? "Type next task… it will be queued automatically"
                            : "Describe a Docker task… (Enter to run, Shift+Enter for newline)"
                        }
                        rows={2}
                        className="flex-1 resize-none text-sm rounded-lg border border-border bg-muted/30 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground font-sans"
                    />
                    <div className="flex flex-col gap-1 shrink-0">
                        {running && (
                            <Button variant="destructive" size="icon" className="h-9 w-10 rounded-lg" onClick={onCancel} title="Stop current task">
                                <Square className="w-4 h-4" />
                            </Button>
                        )}
                        <Button
                            size="icon"
                            className={cn("rounded-lg w-10 h-9", running ? "bg-amber-500 hover:bg-amber-600 text-white" : "")}
                            onClick={() => onRun()}
                            disabled={!prompt.trim()}
                            title={running ? `Queue message (#${queueCount + 1})` : "Run"}
                        >
                            {running ? <ListOrdered className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                        </Button>
                    </div>
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
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [running, setRunning]             = useState(false);
    const [agentId, setAgentId]             = useState<string | null>(null);
    const [dockerMissing, setDockerMissing] = useState(false);
    const [historyKey, setHistoryKey]       = useState(0);
    const [openSheet, setOpenSheet]         = useState<Sheet>(null);
    const [confirmRequest, setConfirmRequest]     = useState<ConfirmRequest | null>(null);
    const [confirmLoading, setConfirmLoading]     = useState(false);
    const [inputRequest, setInputRequest]         = useState<InputRequest | null>(null);
    const [inputLoading, setInputLoading]         = useState(false);
    const [queueCount, setQueueCount]       = useState(0);
    const [memoryStats, setMemoryStats]     = useState<{ memoryCount: number; ragCount: number } | null>(null);

    const textareaRef  = useRef<HTMLTextAreaElement>(null);
    const currentAgent = useRef<string | null>(null);

    // Load memory stats on mount
    useEffect(() => {
        apiFetch<{ memoryCount: number; ragCount: number }>("/agent/memory/stats")
            .then(s => setMemoryStats(s))
            .catch(() => {});
    }, []);

    useEffect(() => {
        const socket = getSocket();

        // ── Find message by agentId (search from end) ─────────────────────────
        const findIdx = (prev: ChatMessage[], agentId: string) => {
            for (let i = prev.length - 1; i >= 0; i--) {
                if (prev[i].id === agentId) return i;
            }
            return -1;
        };

        // ── Streaming log (classifies into live sections) ──────────────────────
        const onLog = (data: { agentId: string; type: LogEntry["type"]; content: string }) => {
            const sec   = logSectionFor(data.type);
            const entry = { type: data.type, content: data.content };
            const rawLog: LogEntry = { ...entry, ts: Date.now() };
            setMessages(prev => {
                const idx = findIdx(prev, data.agentId);
                if (idx < 0) return prev;
                const msg   = prev[idx];
                const sIdx  = msg.sections.findIndex(s => s.id === sec.id);
                const newSections: LogSection[] = sIdx >= 0
                    ? msg.sections.map((s, i) => i === sIdx ? { ...s, entries: [...s.entries, entry] } : s)
                    : [...msg.sections, { id: sec.id, title: sec.title, priority: "normal" as const, entries: [entry] }];
                const updated = { ...msg, sections: newSections, rawLogs: [...msg.rawLogs, rawLog] };
                return [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
            });
        };

        // ── Task done ─────────────────────────────────────────────────────────
        const onDone = (data: { agentId: string; success: boolean; summary: string; dockerMissing?: boolean }) => {
            if (data.dockerMissing) { setDockerMissing(true); }
            else {
                if (data.success) toast.success("Task completed");
                else toast.error("Task ended with errors");
                setHistoryKey(k => k + 1);
            }
            setMessages(prev => {
                const idx = findIdx(prev, data.agentId);
                if (idx < 0) return prev;
                const updated = {
                    ...prev[idx],
                    done: true,
                    success: data.success,
                    status: (data.success ? "done" : "failed") as ChatMessage["status"],
                };
                const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
                // Update running: true only if any message is still running
                const stillRunning = next.some(m => m.status === "running");
                setRunning(stillRunning);
                return next;
            });
        };

        // ── Structured result replaces live sections with final classified result
        const onStructured = (data: { agentId: string } & StructuredResult) => {
            setMessages(prev => {
                const idx = findIdx(prev, data.agentId);
                if (idx < 0) return prev;
                const updated = {
                    ...prev[idx],
                    sections: data.sections,
                    taskType: data.taskType,
                    intent: data.intent,
                    summary: data.summary,
                    success: data.success,
                };
                return [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
            });
        };

        // ── Queue events ──────────────────────────────────────────────────────
        const onQueued = (data: { agentId: string; queueId: string; position: number; message: string }) => {
            setMessages(prev => {
                const idx = findIdx(prev, data.agentId);
                if (idx >= 0) {
                    // Already pre-added by run() — just update status/queue info
                    const updated = {
                        ...prev[idx],
                        status: "queued" as ChatMessage["status"],
                        queueId: data.queueId,
                        queuePosition: data.position,
                    };
                    return [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
                }
                // Not found (e.g. another tab) — add fresh
                setQueueCount(q => q + 1);
                return [...prev, {
                    id: data.agentId, userText: data.message, sections: [], done: false,
                    success: false, taskType: "general", intent: data.message, summary: "",
                    rawLogs: [], status: "queued" as ChatMessage["status"],
                    queueId: data.queueId, queuePosition: data.position,
                }];
            });
        };

        const onDequeued = (data: { agentId: string; queueId: string }) => {
            setQueueCount(prev => Math.max(0, prev - 1));
            setRunning(true);
            setMessages(prev => prev.map(m =>
                m.id === data.agentId
                    ? { ...m, status: "running" as ChatMessage["status"], queueId: undefined, queuePosition: undefined }
                    : m
            ));
        };

        const onQueueUpdate = (data: { items: { agentId: string; queueId: string; position: number }[] }) => {
            setQueueCount(data.items.length);
            setMessages(prev => prev.map(m => {
                const qi = data.items.find(q => q.agentId === m.id);
                return qi ? { ...m, queuePosition: qi.position } : m;
            }));
        };

        const onQueueCancelled = (data: { queueId: string }) => {
            setQueueCount(prev => Math.max(0, prev - 1));
            setMessages(prev => prev.map(m =>
                m.queueId === data.queueId
                    ? { ...m, status: "cancelled" as ChatMessage["status"], done: true }
                    : m
            ));
        };

        // ── Memory used notification ───────────────────────────────────────────
        const onMemoryUsed = (data: { agentId: string; memoryCount: number; ragCount: number }) => {
            setMessages(prev => prev.map(m =>
                m.id === data.agentId
                    ? { ...m, usedMemory: true, memoryCount: data.memoryCount, ragCount: data.ragCount }
                    : m
            ));
            // Refresh memory stats
            apiFetch<{ memoryCount: number; ragCount: number }>("/agent/memory/stats")
                .then(s => setMemoryStats(s)).catch(() => {});
        };

        const onConfirmRequired = (data: { agentId: string; title: string; message: string; showNewPortOption?: boolean }) => {
            setConfirmRequest({ agentId: data.agentId, title: data.title, message: data.message, showNewPortOption: data.showNewPortOption });
        };
        const onInputRequired = (data: InputRequest) => {
            setInputRequest(data);
        };

        socket.on("agent:log",              onLog);
        socket.on("agent:done",             onDone);
        socket.on("agent:structured_result",onStructured);
        socket.on("agent:queued",           onQueued);
        socket.on("agent:dequeued",         onDequeued);
        socket.on("agent:queue_update",     onQueueUpdate);
        socket.on("agent:queue_cancelled",  onQueueCancelled);
        socket.on("agent:memory_used",      onMemoryUsed);
        socket.on("agent:confirm_required", onConfirmRequired);
        socket.on("agent:input_required",   onInputRequired);

        return () => {
            socket.off("agent:log",              onLog);
            socket.off("agent:done",             onDone);
            socket.off("agent:structured_result",onStructured);
            socket.off("agent:queued",           onQueued);
            socket.off("agent:dequeued",         onDequeued);
            socket.off("agent:queue_update",     onQueueUpdate);
            socket.off("agent:queue_cancelled",  onQueueCancelled);
            socket.off("agent:memory_used",      onMemoryUsed);
            socket.off("agent:confirm_required", onConfirmRequired);
            socket.off("agent:input_required",   onInputRequired);
        };
    }, []);

    const run = useCallback(async (text?: string) => {
        const msg = (text ?? prompt).trim();
        if (!msg) return;
        setDockerMissing(false); setPrompt(""); setOpenSheet(null);
        const id = `ag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        currentAgent.current = id; setAgentId(id);
        // Pre-add message (will be updated to 'queued' or 'running' by response)
        setMessages(prev => [...prev, {
            id, userText: msg, sections: [], done: false,
            success: false, taskType: "general", intent: msg, summary: "", rawLogs: [],
            status: "running" as ChatMessage["status"],
        }]);
        try {
            const res = await apiFetch<any>("/agent/run", { method: "POST", body: JSON.stringify({ message: msg, agentId: id }) });
            if (res.dockerMissing) {
                setDockerMissing(true);
            } else if (res.queued) {
                // Backend will emit agent:queued — but we already added the message above.
                // Update it to reflect queued state with correct position
                setMessages(prev => prev.map(m =>
                    m.id === id
                        ? { ...m, status: "queued" as ChatMessage["status"], queueId: res.queueId, queuePosition: res.position }
                        : m
                ));
                setQueueCount(prev => prev + 1);
            } else if (res.started) {
                setRunning(true);
            }
        } catch (e: any) {
            toast.error(e.message || "Failed to start agent");
            setMessages(prev => prev.map(m => m.id === id ? { ...m, done: true, status: "failed" as ChatMessage["status"] } : m));
        }
    }, [prompt]);

    const cancel = useCallback(async () => {
        if (!agentId) return;
        try { await apiFetch("/agent/cancel", { method: "POST", body: JSON.stringify({ agentId }) }); setRunning(false); }
        catch { }
    }, [agentId]);

    const cancelQueuedMessage = useCallback(async (queueId: string) => {
        try {
            await apiFetch(`/agent/queue/${queueId}`, { method: "DELETE" });
            // onQueueCancelled socket event will update state
        } catch (e: any) {
            toast.error("Failed to remove from queue");
        }
    }, []);

    const installDocker = useCallback(async () => {
        setDockerMissing(false); setRunning(true);
        const id = `ag_docker_${Date.now()}`;
        currentAgent.current = id; setAgentId(id);
        setMessages(prev => [...prev, {
            id, userText: "Install Docker automatically", sections: [], done: false,
            success: false, taskType: "infrastructure", intent: "Install Docker automatically", summary: "", rawLogs: [],
        }]);
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

    const sendConfirm = useCallback(async (confirmed: boolean | 'new_port') => {
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
        messages, running, dockerMissing, onInstallDocker: installDocker,
        prompt, setPrompt, onRun: run, onCancel: cancel,
        onCancelQueue: cancelQueuedMessage,
        textareaRef, isMobile: !!isMobile,
        queueCount,
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
                    onNewPort={() => sendConfirm('new_port')}
                    onCancel={() => sendConfirm(false)}
                    loading={confirmLoading}
                />
            )}
            <DesktopSidebar />

            <div className="flex-1 flex flex-col min-w-0">
                {/* Header — matches every other page exactly */}
                <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
                    <div className="px-4 h-18 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <MobileSidebarTrigger />
                            <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                                <Bot className="w-4 h-4 text-primary" />
                            </div>
                            <h1 className="font-semibold text-sm tracking-tight">Docklet Agent</h1>
                            <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-primary/10 text-primary border-primary/20 hidden sm:flex">AI</Badge>
                            {queueCount > 0 && (
                                <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-amber-500/10 text-amber-400 border-amber-400/30 hidden sm:flex items-center gap-1">
                                    <ListOrdered className="w-2.5 h-2.5" />{queueCount} queued
                                </Badge>
                            )}
                            {memoryStats && (memoryStats.memoryCount > 0 || memoryStats.ragCount > 0) && (
                                <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-violet-500/10 text-violet-400 border-violet-400/30 hidden sm:flex items-center gap-1" title={`${memoryStats.memoryCount} memory turns · ${memoryStats.ragCount} RAG entries`}>
                                    <BrainCircuit className="w-2.5 h-2.5" />Memory
                                </Badge>
                            )}
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
