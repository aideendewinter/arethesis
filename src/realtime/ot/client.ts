/**
 * OTClient: the client half of the OT protocol.
 *
 * At most one operation is in flight; edits made while waiting for its
 * acknowledgement are composed into a buffer. Incoming server operations are
 * transformed against both, so local and remote edits converge.
 *
 * States: `synchronized` → `awaiting` (one op in flight) → `buffering`
 * (in flight + buffered).
 *
 * @module realtime/ot/client
 */

import { TextOperation } from './text-operation';

export type OTClientState = 'synchronized' | 'awaiting' | 'buffering';

export interface OTClientCallbacks {
  /** Send an operation made against `revision` to the server. */
  send(revision: number, operation: TextOperation): void;
  /** Apply a (transformed) remote operation to the local document. */
  apply(operation: TextOperation): void;
}

export class OTClient {
  revision: number;
  private outstanding: TextOperation | null = null;
  private buffer: TextOperation | null = null;

  constructor(revision: number, private callbacks: OTClientCallbacks) {
    this.revision = revision;
  }

  get state(): OTClientState {
    return this.buffer ? 'buffering' : this.outstanding ? 'awaiting' : 'synchronized';
  }

  /** The user edited the document. */
  applyClient(operation: TextOperation): void {
    if (operation.isNoop()) return;
    if (!this.outstanding) {
      this.outstanding = operation;
      this.callbacks.send(this.revision, operation);
    } else if (!this.buffer) {
      this.buffer = operation;
    } else {
      this.buffer = this.buffer.compose(operation);
    }
  }

  /** The server broadcast another client's operation. */
  applyServer(operation: TextOperation): void {
    this.revision++;
    let op = operation;
    if (this.outstanding) {
      const [outstanding, transformed] = TextOperation.transform(this.outstanding, op);
      this.outstanding = outstanding;
      op = transformed;
      if (this.buffer) {
        const [buffer, transformed2] = TextOperation.transform(this.buffer, op);
        this.buffer = buffer;
        op = transformed2;
      }
    }
    this.callbacks.apply(op);
  }

  /** The server acknowledged our in-flight operation. */
  serverAck(): void {
    if (!this.outstanding) throw new Error('Received an ack with no operation in flight');
    this.revision++;
    this.outstanding = this.buffer;
    this.buffer = null;
    if (this.outstanding) this.callbacks.send(this.revision, this.outstanding);
  }

  /** Re-send the in-flight operation (after a reconnect). */
  resend(): void {
    if (this.outstanding) this.callbacks.send(this.revision, this.outstanding);
  }

  /** Map a position in the server document to the local document (for remote cursors). */
  transformIndex(index: number, stickLeft = false): number {
    let i = index;
    if (this.outstanding) i = this.outstanding.transformIndex(i, stickLeft);
    if (this.buffer) i = this.buffer.transformIndex(i, stickLeft);
    return i;
  }
}
