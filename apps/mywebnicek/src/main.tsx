import { MsalProvider } from "@azure/msal-react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { getMsalInstance } from "./auth.ts";

const msal = getMsalInstance();

createRoot(document.getElementById("root")!).render(
  msal
    ? (
      <MsalProvider instance={msal}>
        <App />
      </MsalProvider>
    )
    : <App />,
);
