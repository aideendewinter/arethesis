/**
 * Reference OT server, usable in Node or in the browser (the examples run it
 * inside a mock backend).
 *
 * `OTDocumentServer` holds one document and its history. `CollabServer`
 * speaks the `collab:*` message protocol used by `CollabSession`, for any
 * number of documents and clients, over whatever transport you give it.
 *
 * ```ts
 * const server = new CollabServer((clientId, message) => sockets.get(clientId)?.send(JSON.stringify(message)));
 * socket.on('message', raw => server.handle(clientId, JSON.parse(raw)));
 * socket.on('close', () => server.disconnect(clientId));
 * ```
 *
 * @module realtime/ot/server
 */

import { TextOperation } from './text-operation';
import { transformRange } from '../collab/anchors';
import type { AnnotatePayload, CollabAnnotation, CollabMessage, CollabUser, PresencePayload } from '../types';

const MAX_ANNOTATIONS = 500;
const MAX_ANNOTATION_TEXT = 4000;

export class OTDocumentServer {
  readonly operations: TextOperation[] = [];
  /** Client op ids, parallel to `operations` (lets reconnecting clients spot their own ops). */
  readonly opIds: Array<string | undefined> = [];
  /** Annotations (comments), kept anchored to their text as operations arrive. */
  readonly annotations = new Map<string, CollabAnnotation>();

  constructor(public document = '') {}

  get revision(): number {
    return this.operations.length;
  }

  /**
   * Accept an operation made against `revision`. Returns the transformed
   * operation that was applied (broadcast it to the other clients).
   */
  receive(revision: number, operation: TextOperation, opId?: string): TextOperation {
    if (revision < 0 || revision > this.operations.length) throw new Error(`Invalid revision ${revision}`);
    let op = operation;
    for (const concurrent of this.operations.slice(revision)) {
      op = TextOperation.transform(op, concurrent)[0];
    }
    this.document = op.apply(this.document);
    this.operations.push(op);
    this.opIds.push(opId);
    for (const [id, a] of this.annotations) this.annotations.set(id, transformRange(a, op));
    return op;
  }

  /** Map a range made against `revision` to the current document. */
  rebaseRange(from: number, to: number, revision: number): { from: number; to: number } {
    let range = { from, to };
    for (const op of this.operations.slice(Math.max(0, Math.min(revision, this.operations.length)))) range = transformRange(range, op);
    const clamp = (n: number) => Math.max(0, Math.min(n, this.document.length));
    return { from: clamp(range.from), to: clamp(Math.max(range.from, range.to)) };
  }

  /**
   * Apply an annotation change made against `revision`. Returns the stored
   * annotation (positions at the current revision), or null if it was invalid.
   */
  annotate(payload: AnnotatePayload, user?: CollabUser): CollabAnnotation | null {
    const input = payload.annotation;
    if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 100) return null;
    const existing = this.annotations.get(input.id);
    if (payload.action === 'remove') {
      if (!existing) return null;
      this.annotations.delete(input.id);
      return existing;
    }
    const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_ANNOTATION_TEXT) : undefined);
    const revision = typeof payload.revision === 'number' ? payload.revision : this.revision;
    let range = existing ? { from: existing.from, to: existing.to } : null;
    if (typeof input.from === 'number' && typeof input.to === 'number' && input.from <= input.to) range = this.rebaseRange(input.from, input.to, revision);
    if (!range) return null;
    if (payload.action === 'add') {
      if (existing || this.annotations.size >= MAX_ANNOTATIONS) return null;
      const created: CollabAnnotation = { id: input.id, ...range, body: text(input.body) ?? '', user: user ?? input.user, resolved: false, createdAt: typeof input.createdAt === 'number' ? input.createdAt : Date.now(), replies: [] };
      this.annotations.set(input.id, created);
      return created;
    }
    if (!existing) return null;
    const replies = Array.isArray(input.replies)
      ? input.replies.slice(0, 200).map(r => ({ body: text(r?.body) ?? '', user: r?.user, createdAt: typeof r?.createdAt === 'number' ? r.createdAt : undefined }))
      : existing.replies;
    const updated: CollabAnnotation = { ...existing, ...range, body: text(input.body) ?? existing.body, resolved: typeof input.resolved === 'boolean' ? input.resolved : existing.resolved, replies };
    this.annotations.set(input.id, updated);
    return updated;
  }
}

interface ClientInfo {
  docs: Set<string>;
  user?: CollabUser;
  selection?: PresencePayload['selection'];
}

export class CollabServer {
  private docs = new Map<string, OTDocumentServer>();
  private clients = new Map<string, ClientInfo>();

