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

  const server = new MockServer({
    sse(event, data, streamId) {
      const payload = JSON.stringify(data);
      const id = String(++eventId);
      for (const [sid, port] of streams) {
        if (!streamId || sid === streamId) port.post({ kind: 'sse', streamId: sid, event, data: payload, id });
      }
    },
    ws(socketId, message) {
      sockets.get(socketId)?.post({ kind: 'ws-message', socketId, data: JSON.stringify(message) });
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
        server.socketMessage(message.socketId, message.data);
        break;
      case 'ws-close':
        sockets.delete(message.socketId);
        server.socketClosed(message.socketId);
        break;
      case 'control':
        server.control(message.command);
        if (message.command.offline === true) {
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
