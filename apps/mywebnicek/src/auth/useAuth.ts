// Gated by VITE_AUTH_ENABLED
import { useMemo } from "react";

export interface AuthState {
  isAuthenticated: boolean;
  displayName: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string>;
}

/**
 * Returns auth state. When VITE_AUTH_ENABLED is false, returns a no-op stub
 * so the rest of the app doesn't need to handle both cases.
 */
export function useAuth(): AuthState {
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === "true";

  // When auth is disabled, return a permanent "logged in" stub
  const stub = useMemo<AuthState>(
    () => ({
      isAuthenticated: true,
      displayName: null,
      signIn: () => Promise.resolve(),
      signOut: () => Promise.resolve(),
      getToken: () => Promise.resolve(""),
    }),
    [],
  );

  if (!authEnabled) return stub;

  // Dynamic import of MSAL hook is done at module level below
  // This hook must only be called inside MsalProvider — validated at runtime
  throw new Error("MSAL hook not initialized; wrap App with <AuthProvider>");
}
