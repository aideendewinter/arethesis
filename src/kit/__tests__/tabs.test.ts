import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Arethesis, getArethesis } from '../../core/arethesis';
import '../elements/tabs';
import type { Tabs } from '../tabs';
import { flush } from '../../../test/helpers';

const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

async function mount(html: string) {
  document.body.innerHTML = html;
  await flush();
  const tabs = document.querySelector<Tabs>('a-tabs')!;
  return { tabs, tab: (i: number) => tabs.tabs[i], panel: (i: number) => tabs.panels[i] };
}

const HEADINGS = `<a-tabs aria-label="Account">
  <h3 data-tab>Profile</h3><section><p>Name</p></section>
  <h3 data-tab>Billing</h3><section><button>Pay</button></section>
  <h3 data-tab>Danger</h3><section><template data-lazy><p class="lazy">Loaded</p></template></section>
</a-tabs>`;

describe('<a-tabs>', () => {
  beforeEach(() => void getArethesis());
  afterEach(() => {
    Arethesis.resetInstance();
    history.replaceState(null, '', location.pathname);
  });

  it('turns headings and sections into an accessible tab list', async () => {
    const { tabs, tab, panel } = await mount(HEADINGS);
    const list = tabs.querySelector('[role=tablist]')!;
    expect(list.getAttribute('aria-label')).toBe('Account');
    expect(tabs.querySelectorAll('h3')).toHaveLength(0);
    expect(tabs.tabs.map(t => t.textContent)).toEqual(['Profile', 'Billing', 'Danger']);
    expect(tab(0).getAttribute('aria-selected')).toBe('true');
    expect(tab(0).getAttribute('aria-controls')).toBe(panel(0).id);
    expect(panel(0).getAttribute('aria-labelledby')).toBe(tab(0).id);
    expect(panel(0).getAttribute('role')).toBe('tabpanel');
    expect(panel(0).tabIndex).toBe(0); // no focusable content
    expect(panel(1).hasAttribute('tabindex')).toBe(false);
    expect(panel(1).getAttribute('hidden')).toBe('until-found');
    expect([tab(0).tabIndex, tab(1).tabIndex]).toEqual([0, -1]);
  });

  it('moves with the arrow keys, Home and End, and selects as it goes', async () => {
    const { tabs, tab, panel } = await mount(HEADINGS);
    const changes = vi.fn();
    tabs.addEventListener('tabs:change', changes);
    key(tab(0), 'ArrowRight');
    expect(tabs.selectedIndex).toBe(1);
    expect(document.activeElement).toBe(tab(1));
    expect(panel(1).hasAttribute('hidden')).toBe(false);
    key(tab(1), 'End');
    expect(tabs.selectedIndex).toBe(2);
    expect(panel(2).querySelector('.lazy')).not.toBeNull();
    key(tab(2), 'ArrowRight'); // wraps
    expect(tabs.selectedIndex).toBe(0);
    key(tab(0), 'ArrowLeft');
    expect(tabs.selectedIndex).toBe(2);
    key(tab(2), 'Home');
    expect(tabs.selectedIndex).toBe(0);
    expect(changes).toHaveBeenCalledTimes(5);
    expect(changes.mock.calls[0][0].detail.index).toBe(1);
  });

  it('only moves focus with activation="manual", until Enter or Space', async () => {
    const { tabs, tab } = await mount(HEADINGS.replace('<a-tabs', '<a-tabs activation="manual" orientation="vertical"'));
    key(tab(0), 'ArrowDown');
    expect(document.activeElement).toBe(tab(1));
    expect(tabs.selectedIndex).toBe(0);
    key(tab(1), 'Enter');
    expect(tabs.selectedIndex).toBe(1);
    key(tab(1), 'ArrowUp');
    key(tab(0), ' ');
    expect(tabs.selectedIndex).toBe(0);
    tab(2).click();
    expect(tabs.selectedIndex).toBe(2);
  });

  it('enhances a hand-written tab list and skips disabled tabs', async () => {
    const { tabs, tab, panel } = await mount(`<a-tabs>
      <div role="tablist"><button role="tab" aria-controls="b">A</button><button role="tab" disabled>X</button><button role="tab" aria-controls="c" aria-selected="true">C</button></div>
      <div role="tabpanel" id="b">B</div><div role="tabpanel" id="x">X</div><div role="tabpanel" id="c">C</div>
    </a-tabs>`);
    expect(tabs.selectedIndex).toBe(2);
    expect(panel(0).id).toBe('b');
    key(tab(2), 'ArrowRight');
    expect(tabs.selectedIndex).toBe(0);
    key(tab(0), 'ArrowRight');
    expect(tabs.selectedIndex).toBe(2);
  });

  it('opens the tab that find-in-page reveals, and keeps the URL in sync with data-hash', async () => {
    history.replaceState(null, '', '#billing');
    const { tabs, panel } = await mount(`<a-tabs data-hash><h3 data-tab>One</h3><section id="one">1</section><h3 data-tab>Two</h3><section id="billing">2</section></a-tabs>`);
    expect(tabs.selectedIndex).toBe(1);
    panel(0).dispatchEvent(new Event('beforematch'));
    expect(tabs.selectedIndex).toBe(0);
    expect(location.hash).toBe('#one');
    history.replaceState(null, '', '#billing');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(tabs.selectedIndex).toBe(1);
  });
});
