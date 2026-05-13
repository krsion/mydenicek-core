import { PublicClientApplication } from "@azure/msal-browser";

const VITE_AUTH_ENABLED: string | undefined = import.meta.env
  ?.VITE_AUTH_ENABLED;
const VITE_AUTH_CLIENT_ID: string | undefined = import.meta.env
  ?.VITE_AUTH_CLIENT_ID;
const VITE_AUTH_TENANT_ID: string | undefined = import.meta.env
  ?.VITE_AUTH_TENANT_ID;
const VITE_AUTH_SCOPE: string | undefined = import.meta.env?.VITE_AUTH_SCOPE;

export const AUTH_ENABLED = VITE_AUTH_ENABLED === "true" &&
  Boolean(VITE_AUTH_CLIENT_ID);

const msal = AUTH_ENABLED && VITE_AUTH_CLIENT_ID
  ? new PublicClientApplication({
    auth: {
      clientId: VITE_AUTH_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${
        VITE_AUTH_TENANT_ID ?? "common"
      }`,
      redirectUri: globalThis.location?.origin,
    },
    cache: {
      cacheLocation: "sessionStorage",
    },
  })
  : undefined;

if (msal) {
  await msal.initialize();
}

function getScopes(): string[] {
  // Configure VITE_AUTH_SCOPE to request an API scope; fallback scopes are
  // suitable for identity only.
  return VITE_AUTH_SCOPE ? [VITE_AUTH_SCOPE] : ["openid", "profile"];
}

export function getMsalInstance(): PublicClientApplication | undefined {
  return msal;
}

export async function signInWithMicrosoft(): Promise<string | undefined> {
  if (!msal) return undefined;
  const loginResult = await msal.loginPopup({ scopes: getScopes() });
  const tokenResult = await msal.acquireTokenSilent({
    account: loginResult.account,
    scopes: getScopes(),
  });
  return tokenResult.accessToken;
}

export function getSignedInName(): string | undefined {
  if (!msal) return undefined;
  return msal.getActiveAccount()?.name ?? msal.getAllAccounts()[0]?.name;
}

export async function getAccessToken(): Promise<string | undefined> {
  if (!msal) return undefined;
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account) return undefined;
  const tokenResult = await msal.acquireTokenSilent({
    account,
    scopes: getScopes(),
  });
  return tokenResult.accessToken;
}
