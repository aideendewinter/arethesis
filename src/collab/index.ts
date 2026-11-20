/**
 * Collaborative editing: OT sessions over a WebSocket, presence, cursors,
 * per-user undo and anchored comments. Importing this module enables
 * `app.collab`.
 *
 * ```ts
 * import 'arethesis/collab';
 * const session = getArethesis().collab.open('doc-1', textarea);
 * ```
 *
 * @packageDocumentation
 */

import { CollabManager } from '../realtime/collab/collab-session';
import { setCollabFactory } from '../core/collab-hook';

setCollabFactory(ws => new CollabManager(ws));

export { CollabSession, CollabManager } from '../realtime/collab/collab-session';
export type { CollabEvents, CollabOptions, CollabStatus } from '../realtime/collab/collab-session';
export { TextareaAdapter } from '../realtime/collab/textarea-adapter';
export type { EditorAdapter, CollabApplyDetail } from '../realtime/collab/textarea-adapter';
export { CursorOverlay, caretCoordinates, rangeRects } from '../realtime/collab/cursor-overlay';
export { UndoManager, caretAfter } from '../realtime/collab/undo-manager';
export type { UndoManagerOptions } from '../realtime/collab/undo-manager';
export { transformRange, mapRange } from '../realtime/collab/anchors';
export type { TextRange } from '../realtime/collab/anchors';
