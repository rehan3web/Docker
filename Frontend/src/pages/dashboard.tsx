import React, { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Database, Activity, LayoutList, Server, Sun, Moon, Plug, Cpu, MemoryStick, HardDrive, Container } from "lucide-react";
import { ConnectPanel } from "@/components/ConnectPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopSidebar, MobileSidebarTrigger, IconDashboard } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import {
  useHealthCheck,
  useGetDbOverview,
  getGetDbOverviewQueryKey,
  useGetSystemStats,
  useGetDockerStatus,
} from "@/api/client";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatUptime(secs: number): string {
  if (!secs) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(" ") : `${secs}s`;
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { theme, toggle } = useTheme();
  const [connectOpen, setConnectOpen] = useState(false);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetDbOverviewQueryKey() });
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <ConnectPanel isOpen={connectOpen} onClose={() => setConnectOpen(false)} />
      <DesktopSidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-18 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />

              <div className="flex items-center gap-2 lg:hidden">
                <span className="font-semibold text-sm tracking-tight text-foreground">Database Metrics</span>
              </div>

              <div className="hidden lg:flex items-center gap-3">
                <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                  <IconDashboard className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight text-foreground">Database Metrics</span>
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 px-3 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 border border-black/10 dark:border-white/10 bg-[#72e3ad] text-black hover:bg-[#5fd49a] dark:bg-[#006239] dark:text-white dark:hover:bg-[#007a47] shadow-none"
                  onClick={() => setConnectOpen(true)}
                >
                  <Plug className="w-3 h-3" />
                  Connect
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                onClick={toggle}
                aria-label="Toggle theme"
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 space-y-10 pb-24 max-w-6xl w-full mx-auto">
          {/* Database overview */}
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground leading-none">Database Metrics</h1>
              <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
                Real-time infrastructure health and connection overview.
              </p>
            </div>
            <DbOverviewSection />
          </div>

          {/* VPS */}
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-normal tracking-tight text-foreground leading-none">VPS Management</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Live CPU, memory, storage, and load metrics for the host server.
              </p>
            </div>
            <VpsSection />
          </div>

          {/* Docker */}
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-normal tracking-tight text-foreground leading-none">Docker Manager</h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Manage containers running on the host. Click a card to open its detail page.
              </p>
            </div>
            <DockerSection />
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Database overview cards ───────────────────────────────────────────────────

function DbOverviewSection() {
  const { data: overview, isLoading } = useGetDbOverview();
  const { data: health } = useHealthCheck();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-background border-border shadow-none rounded-lg">
            <CardContent className="p-5">
              <Skeleton className="h-4 w-1/2 mb-2 bg-muted" />
              <Skeleton className="h-8 w-3/4 bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard
        title="Database Health"
        value={health?.status === "ok" ? "Healthy" : "Degraded"}
        valueColor={health?.status === "ok" ? "text-primary" : "text-destructive"}
        icon={<Activity className="w-4 h-4 text-muted-foreground" />}
      />
      <MetricCard
        title="Active Connections"
        value={overview?.activeConnections?.toString() || "0"}
        icon={<Server className="w-4 h-4 text-muted-foreground" />}
      />
      <MetricCard
        title="Total Database Size"
        value={overview?.databaseSize || "0 MB"}
        icon={<Database className="w-4 h-4 text-muted-foreground" />}
      />
      <MetricCard
        title="Total Tables"
        value={overview?.tableCount?.toString() || "0"}
        icon={<LayoutList className="w-4 h-4 text-muted-foreground" />}
      />
    </div>
  );
}

// ── VPS cards ─────────────────────────────────────────────────────────────────

