import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { auth, setUnauthorizedHandler, type User } from "../api";
import { useToast } from "../components/ui";

interface AuthContextValue {
  user: User | null;
  /** "loading" until the startup session check has answered. */
  status: "loading" | "ready";
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function homeFor(user: User): string {
  return user.role === "ops" ? "/ops" : "/shop";
}

/**
 * Holds who is signed in. The session itself is the backend's HTTP-only cookie; nothing about it
 * (and no password) is kept in the browser's storage.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    auth.me()
      .then((me) => { if (!cancelled) setUser(me); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setStatus("ready"); });
    return () => { cancelled = true; };
  }, []);

  // Any API call that answers 401 means the session is gone: forget the user and go to sign in.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser((current) => {
        if (current) toast({ tone: "info", title: "Your session has ended", description: "Please sign in again." });
        return null;
      });
      queryClient.clear();
      navigate("/login", { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, queryClient, toast]);

  const login = useCallback(async (email: string, password: string) => {
    const signedIn = await auth.login(email, password);
    queryClient.clear();
    setUser(signedIn);
    return signedIn;
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      queryClient.clear();
      setUser(null);
      navigate("/login", { replace: true });
      toast({ tone: "success", title: "Signed out" });
    }
  }, [navigate, queryClient, toast]);

  const value = useMemo(() => ({ user, status, login, logout }), [user, status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** For pages inside a role guard, where a user is always present. */
export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useCurrentUser used outside a signed-in route");
  return user;
}
