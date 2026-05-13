import type { Denicek, PlainNode } from "@mydenicek/react";
import { useDenicek } from "@mydenicek/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SignedEvent, UnsignedEvent } from "@mydenicek/shared-types";

import { CommandBar } from "./CommandBar.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { EventGraphView } from "./EventGraphView.tsx";
import { INITIAL_DOCUMENT, initializeActions } from "./initializeDocument.ts";
import { RawDocumentView } from "./RawDocumentView.tsx";
import { RenderedDocument } from "./RenderedDocument.tsx";
import {
  clearStoredKeypair,
  type DeviceKeypair,
  getOrCreateDeviceIdentity,
  revokePeerKey,
  signOutgoingEvent,
} from "./security.ts";

// @ts-ignore: Vite injects import.meta.env at build time
const VITE_SYNC_URL: string | undefined = import.meta.env?.VITE_SYNC_URL;
// @ts-ignore: Vite injects import.meta.env at build time
const VITE_ACL_URL: string = import.meta.env?.VITE_ACL_URL ?? "/api/acl";
// @ts-ignore: Vite injects import.meta.env at build time
const VITE_AUTH_ENABLED: boolean = import.meta.env?.VITE_AUTH_ENABLED === "true";
const SYNC_SERVER_URL: string = VITE_SYNC_URL ??
  (globalThis.location?.hostname === "localhost"
    ? "ws://localhost:8787/sync"
    : "wss://mydenicek-core-krsion-dev-sync.happyisland-d6dda219.westeurope.azurecontainerapps.io/sync");

// Warm up the sync server (Azure Container Apps cold start) by hitting
// the health endpoint as early as possible. Fire-and-forget.
const HEALTH_URL = SYNC_SERVER_URL
  .replace(/^ws/, "http")
  .replace(/\/sync$/, "/healthz");
fetch(HEALTH_URL).catch(() => {});

const PEER_SESSION_KEY = "mydenicek-peer-id";

/** Unique peer ID per tab, survives refreshes via sessionStorage. */
function getOrCreatePeerId(): string {
  const stored = globalThis.sessionStorage?.getItem(PEER_SESSION_KEY);
  if (stored) return stored;
  const id = crypto.randomUUID().slice(0, 7);
  globalThis.sessionStorage?.setItem(PEER_SESSION_KEY, id);
  return id;
}

interface AuthBootstrap {
  oid: string;
  token: string;
}

const statusColors: Record<string, string> = {
  connected: "#107c10",
  connecting: "#ca5010",
  disconnected: "#d13438",
  idle: "#8a8a8a",
};

const defaultPanels = { rendered: true, raw: true, events: true };

function Editor(
  {
    peerId,
    roomId,
    initialDocument,
    runInitActions,
    signUnsignedEvent,
    authDeviceGuid,
  }: {
    peerId: string;
    roomId: string;
    initialDocument?: PlainNode;
    runInitActions?: (dk: Denicek) => void;
    signUnsignedEvent?: (event: UnsignedEvent) => Promise<SignedEvent>;
    authDeviceGuid?: string;
  },
) {
  // If no initial document, fetch it from the sync server hello
  const [resolvedDoc, setResolvedDoc] = useState<
    PlainNode | undefined
  >(initialDocument);
  const [loading, setLoading] = useState(!initialDocument);

  useEffect(() => {
    if (initialDocument) return;
    let cancelled = false;
    let currentWs: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Poll the server until the room has been bootstrapped (i.e. the hello
    // message carries a non-undefined initialDocument). Without this, a second
    // peer who arrives before the first peer's initial sync round-trip would
    // get hello.initialDocument === undefined, instantiate a Denicek with an
    // empty default document, and then fail hash validation on its first
    // sync — after which the server silently excludes it from broadcasts.
    const openOnce = () => {
      if (cancelled) return;
      const url = new URL(SYNC_SERVER_URL);
      url.searchParams.set("room", roomId);
      const ws = new WebSocket(url.toString());
      currentWs = ws;
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "hello") {
            if (msg.initialDocument) {
              if (cancelled) return;
              setResolvedDoc(msg.initialDocument);
              setLoading(false);
              ws.close();
            } else {
              // Room not yet bootstrapped — close and retry shortly.
              ws.close();
              if (!cancelled) {
                retryTimer = setTimeout(openOnce, 500);
              }
            }
          }
        } catch { /* ignore */ }
      };
      ws.onerror = () => {
        if (!cancelled) {
          retryTimer = setTimeout(openOnce, 1000);
        }
      };
    };
    openOnce();

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      currentWs?.close();
    };
  }, [initialDocument, roomId]);

  if (loading) {
    return (
      <div style={{ padding: 24, color: "#888" }}>
        Connecting to room {roomId}…
      </div>
    );
  }

  return (
    <EditorInner
      peerId={peerId}
      roomId={roomId}
      initialDocument={resolvedDoc}
      runInitActions={runInitActions}
      signUnsignedEvent={signUnsignedEvent}
      authDeviceGuid={authDeviceGuid}
    />
  );
}

