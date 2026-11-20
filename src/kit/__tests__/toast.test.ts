import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Arethesis, getArethesis } from '../../core/arethesis';
import { toast, connectToasts, type Toaster } from '../elements/toast';
import { flush, mockFetch } from '../../../test/helpers';

describe('toast()', () => {
  beforeEach(() => void getArethesis());
  afterEach(() => {
    vi.useRealTimers();
    Arethesis.resetInstance();
  });

  it('adds an <a-toast> with both live regions, and puts errors in the alert region', async () => {
    toast('Saved', 'success');
    const host = document.querySelector<Toaster>('a-toast')!;
    expect(host).not.toBeNull();
    const [status, alert] = Array.from(host.querySelectorAll('.ar-toast__region'));
    expect(status.getAttribute('role')).toBe('status');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(status.querySelector('.ar-toast')!.textContent).toContain('Saved');
    expect(status.querySelector<HTMLElement>('.ar-toast')!.dataset.kind).toBe('success');
    toast('Broken', { kind: 'error' });
    expect(alert.querySelector('.ar-toast')!.textContent).toContain('Broken');
    expect(document.querySelectorAll('a-toast')).toHaveLength(1);
    host.clear();
    expect(host.querySelectorAll('.ar-toast')).toHaveLength(0);
  });

  it('goes away after its timeout, but not while hovered or focused', () => {
    vi.useFakeTimers();
    const { element } = toast('Hello', { timeout: 1000 });
    element.dispatchEvent(new Event('pointerenter'));
    vi.advanceTimersByTime(2000);
    expect(element.isConnected).toBe(true);
    element.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(999);
    expect(element.isConnected).toBe(true);
    element.dispatchEvent(new FocusEvent('focusin'));
    vi.advanceTimersByTime(5000);
    expect(element.isConnected).toBe(true);
    element.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body }));
    vi.advanceTimersByTime(1000);
    expect(element.isConnected).toBe(false);
  });

  it('keeps a toast with an action until it is used or dismissed', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const { element } = toast('Deleted', { action: { label: 'Undo', run } });
    vi.advanceTimersByTime(60_000);
    expect(element.isConnected).toBe(true);
    (element.querySelector('.ar-toast__action') as HTMLButtonElement).click();
    expect(run).toHaveBeenCalled();
    expect(element.isConnected).toBe(false);
    const second = toast('Again', { timeout: 0 });
    (second.element.querySelector('.ar-toast__close') as HTMLButtonElement).click();
    expect(second.element.isConnected).toBe(false);
  });

  it('uses a toaster already on the page', async () => {
    document.body.innerHTML = '<a-toast position="top-end" aria-label="Alerts"></a-toast>';
    await flush();
    toast('Hi');
    expect(document.querySelectorAll('a-toast')).toHaveLength(1);
    expect(document.querySelector('a-toast')!.getAttribute('aria-label')).toBe('Alerts');
  });

  it('connects to rolled-back changes and failed requests', async () => {
    const app = getArethesis();
    const fetch = mockFetch(() => ({ status: 500 }));
    app.http.configure({ baseUrl: '/api', fetch, retry: false });
    app.store.upsert('Thing', '1', { name: 'a' });
    const stop = connectToasts(app, { httpError: e => `Request failed (${e.status})` });
    await app.optimistic.update('Thing', '1', { name: 'b' }, () => app.request({ url: '/things/1', method: 'PATCH' })).catch(() => {});
    const texts = () => Array.from(document.querySelectorAll('.ar-toast__message')).map(m => m.textContent);
    expect(texts()).toEqual(['Request failed (500)', 'Couldn’t save that. It’s been undone.']);
    stop();
    await app.request({ url: '/x' }).catch(() => {});
    expect(texts()).toHaveLength(2);
    const quiet = connectToasts(app, { rollback: false, httpError: () => false });
    await app.request({ url: '/x' }).catch(() => {});
    expect(texts()).toHaveLength(2);
    quiet();
  });
});
