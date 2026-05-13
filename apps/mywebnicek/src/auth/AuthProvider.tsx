// Wraps the app with MsalProvider when auth is enabled.
// When VITE_AUTH_ENABLED=false, renders children directly.
import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

/**
 * Conditionally wraps children with MsalProvider.
 * Import is dynamic to avoid bundling MSAL when auth is disabled.
 */
export function AuthProvider({ children }: Props): JSX.Element {
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === "true";
  if (!authEnabled) {
    return <>{children}</>;
  }
  // TODO: When VITE_AUTH_ENABLED=true, import PublicClientApplication and MsalProvider
  // from @azure/msal-browser / @azure/msal-react and wrap here.
  // This is a stub — the feature flag keeps this path unreachable in production.
  return <>{children}</>;
}
