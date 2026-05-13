/**
 * WebSocket sync for the Denicek CRDT.
 *
 * Wraps the {@linkcode SyncClient} from `@mydenicek/sync` with
 * React-specific features: reactive status tracking and automatic
 * reconnection with exponential backoff.
 */

import type { Denicek, PlainNode } from "@mydenicek/core";
import type { SignedEvent, UnsignedEvent } from "@mydenicek/shared-types";
import { SyncClient as BaseSyncClient } from "@mydenicek/sync";

/** Reactive sync status. */
export type SyncStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "paused";

/** Options for connecting to a sync server. */
export interface SyncConnectionOptions {
  /** WebSocket URL of the sync server (e.g. `wss://host/sync`). */
  url: string;
  /** Room identifier to join. */
  roomId: string;
  /** Stable auth-bound peer ID sent to the sync server when enabled. */
  authPeerId?: string;
  /** Optional event signer for L4 event signatures. */
  signUnsignedEvent?: (event: UnsignedEvent) => Promise<SignedEvent>;
  /** Optional auth device GUID sent during WebSocket upgrade. */
  authDeviceGuid?: string;
}

/**
 * Manages a WebSocket connection for syncing a Denicek instance.
 *
 * - `connect()` / `disconnect()` — full lifecycle management with auto-reconnect.
 * - `pause()` / `resume()` — soft pause: socket stays open, messages buffered.
 * - `flush()` — send pending local events immediately.
 */
export class SyncClient {
  private inner: BaseSyncClient | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private opts: SyncConnectionOptions | null = null;
  private readonly initialDocumentSnapshot: PlainNode;

  status: SyncStatus = "idle";

  constructor(
    private denicek: Denicek,
    private onStatusChange: (s: SyncStatus) => void,
    private onRemoteChange: () => void,
  ) {
    this.initialDocumentSnapshot = denicek.materialize();
  }

  /** Connect (or reconnect) to a sync server. */
  connect(opts: SyncConnectionOptions): void {
    this.disconnect();
    this.opts = opts;
    this.setStatus("connecting");

    const inner = new BaseSyncClient({
      url: opts.url,
      roomId: opts.roomId,
      document: this.denicek,
      initialDocument: this.initialDocumentSnapshot,
      onRemoteChange: () => this.onRemoteChange(),
      authPeerId: opts.authPeerId,
      signUnsignedEvent: opts.signUnsignedEvent,
      authDeviceGuid: opts.authDeviceGuid,
      onDisconnect: () => {
        if (this.inner !== inner || !this.opts) return;
        this.inner = null;
        this.setStatus("disconnected");
        this.scheduleReconnect();
      },
    });
    this.inner = inner;

    inner.connect().then(
      () => {
        if (this.inner === inner) {
          this.reconnectDelay = 1000;
          this.setStatus("connected");
        }
      },
      () => {
        if (this.inner !== inner || !this.opts) return;
        this.inner = null;
        this.setStatus("disconnected");
        this.scheduleReconnect();
      },
    );
  }

  /** Disconnect from the sync server and stop auto-reconnect. */
  disconnect(): void {
    this.clearReconnectTimer();
    this.opts = null;
    if (this.inner) {
      this.inner.close();
      this.inner = null;
      this.setStatus("idle");
    }
  }

  /** Pause syncing: socket stays open, messages buffered, sends suppressed. */
  pause(): void {
    this.clearReconnectTimer();
    this.inner?.pause();
    this.setStatus("paused");
  }

  /** Resume syncing: replay buffered messages and flush pending edits. */
  resume(): void {
    if (this.inner) {
      this.inner.resume();
      this.setStatus("connected");
    } else if (this.opts) {
      this.connect(this.opts);
    }
  }

  /** Send any pending local events to the server. */
  flush(): void {
    if (this.inner?.paused === false) {
      this.inner.syncNow();
    }
  }

  private setStatus(s: SyncStatus): void {
    if (this.status !== s) {
      this.status = s;
      this.onStatusChange(s);
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.opts) return;
    this.reconnectTimer = setTimeout(() => {
      if (this.opts) this.connect(this.opts);
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }
}
