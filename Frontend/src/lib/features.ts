export const ALL_FEATURES: { key: string; label: string; group: string }[] = [
  { key: "dashboard",      label: "Dashboard",        group: "Core" },
  { key: "table-editor",   label: "Table Editor",     group: "Core" },
  { key: "sql-editor",     label: "SQL Editor",       group: "Core" },
  { key: "statistics",     label: "Statistics",       group: "Analytics" },
  { key: "visualizer",     label: "Visualizer",       group: "Analytics" },
  { key: "backup-restore", label: "Backup & Restore", group: "Maintenance" },
  { key: "vps",            label: "VPS",              group: "Infrastructure" },
  { key: "terminal",       label: "AI Terminal",      group: "Infrastructure" },
  { key: "ssh",            label: "SSH",              group: "Infrastructure" },
  { key: "docker",         label: "Docker",           group: "Infrastructure" },
  { key: "deploy",         label: "Auto Deploy",      group: "Infrastructure" },
  { key: "proxy",          label: "Reverse Proxy",    group: "Infrastructure" },
  { key: "domains",        label: "Domains",          group: "Infrastructure" },
  { key: "scheduler",      label: "Scheduler",        group: "Infrastructure" },
  { key: "storage",        label: "Storage",          group: "Infrastructure" },
  { key: "redis",          label: "Redis Cache",      group: "Infrastructure" },
  { key: "ai",             label: "AI",               group: "AI Services" },
  { key: "agent",          label: "Docklet Agent",    group: "AI Services" },
];

export const FEATURE_GROUPS = Array.from(new Set(ALL_FEATURES.map((f) => f.group)));
