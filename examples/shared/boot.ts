/** Starts Arethesis against the in-browser mock backend. */
import { getArethesis, type ArethesisConfig } from 'arethesis';
import { connectMockBackend } from '../mock/client';
import { storedLatency } from './network';

export async function startApp(page: string, config: ArethesisConfig = {}, options: { live?: boolean } = {}) {
  const backend = connectMockBackend();
  // The simulated network speed chosen on any page (see network.ts).
  const latency = storedLatency();
  if (latency !== null) backend.control({ latency });
  const app = getArethesis();
  await app.init({
    ...config,
    http: { baseUrl: '/api', fetch: backend.fetch, ...config.http },
    sse: options.live === false ? undefined : config.sse ?? { url: '/events', eventSourceFactory: backend.eventSource },
    persistence: config.persistence ?? { dbName: `arethesis-demo-${page}` },
  });
  return { app, backend };
}
