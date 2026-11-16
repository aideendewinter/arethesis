/**
 * `infinite-scroll`: load more when the end of the content scrolls into view.
 *
 * Give it a `loadMore` function, or the id of a ListView via `view`
 * (`data-mixin-infinite-scroll-view="…"`) to page through it with no code.
 *
 * Events: `infinite-scroll:load` (before loading), `infinite-scroll:loaded`, `infinite-scroll:error`.
 *
 * @module mixins/infinite-scroll
 */

import type { InfiniteScrollOptions, MixinInstance } from './types';
import { mixinRegistry } from './registry';
import { emit } from './utils';
import { getRuntime, hasRuntime } from '../components/runtime';

export function infiniteScrollMixin(element: HTMLElement, options: InfiniteScrollOptions = {}): MixinInstance {
  const threshold = options.threshold ?? 300;
  let loading = false;
  let destroyed = false;

  const listView = (): ReturnType<ReturnType<typeof getRuntime>['listViews']['get']> =>
    options.view && hasRuntime() ? getRuntime().listViews.get(options.view) : undefined;

  const hasMore = (): boolean => {
    if (options.hasMore) return options.hasMore();
    const view = listView();
    return view ? view.hasMore : true;
  };

  const loadMore = async (): Promise<void> => {
    if (options.loadMore) {
      await options.loadMore();
    } else if (options.view && hasRuntime()) {
      await getRuntime().listViews.loadMore(options.view);
    }
  };

  let sentinel = options.sentinel ? element.querySelector<HTMLElement>(options.sentinel) : null;
  const created = !sentinel;
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.className = 'ar-scroll-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    element.appendChild(sentinel);
  }
  const target = sentinel;

  const resolveRoot = (): Element | null => {
    if (options.root === 'viewport') return null;
    if (options.root === 'self') return element;
    if (options.root) return document.querySelector(options.root);
    const style = getComputedStyle(element);
    return /(auto|scroll)/.test(`${style.overflowY}${style.overflow}`) ? element : null;
  };

  let observer: IntersectionObserver | null = null;

  const observe = (): void => {
    observer?.disconnect();
    if (destroyed || typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) void trigger();
    }, { root: resolveRoot(), rootMargin: `0px 0px ${threshold}px 0px` });
    observer.observe(target);
  };

  async function trigger(): Promise<void> {
    if (loading || destroyed || !hasMore()) return;
    if (!emit(element, 'infinite-scroll:load', {})) return;
    loading = true;
    element.classList.add('is-loading-more');
    element.setAttribute('aria-busy', 'true');
    try {
      await loadMore();
      emit(element, 'infinite-scroll:loaded', {});
    } catch (error) {
      emit(element, 'infinite-scroll:error', { error });
    } finally {
      loading = false;
      element.classList.remove('is-loading-more');
      element.removeAttribute('aria-busy');
      // Keep the sentinel last, and re-check: if it is still visible, load again.
      if (target.parentElement === element && element.lastElementChild !== target) element.appendChild(target);
      if (!destroyed && hasMore()) observe();
      else observer?.disconnect();
    }
  }

  observe();

  return {
    name: 'infinite-scroll',
    element,
    options: options as Record<string, unknown>,
    /** Trigger a load now (respects `hasMore`). */
    load: trigger,
    destroy: () => {
      destroyed = true;
      observer?.disconnect();
      if (created) target.remove();
      element.classList.remove('is-loading-more');
    },
  };
}

mixinRegistry.register('infinite-scroll', infiniteScrollMixin);
