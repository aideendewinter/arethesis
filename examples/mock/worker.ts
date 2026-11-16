/// <reference lib="webworker" />
/** SharedWorker entry: one mock server shared by every open demo tab. */
import { createHost } from './host';
import type { Port } from './protocol';

const host = createHost();

(self as unknown as SharedWorkerGlobalScope).onconnect = (event: MessageEvent) => {
  const raw = event.ports[0];
  const port: Port = {
    post: message => raw.postMessage(message),
    listen: handler => {
      raw.onmessage = e => handler(e.data);
    },
  };
  host.connect(port);
  raw.start();
};
