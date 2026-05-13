// MSAL configuration — only active when VITE_AUTH_ENABLED=true
import type { Configuration } from "@azure/msal-browser";

export const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID ?? "",
    authority: `https://login.microsoftonline.com/${
      import.meta.env.VITE_AZURE_TENANT_ID ?? "common"
    }`,
    redirectUri: globalThis.location?.origin ?? "",
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: [
    "openid",
    "profile",
    "email",
    `api://${import.meta.env.VITE_AZURE_CLIENT_ID ?? ""}/CRDT.ReadWrite`,
  ],
};
