/**
 * A "Network" control for the demos: how slow the simulated network between
 * the page and the mock backend is. The choice is remembered across pages
 * and reloads, and applies to HTTP requests, WebSocket messages and SSE.
 */
import type { MockBackend } from '../mock/client';

const KEY = 'demo-network-latency';

export const NETWORK_PROFILES: Array<[label: string, roundTripMs: number]> = [
  ['Instant', 0],
  ['Typical (250 ms)', 250],
  ['Slow (1 s)', 1000],
  ['Very slow (3 s)', 3000],
];

/** The saved round-trip time, or null for the default. */
export function storedLatency(): number | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === null ? null : Number(value);
  } catch {
    return null;
  }
}

/** Fill a `<select>` with the network profiles and keep the backend in sync with it. */
export function bindNetworkControl(select: HTMLSelectElement, backend: Pick<MockBackend, 'control'>): void {
  const current = storedLatency() ?? 250;
  select.replaceChildren(...NETWORK_PROFILES.map(([label, ms]) => new Option(label, String(ms), false, ms === current)));
  select.addEventListener('change', () => {
    const latency = Number(select.value);
    backend.control({ latency });
    try {
      localStorage.setItem(KEY, String(latency));
    } catch {
      /* not remembered, but still applied */
    }
  });
}
