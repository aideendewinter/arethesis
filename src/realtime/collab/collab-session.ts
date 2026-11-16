/**
 * CollabSession: real-time collaborative editing of one document over the
 * WebSocketManager, using operational transformation.
 *
 * ```ts
 * const session = app.collab.open('doc-42', textarea, { user: { name: 'Alice', color: '#e11d48' } });
 * session.on('presence', cursors => renderAvatars(cursors));
 * // later
 * session.close();
 * ```
 *
 * The server side is `CollabServer` (see `realtime/ot/server`).
 *
 * @module realtime/collab/collab-session
 */

import { OTClient } from '../ot/client';
import { TextOperation } from '../ot/text-operation';
import type { WebSocketManager } from '../websocket-manager';
import type { CollabMessage, CollabSelection, CollabUser, RemoteCursor } from '../types';
import { Emitter } from '../../utils/emitter';
import { TextareaAdapter, type EditorAdapter } from './textarea-adapter';
import { CursorOverlay } from './cursor-overlay';

export type CollabStatus = 'connecting' | 'synced' | 'syncing' | 'offline';

export interface CollabEvents extends Record<string, unknown> {
  /** The document content changed (locally or remotely). */
  change: { content: string; remote: boolean };
  /** Remote collaborators and their selections. */
  presence: RemoteCursor[];
  status: CollabStatus;
  error: { message: string };
  /** Initial content arrived. */
  ready: { content: string; revision: number };
}

export interface CollabOptions {
  user?: CollabUser;
  /** Draw remote cursors over a textarea. @default true */
  cursors?: boolean;
  /** Presence update throttle in ms. @default 50 */
  presenceInterval?: number;
}

interface InitPayload {
  content: string;
  revision: number;
  clientId: string;
  peers?: RemoteCursor[];
  since?: number | null;
  missed?: Array<{ op: unknown; opId?: string }>;
}

export class CollabSession extends Emitter<CollabEvents> {
  readonly docId: string;
  readonly channel: string;
  private client: OTClient | null = null;
  private adapter: EditorAdapter;
  private overlay: CursorOverlay | null = null;
  private cursors = new Map<string, RemoteCursor>();
  private unsubscribe: (() => void) | null = null;
  private offOpen: (() => void) | null = null;
  private offStatus: (() => void) | null = null;
  private outstandingOpId: string | null = null;
  private opCounter = 0;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private _status: CollabStatus = 'connecting';
  clientId: string | null = null;

  constructor(
    private ws: WebSocketManager,
    docId: string,
    target: HTMLTextAreaElement | HTMLInputElement | EditorAdapter,
    private options: CollabOptions = {}
  ) {
    super();
    this.docId = docId;
    this.channel = `doc:${docId}`;
    this.adapter = target instanceof HTMLElement ? new TextareaAdapter(target) : target;
    if (target instanceof HTMLTextAreaElement && options.cursors !== false) this.overlay = new CursorOverlay(target);
    if (target instanceof HTMLElement) target.setAttribute('aria-busy', 'true');

    this.adapter.attach(
      op => this.handleLocalEdit(op),
      selection => this.queuePresence(selection),
    );
    this.unsubscribe = ws.subscribe<CollabMessage>(this.channel, message => this.handleMessage(message));
    this.offOpen = ws.onOpen(() => this.join());
    this.offStatus = ws.onStatusChange(status => {
      if (status !== 'open') this.setStatus('offline');
    });
    if (ws.isConnected) this.join();
    else void ws.connect();
  }

  get status(): CollabStatus {
    return this._status;
  }

  get content(): string {
    return this.adapter.getValue();
  }

  get revision(): number {
    return this.client?.revision ?? 0;
  }

  /** Remote collaborators. */
  get peers(): RemoteCursor[] {
    return Array.from(this.cursors.values());
  }

  private setStatus(status: CollabStatus): void {
    if (status === this._status) return;
    this._status = status;
    this.emit('status', status);
  }

  private join(): void {
    this.setStatus('connecting');
    this.ws.send({ type: 'collab:join', channel: this.channel, payload: { user: this.options.user, revision: this.client?.revision } });
  }

  private handleMessage(message: CollabMessage): void {
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    switch (message.type) {
      case 'collab:init':
        this.handleInit(payload as unknown as InitPayload);
        break;
      case 'collab:op':
        if (!this.client || payload.clientId === this.clientId) return;
        this.client.applyServer(TextOperation.fromJSON(payload.op));
        this.updateStatus();
        break;
      case 'collab:ack':
        if (!this.client || (payload.opId && payload.opId !== this.outstandingOpId)) return;
        this.outstandingOpId = null;
        this.client.serverAck();
        this.updateStatus();
        break;
      case 'collab:presence': {
        const id = String(payload.clientId ?? '');
        if (!id || id === this.clientId) return;
        const existing = this.cursors.get(id);
        const selection = payload.selection as CollabSelection | undefined;
        this.cursors.set(id, {
          clientId: id,
          user: (payload.user as CollabUser | undefined) ?? existing?.user,
          selection: selection ? this.toLocal(selection) : existing?.selection,
        });
        this.emitPresence();
        break;
      }
      case 'collab:leave':
        if (this.cursors.delete(String(payload.clientId))) this.emitPresence();
        break;
      case 'collab:error':
        this.emit('error', { message: String(payload.message ?? 'Collaboration error') });
        break;
    }
  }