  /**
   * @param send Deliver a message to one client.
   * @param loadDocument Initial content for a document opened for the first time.
   */
  constructor(
    private send: (clientId: string, message: CollabMessage) => void,
    private loadDocument: (docId: string) => string = () => ''
  ) {}

  /** Access (or create) a document. */
  document(docId: string): OTDocumentServer {
    let doc = this.docs.get(docId);
    if (!doc) {
      doc = new OTDocumentServer(this.loadDocument(docId));
      this.docs.set(docId, doc);
    }
    return doc;
  }

  private membersOf(docId: string): string[] {
    return Array.from(this.clients.entries()).filter(([, c]) => c.docs.has(docId)).map(([id]) => id);
  }

  private broadcast(docId: string, message: CollabMessage, except?: string): void {
    for (const id of this.membersOf(docId)) if (id !== except) this.send(id, message);
  }

  /** Handle one incoming message from a client. */
  handle(clientId: string, message: CollabMessage): void {
    const docId = message.channel?.replace(/^doc:/, '') ?? '';
    if (!docId) return;
    let client = this.clients.get(clientId);
    if (!client) {
      client = { docs: new Set() };
      this.clients.set(clientId, client);
    }

    switch (message.type) {
      case 'collab:join': {
        client.docs.add(docId);
        const join = (message.payload ?? {}) as { user?: CollabUser; revision?: number };
        client.user = join.user;
        const doc = this.document(docId);
        // A reconnecting client sends its revision and gets the ops it missed.
        const since = typeof join.revision === 'number' && join.revision >= 0 && join.revision <= doc.revision ? join.revision : null;
        const missed = since === null ? undefined : doc.operations.slice(since).map((op, i) => ({ op: op.toJSON(), opId: doc.opIds[since + i] }));
        const peers = this.membersOf(docId)
          .filter(id => id !== clientId)
          .map(id => ({ clientId: id, user: this.clients.get(id)?.user, selection: this.clients.get(id)?.selection }));
        const annotations = [...doc.annotations.values()];
        this.send(clientId, { type: 'collab:init', channel: message.channel, payload: { content: doc.document, revision: doc.revision, clientId, peers, since, missed, annotations } });
        this.broadcast(docId, { type: 'collab:presence', channel: message.channel, payload: { clientId, user: client.user } }, clientId);
        return;
      }
      case 'collab:op': {
        if (!client.docs.has(docId)) return;
        const { revision, op, opId } = message.payload as { revision: number; op: unknown; opId?: string };
        let applied: TextOperation;
        try {
          applied = this.document(docId).receive(revision, TextOperation.fromJSON(op), opId);
        } catch (err) {
          this.send(clientId, { type: 'collab:error', channel: message.channel, payload: { opId, message: (err as Error).message } });
          return;
        }
        const newRevision = this.document(docId).revision;
        this.send(clientId, { type: 'collab:ack', channel: message.channel, payload: { revision: newRevision, opId } });
        this.broadcast(docId, { type: 'collab:op', channel: message.channel, payload: { op: applied.toJSON(), revision: newRevision, clientId } }, clientId);
        return;
      }
      case 'collab:presence': {
        if (!client.docs.has(docId)) return;
        const payload = message.payload as PresencePayload;
        client.selection = payload.selection;
        if (payload.user) client.user = payload.user;
        this.broadcast(docId, { type: 'collab:presence', channel: message.channel, payload: { clientId, user: client.user, selection: payload.selection, revision: this.document(docId).revision } }, clientId);
        return;
      }
      case 'collab:annotate': {
        if (!client.docs.has(docId)) return;
        const payload = message.payload as AnnotatePayload;
        const doc = this.document(docId);
        const annotation = doc.annotate(payload, client.user);
        if (!annotation) {
          this.send(clientId, { type: 'collab:error', channel: message.channel, payload: { message: 'Invalid annotation' } });
          return;
        }
        // Everyone, including the sender, gets the stored version at the current revision.
        this.broadcast(docId, { type: 'collab:annotate', channel: message.channel, payload: { action: payload.action, annotation, revision: doc.revision } });
        return;
      }
      case 'collab:leave':
        this.leave(clientId, docId);
        return;
    }
  }

  private leave(clientId: string, docId: string): void {
    const client = this.clients.get(clientId);
    if (!client?.docs.delete(docId)) return;
    this.broadcast(docId, { type: 'collab:leave', channel: `doc:${docId}`, payload: { clientId } });
  }

  /** A client went away: leave every document. */
  disconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    for (const docId of [...client.docs]) this.leave(clientId, docId);
    this.clients.delete(clientId);
  }
}
