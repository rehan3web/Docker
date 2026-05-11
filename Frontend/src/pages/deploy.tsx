import React, { useEffect, useRef, useState } from "react";
import { Sun, Moon, GitBranch, RefreshCw, Loader2, CheckCircle2, XCircle, Clock, Container, Layers, ListOrdered } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import { useGetDeployments, startGithubDeploy, getDeploymentLogs, type DeploySummary } from "@/api/client";
import { getSocket } from "@/api/socket";
import { useQueryClient } from "@tanstack/react-query";

type LogLine = { stream: "stdout" | "stderr" | "system"; text: string; timestamp: number };

// ── Status badge ──────────────────────────────────────────────────────────────

function DeployStatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; icon: React.ReactNode }> = {
    queued:   { color: "text-violet-500 bg-violet-500/10 border-violet-500/30",  icon: <ListOrdered className="w-2.5 h-2.5" /> },
    pending:  { color: "text-muted-foreground bg-muted/50 border-border",         icon: <Clock className="w-2.5 h-2.5" /> },
    cloning:  { color: "text-blue-500 bg-blue-500/10 border-blue-500/30",         icon: <Loader2 className="w-2.5 h-2.5 animate-spin" /> },
    building: { color: "text-amber-500 bg-amber-500/10 border-amber-500/30",      icon: <Loader2 className="w-2.5 h-2.5 animate-spin" /> },
    running:  { color: "text-amber-500 bg-amber-500/10 border-amber-500/30",      icon: <Loader2 className="w-2.5 h-2.5 animate-spin" /> },
    success:  { color: "text-primary bg-primary/10 border-primary/20",            icon: <CheckCircle2 className="w-2.5 h-2.5" /> },
    failed:   { color: "text-destructive bg-destructive/10 border-destructive/30", icon: <XCircle className="w-2.5 h-2.5" /> },
  };
  const cfg = map[status] || map.pending;
  return (
    <Badge variant="outline" className={`font-mono text-[10px] uppercase rounded-full px-2 py-0 inline-flex items-center gap-1 ${cfg.color}`}>
      {cfg.icon}{status}
    </Badge>
  );
}

