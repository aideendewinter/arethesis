/**
 * Hosts one MockServer for any number of page connections (ports). Used by
 * the SharedWorker and by the in-page fallback.
 */
import { MockServer } from './server';
import type { Port, ToPage, ToServer } from './protocol';

export function createHost() {
  const streams = new Map<string, Port>();
  const sockets = new Map<string, Port>();
  const portStreams = new Map<Port, Set<string>>();
  let eventId = 0;

  // Simulated network: every message on a stream or socket takes half the
  // round-trip time (with some jitter). Each connection is a queue drained in
  // order by one timer, so messages never overtake each other (separate timers
  // can fire out of order because browsers round their delays). Going offline
  // drops whatever is still in flight.
  const queues = new Map<string, { items: Array<{ at: number; send: () => void }>; timer?: ReturnType<typeof setTimeout> }>();
  function pump(connection: string): void {
    const queue = queues.get(connection);
    if (!queue) return;
    queue.timer = undefined;
    const now = performance.now();
    while (queue.items.length && queue.items[0].at <= now + 1) queue.items.shift()!.send();
    if (queue.items.length) queue.timer = setTimeout(() => pump(connection), Math.max(0, queue.items[0].at - now));
    else queues.delete(connection);
  }
  function deliver(connection: string, send: () => void): void {
    const oneWay = server.latency / 2;
    let queue = queues.get(connection);
    if (oneWay <= 0 && !queue) {
      send();
      return;
    }
    if (!queue) queues.set(connection, (queue = { items: [] }));
    const last = queue.items.at(-1)?.at ?? 0;
    queue.items.push({ at: Math.max(performance.now() + oneWay * (0.7 + Math.random() * 0.6), last), send });
    if (!queue.timer) queue.timer = setTimeout(() => pump(connection), Math.max(0, queue.items[0].at - performance.now()));
  }
  function dropInFlight(): void {
    for (const queue of queues.values()) clearTimeout(queue.timer);
    queues.clear();
  }

  const server = new MockServer({
    sse(event, data, streamId) {
      const payload = JSON.stringify(data);
      const id = String(++eventId);
      for (const [sid, port] of streams) {
        if (!streamId || sid === streamId) deliver(`sse:${sid}`, () => streams.has(sid) && port.post({ kind: 'sse', streamId: sid, event, data: payload, id }));
      }
    },
    ws(socketId, message) {
      const data = JSON.stringify(message);
      deliver(`down:${socketId}`, () => sockets.get(socketId)?.post({ kind: 'ws-message', socketId, data }));
    },
  });

  const track = (port: Port, id: string): void => {
    if (!portStreams.has(port)) portStreams.set(port, new Set());
    portStreams.get(port)!.add(id);
  };

  function closeSocket(socketId: string, code: number): void {
    const port = sockets.get(socketId);
    if (!port) return;
    sockets.delete(socketId);
    server.socketClosed(socketId);
    port.post({ kind: 'ws-close', socketId, code });
  }

  async function handle(port: Port, message: ToServer): Promise<void> {
    switch (message.kind) {
      case 'fetch': {
        const res = await server.handle(message.request);
        port.post({ kind: 'response', id: message.id, status: res.status, body: res.body, headers: res.headers } satisfies ToPage);
        break;
      }
      case 'sse-open':
        if (server.offline) {
          port.post({ kind: 'sse-error', streamId: message.streamId });
          break;
        }
        streams.set(message.streamId, port);
        track(port, message.streamId);
        port.post({ kind: 'sse-open', streamId: message.streamId });
        break;
      case 'sse-close':
        streams.delete(message.streamId);
        break;
      case 'ws-open':
        if (server.offline) {
          port.post({ kind: 'ws-close', socketId: message.socketId, code: 1006 });
          break;
        }
        sockets.set(message.socketId, port);
        track(port, message.socketId);
        port.post({ kind: 'ws-open', socketId: message.socketId });
        break;
      case 'ws-send':
        deliver(`up:${message.socketId}`, () => sockets.has(message.socketId) && server.socketMessage(message.socketId, message.data));
        break;
      case 'ws-close':
        sockets.delete(message.socketId);
        server.socketClosed(message.socketId);
        break;
      case 'control':
        server.control(message.command);
        if (message.command.offline === true) {
          dropInFlight();
          // Drop every live connection, like a network outage.
          for (const [sid, p] of [...streams]) {
            streams.delete(sid);
            p.post({ kind: 'sse-error', streamId: sid });
          }
          for (const sid of [...sockets.keys()]) closeSocket(sid, 1006);
        }
        break;
      case 'bye':
        for (const id of portStreams.get(port) ?? []) {
          streams.delete(id);
          if (sockets.has(id)) {
            sockets.delete(id);
            server.socketClosed(id);
          }
        }
        portStreams.delete(port);
        break;
    }
  }

  return { connect: (port: Port) => port.listen(m => void handle(port, m as ToServer)) };
}
