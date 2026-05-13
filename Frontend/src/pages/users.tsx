import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/hooks/use-auth";
import { ALL_FEATURES, FEATURE_GROUPS } from "@/lib/features";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ShieldCheck,
  UserX,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppUser {
  id: number;
  username: string;
  role: string;
  features: string[];
  enabled: boolean;
  created_at: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

function useUsers() {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiFetch<{ users: AppUser[] }>("/users"),
  });
}

// ── Feature multi-select ──────────────────────────────────────────────────────

function FeatureSelector({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (key: string) => {
    onChange(
      selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]
    );
  };
  const toggleGroup = (group: string) => {
    const groupKeys = ALL_FEATURES.filter((f) => f.group === group).map((f) => f.key);
    const allSelected = groupKeys.every((k) => selected.includes(k));
    if (allSelected) {
      onChange(selected.filter((k) => !groupKeys.includes(k)));
    } else {
      const next = new Set(selected);
      groupKeys.forEach((k) => next.add(k));
      onChange(Array.from(next));
    }
  };
  const selectAll = () => onChange(ALL_FEATURES.map((f) => f.key));
  const clearAll = () => onChange([]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={selectAll}
          className="text-xs text-primary hover:underline"
        >
          Select all
        </button>
        <span className="text-xs text-muted-foreground">·</span>
        <button
          type="button"
          onClick={clearAll}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Clear all
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {selected.length} / {ALL_FEATURES.length} selected
        </span>
      </div>
      {FEATURE_GROUPS.map((group) => {
        const groupFeatures = ALL_FEATURES.filter((f) => f.group === group);
        const groupKeys = groupFeatures.map((f) => f.key);
        const allSelected = groupKeys.every((k) => selected.includes(k));
        const someSelected = groupKeys.some((k) => selected.includes(k));
        return (
          <div key={group}>
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className="flex items-center gap-2 mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
            >
              <span
                className={cn(
                  "w-3 h-3 rounded-sm border flex items-center justify-center shrink-0",
                  allSelected
                    ? "bg-primary border-primary"
                    : someSelected
                    ? "bg-primary/40 border-primary/40"
                    : "border-border"
                )}
              />
              {group}
            </button>
            <div className="flex flex-wrap gap-1.5 pl-5">
              {groupFeatures.map((f) => {
                const on = selected.includes(f.key);
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggle(f.key)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                      on
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-transparent text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Create / Edit dialog ──────────────────────────────────────────────────────

interface UserFormData {
  username: string;
  password: string;
  role: string;
  features: string[];
}

function UserDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: AppUser | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<UserFormData>({
    username: editing?.username ?? "",
    password: "",
    role: editing?.role ?? "user",
    features: editing?.features ?? [],
  });
  const [showPass, setShowPass] = useState(false);

  React.useEffect(() => {
    setForm({
      username: editing?.username ?? "",
      password: "",
      role: editing?.role ?? "user",
      features: editing?.features ?? [],
    });
    setShowPass(false);
  }, [editing, open]);

  const mutation = useMutation({
    mutationFn: async (data: UserFormData) => {
      if (editing) {
        const body: any = {
          username: data.username,
          role: data.role,
          features: data.features,
        };
        if (data.password) body.password = data.password;
        return apiFetch(`/users/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
      } else {
        return apiFetch("/users", {
          method: "POST",
          body: JSON.stringify(data),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(editing ? "User updated" : "User created");
      onClose();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username.trim()) return toast.error("Username is required");
    if (!editing && !form.password) return toast.error("Password is required");
    mutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit User" : "Create User"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="john"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Input
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                placeholder="user / operator / viewer"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{editing ? "New Password" : "Password"}</Label>
            <div className="relative">
              <Input
                type={showPass ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={editing ? "Leave blank to keep current" : "Enter password"}
                autoComplete="new-password"
                className="pr-9"
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPass((v) => !v)}
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Feature Access</Label>
            <div className="border border-border rounded-lg p-3 bg-muted/20">
              <FeatureSelector
                selected={form.features}
                onChange={(v) => setForm((f) => ({ ...f, features: v }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : editing ? "Save Changes" : "Create User"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useUsers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);

  const toggleMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/users/${id}/toggle`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User deleted");
      setDeleteTarget(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (!me?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
        <ShieldCheck className="w-10 h-10" />
        <p className="font-medium">Admin access required</p>
      </div>
    );
  }

  const users: AppUser[] = data?.users ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-border flex items-center justify-center">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">User Management</h1>
            <p className="text-xs text-muted-foreground">
              Create users with custom roles and feature permissions
            </p>
          </div>
        </div>
        <Button
          onClick={() => { setEditing(null); setDialogOpen(true); }}
          size="sm"
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          New User
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground text-sm">Loading users…</div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <UserX className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">No users yet. Create one to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Features</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{u.username}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      #{u.id} · {new Date(u.created_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs font-mono capitalize">
                      {u.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {u.features.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">None</span>
                      ) : u.features.length <= 4 ? (
                        u.features.map((f) => (
                          <Badge key={f} variant="secondary" className="text-[10px] px-1.5 py-0">
                            {ALL_FEATURES.find((x) => x.key === f)?.label ?? f}
                          </Badge>
                        ))
                      ) : (
                        <>
                          {u.features.slice(0, 3).map((f) => (
                            <Badge key={f} variant="secondary" className="text-[10px] px-1.5 py-0">
                              {ALL_FEATURES.find((x) => x.key === f)?.label ?? f}
                            </Badge>
                          ))}
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            +{u.features.length - 3} more
                          </Badge>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleMutation.mutate(u.id)}
                      disabled={toggleMutation.isPending}
                      className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                      title={u.enabled ? "Click to disable" : "Click to enable"}
                    >
                      {u.enabled ? (
                        <>
                          <ToggleRight className="w-4 h-4 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400">Active</span>
                        </>
                      ) : (
                        <>
                          <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                          <span className="text-muted-foreground">Disabled</span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => { setEditing(u); setDialogOpen(true); }}
                        title="Edit user"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-500"
                        onClick={() => setDeleteTarget(u)}
                        title="Delete user"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create / Edit dialog */}
      <UserDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        editing={editing}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user "{deleteTarget?.username}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The user will lose all access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