function EditorInner(
  {
    peerId,
    roomId,
    initialDocument,
    runInitActions,
    signUnsignedEvent,
    authDeviceGuid,
  }: {
    peerId: string;
    roomId: string;
    initialDocument?: PlainNode;
    runInitActions?: (dk: Denicek) => void;
    signUnsignedEvent?: (event: UnsignedEvent) => Promise<SignedEvent>;
    authDeviceGuid?: string;
  },
) {
  const dk = useDenicek({
    peer: peerId,
    initialDocument,
    sync: {
      url: SYNC_SERVER_URL,
      roomId,
      authPeerId: signUnsignedEvent ? peerId : undefined,
      signUnsignedEvent,
      authDeviceGuid,
    },
  });

  // Run init actions once and flush to server immediately
  const initialized = useRef(false);
  if (!initialized.current && runInitActions) {
    // Only run if this is a fresh document (no events from server yet)
    if (dk.denicek.inspectEvents().length === 0) {
      runInitActions(dk.denicek);
    }
    initialized.current = true;
    dk.forceUpdate();
  }

  const [syncEnabled, setSyncEnabled] = useState(true);
  const PANELS_KEY = "mydenicek-panels";
  const [panels, setPanels] = useState(() => {
    try {
      const stored = sessionStorage.getItem(PANELS_KEY);
      if (stored) return JSON.parse(stored) as typeof defaultPanels;
    } catch { /* ignore */ }
    return defaultPanels;
  });

  const togglePanel = (key: keyof typeof panels) =>
    setPanels((p) => {
      const next = { ...p, [key]: !p[key] };
      try {
        sessionStorage.setItem(PANELS_KEY, JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });

  const toggleSync = () => {
    if (syncEnabled) {
      dk.pauseSync();
    } else {
      dk.resumeSync();
    }
    setSyncEnabled(!syncEnabled);
  };

  const activePanels = Object.entries(panels).filter(([, on]) => on);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          background: "#f5f5f5",
          borderBottom: "1px solid #e0e0e0",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 600, color: "#242424" }}>
          mydenicek
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {(["rendered", "raw", "events"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => togglePanel(key)}
              style={{
                padding: "4px 12px",
                fontSize: 12,
                cursor: "pointer",
                background: panels[key] ? "#0078d4" : "transparent",
                color: panels[key] ? "#fff" : "#616161",
                border: panels[key] ? "1px solid #0078d4" : "1px solid #d0d0d0",
                borderRadius: 4,
              }}
            >
              {key === "rendered"
                ? "Document"
                : key === "raw"
                ? "Raw JSON"
                : "Event Graph"}
            </button>
          ))}
        </div>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 12,
            color: statusColors[dk.syncStatus] ?? "#8a8a8a",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          ● {dk.syncStatus} — peer: {peerId} — room: {roomId}
          <button
            type="button"
            onClick={toggleSync}
            style={{
              padding: "2px 8px",
              fontSize: 11,
              cursor: "pointer",
              background: syncEnabled ? "#d13438" : "#107c10",
              color: "#fff",
              border: "none",
              borderRadius: 3,
            }}
          >
            {syncEnabled ? "Disconnect" : "Connect"}
          </button>
        </span>
      </div>

      {/* Main area — side-by-side panels */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {activePanels.length === 0 && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#888",
            }}
          >
            Toggle a panel above
          </div>
        )}
        {panels.rendered && (
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: 24,
              borderRight: activePanels.length > 1
                ? "1px solid #e0e0e0"
                : undefined,
            }}
          >
            <ErrorBoundary>
              <RenderedDocument
                doc={dk.doc}
                onAction={(scriptPath) => {
                  try {
                    dk.denicek.repeatEditsFrom(scriptPath);
                    dk.forceUpdate();
                  } catch (e) {
                    console.error("Action failed:", e);
                  }
                }}
                onSetValue={(valuePath, value) => {
                  try {
                    dk.set(valuePath, value);
                  } catch (e) {
                    console.error("Set failed:", e);
                  }
                }}
              />
            </ErrorBoundary>
          </div>
        )}
        {panels.raw && (
          <div
            style={{
              flex: 1,
              overflow: "auto",
              borderRight: panels.events ? "1px solid #e0e0e0" : undefined,
            }}
          >
            <RawDocumentView doc={dk.doc} />
          </div>
        )}
        {panels.events && (
          <div style={{ flex: 1, overflow: "auto" }}>
            <EventGraphView
              denicek={dk.denicek}
              version={dk.version}
              onReplay={(eventId) => {
                try {
                  dk.denicek.repeatEditFromEventId(eventId);
                  dk.forceUpdate();
                } catch (e) {
                  console.error("Replay failed:", e);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Bottom command bar */}
      <ErrorBoundary>
        <CommandBar dk={dk} />
      </ErrorBoundary>
    </div>
  );
}

interface Template {
  name: string;
  initialDocument?: PlainNode;
  initActions?: (dk: Denicek) => void;
}

const TEMPLATES: Template[] = [
  {
    name: "Formative Examples",
    initialDocument: INITIAL_DOCUMENT,
    initActions: initializeActions,
  },
  { name: "Empty", initialDocument: { $tag: "root" } },
];

interface DocTab {
  id: string;
  template?: Template;
}

function createTab(template: Template): DocTab {
  const id = crypto.randomUUID().slice(0, 8);
  return { id, template };
}

export function App() {
  const [authBootstrap, setAuthBootstrap] = useState<AuthBootstrap | null>(
    null,
  );
  const [deviceKeypair, setDeviceKeypair] = useState<DeviceKeypair | null>(
    null,
  );
  const [peerId, setPeerId] = useState(() => getOrCreatePeerId());

  useEffect(() => {
    if (!VITE_AUTH_ENABLED) return;
    const oid = globalThis.localStorage?.getItem("mydenicek.auth.oid") ?? "";
    const token = globalThis.localStorage?.getItem("mydenicek.auth.token") ??
      "";
    if (!oid || !token) {
      return;
    }
    const auth: AuthBootstrap = { oid, token };
    setAuthBootstrap(auth);
    getOrCreateDeviceIdentity(auth, VITE_ACL_URL).then(
      ({ keypair, peerId }) => {
        setDeviceKeypair(keypair);
        setPeerId(peerId);
      },
    ).catch((error) => {
      console.error("Failed to initialize device identity", error);
    });
  }, []);

  const signUnsignedEvent = useMemo(() => {
    if (!VITE_AUTH_ENABLED || !deviceKeypair) return undefined;
    return (event: UnsignedEvent) => signOutgoingEvent(event, deviceKeypair);
  }, [deviceKeypair]);

  const handleForgetDevice = useCallback(async () => {
    if (!authBootstrap || !deviceKeypair) return;
    await revokePeerKey(VITE_ACL_URL, authBootstrap, deviceKeypair.deviceGuid);
    await clearStoredKeypair();
    setDeviceKeypair(null);
  }, [authBootstrap, deviceKeypair]);

  const [tabs, setTabs] = useState<DocTab[]>(() => {
    const hash = globalThis.location?.hash?.slice(1);
    if (hash) return [{ id: hash }];
    return [];
  });
  const [activeTab, setActiveTab] = useState<string | null>(
    () => globalThis.location?.hash?.slice(1) || null,
  );

  const addFromTemplate = (template: Template) => {
    const tab = createTab(template);
    globalThis.location.hash = tab.id;
    setTabs((prev) => [...prev, tab]);
    setActiveTab(tab.id);
  };

  const openRoom = useCallback((roomId: string) => {
    setTabs((prev) => {
      if (prev.some((t) => t.id === roomId)) return prev;
      return [...prev, { id: roomId }];
    });
    setActiveTab(roomId);
  }, []);

  // Listen for hash changes (e.g. pasting a link while app is open)
  useEffect(() => {
    const onHashChange = () => {
      const hash = globalThis.location.hash.slice(1);
      if (hash) openRoom(hash);
    };
    globalThis.addEventListener("hashchange", onHashChange);
    return () => globalThis.removeEventListener("hashchange", onHashChange);
  }, [openRoom]);

  const tab = activeTab ? tabs.find((t) => t.id === activeTab) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 2,
          padding: "4px 16px",
          background: "#e8e8e8",
          borderBottom: "1px solid #d0d0d0",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setActiveTab(t.id);
              globalThis.location.hash = t.id;
            }}
            style={{
              padding: "4px 12px",
              fontSize: 12,
              cursor: "pointer",
              background: t.id === activeTab ? "#fff" : "transparent",
              color: t.id === activeTab ? "#242424" : "#666",
              border: t.id === activeTab
                ? "1px solid #d0d0d0"
                : "1px solid transparent",
              borderBottom: t.id === activeTab ? "1px solid #fff" : undefined,
              borderRadius: "4px 4px 0 0",
              marginBottom: -1,
            }}
          >
            {t.id.slice(0, 8)}
          </button>
        ))}
        <span
          style={{ borderLeft: "1px solid #ccc", height: 16, margin: "0 4px" }}
        />
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.name}
            type="button"
            onClick={() => addFromTemplate(tpl)}
            style={{
              padding: "4px 8px",
              fontSize: 11,
              cursor: "pointer",
              background: "transparent",
              color: "#0078d4",
              border: "1px solid #ccc",
              borderRadius: 4,
            }}
            title={`New ${tpl.name} document`}
          >
            + {tpl.name}
          </button>
        ))}
        {VITE_AUTH_ENABLED && (
          <button
            type="button"
            onClick={handleForgetDevice}
            style={{
              marginLeft: "auto",
              padding: "4px 8px",
              fontSize: 11,
              cursor: "pointer",
              background: "transparent",
              color: "#a4262c",
              border: "1px solid #d0d0d0",
              borderRadius: 4,
            }}
          >
            Sign out &amp; forget this device
          </button>
        )}
      </div>

      {/* Active editor or landing */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab
          ? (
            <Editor
              key={tab.id}
              peerId={peerId}
              roomId={tab.id}
              initialDocument={tab.template?.initialDocument}
              runInitActions={tab.template?.initActions}
              signUnsignedEvent={signUnsignedEvent}
              authDeviceGuid={deviceKeypair?.deviceGuid}
            />
          )
          : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#888",
                fontSize: 14,
              }}
            >
              Create a document using a template above
            </div>
          )}
      </div>
    </div>
  );
}
