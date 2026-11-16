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
import type { CollabMessage, CollabUser, PresencePayload } from '../types';

export class OTDocumentServer {
  readonly operations: TextOperation[] = [];
  /** Client op ids, parallel to `operations` (lets reconnecting clients spot their own ops). */
  readonly opIds: Array<string | undefined> = [];

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
    return op;
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
        this.send(clientId, { type: 'collab:init', channel: message.channel, payload: { content: doc.document, revision: doc.revision, clientId, peers, since, missed } });
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