  private handleInit(init: InitPayload): void {
    this.clientId = init.clientId;
    if (!this.client || init.since === null || init.since === undefined || !init.missed) {
      // First sync (or the server could not replay): take the server's document.
      this.client = new OTClient(init.revision, {
        send: (revision, op) => this.sendOp(revision, op),
        apply: op => this.applyRemote(op),
      });
      this.outstandingOpId = null;
      this.adapter.setValue(init.content);
      this.emit('ready', { content: init.content, revision: init.revision });
      this.emit('change', { content: init.content, remote: true });
    } else {
      // Reconnected: replay what we missed; our own op in the list counts as an ack.
      for (const entry of init.missed) {
        if (entry.opId && entry.opId === this.outstandingOpId) {
          this.outstandingOpId = null;
          this.client.serverAck();
        } else {
          this.client.applyServer(TextOperation.fromJSON(entry.op));
        }
      }
      this.client.resend();
    }
    this.cursors.clear();
    for (const peer of init.peers ?? []) this.cursors.set(peer.clientId, peer);
    this.emitPresence();
    if (this.adapter instanceof TextareaAdapter) this.adapter.element.removeAttribute('aria-busy');
    this.updateStatus();
  }

  private sendOp(revision: number, op: TextOperation): void {
    this.outstandingOpId = `${this.clientId ?? 'c'}-${++this.opCounter}`;
    this.ws.send({ type: 'collab:op', channel: this.channel, payload: { revision, op: op.toJSON(), opId: this.outstandingOpId } });
  }

  private applyRemote(op: TextOperation): void {
    this.adapter.applyOperation(op);
    for (const cursor of this.cursors.values()) {
      if (cursor.selection) {
        cursor.selection = { anchor: op.transformIndex(cursor.selection.anchor), head: op.transformIndex(cursor.selection.head) };
      }
    }
    this.emitPresence();
    this.emit('change', { content: this.adapter.getValue(), remote: true });
  }

  private handleLocalEdit(op: TextOperation): void {
    if (!this.client) return; // not synced yet; the init will overwrite
    this.client.applyClient(op);
    for (const cursor of this.cursors.values()) {
      if (cursor.selection) {
        cursor.selection = { anchor: op.transformIndex(cursor.selection.anchor), head: op.transformIndex(cursor.selection.head) };
      }
    }
    this.emitPresence();
    this.updateStatus();
    this.emit('change', { content: this.adapter.getValue(), remote: false });
    this.queuePresence(this.adapter.getSelection());
  }

  private toLocal(selection: CollabSelection): CollabSelection {
    if (!this.client) return selection;
    return { anchor: this.client.transformIndex(selection.anchor), head: this.client.transformIndex(selection.head) };
  }

  private queuePresence(selection: CollabSelection): void {
    if (this.presenceTimer || !this.client) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.ws.send({ type: 'collab:presence', channel: this.channel, payload: { selection: this.adapter.getSelection() ?? selection, user: this.options.user } });
    }, this.options.presenceInterval ?? 50);
  }

  private emitPresence(): void {
    const peers = this.peers;
    this.overlay?.update(peers);
    this.emit('presence', peers);
  }

  private updateStatus(): void {
    if (!this.ws.isConnected) this.setStatus('offline');
    else this.setStatus(this.client?.state === 'synchronized' ? 'synced' : 'syncing');
  }

  /** Leave the document and clean up. */
  close(): void {
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    if (this.ws.isConnected) this.ws.send({ type: 'collab:leave', channel: this.channel });
    this.unsubscribe?.();
    this.offOpen?.();
    this.offStatus?.();
    this.adapter.destroy();
    this.overlay?.destroy();
    this.clear();
  }
}

/** Opens collaboration sessions on a WebSocketManager. */
export class CollabManager {
  constructor(private getWs: () => WebSocketManager | null) {}

  /** Start collaborating on `docId` in a textarea/input (or a custom adapter). */
  open(docId: string, target: HTMLTextAreaElement | HTMLInputElement | EditorAdapter, options: CollabOptions = {}): CollabSession {
    const ws = this.getWs();
    if (!ws) throw new Error('Collaboration needs a WebSocket: pass `websocket` to Arethesis.init().');
    return new CollabSession(ws, docId, target, options);
  }
}
