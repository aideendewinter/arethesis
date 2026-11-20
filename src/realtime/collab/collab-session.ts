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
import type { AnnotatePayload, CollabAnnotation, CollabMessage, CollabSelection, CollabUser, RemoteCursor } from '../types';
import { Emitter } from '../../utils/emitter';
import { TextareaAdapter, type EditorAdapter } from './textarea-adapter';
import { CursorOverlay } from './cursor-overlay';
import { caretAfter, UndoManager } from './undo-manager';
import { mapRange, transformRange } from './anchors';

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
  /** Annotations (comments) changed: added, edited, removed, or moved by edits. */
  annotations: CollabAnnotation[];
}

export interface CollabOptions {
  user?: CollabUser;
  /** Draw remote cursors over a textarea. @default true */
  cursors?: boolean;
  /** Presence update throttle in ms. @default 50 */
  presenceInterval?: number;
  /**
   * Per-user undo and redo: Ctrl/Cmd+Z (and Shift+Z, or Y) revert only your
   * own edits, even after other people's. Replaces the browser's undo, which
   * doesn't know about remote edits. @default false
   */
  undo?: boolean;
}

interface InitPayload {
  content: string;
  revision: number;
  clientId: string;
  peers?: RemoteCursor[];
  since?: number | null;
  missed?: Array<{ op: unknown; opId?: string }>;
  annotations?: CollabAnnotation[];
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
  /** The textarea's own readOnly, restored once the document has loaded. */
  private wasReadOnly: boolean | null = null;
  private history: UndoManager | null = null;
  /** The content as of the last change, for computing undo steps. */
  private lastContent = '';
  private annotationMap = new Map<string, CollabAnnotation>();
  /** Annotation changes made while our own edits are in flight, sent once synchronized. */
  private pendingAnnotations: AnnotatePayload[] = [];
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
    if (target instanceof HTMLElement) {
      target.setAttribute('aria-busy', 'true');
      // Typing before the document has loaded would be overwritten by it: wait.
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        this.wasReadOnly = target.readOnly;
        target.readOnly = true;
      }
    }

    this.adapter.attach(
      op => this.handleLocalEdit(op),
      selection => this.queuePresence(selection),
    );
    if (options.undo) {
      this.history = new UndoManager();
      this.adapter.attachHistory?.(() => this.undo(), () => this.redo());
    }
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

  /** Annotations (comments), in document order, with positions in the local document. */
  get annotations(): CollabAnnotation[] {
    return [...this.annotationMap.values()].sort((a, b) => a.from - b.from || a.to - b.to);
  }

  /** Whether `undo()` / `redo()` would do anything (with `{ undo: true }`). */
  get canUndo(): boolean {
    return this.history?.canUndo ?? false;
  }

  get canRedo(): boolean {
    return this.history?.canRedo ?? false;
  }

  /** Undo your last edit (needs `{ undo: true }`). Returns whether anything changed. */
  undo(): boolean {
    return this.applyHistory(this.history?.undo(this.adapter.getValue()) ?? null);
  }

  /** Redo your last undone edit (needs `{ undo: true }`). */
  redo(): boolean {
    return this.applyHistory(this.history?.redo(this.adapter.getValue()) ?? null);
  }

  private applyHistory(op: TextOperation | null): boolean {
    if (!op || !this.client || !this.adapter.applyLocal) return false;
    this.adapter.applyLocal(op, caretAfter(op));
    this.commitLocal(op);
    return true;
  }

  /**
   * Comment on the text from `from` to `to` (local positions). The comment
   * appears (in the `annotations` event) once the server has stored it.
   * Returns its id.
   */
  annotate(from: number, to: number, body: string, id = `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`): string {
    this.sendAnnotation({ action: 'add', annotation: { id, from: Math.min(from, to), to: Math.max(from, to), body, user: this.options.user, createdAt: Date.now() } });
    return id;
  }

  /** Change an annotation: its body, `resolved`, `replies`, or its range (local positions). */
  updateAnnotation(id: string, changes: Partial<Omit<CollabAnnotation, 'id'>>): void {
    this.sendAnnotation({ action: 'update', annotation: { ...changes, id } });
  }

  removeAnnotation(id: string): void {
    this.sendAnnotation({ action: 'remove', annotation: { id } });
  }

  private sendAnnotation(payload: AnnotatePayload): void {
    this.pendingAnnotations.push(payload);
    this.flushAnnotations();
  }

  /**
   * Positions only mean something at a revision. While our own edits are in
   * flight, the local document is ahead of every server revision, so wait
   * until they're acknowledged.
   */
  private flushAnnotations(): void {
    if (!this.client || this.client.state !== 'synchronized' || !this.ws.isConnected) return;
    for (const payload of this.pendingAnnotations.splice(0)) {
      this.ws.send({ type: 'collab:annotate', channel: this.channel, payload: { ...payload, revision: this.client.revision } });
    }
  }

  private toLocalRange(a: CollabAnnotation): CollabAnnotation {
    const client = this.client;
    return client ? mapRange(a, (i, stickLeft) => client.transformIndex(i, stickLeft)) : a;
  }

  private emitAnnotations(): void {
    this.emit('annotations', this.annotations);
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
      case 'collab:annotate': {
        const { action, annotation } = payload as unknown as AnnotatePayload;
        if (!annotation?.id) return;
        if (action === 'remove') this.annotationMap.delete(annotation.id);
        else this.annotationMap.set(annotation.id, this.toLocalRange(annotation as CollabAnnotation));
        this.emitAnnotations();
        break;
      }
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
      this.lastContent = init.content;
      this.history?.clear();
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
    this.annotationMap.clear();
    for (const a of init.annotations ?? []) this.annotationMap.set(a.id, this.toLocalRange(a));
    this.emitAnnotations();
    if (this.adapter instanceof TextareaAdapter) {
      this.adapter.element.removeAttribute('aria-busy');
      if (this.wasReadOnly !== null) this.adapter.element.readOnly = this.wasReadOnly;
      this.wasReadOnly = null;
    }
    this.updateStatus();
  }

  private sendOp(revision: number, op: TextOperation): void {
    this.outstandingOpId = `${this.clientId ?? 'c'}-${++this.opCounter}`;
    this.ws.send({ type: 'collab:op', channel: this.channel, payload: { revision, op: op.toJSON(), opId: this.outstandingOpId } });
  }

  private applyRemote(op: TextOperation): void {
    this.adapter.applyOperation(op);
    this.lastContent = this.adapter.getValue();
    this.history?.transform(op);
    this.moveAnnotations(op);
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
    this.history?.record(op, this.lastContent);
    this.commitLocal(op);
  }

  /** A local edit (typed, or an undo/redo) that is already in the editor. */
  private commitLocal(op: TextOperation): void {
    if (!this.client) return;
    this.lastContent = this.adapter.getValue();
    this.client.applyClient(op);
    for (const cursor of this.cursors.values()) {
      if (cursor.selection) {
        cursor.selection = { anchor: op.transformIndex(cursor.selection.anchor), head: op.transformIndex(cursor.selection.head) };
      }
    }
    this.moveAnnotations(op);
    this.emitPresence();
    this.updateStatus();
    this.emit('change', { content: this.adapter.getValue(), remote: false });
    this.queuePresence(this.adapter.getSelection());
  }

  private moveAnnotations(op: TextOperation): void {
    if (!this.annotationMap.size) return;
    for (const [id, a] of this.annotationMap) this.annotationMap.set(id, transformRange(a, op));
    this.emitAnnotations();
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
    this.flushAnnotations();
  }

  /** Leave the document and clean up. */
  close(): void {
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    if (this.ws.isConnected) this.ws.send({ type: 'collab:leave', channel: this.channel });
    this.unsubscribe?.();
    this.offOpen?.();
    this.offStatus?.();
    if (this.adapter instanceof TextareaAdapter && this.wasReadOnly !== null) {
      this.adapter.element.readOnly = this.wasReadOnly;
      this.adapter.element.removeAttribute('aria-busy');
    }
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