function VpsSection() {
  const { data, isLoading } = useGetSystemStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-background border-border shadow-none rounded-lg">
            <CardContent className="p-5">
              <Skeleton className="h-4 w-1/2 mb-3 bg-muted" />
              <Skeleton className="h-7 w-2/3 mb-3 bg-muted" />
              <Skeleton className="h-1.5 w-full bg-muted" />
              <Skeleton className="h-3 w-3/4 mt-2 bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const cpu = data?.cpu;
  const mem = data?.memory;
  const stor = data?.storage;
  const load = data?.load;
  const os = data?.os;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        title="CPU Usage"
        value={cpu ? `${cpu.load.toFixed(1)}%` : "—"}
        sub={cpu ? `${cpu.cores} cores · ${cpu.model.slice(0, 22)}` : "—"}
        percent={cpu?.load ?? 0}
        icon={<Cpu className="w-4 h-4 text-muted-foreground" />}
      />
      <StatCard
        title="Memory"
        value={mem ? `${mem.usedPercent.toFixed(1)}%` : "—"}
        sub={mem ? `${formatBytes(mem.used)} / ${formatBytes(mem.total)}` : "—"}
        percent={mem?.usedPercent ?? 0}
        icon={<MemoryStick className="w-4 h-4 text-muted-foreground" />}
      />
      <StatCard
        title="Storage"
        value={stor ? `${stor.usedPercent.toFixed(1)}%` : "—"}
        sub={stor ? `${formatBytes(stor.used)} / ${formatBytes(stor.total)}` : "—"}
        percent={stor?.usedPercent ?? 0}
        icon={<HardDrive className="w-4 h-4 text-muted-foreground" />}
      />
      <StatCard
        title="System Load"
        value={load ? load.avgLoad.toFixed(2) : "—"}
        sub={os ? `Up ${formatUptime(os.uptime)}` : "—"}
        percent={Math.min(100, (load?.avgLoad ?? 0) * 25)}
        icon={<Activity className="w-4 h-4 text-muted-foreground" />}
      />
    </div>
  );
}

// ── Docker cards ──────────────────────────────────────────────────────────────

function DockerSection() {
  const { data, isLoading } = useGetDockerStatus();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-background border-border shadow-none rounded-lg">
            <CardContent className="p-5">
              <Skeleton className="h-4 w-1/2 mb-2 bg-muted" />
              <Skeleton className="h-8 w-3/4 bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const unavailable = !data?.available;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <MetricCard
        title="Total Containers"
        value={unavailable ? "—" : (data?.containers?.toString() ?? "0")}
        icon={<Container className="w-4 h-4 text-muted-foreground" />}
      />
      <MetricCard
        title="Running"
        value={unavailable ? "—" : (data?.running?.toString() ?? "0")}
        valueColor={!unavailable && (data?.running ?? 0) > 0 ? "text-primary" : "text-foreground"}
        icon={<Activity className="w-4 h-4 text-muted-foreground" />}
      />
      <MetricCard
        title="Stopped"
        value={unavailable ? "—" : (data?.stopped?.toString() ?? "0")}
        valueColor={!unavailable && (data?.stopped ?? 0) > 0 ? "text-destructive" : "text-foreground"}
        icon={<Server className="w-4 h-4 text-muted-foreground" />}
      />
      <MetricCard
        title="Images"
        value={unavailable ? "—" : (data?.images?.toString() ?? "0")}
        icon={<Database className="w-4 h-4 text-muted-foreground" />}
      />
    </div>
  );
}

// ── Shared card components ────────────────────────────────────────────────────

function MetricCard({ title, value, icon, valueColor = "text-foreground" }: {
  title: string;
  value: string;
  icon: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <Card className="bg-background border-border shadow-none rounded-lg overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-medium text-muted-foreground tracking-wide">{title}</p>
          {icon}
        </div>
        <p className={`text-2xl font-normal tracking-tight ${valueColor}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value, sub, percent, icon }: {
  title: string;
  value: string;
  sub: string;
  percent: number;
  icon: React.ReactNode;
}) {
  return (
    <Card className="bg-background border-border shadow-none rounded-lg overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground tracking-wide">{title}</p>
          {icon}
        </div>
        <p className="text-2xl font-normal tracking-tight text-foreground">{value}</p>
        <Progress value={Math.min(100, Math.max(0, percent))} className="h-1.5" />
        <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
      </CardContent>
    </Card>
  );
}
