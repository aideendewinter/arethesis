/**
 * `context-menu`: a keyboard-accessible menu on right-click, Shift+F10 or the
 * Menu key. Items come from `items` or a JSON `data-mixin-context-menu-items` attribute.
 *
 * Event: `context-menu:select` (detail `{ action, target }`); `target` is the
 * element the menu was opened on (or its closest match for `target`).
 *
 * @module mixins/context-menu
 */

import type { ContextMenuItem, ContextMenuOptions, MixinInstance } from './types';
import { mixinRegistry } from './registry';
import { emit } from './utils';
import { uniqueId } from '../utils/dom';

export function contextMenuMixin(element: HTMLElement, options: ContextMenuOptions = {}): MixinInstance {
  const controller = new AbortController();
  const { signal } = controller;
  let menu: HTMLElement | null = null;
  let menuController: AbortController | null = null;
  let openedOn: HTMLElement | null = null;
  let returnFocus: HTMLElement | null = null;
  let typeahead = '';
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  const items = (): ContextMenuItem[] => options.items ?? [];

  function menuItems(): HTMLElement[] {
    return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')) : [];
  }

  function focusItem(index: number): void {
    const list = menuItems();
    if (!list.length) return;
    list[(index + list.length) % list.length].focus();
  }

  function open(x: number, y: number, target: HTMLElement): void {
    close(false);
    openedOn = target;
    returnFocus = document.activeElement as HTMLElement | null;
    menuController = new AbortController();
    const ms = menuController.signal;
    menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = uniqueId('menu');
    menu.setAttribute('role', 'menu');
    for (const item of items()) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.setAttribute('role', 'separator');
        sep.className = 'context-menu__separator';
        menu.appendChild(sep);
        continue;
      }
      const btn = document.createElement('div');
      btn.setAttribute('role', 'menuitem');
      btn.tabIndex = -1;
      btn.className = 'context-menu__item';
      if (item.danger) btn.classList.add('is-danger');
      if (item.disabled) btn.setAttribute('aria-disabled', 'true');
      btn.dataset.action = item.action ?? item.label ?? '';
      const label = document.createElement('span');
      label.textContent = item.label ?? '';
      btn.appendChild(label);
      if (item.shortcut) {
        const kbd = document.createElement('kbd');
        kbd.textContent = item.shortcut;
        btn.appendChild(kbd);
      }
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    menu.style.position = 'fixed';
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    element.setAttribute('aria-expanded', 'true');

    menu.addEventListener('click', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[role="menuitem"]');
      if (btn && btn.getAttribute('aria-disabled') !== 'true') select(btn.dataset.action ?? '');
    }, { signal: ms });
    menu.addEventListener('keydown', (e: KeyboardEvent) => {
      const list = menuItems();
      const index = list.indexOf(document.activeElement as HTMLElement);
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); focusItem(index + 1); break;
        case 'ArrowUp': e.preventDefault(); focusItem(index - 1); break;
        case 'Home': e.preventDefault(); focusItem(0); break;
        case 'End': e.preventDefault(); focusItem(list.length - 1); break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (list[index]) select(list[index].dataset.action ?? '');
          break;
        case 'Escape':
        case 'Tab':
          e.preventDefault();
          close();
          break;
        default:
          if (e.key.length === 1) {
            typeahead += e.key.toLowerCase();
            if (typeaheadTimer) clearTimeout(typeaheadTimer);
            typeaheadTimer = setTimeout(() => (typeahead = ''), 500);
            const match = list.find(li => (li.textContent ?? '').toLowerCase().startsWith(typeahead));
            match?.focus();
          }
      }
    }, { signal: ms });
    document.addEventListener('pointerdown', (e: PointerEvent) => {
      if (menu && !menu.contains(e.target as Node)) close(false);
    }, { signal: ms, capture: true });
    window.addEventListener('resize', () => close(false), { signal: ms });
    window.addEventListener('scroll', () => close(false), { signal: ms, capture: true, passive: true });
    focusItem(0);
  }

  function select(action: string): void {
    const target = openedOn ?? element;
    close();
    options.onSelect?.(action, target);
    emit(element, 'context-menu:select', { action, target });
  }

  function close(restoreFocus = true): void {
    if (!menu) return;
    menuController?.abort();
    menuController = null;
    menu.remove();
    menu = null;
    element.removeAttribute('aria-expanded');
    if (restoreFocus) returnFocus?.focus?.();
  }

  const resolveTarget = (from: EventTarget | null): HTMLElement | null => {
    const el = from as HTMLElement | null;
    if (!el || !element.contains(el)) return null;
    return options.target ? el.closest<HTMLElement>(options.target) : element;
  };

  element.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = resolveTarget(e.target);
    if (!target) return;
    e.preventDefault();
    open(e.clientX, e.clientY, target);
  }, { signal });
  element.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
    const target = resolveTarget(e.target);
    if (!target) return;
    e.preventDefault();
    const r = target.getBoundingClientRect();
    open(r.left + 8, r.bottom, target);
  }, { signal });
  element.setAttribute('aria-haspopup', 'menu');

  return {
    name: 'context-menu',
    element,
    options: options as Record<string, unknown>,
    open: (x: number, y: number, target: HTMLElement = element) => open(x, y, target),
    close: () => close(),
    isOpen: () => menu !== null,
    destroy: () => {
      close(false);
      controller.abort();
      element.removeAttribute('aria-haspopup');
    },
  };
}

mixinRegistry.register('context-menu', contextMenuMixin);
