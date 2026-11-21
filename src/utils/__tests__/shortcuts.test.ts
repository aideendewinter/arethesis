import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatShortcut, isApplePlatform, renderShortcutHelp, shortcutKeys, shortcutList, shortcuts, shortcutSource } from '../shortcuts';
import { openLayers, pushLayer, topLayer } from '../layers';
import { attachPopup } from '../../mixins/popup';
import { modal } from '../../kit/internal/modal';
import { Component } from '../../components/component';
import { defineComponent } from '../../components/decorators';
import { Arethesis, getArethesis } from '../../core/arethesis';
import { flush } from '../../../test/helpers';

const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

const stops: Array<() => void> = [];
const register: typeof shortcuts = (map, options) => {
  const stop = shortcuts(map, options);
  stops.push(stop);
  return stop;
};

describe('shortcuts', () => {
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('matches typed characters, letters with exact modifiers, and named keys', () => {
    const run = vi.fn();
    register({ t: () => run('t'), 'Shift+T': () => run('T'), '?': () => run('?'), 'Ctrl+k': () => run('ctrl-k'), 'Alt+p': () => run('alt-p'), Esc: () => run('esc'), 'Shift+ArrowDown': () => run('sdown'), Space: () => run('space'), 'Ctrl++': () => run('plus') });
    press(document.body, 't');
    press(document.body, 'T', { shiftKey: true });
    press(document.body, '?', { shiftKey: true }); // Shift is how you type it
    press(document.body, 'k', { ctrlKey: true });
    press(document.body, 'k', { ctrlKey: true, shiftKey: true }); // not a match
    press(document.body, 'k', { metaKey: true }); // not a match
    press(document.body, 'π', { altKey: true, code: 'KeyP' }); // Option+P on a Mac
    press(document.body, 'Escape');
    press(document.body, 'ArrowDown'); // needs Shift
    press(document.body, 'ArrowDown', { shiftKey: true });
    press(document.body, ' ');
    press(document.body, '+', { ctrlKey: true, shiftKey: true });
    expect(run.mock.calls.map(c => c[0])).toEqual(['t', 'T', '?', 'ctrl-k', 'alt-p', 'esc', 'sdown', 'space', 'plus']);
    expect(() => register({ 'Hyper+x': () => {} })).toThrow(/unknown modifier/);
  });

  it('maps Mod to ⌘ on Apple platforms and Ctrl elsewhere', () => {
    const run = vi.fn();
    expect(isApplePlatform()).toBe(false);
    register({ 'Mod+k': run });
    press(document.body, 'k', { ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(formatShortcut('Mod+Shift+k')).toBe('Ctrl+Shift+K');
    expect(formatShortcut('Escape')).toBe('Esc');
    expect(shortcutKeys('Meta+ArrowUp')).toEqual(['Meta', '↑']);
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(isApplePlatform()).toBe(true);
    const apple = vi.fn();
    register({ 'Mod+j': apple });
    press(document.body, 'j', { metaKey: true });
    press(document.body, 'j', { ctrlKey: true });
    expect(apple).toHaveBeenCalledTimes(1);
    expect(formatShortcut('Mod+Shift+Alt+Ctrl+k')).toBe('⌃⌥⇧⌘K');
    vi.stubGlobal('navigator', undefined);
    expect(isApplePlatform()).toBe(false);
  });

  it('skips text fields unless the binding has a modifier or allows them', () => {
    document.body.innerHTML = '<input id="i"><input id="c" type="checkbox"><textarea id="t"></textarea><div id="e" contenteditable="true"><b id="eb">x</b></div><select id="s"></select>';
    const run = vi.fn();
    register({ '/': () => run('/'), 'Mod+s': () => run('save'), Enter: { run: () => run('enter'), allowInInput: true } });
    for (const id of ['i', 't', 'eb', 's']) press(document.getElementById(id)!, '/');
    press(document.getElementById('c')!, '/');
    press(document.getElementById('i')!, 's', { ctrlKey: true });
    press(document.getElementById('i')!, 'Enter');
    expect(run.mock.calls.map(c => c[0])).toEqual(['/', 'save', 'enter']);
  });

  it('ignores repeats, composition and handled events; respects when, scope and the newest registration', () => {
    document.body.innerHTML = '<div id="a"><button id="in">x</button></div><button id="out">y</button>';
    const calls: string[] = [];
    let enabled = false;
    register({ n: () => void calls.push('old'), h: { run: () => void calls.push('held'), repeat: true } });
    register({ n: () => void calls.push('new'), w: { run: () => void calls.push('when'), when: () => enabled } });
    register({ x: () => void calls.push('scoped'), p: () => false }, { scope: document.getElementById('a')! });
    press(document.body, 'n');
    press(document.body, 'n', { repeat: true });
    press(document.body, 'h', { repeat: true });
    press(document.body, 'n', { isComposing: true });
    const handled = new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    press(document.body, 'w');
    enabled = true;
    press(document.body, 'w');
    press(document.getElementById('out')!, 'x');
    press(document.getElementById('in')!, 'x');
    expect(calls).toEqual(['new', 'held', 'when', 'scoped']);
    // Returning false leaves the default alone.
    expect(press(document.getElementById('in')!, 'p').defaultPrevented).toBe(false);
    expect(press(document.body, 'n').defaultPrevented).toBe(true);
  });

  it('removes its listeners when the last registration goes', () => {
    const run = vi.fn();
    const stop = shortcuts({ q: run });
    stop();
    stop();
    press(document.body, 'q');
    expect(run).not.toHaveBeenCalled();
  });

  it('lists labelled shortcuts, renders help and feeds the command palette', () => {
    const run = vi.fn();
    register({ t: { run, label: 'Contents', group: 'Reading' }, '/': { run, label: 'Search' }, x: run, 'Mod+k': { run, label: 'Hidden', when: () => false } });
    register({ t: { run, label: 'Contents', group: 'Reading' } });
    const list = shortcutList();
    expect(list.map(g => [g.group, g.shortcuts.map(s => s.keys)])).toEqual([['Reading', ['t']], ['General', ['/']]]);
    const el = document.createElement('div');
    renderShortcutHelp(el);
    expect(el.querySelectorAll('section.ar-shortcuts h3')).toHaveLength(2);
    expect(el.querySelector('dt')!.innerHTML).toBe('<kbd><kbd>T</kbd></kbd>');
    expect(el.querySelector('dd')!.textContent).toBe('Contents');
    register({ 'Ctrl+<': { run, label: '<b>' } });
    renderShortcutHelp(el, { headingLevel: 2 });
    expect(el.querySelector('dt')!.innerHTML).toBe('<kbd><kbd>Ctrl</kbd><span aria-hidden="true">+</span><kbd>&lt;</kbd></kbd>');
    expect(el.querySelector('dd')!.textContent).toBe('<b>');
    for (const level of [4, 5, 6] as const) {
      renderShortcutHelp(el, { headingLevel: level });
      expect(el.querySelector(`h${level}`)).not.toBeNull();
    }
    const source = shortcutSource();
    const commands = source.commands();
    expect(commands.find(c => c.title === 'Contents')).toMatchObject({ subtitle: 'Reading', shortcut: 'T' });
    expect(commands.find(c => c.title === 'Search')!.subtitle).toBeUndefined();
    commands[0].run();
    expect(run).toHaveBeenCalled();
  });
});

describe('Escape and layers', () => {
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    document.body.innerHTML = '';
  });

  it('closes the top app layer first, and runs Escape only when nothing is open', () => {
    const escape = vi.fn();
    register({ Escape: escape });
    const sheet = document.createElement('div');
    document.body.append(sheet);
    const closeSheet = vi.fn(() => releaseSheet());
    const releaseSheet = pushLayer(sheet, closeSheet);
    const drawer = vi.fn(() => releaseDrawer());
    const releaseDrawer = pushLayer(null, drawer);
    expect(openLayers()).toHaveLength(2);
    press(document.body, 'Escape');
    expect(drawer).toHaveBeenCalledTimes(1);
    expect(closeSheet).not.toHaveBeenCalled();
    press(document.body, 'Escape');
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(escape).not.toHaveBeenCalled();
    press(document.body, 'Escape');
    expect(escape).toHaveBeenCalledTimes(1);
    // A layer whose element left the page doesn't count.
    const gone = document.createElement('div');
    const release = pushLayer(gone, vi.fn());
    expect(topLayer()).toBeNull();
    release();
    release();
  });

  it('leaves Escape to an open popup, even one that closes itself first', () => {
    const escape = vi.fn();
    register({ Escape: escape });
    const menu = document.createElement('div');
    document.body.append(menu);
    const popup = attachPopup(menu, { anchor: () => document.body });
    // Like the mixins: the popup's own handler closes it before ours runs.
    document.addEventListener('keydown', e => e.key === 'Escape' && popup.hide(), { once: true });
    popup.show();
    expect(topLayer()?.kind).toBe('popup');
    press(document.body, 'Escape');
    expect(popup.isOpen()).toBe(false);
    expect(escape).not.toHaveBeenCalled();
    expect(topLayer()).toBeNull();
    // Hints (tooltips) aren't layers.
    const tip = attachPopup(document.body.appendChild(document.createElement('div')), { anchor: () => document.body, mode: 'hint' });
    tip.show();
    press(document.body, 'Escape');
    expect(escape).toHaveBeenCalledTimes(1);
    popup.destroy();
    tip.destroy();
  });

  it('leaves Escape to an open dialog', () => {
    const escape = vi.fn();
    register({ Escape: escape });
    const dialog = document.body.appendChild(document.createElement('dialog'));
    dialog.innerHTML = '<button>ok</button>';
    const m = modal(dialog);
    m.open();
    expect(topLayer()?.kind).toBe('dialog');
    press(dialog.querySelector('button')!, 'Escape');
    expect(escape).not.toHaveBeenCalled();
    m.close();
    expect(topLayer()).toBeNull();
    m.open();
    m.destroy();
    expect(topLayer()).toBeNull();
  });
});

describe('Component.shortcuts', () => {
  afterEach(() => Arethesis.resetInstance());

  it('registers while connected', async () => {
    getArethesis();
    const run = vi.fn();
    @defineComponent({ tag: 'shortcut-host', html: '<p>x</p>' })
    class Host extends Component {
      protected override onConnected(): void {
        this.shortcuts({ g: run });
      }
    }
    void Host;
    const el = document.createElement('shortcut-host');
    document.body.append(el);
    await flush();
    press(document.body, 'g');
    el.remove();
    press(document.body, 'g');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
