import React, { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Database, Activity, LayoutList, Server, Sun, Moon, Plug } from "lucide-react";
import { ConnectPanel } from "@/components/ConnectPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DesktopSidebar, MobileSidebarTrigger, IconDashboard } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import {
  useHealthCheck,
  useGetDbOverview,
  getGetDbOverviewQueryKey,
} from "@/api/mock";

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

        <main className="flex-1 px-4 py-8 space-y-8 pb-24 max-w-6xl w-full mx-auto">
          <div className="flex flex-col gap-2 mb-10">
            <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground leading-none">Database Metrics</h1>
            <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
              Real-time infrastructure health and connection overview.
            </p>
          </div>

          <OverviewSection />
        </main>
      </div>
    </div>
  );
}

function OverviewSection() {
  const { data: overview, isLoading: overviewLoading } = useGetDbOverview();
  const { data: health } = useHealthCheck();

  if (overviewLoading) {
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

function MetricCard({ title, value, icon, valueColor = "text-foreground" }: { title: string; value: string; icon: React.ReactNode; valueColor?: string }) {
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
