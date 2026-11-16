# Real-time and collaboration

## Server-Sent Events

```ts
await app.init({ sse: { url: '/events' } }); // resolved against http.baseUrl
```

Built-in events, as named SSE events, or as `message` events with an `action` field:

| Event | Payload | Effect |
| --- | --- | --- |
| `invalidate` | `{ type, id? , ids? }` | Mark objects (or the whole type) stale. Bound components and list views refetch |
| `delete` | `{ type, id }` | Remove the object and drop it from every list view |
| `upsert` | `{ type, id?, data }` | Write fresh data into the store |

```
event: invalidate
data: {"type":"Person","id":42}
```

Listen for your own events with `app.sse.on('notification', data => …)`. The manager reconnects itself with exponential backoff, using a freshly refreshed token each time (sent as `?token=`, only to trusted origins), and resumes with `?lastEventId=`. Watch the connection with `app.sse.onStatusChange(status => …)`: `connecting`, `open`, `reconnecting`, `closed`.

Reconnect options shared by SSE, WebSocket and Azure: `reconnect`, `maxReconnectAttempts`, `baseDelay`, `maxDelay`, `jitter`.

## WebSockets

```ts
await app.init({ websocket: { url: 'wss://api.example.com/ws' } });

const off = app.ws.subscribe('room:1', message => console.log(message.payload));
app.ws.send({ type: 'chat', channel: 'room:1', payload: { text: 'Hi' } });
app.ws.sendPresence('room:1', { typing: true });
```

Messages are JSON `{ type, channel?, payload? }`. The first subscriber to a channel sends `{ type: 'subscribe', channel }` and the last one to leave sends `unsubscribe`. Channels are re-subscribed after reconnects, and messages sent while offline are queued (up to `maxQueue`).

## Azure Web PubSub

```ts
await app.init({
  azurePubSub: {
    negotiateUrl: '/pubsub/negotiate', // your backend returns { url } (or { token } with `endpoint`)
    autoJoinGroups: ['announcements'],
    enableCacheInvalidation: true,
  },
});

app.azurePubSub.subscribe('announcements', msg => console.log(msg.payload));
await app.azurePubSub.sendToGroup('announcements', { text: 'Deploying…' });
```

With `enableCacheInvalidation`, `{ action: 'invalidate' | 'delete' | 'upsert', type, id, data }` messages are applied to the store, but **only messages sent by the server**. Messages that another client sent to a group are ignored, so peers can't tamper with your cache.

## Collaborative editing

Arethesis includes a complete operational-transformation stack for plain text:

- `TextOperation`: retain/insert/delete operations with `apply`, `compose`, `invert`, `transform` and `transformIndex`
- `OTClient`: the client state machine (synchronized → awaiting → buffering)
- `CollabServer` / `OTDocumentServer`: a reference server you can run in Node (or a worker)
- `CollabSession`: connects a `<textarea>` to the server, with presence and live cursors

```ts
await app.init({ websocket: { url: 'wss://api.example.com/collab' } });

const session = app.collab.open('doc-42', textarea, { user: { name: 'Alice', color: '#7c3aed' } });
session.on('status', s => statusEl.textContent = s);        // connecting | syncing | synced | offline
session.on('presence', peers => renderAvatars(peers));
session.close();
```

Edits made while offline are kept. On reconnect the client receives the operations it missed (including its own unacknowledged one, if the server got it) and resends the rest, so nothing is lost or applied twice.

### Server

```ts
import { CollabServer } from 'arethesis';
import { WebSocketServer } from 'ws';

const server = new CollabServer((clientId, message) => sockets.get(clientId)?.send(JSON.stringify(message)),
  docId => loadDocument(docId));

wss.on('connection', socket => {
  const id = crypto.randomUUID();
  sockets.set(id, socket);
  socket.on('message', raw => server.handle(id, JSON.parse(String(raw))));
  socket.on('close', () => { server.disconnect(id); sockets.delete(id); });
});
```

Persist `server.document(docId).document` wherever you like. The protocol is the `collab:*` message family described in `realtime/types`.
