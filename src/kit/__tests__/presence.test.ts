import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Arethesis, getArethesis } from '../../core/arethesis';
import '../elements/presence';
import { colorFor, initials, textOn, type Presence, type PresenceSource } from '../presence';
import type { RemoteCursor } from '../../realtime/types';
import type { CollabSession } from '../../realtime/collab/collab-session';
import { flush } from '../../../test/helpers';

class FakeSession implements PresenceSource {
  peers: RemoteCursor[] = [];
  #listeners = new Set<(peers: RemoteCursor[]) => void>();
  on(_event: 'presence', listener: (peers: RemoteCursor[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  set(names: string[]): void {
    this.peers = names.map(name => ({ clientId: name.toLowerCase(), user: { name, color: name === 'Sappho' ? '#f5e663' : undefined } }));
    for (const l of this.#listeners) l(this.peers);
  }
  get listeners(): number {
    return this.#listeners.size;
  }
}

async function mount(attrs = '') {
  document.body.innerHTML = `<a-presence ${attrs}></a-presence>`;
  await flush();
  const el = document.querySelector<Presence>('a-presence')!;
  const session = new FakeSession();
  el.self = { name: 'Hypatia of Alexandria', color: '#1d4b98' };
  el.session = session;
  const names = () => Array.from(el.querySelectorAll('.ar-presence__person .ar-visually-hidden')).map(s => s.textContent);
  return { el, session, names };
}

describe('<a-presence>', () => {
  beforeEach(() => void getArethesis());
  afterEach(() => Arethesis.resetInstance());

  it('lists you and the session’s people as avatars with readable initials', async () => {
    const { el, session, names } = await mount();
    session.set(['Sappho', 'Diogenes']);
    expect(names()).toEqual(['Hypatia of Alexandria (you)', 'Sappho', 'Diogenes']);
    expect(el.querySelector('ul')!.getAttribute('aria-label')).toBe('People here');
    const avatars = Array.from(el.querySelectorAll<HTMLElement>('.ar-presence .ar-presence__avatar'));
    expect(avatars.map(a => a.textContent)).toEqual(['HA', 'S', 'D']);
    expect(avatars[0].getAttribute('aria-hidden')).toBe('true');
    // Yellow gets black text; the dark blue gets white.
    expect(avatars[1].style.color).toMatch(/^(#000|rgb\(0, 0, 0\))$/);
    expect(avatars[0].style.color).toMatch(/^(#fff|rgb\(255, 255, 255\))$/);
    expect(el.querySelector('.ar-presence__person')!.getAttribute('aria-describedby')).toMatch(/^tooltip/);
  });

  it('collapses past max into a button that opens everyone', async () => {
    const { el, session, names } = await mount('max="3"');
    session.set(['Sappho', 'Diogenes', 'Heraclitus', 'Archilochus']);
    expect(names()).toHaveLength(2);
    const more = el.querySelector<HTMLButtonElement>('.ar-presence__more')!;
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe('+3');
    expect(more.getAttribute('aria-label')).toBe('3 more: show everyone');
    more.click();
    const panel = el.querySelector<HTMLElement>('.ar-presence__panel')!;
    expect(panel.hidden).toBe(false);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(panel.querySelectorAll('li')).toHaveLength(5);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(more);
    more.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(true);
    el.setAttribute('max', '10');
    expect(more.hidden).toBe(true);
  });

  it('announces who joined and left, in batches, when asked', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<a-presence announce></a-presence>';
      await vi.advanceTimersByTimeAsync(0);
      const el = document.querySelector<Presence>('a-presence')!;
      const session = new FakeSession();
      el.session = session;
      session.set(['Sappho']);
      session.set(['Sappho', 'Diogenes', 'Heraclitus', 'Archilochus']);
      await vi.advanceTimersByTimeAsync(1100);
      session.set(['Diogenes']);
      await vi.advanceTimersByTimeAsync(1100);
      const live = document.querySelector('[aria-live]')!;
      expect(live.textContent).toBe('Sappho, Heraclitus and 1 more left');
    } finally {
      vi.useRealTimers();
    }
  });

  it('changes and drops sessions cleanly', async () => {
    const { el, session, names } = await mount();
    expect(session.listeners).toBe(1);
    el.session = null;
    expect(session.listeners).toBe(0);
    expect(names()).toEqual(['Hypatia of Alexandria (you)']);
    el.self = null;
    expect(names()).toEqual([]);
    // A CollabSession has the right shape.
    const typed: PresenceSource = {} as CollabSession;
    void typed;
  });

  it('has helpers for initials, colors and readable text', () => {
    expect(initials('Hypatia of Alexandria')).toBe('HA');
    expect(initials('  ')).toBe('?');
    expect(colorFor('Sappho')).toBe(colorFor('Sappho'));
    expect(textOn('#fff')).toBe('#000');
    expect(textOn('#000000')).toBe('#fff');
    expect(textOn('rgb(250, 250, 210)')).toBe('#000');
    expect(textOn('tomato')).toBe('#fff');
  });
});