function BuildMethodBadge({ method }: { method?: "docker" | "railpack" }) {
  if (!method) return null;
  if (method === "railpack") {
    return (
      <Badge variant="outline" className="font-mono text-[10px] rounded-full px-2 py-0 inline-flex items-center gap-1 text-orange-500 bg-orange-500/10 border-orange-500/30">
        <Layers className="w-2.5 h-2.5" /> RailPack
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-mono text-[10px] rounded-full px-2 py-0 inline-flex items-center gap-1 text-blue-500 bg-blue-500/10 border-blue-500/30">
      <Container className="w-2.5 h-2.5" /> Docker
    </Badge>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DeployPage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const [repo, setRepo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const [activeDeploy, setActiveDeploy] = useState<DeploySummary | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const { data: deploys } = useGetDeployments();

  // ── Socket.IO live streaming ───────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    const onLog = (e: { id: string; stream: "stdout" | "stderr" | "system"; chunk: string }) => {
      if (activeId && e.id === activeId) {
        setLogs(prev => [...prev, { stream: e.stream, text: e.chunk, timestamp: Date.now() }]);
      }
    };
    const onStatus = (e: { id: string; status: string; error?: string; buildMethod?: string; queuePosition?: number }) => {
      if (activeId && e.id === activeId) {
        setActiveStatus(e.status);
        if (e.error) toast.error(e.error);
        if (e.status === "success") toast.success("Deployment successful!");
        qc.invalidateQueries({ queryKey: ["deployments"] });
      }
    };
    socket.on("deploy-log", onLog);
    socket.on("deploy-status", onStatus);
    return () => { socket.off("deploy-log", onLog); socket.off("deploy-status", onStatus); };
  }, [activeId, qc]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs.length]);

  // ── Load cached logs (Redis-backed, survives page refresh) ────────────────
  async function loadDeploymentHistory(d: DeploySummary) {
    setActiveId(d.id);
    setActiveDeploy(d);
    setActiveStatus(d.status);
    setLogs([]);
    setLogsLoading(true);
    try {
      const res = await getDeploymentLogs(d.id);
      setLogs((res.logs || []).map((l: any) => ({ stream: l.stream, text: l.chunk, timestamp: l.timestamp })));
    } catch (err: any) {
      toast.error(err.message || "Failed to load logs");
    } finally {
      setLogsLoading(false);
    }
  }

  // ── Submit deploy ──────────────────────────────────────────────────────────
  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault();
    if (!repo.trim()) return;
    setSubmitting(true);
    setLogs([]);
    setActiveStatus("queued");
    setActiveDeploy(null);
    try {
      const r = await startGithubDeploy(repo.trim());
      setActiveId(r.id);
      toast.info(`Queued: ${r.name}`);
      qc.invalidateQueries({ queryKey: ["deployments"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to queue deployment");
      setActiveStatus(null);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Live status from list ──────────────────────────────────────────────────
  const activeFromList = deploys?.deployments?.find(d => d.id === activeId);
  const displayDeploy  = activeFromList ?? activeDeploy;
  const displayStatus  = activeFromList?.status ?? activeStatus;
  const queuePos       = activeFromList?.queuePosition;

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">

        {/* ── Header ── */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <div className="hidden lg:flex items-center gap-3">
                <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                  <GitBranch className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight">GitHub Auto Deploy</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={() => qc.invalidateQueries({ queryKey: ["deployments"] })}>
                <RefreshCw className="w-3.5 h-3.5 mr-2" />Refresh
              </Button>
            </div>
          </div>
        </header>

        {/* ── Content ── */}
        <main className="flex-1 px-4 py-8 space-y-6 pb-24 max-w-6xl w-full mx-auto">
          <div className="flex flex-col gap-1 mb-2">
            <h1 className="text-4xl sm:text-5xl font-normal tracking-tight leading-none">GitHub Auto Deploy</h1>
            <p className="text-muted-foreground text-sm max-w-xl leading-relaxed mt-2">
              Paste a Git repo URL — Docklet clones it, detects the Dockerfile (or uses RailPack auto-build), and starts a container. Builds are queued to prevent overload.
            </p>
          </div>

          {/* Deploy form */}
          <Card className="bg-background border-border shadow-none rounded-xl">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium tracking-tight">Deploy from Git</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                With Dockerfile → Docker build. Without Dockerfile → RailPack auto-detect (Node, Python, Go, Rust, PHP, Bun, static…).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              <form onSubmit={handleDeploy} className="flex flex-col sm:flex-row gap-2">
                <Input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/user/repo.git" className="font-mono text-xs" />
                <Button type="submit" className="h-9 sm:w-auto w-full border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none" disabled={submitting || !repo.trim()}>
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <GitBranch className="w-3.5 h-3.5 mr-2" />}
                  Deploy
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Live Logs */}
          <Card className="bg-background border-border shadow-none rounded-xl overflow-hidden">
            <CardHeader className="p-4 pb-3 border-b border-border/50 flex-row items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-sm font-medium tracking-tight">Live Logs</CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  {activeId ? `Deployment ${activeId.slice(-8)} — logs restore from cache on reload` : "Run a deploy to stream logs here"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {displayDeploy?.buildMethod && <BuildMethodBadge method={displayDeploy.buildMethod} />}
                {displayStatus && <DeployStatusBadge status={displayStatus} />}
                {queuePos !== undefined && queuePos > 0 && (
                  <Badge variant="outline" className="font-mono text-[10px] rounded-full px-2 py-0 text-violet-500 bg-violet-500/10 border-violet-500/30">
                    <ListOrdered className="w-2.5 h-2.5 mr-1" />Queue #{queuePos}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div ref={logRef} className="bg-[#f8f8f8] dark:bg-[#0d0d0d] font-mono text-xs p-4 h-[420px] overflow-y-auto whitespace-pre-wrap">
                {logsLoading ? (
                  <span className="text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Restoring logs from cache…</span>
                ) : logs.length === 0 ? (
                  <span className="text-muted-foreground">No logs yet. Logs stream in real time and restore from Redis cache on page refresh.</span>
                ) : (
                  logs.map((line, i) => (
                    <div key={i} className={
                      line.stream === "stderr" ? "text-red-500 dark:text-red-400" :
                      line.stream === "system"  ? "text-[#0369a1] dark:text-cyan-400" :
                      "text-[#166534] dark:text-green-400"
                    }>
                      {line.text}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Deploy History */}
          <Card className="bg-background border-border shadow-none rounded-xl">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium tracking-tight">Deploy History</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Click a deployment to restore its logs</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="w-full">
                <div className="p-2 flex flex-row flex-wrap gap-2">
                  {(deploys?.deployments || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground p-4">No deployments yet</p>
                  ) : (
                    (deploys?.deployments || []).slice().reverse().map((d) => (
                      <button
                        key={d.id}
                        onClick={() => loadDeploymentHistory(d)}
                        className={`text-left p-3 rounded-lg hover:bg-muted/60 transition-colors border w-full sm:w-[280px] shrink-0 ${activeId === d.id ? "bg-muted/40 border-border" : "border-transparent hover:border-border/40"}`}
                      >
                        <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                          <span className="font-mono text-xs text-foreground truncate">{d.name}</span>
                          <div className="flex items-center gap-1.5">
                            {d.buildMethod && <BuildMethodBadge method={d.buildMethod} />}
                            <DeployStatusBadge status={d.status} />
                          </div>
                        </div>
                        <p className="font-mono text-[10px] text-muted-foreground truncate">{d.repo}</p>
                        {d.status === "queued" && d.queuePosition !== undefined && (
                          <p className="font-mono text-[10px] text-violet-500 mt-0.5">Queue position #{d.queuePosition}</p>
                        )}
                        {d.hostPort && d.containerPort && (
                          <p className="font-mono text-[10px] text-primary/80 mt-0.5">:{d.hostPort} → :{d.containerPort}</p>
                        )}
                        <p className="font-mono text-[10px] text-muted-foreground mt-0.5">{format(new Date(d.startedAt), "MMM dd, HH:mm:ss")}</p>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
