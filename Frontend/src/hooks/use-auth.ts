import { useMemo } from "react";
import { getToken } from "@/api/client";

export interface AuthUser {
  id?: number;
  username: string;
  role: string;
  isAdmin: boolean;
  features: string[];
}

function decodeJwt(token: string): any {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

export function useAuth(): { user: AuthUser | null; hasFeature: (key: string) => boolean } {
  const token = getToken();

  const user = useMemo((): AuthUser | null => {
    if (!token) return null;
    const payload = decodeJwt(token);
    if (!payload) return null;
    // Legacy tokens (issued before RBAC) have no `isAdmin` field — they are
    // always the env-var admin, so treat them as admin for backwards compatibility.
    const isAdmin = payload.isAdmin === true || payload.isAdmin === undefined;
    return {
      id: payload.id,
      username: payload.username ?? "unknown",
      role: payload.role ?? (isAdmin ? "admin" : "user"),
      isAdmin,
      features: Array.isArray(payload.features) ? payload.features : [],
    };
  }, [token]);

  const hasFeature = useMemo(() => {
    return (key: string): boolean => {
      if (!user) return false;
      if (user.isAdmin) return true;
      return user.features.includes(key);
    };
  }, [user]);

  return { user, hasFeature };
}
