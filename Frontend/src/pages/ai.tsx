import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles, Bot, User, RotateCcw, Send, Loader2,
  ChevronDown, AlertTriangle, Sun, Moon, Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useGetAiSettings, aiChat } from "@/api/client";
import { cn } from "@/lib/utils";
import MarkdownContent from "@/components/MarkdownContent";
import { Link } from "wouter";

// ── Model list ────────────────────────────────────────────────────────────────

export const NVIDIA_MODELS = [
  { value: "openai/gpt-oss-120b",                                   label: "ChatGPT OSS 120B",            provider: "OpenAI",       thinking: true  },
  { value: "deepseek-ai/deepseek-v4-pro",                           label: "DeepSeek V4 Pro",             provider: "DeepSeek",     thinking: true  },
  { value: "moonshotai/kimi-k2-thinking",                           label: "Kimi K2 Thinking",            provider: "Moonshot AI",  thinking: true  },
  { value: "qwen/qwen3-next-80b-a3b-thinking",                      label: "Qwen3 80B Thinking",          provider: "Alibaba",      thinking: true  },
  { value: "qwen/qwen3.5-397b-a17b",                                label: "Qwen 3.5 397B",               provider: "Alibaba",      thinking: true  },
  { value: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",         label: "Nemotron 3 Nano Omni 30B",    provider: "NVIDIA",       thinking: true  },
  { value: "google/gemma-3-27b-it",                                 label: "Gemma 3 27B",                 provider: "Google",       thinking: false },
  { value: "google/gemma-3-12b-it",                                 label: "Gemma 3 12B",                 provider: "Google",       thinking: false },
  { value: "meta/llama-3.1-8b-instruct",                            label: "Llama 3.1 8B",                provider: "Meta",         thinking: false },
  { value: "meta/llama-3.3-70b-instruct",                           label: "Llama 3.3 70B",               provider: "Meta",         thinking: false },
  { value: "mistralai/mistral-large-3-675b-instruct-2512",          label: "Mistral Large 3 675B",        provider: "Mistral AI",   thinking: false },
  { value: "stepfun-ai/step-3.5-flash",                             label: "Step 3.5 Flash",              provider: "Stepfun AI",   thinking: false },
];

type ChatMsg = { role: "user" | "assistant"; content: string };

const CHAT_SYSTEM =
  "You are a helpful Docker, DevOps, and infrastructure assistant inside Docklet — a VPS/Docker/PostgreSQL management dashboard. " +
  "Help with container management, networking, debugging, SQL, shell commands, and infrastructure questions. " +
  "Be concise, practical, and give actionable answers. Use markdown for code blocks.";

const CHAT_PROMPTS = [
  "Why would a container keep restarting?",
  "How do I check PostgreSQL slow queries?",
  "What does OOMKilled mean?",
  "How to limit container memory?",
];

// ── Model dropdown (reusable) ─────────────────────────────────────────────────

function ModelDropdown({
  value, onChange, className,
}: { value: string; onChange: (v: string) => void; className?: string }) {
  const sel = NVIDIA_MODELS.find(m => m.value === value) ?? NVIDIA_MODELS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-7 text-[11px] gap-1.5 px-2.5 font-sans", className)}
        >
          <Cpu className="w-3 h-3 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-[120px]">{sel.label}</span>
          {sel.thinking && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary/30 text-primary bg-primary/5 shrink-0">T</Badge>
          )}
          <ChevronDown className="w-3 h-3 shrink-0 opacity-50 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[300px] rounded-xl p-1.5 shadow-lg">
        <p className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Thinking / Reasoning</p>
        {NVIDIA_MODELS.filter(m => m.thinking).map(m => (
          <DropdownMenuItem
            key={m.value}
            className="px-2.5 py-2 rounded-lg cursor-pointer gap-2 text-xs"
            onClick={() => onChange(m.value)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn("font-medium truncate", m.value === value && "text-primary")}>{m.label}</span>
                {m.value === value && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
              </div>
              <span className="text-muted-foreground text-[11px]">{m.provider}</span>
            </div>
            <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 border-primary/30 text-primary bg-primary/5">Thinking</Badge>
          </DropdownMenuItem>
        ))}
        <div className="my-1 border-t border-border/50" />
        <p className="px-2.5 py-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Fast / Instruction</p>
        {NVIDIA_MODELS.filter(m => !m.thinking).map(m => (
          <DropdownMenuItem
            key={m.value}
            className="px-2.5 py-2 rounded-lg cursor-pointer gap-2 text-xs"
            onClick={() => onChange(m.value)}
          >
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AiPage() {
  const { theme, toggle } = useTheme();
  const { data: settings, isLoading } = useGetAiSettings();
  const configured = settings?.configured ?? false;

  // Active model — starts from saved setting, user can override per-session
  const [chatModel, setChatModel] = useState(
    () => settings?.model || NVIDIA_MODELS[0].value
  );

  // Sync with fetched settings on first load
  useEffect(() => {
    if (settings?.model && !isLoading) setChatModel(settings.model);
  }, [settings?.model, isLoading]);

  const [chatMsgs, setChatMsgs]       = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput]     = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs]);

  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    if (!configured) { toast.error("Configure your NVIDIA API key in Settings → AI first."); return; }
    const newMsgs: ChatMsg[] = [...chatMsgs, { role: "user", content: text }];
    setChatMsgs(newMsgs); setChatInput(""); setChatLoading(true);
    try {
      const r = await aiChat(
        newMsgs.map(m => ({ role: m.role, content: m.content })),
        CHAT_SYSTEM,
        chatModel,
      );
      setChatMsgs(prev => [...prev, { role: "assistant", content: r.content }]);
    } catch (err: any) {
      toast.error(err.message || "AI request failed");
      setChatMsgs(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally { setChatLoading(false); }
  }

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
                <Badge variant="outline" className="text-[10px] rounded-full px-2 py-0 bg-primary/10 text-primary border-primary/20">Configured</Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 flex flex-col max-w-4xl w-full mx-auto px-4 py-6 pb-8 gap-4">

          {/* Not-configured banner */}
          {!isLoading && !configured && (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-400">
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

          {/* Chat panel */}
          <div className="rounded-xl border border-border overflow-hidden flex flex-col flex-1" style={{ minHeight: "520px" }}>

            {/* Chat header */}
            <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">AI Chat</span>
              </div>
              <div className="flex items-center gap-2">
                <ModelDropdown value={chatModel} onChange={setChatModel} />
                {chatMsgs.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1 px-2" onClick={() => setChatMsgs([])}>
                    <RotateCcw className="w-3 h-3" /> Clear
                  </Button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ maxHeight: "calc(100vh - 280px)" }}>
              {chatMsgs.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-12">
                  <Bot className="w-10 h-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    {configured
                      ? "Ask anything about containers, databases, or infrastructure."
                      : "Set up your API key in Settings → AI to start chatting."}
                  </p>
                  {configured && (
                    <div className="flex flex-wrap gap-2 justify-center max-w-sm mt-1">
                      {CHAT_PROMPTS.map(q => (
                        <button
                          key={q}
                          onClick={() => setChatInput(q)}
                          className="text-[11px] bg-muted hover:bg-muted/80 border border-border px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {chatMsgs.map((msg, i) => (
                <div key={i} className={cn("flex gap-3", msg.role === "user" && "flex-row-reverse")}>
                  <div className={cn(
                    "shrink-0 w-7 h-7 rounded-full flex items-center justify-center border",
                    msg.role === "user"
                      ? "bg-muted border-border text-foreground"
                      : "bg-primary/10 border-primary/20 text-primary"
                  )}>
                    {msg.role === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                  </div>
                  <div className={cn(
                    "flex-1 max-w-[85%] rounded-xl px-4 py-2.5",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground ml-auto"
                      : "bg-muted/50 border border-border"
                  )}>
                    {msg.role === "user"
                      ? <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                      : <MarkdownContent content={msg.content} />
                    }
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex gap-3">
                  <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center border bg-primary/10 border-primary/20 text-primary">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                  <div className="bg-muted/50 border border-border rounded-xl px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">Thinking…</span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleChat} className="border-t border-border bg-background flex items-center gap-2 p-3">
              <Input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder={configured ? "Ask about containers, databases, infrastructure…" : "Set up AI first in Settings → AI"}
                className="h-9 text-sm flex-1"
                disabled={!configured || chatLoading}
                autoComplete="off"
              />
              <Button type="submit" size="sm" className="h-9 w-9 p-0 shrink-0" disabled={!configured || !chatInput.trim() || chatLoading}>
                {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
