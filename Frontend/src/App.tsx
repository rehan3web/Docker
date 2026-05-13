import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import SqlEditorPage from "@/pages/sql-editor";
import TableEditorPage from "@/pages/table-editor";
import StatisticsPage from "@/pages/statistics";
import VisualizerPage from "@/pages/visualizer";
import SettingsPage from "@/pages/settings";
import BackupRestorePage from "@/pages/backup-restore";
import VpsPage from "@/pages/vps";
import TerminalPage from "@/pages/terminal";
import SshPage from "@/pages/ssh";
import DockerPage from "@/pages/docker";
import ContainerDetailPage from "@/pages/docker-container";
import DeployPage from "@/pages/deploy";
import ProxyPage from "@/pages/proxy";
import SchedulerPage from "@/pages/scheduler";
import StoragePage from "@/pages/storage";
import DomainsPage from "@/pages/domains";
import AiPage from "@/pages/ai";
import AgentPage from "@/pages/agent";
import RedisPage from "@/pages/redis";
import UsersPage from "@/pages/users";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import TwoFASetupOverlay from "@/components/TwoFASetupOverlay";
import { ThemeProvider } from "@/hooks/use-theme";
import { getToken, clearToken } from "@/api/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { ShieldX } from "lucide-react";

const queryClient = new QueryClient();

// ── JWT expiry guard ──────────────────────────────────────────────────────────

function useTokenExpiryGuard() {
  const [, navigate] = useLocation();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function scheduleCheck() {
      if (timer) clearTimeout(timer);
      const token = getToken();
      if (!token) return;
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const exp: number | undefined = payload.exp;
        if (!exp) return;
        const msLeft = exp * 1000 - Date.now();
        if (msLeft <= 0) { doLogout(); return; }
        timer = setTimeout(doLogout, Math.min(msLeft, 2_147_483_647));
      } catch { /* malformed token */ }
    }

    function doLogout() {
      clearToken();
      queryClient.clear();
      toast.error("Your session has expired. Please log in again.");
      navigate("/login");
    }

    scheduleCheck();
    const onVisible = () => { if (document.visibilityState === "visible") scheduleCheck(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", scheduleCheck);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", scheduleCheck);
    };
  }, [navigate]);
}

// ── Access Denied ─────────────────────────────────────────────────────────────

function AccessDenied() {
  const [, navigate] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 select-none">
      <div className="w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
        <ShieldX className="w-7 h-7 text-destructive" />
      </div>
      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Access Denied</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          You don't have permission to access this feature. Contact your administrator to request access.
        </p>
      </div>
      <button
        onClick={() => navigate("/")}
        className="text-sm text-primary hover:underline mt-1"
      >
        Go to Dashboard
      </button>
    </div>
  );
}

// ── Route guards ──────────────────────────────────────────────────────────────

function PrivateRoute({ component: Component }: { component: React.ComponentType }) {
  const [, navigate] = useLocation();
  const token = getToken();
  useTokenExpiryGuard();

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token]);

  if (!token) return null;
  return <Component />;
}

function FeatureRoute({
  component: Component,
  feature,
}: {
  component: React.ComponentType;
  feature: string;
}) {
  const [, navigate] = useLocation();
  const token = getToken();
  const { hasFeature } = useAuth();
  useTokenExpiryGuard();

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token]);

  if (!token) return null;
  if (!hasFeature(feature)) return <AccessDenied />;
  return <Component />;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const [, navigate] = useLocation();
  const token = getToken();
  const { user } = useAuth();
  useTokenExpiryGuard();

  useEffect(() => {
    if (!token) navigate("/login");
  }, [token]);

  if (!token) return null;
  if (!user?.isAdmin) return <AccessDenied />;
  return <Component />;
}

function PublicRoute({ component: Component }: { component: React.ComponentType }) {
  const [, navigate] = useLocation();
  const token = getToken();

  useEffect(() => {
    if (token) navigate("/");
  }, [token]);

  if (token) return null;
  return <Component />;
}

// ── Router ────────────────────────────────────────────────────────────────────

function Router() {
  return (
    <Switch>
      <Route path="/">{() => <FeatureRoute component={Dashboard} feature="dashboard" />}</Route>
      <Route path="/table-editor">{() => <FeatureRoute component={TableEditorPage} feature="table-editor" />}</Route>
      <Route path="/sql-editor">{() => <FeatureRoute component={SqlEditorPage} feature="sql-editor" />}</Route>
      <Route path="/statistics">{() => <FeatureRoute component={StatisticsPage} feature="statistics" />}</Route>
      <Route path="/visualizer">{() => <FeatureRoute component={VisualizerPage} feature="visualizer" />}</Route>
      <Route path="/backup-restore">{() => <FeatureRoute component={BackupRestorePage} feature="backup-restore" />}</Route>
      <Route path="/vps">{() => <FeatureRoute component={VpsPage} feature="vps" />}</Route>
      <Route path="/terminal">{() => <FeatureRoute component={TerminalPage} feature="terminal" />}</Route>
      <Route path="/ssh">{() => <FeatureRoute component={SshPage} feature="ssh" />}</Route>
      <Route path="/docker">{() => <FeatureRoute component={DockerPage} feature="docker" />}</Route>
      <Route path="/docker/:id">{() => <FeatureRoute component={ContainerDetailPage} feature="docker" />}</Route>
      <Route path="/deploy">{() => <FeatureRoute component={DeployPage} feature="deploy" />}</Route>
      <Route path="/proxy">{() => <FeatureRoute component={ProxyPage} feature="proxy" />}</Route>
      <Route path="/scheduler">{() => <FeatureRoute component={SchedulerPage} feature="scheduler" />}</Route>
      <Route path="/storage">{() => <FeatureRoute component={StoragePage} feature="storage" />}</Route>
      <Route path="/domains">{() => <FeatureRoute component={DomainsPage} feature="domains" />}</Route>
      <Route path="/ai">{() => <FeatureRoute component={AiPage} feature="ai" />}</Route>
      <Route path="/agent">{() => <FeatureRoute component={AgentPage} feature="agent" />}</Route>
      <Route path="/redis">{() => <FeatureRoute component={RedisPage} feature="redis" />}</Route>
      <Route path="/settings">{() => <PrivateRoute component={SettingsPage} />}</Route>
      <Route path="/users">{() => <AdminRoute component={UsersPage} />}</Route>
      <Route path="/login">{() => <PublicRoute component={LoginPage} />}</Route>
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
            <TwoFASetupOverlay />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
