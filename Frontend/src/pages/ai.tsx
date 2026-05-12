import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles, Bot, User, RotateCcw, Send, Loader2,
  ChevronDown, ChevronRight, AlertTriangle, Sun, Moon, Cpu,
  Lightbulb, Code2, BookOpen, Zap, Copy, Check, BrainCircuit,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useGetAiSettings, getToken } from "@/api/client";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { NVIDIA_MODELS } from "@/lib/ai-models";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

// ── Types ─────────────────────────────────────────────────────────────────────

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking: string;   // streams into this separately
  streaming?: boolean;
};

const CHAT_SYSTEM =
  "You are a helpful Docker, DevOps, and infrastructure assistant inside Docklet — a VPS/Docker/PostgreSQL management dashboard. " +
  "Help with container management, networking, debugging, SQL, shell commands, and infrastructure questions. " +
  "Be concise, practical, and give actionable answers. Use markdown for code blocks.";

const SUGGESTION_CARDS = [
  { icon: Lightbulb, title: "Brainstorm ideas",  desc: "for optimising my Docker setup"      },
  { icon: Code2,     title: "Write a script",    desc: "to backup PostgreSQL automatically"  },
  { icon: BookOpen,  title: "Explain a concept", desc: "how does container networking work?" },
  { icon: Zap,       title: "Troubleshoot",      desc: "why my container keeps restarting"   },
];

// ── Model dropdown ─────────────────────────────────────────────────────────────

function ModelDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const sel = NVIDIA_MODELS.find(m => m.value === value) ?? NVIDIA_MODELS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5 px-2.5 font-sans">
          <Cpu className="w-3 h-3 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-[110px]">{sel.label}</span>
          {sel.thinking && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/30 text-primary bg-primary/5 shrink-0 hidden sm:flex">T</Badge>
          )}
          <ChevronDown className="w-3 h-3 shrink-0 opacity-50 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[280px] rounded-xl p-1.5 shadow-xl">
        <p className="px-2.5 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Thinking / Reasoning</p>
        {NVIDIA_MODELS.filter(m => m.thinking).map(m => (
          <DropdownMenuItem key={m.value} className="px-2.5 py-2 rounded-lg cursor-pointer text-xs" onClick={() => onChange(m.value)}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn("font-medium truncate", m.value === value && "text-primary")}>{m.label}</span>
                {m.value === value && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
              </div>
              <span className="text-muted-foreground text-[11px]">{m.provider}</span>
            </div>
            <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 border-primary/30 text-primary bg-primary/5 ml-2">Thinking</Badge>
          </DropdownMenuItem>
        ))}
        <div className="my-1 border-t border-border/50" />
        <p className="px-2.5 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Fast / Instruction</p>
        {NVIDIA_MODELS.filter(m => !m.thinking).map(m => (
          <DropdownMenuItem key={m.value} className="px-2.5 py-2 rounded-lg cursor-pointer text-xs" onClick={() => onChange(m.value)}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn("font-medium truncate", m.value === value && "text-primary")}>{m.label}</span>
                {m.value === value && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
              </div>
              <span className="text-muted-foreground text-[11px]">{m.provider}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Suggestion cards ───────────────────────────────────────────────────────────

function SuggestionCards({ onSelect }: { onSelect: (text: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 px-4 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-1">
          <Sparkles className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">How can I help you today?</h2>
        <p className="text-sm text-muted-foreground">Ask anything about your containers, databases, or infrastructure.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        {SUGGESTION_CARDS.map(c => (
          <button
            key={c.title}
            onClick={() => onSelect(`${c.title} — ${c.desc}`)}
            className="flex items-start gap-3 text-left p-4 rounded-xl border border-border bg-card hover:bg-muted/50 hover:border-primary/30 transition-all group"
          >
            <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 shrink-0 group-hover:bg-primary/20 transition-colors">
              <c.icon className="w-3.5 h-3.5 text-primary" />
            </div>
            <div>
              <p className="text-xs font-semibold text-foreground">{c.title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{c.desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Message item ───────────────────────────────────────────────────────────────

function MessageItem({ message }: { message: ChatMsg }) {
  const [thinkingOpen, setThinkingOpen] = useState(true); // open while streaming
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Auto-collapse thinking block once streaming is done
  useEffect(() => {
    if (!message.streaming && message.thinking) {
      // leave open for a moment then collapse
      const t = setTimeout(() => setThinkingOpen(false), 1200);
      return () => clearTimeout(t);
    }
  }, [message.streaming, message.thinking]);

  const copyCode = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isUser = message.role === "user";

  return (
    <div className={cn(
      "flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300",
      isUser && "flex-row-reverse"
    )}>
      {/* Avatar */}
      <div className={cn(
        "h-8 w-8 rounded-full shrink-0 flex items-center justify-center border mt-0.5",
        isUser
          ? "bg-primary border-primary/20 text-primary-foreground"
          : "bg-primary/10 border-primary/20 text-primary"
      )}>
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Content */}
      <div className={cn("min-w-0", isUser ? "flex justify-end flex-1" : "flex-1 space-y-3")}>
        {isUser ? (
          <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed">
            {message.content}
          </div>
        ) : (
          <div className="max-w-[80%] space-y-3">
            {/* Role label */}
            <div className="text-xs font-semibold text-foreground/60 flex items-center gap-1.5">
              AI
              {message.streaming && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              )}
            </div>

            {/* ── Thinking block (streams first) ── */}
            {message.thinking && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 overflow-hidden">
                <button
                  onClick={() => setThinkingOpen(v => !v)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-xs font-medium text-primary/80 hover:bg-primary/10 transition-colors group"
                >
                  <BrainCircuit className={cn("w-3.5 h-3.5 transition-transform", message.streaming && "animate-pulse")} />
                  <span>{message.streaming && !message.content ? "Thinking…" : "Thinking Process"}</span>
                  {!message.streaming && (
                    <span className="text-[11px] opacity-60 font-normal">
                      ({message.thinking.split(/\s+/).filter(Boolean).length} words)
                    </span>
                  )}
                  {thinkingOpen
                    ? <ChevronDown className="w-3.5 h-3.5 ml-auto opacity-70" />
                    : <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-70" />
                  }
                </button>
                {thinkingOpen && (
                  <div className="px-4 py-3 text-[13px] text-foreground/70 whitespace-pre-wrap leading-relaxed border-t border-primary/10 bg-primary/5">
                    {message.thinking}
                    {message.streaming && !message.content && (
                      <span className="inline-block w-0.5 h-3.5 bg-primary/60 ml-0.5 animate-pulse align-middle" />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Main content (streams after thinking) ── */}
            {(message.content || (!message.thinking && message.streaming)) && (
              <div className="text-sm leading-relaxed text-foreground/90 prose prose-neutral dark:prose-invert max-w-none prose-sm">
                {message.streaming && !message.content ? (
                  // Thinking dots while waiting for first content token
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" />
                  </div>
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ node, inline, className, children, ...props }: any) {
                        const langMatch = /language-(\w+)/.exec(className || "");
                        const codeStr = String(children).replace(/\n$/, "");
                        const codeId = codeStr.slice(0, 24);
                        if (!inline && langMatch) {
                          return (
                            <div className="relative my-4 rounded-xl overflow-hidden border border-border bg-zinc-950 shadow-lg">
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
                      p: ({ children }) => <p className="mb-3 last:mb-0 leading-7">{children}</p>,
                      ul: ({ children }) => <ul className="mb-3 space-y-1 pl-4 list-disc">{children}</ul>,
                      ol: ({ children }) => <ol className="mb-3 space-y-1 pl-4 list-decimal">{children}</ol>,
                      li: ({ children }) => <li className="leading-6">{children}</li>,
                      h1: ({ children }) => <h1 className="text-base font-bold mt-4 mb-2">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-sm font-bold mt-3 mb-1.5">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-primary/40 pl-4 text-muted-foreground italic my-3">{children}</blockquote>
                      ),
                      table: ({ children }) => (
                        <div className="my-3 overflow-x-auto rounded-lg border border-border">
                          <table className="text-xs w-full">{children}</table>
                        </div>
                      ),
                      th: ({ children }) => <th className="px-3 py-2 bg-muted/50 font-semibold text-left border-b border-border">{children}</th>,
                      td: ({ children }) => <td className="px-3 py-2 border-b border-border/50">{children}</td>,
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline underline-offset-2">{children}</a>
                      ),
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                )}
                {/* Streaming cursor */}
                {message.streaming && message.content && (
                  <span className="inline-block w-0.5 h-4 bg-foreground/60 ml-0.5 animate-pulse align-middle" />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Composer ───────────────────────────────────────────────────────────────────

function ChatComposer({
  value, onChange, onSend, onStop, streaming, disabled, textareaRef, configured,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  configured: boolean;
}) {
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (streaming) onStop();
      else onSend();
    }
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  const placeholder = !configured
    ? "Set up AI in Settings → AI to start chatting"
    : "Message AI…";

  return (
    <div className="border-t border-border bg-background/80 backdrop-blur-md px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/30 px-4 py-3 focus-within:border-primary/40 transition-colors">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder={placeholder}
            disabled={disabled && !streaming}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed min-h-[24px] max-h-[200px] overflow-y-auto"
            style={{ height: "24px" }}
            autoComplete="off"
          />
          {streaming ? (
            <Button
              size="icon"
              variant="outline"
              onClick={onStop}
              className="h-8 w-8 shrink-0 rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10 hover:border-destructive/60"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={onSend}
              disabled={disabled || !value.trim()}
              className="h-8 w-8 shrink-0 rounded-xl"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <p className="text-center text-[10px] text-muted-foreground/40 mt-2">
          AI can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AiPage() {
  const { theme, toggle } = useTheme();
  const { data: settings, isLoading } = useGetAiSettings();
  const configured = settings?.configured ?? false;

  const [chatModel, setChatModel] = useState(() => NVIDIA_MODELS[0].value);
  useEffect(() => {
    if (settings?.model && !isLoading) setChatModel(settings.model);
  }, [settings?.model, isLoading]);

  const [messages, setMessages]   = useState<ChatMsg[]>([]);
  const [input, setInput]         = useState("");
  const [streaming, setStreaming] = useState(false);

  const scrollRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef    = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    // Mark last assistant message as done
    setMessages(prev => prev.map((m, i) =>
      i === prev.length - 1 && m.role === "assistant"
        ? { ...m, streaming: false }
        : m
    ));
  }, []);

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || streaming) return;
    if (!configured) {
      toast.error("Configure your NVIDIA API key in Settings → AI first.");
      return;
    }

    const userMsg: ChatMsg = { id: crypto.randomUUID(), role: "user", content, thinking: "" };
    const aiId = crypto.randomUUID();
    const aiMsg: ChatMsg   = { id: aiId, role: "assistant", content: "", thinking: "", streaming: true };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setInput("");
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const token = getToken();
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

      const resp = await fetch("/api/terminal/ai/chat/stream", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body:   JSON.stringify({ messages: history, systemContext: CHAT_SYSTEM, model: chatModel }),
        signal: ctrl.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ message: "Stream failed" }));
        throw new Error(err.message || "Stream failed");
      }

      const reader  = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const evt = JSON.parse(raw) as { type?: string; delta?: string; error?: string };
            if (evt.error) throw new Error(evt.error);
            if (!evt.delta) continue;

            if (evt.type === "thinking") {
              setMessages(prev => prev.map(m =>
                m.id === aiId ? { ...m, thinking: m.thinking + evt.delta! } : m
              ));
            } else {
              setMessages(prev => prev.map(m =>
                m.id === aiId ? { ...m, content: m.content + evt.delta! } : m
              ));
            }
          } catch (parseErr: any) {
            if (parseErr.message !== "Stream failed") continue;
            throw parseErr;
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") return; // user stopped
      toast.error(err.message || "AI request failed");
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.id === aiId && !last.content && !last.thinking) {
          return prev.slice(0, -1); // remove empty assistant message
        }
        return prev;
      });
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setStreaming(false);
      setMessages(prev => prev.map(m =>
        m.id === aiId ? { ...m, streaming: false } : m
      ));
    }
  }, [input, streaming, configured, messages, chatModel]);

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />

      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <h1 className="font-semibold text-sm tracking-tight">AI Chat</h1>
              {configured && (
                <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-primary/10 text-primary border-primary/20 hidden sm:flex">
                  Configured
                </Badge>
              )}
              {streaming && (
                <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-amber-500/10 text-amber-400 border-amber-400/30 animate-pulse hidden sm:flex">
                  Streaming
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <ModelDropdown value={chatModel} onChange={setChatModel} />
              {streaming && (
                <Button
                  variant="outline" size="sm"
                  onClick={stop}
                  className="h-7 text-xs gap-1.5 px-2.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <Square className="w-3 h-3 fill-current" /> Stop
                </Button>
              )}
              {messages.length > 0 && !streaming && (
                <Button
                  variant="ghost" size="sm"
                  className="h-7 text-xs text-muted-foreground gap-1 px-2"
                  onClick={() => setMessages([])}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span className="hidden sm:inline">Clear</span>
                </Button>
              )}
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </header>

        {/* Not-configured banner */}
        {!isLoading && !configured && (
          <div className="mx-4 mt-4 flex items-center gap-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <p className="text-xs flex-1">
              No NVIDIA API key configured.{" "}
              <Link href="/settings" className="underline underline-offset-2 hover:text-amber-300">
                Go to Settings → AI
              </Link>{" "}
              to set it up.
            </p>
          </div>
        )}

        {/* Messages / Empty state */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <SuggestionCards onSelect={text => send(text)} />
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
              {messages.map(m => (
                <MessageItem key={m.id} message={m} />
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={() => send()}
          onStop={stop}
          streaming={streaming}
          disabled={!configured}
          textareaRef={textareaRef}
          configured={configured}
        />
      </div>
    </div>
  );
}
