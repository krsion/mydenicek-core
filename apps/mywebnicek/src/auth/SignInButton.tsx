// "Sign in with Microsoft" button, gated by VITE_AUTH_ENABLED
interface Props {
  className?: string;
}

/**
 * Renders a "Sign in with Microsoft" button when VITE_AUTH_ENABLED=true,
 * or nothing when auth is disabled.
 */
export function SignInButton({ className }: Props): JSX.Element | null {
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === "true";
  if (!authEnabled) return null;

  const handleSignIn = (): void => {
    // TODO: call msalInstance.loginPopup(loginRequest) when MSAL is fully wired
    console.warn("MSAL sign-in not yet implemented in this build");
  };

  const handleSignOut = (): void => {
    // TODO: call msalInstance.logoutPopup() when MSAL is fully wired
    // Also clear device identity: clearDeviceIdentity()
    console.warn("MSAL sign-out not yet implemented in this build");
  };

  return (
    <div className={className}>
      <button type="button" onClick={handleSignIn}>
        Sign in with Microsoft
      </button>
      <button type="button" onClick={handleSignOut}>
        Sign out &amp; forget this device
      </button>
    </div>
  );
}
