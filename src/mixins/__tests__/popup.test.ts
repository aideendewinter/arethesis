import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachPopup, popupHost, supportsPopover } from '../popup';

const anchorEl = () => {
  const a = document.createElement('button');
  document.body.appendChild(a);
  return a;
};

describe('attachPopup', () => {
  afterEach(() => vi.restoreAllMocks());

  it('mirrors open state in `hidden` and places the popup next to its anchor', () => {
    const anchor = anchorEl();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const popup = attachPopup(el, { anchor: () => anchor, placement: 'bottom', matchWidth: true });
    expect(el.hidden).toBe(true);
    expect(el.classList.contains('ar-popup')).toBe(true);
    popup.show();
    expect(popup.isOpen()).toBe(true);
    expect(el.hidden).toBe(false);
    expect(el.style.position).toBe('fixed');
    expect(el.dataset.placement).toBeDefined();
    popup.hide();
    expect(el.hidden).toBe(true);
    expect(popup.isOpen()).toBe(false);
    popup.destroy();
    expect(el.classList.contains('ar-popup')).toBe(false);
    expect(el.hasAttribute('popover')).toBe(false);
  });

  it('uses the Popover API when it exists', () => {
    const show = vi.fn();
    const hide = vi.fn();
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const had = { show: proto.showPopover, hide: proto.hidePopover };
    proto.showPopover = show;
    proto.hidePopover = hide;
    try {
      expect(supportsPopover()).toBe(true);
      const el = document.createElement('div');
      document.body.appendChild(el);
      const popup = attachPopup(el, { anchor: () => new DOMRect(10, 10, 0, 0) });
      expect(el.getAttribute('popover')).toBe('manual');
      popup.show();
      popup.show(); // already open: only repositions
      expect(show).toHaveBeenCalledOnce();
      popup.hide();
      expect(hide).toHaveBeenCalledOnce();
    } finally {
      proto.showPopover = had.show;
      proto.hidePopover = had.hide;
    }
  });

  it('follows its anchor while the page scrolls, until hidden', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      cb(0);
      return 1;
    });
    const anchor = anchorEl();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const popup = attachPopup(el, { anchor: () => anchor });
    const spy = vi.spyOn(anchor, 'getBoundingClientRect');
    popup.show();
    const calls = spy.mock.calls.length;
    window.dispatchEvent(new Event('scroll'));
    expect(spy.mock.calls.length).toBe(calls + 1);
    popup.hide();
    window.dispatchEvent(new Event('resize'));
    expect(spy.mock.calls.length).toBe(calls + 1);
    expect(raf).toHaveBeenCalled();
  });

  it('lives inside an open modal dialog, where the rest of the page is inert', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const inside = document.createElement('button');
    dialog.appendChild(inside);
    document.body.appendChild(dialog);
    expect(popupHost(inside)).toBe(dialog);
    expect(popupHost(anchorEl())).toBe(document.body);
    expect(popupHost(null)).toBe(document.body);
  });
});
