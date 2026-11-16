import { describe, expect, it } from 'vitest';
import { TemplateLoader } from '../template-loader';
import { defineComponent, getComponentMetadata } from '../decorators';
import { mockFetch } from '../../../test/helpers';

const FILE = '<template id="main"><p class="m">main</p></template><template id="loading"><p>…</p></template>';

describe('TemplateLoader', () => {
  it('fetches once, dedupes, and returns fresh clones', async () => {
    const fetch = mockFetch(() => ({ body: FILE, delay: 5 }));
    const loader = new TemplateLoader();
    loader.setFetch(fetch);
    const [a, b] = await Promise.all([loader.load('/t.html', 'main'), loader.load('/t.html', 'loading')]);
    expect(fetch.calls).toHaveLength(1);
    expect(a.querySelector('.m')?.textContent).toBe('main');
    expect(b.textContent).toBe('…');
    const c = await loader.load('/t.html', 'main');
    expect(c).not.toBe(a);
    expect(loader.isCached('/t.html')).toBe(true);
    expect(await loader.has('/t.html', 'error')).toBe(false);
    expect((await loader.load('/t.html')).querySelectorAll('template')).toHaveLength(2);
    await expect(loader.load('/t.html', 'missing')).rejects.toThrow(/not found/);
    loader.clearCache();
    expect(loader.isCached('/t.html')).toBe(false);
  });

  it('treats a file without templates as the main template', async () => {
    const loader = new TemplateLoader();
    loader.register('plain', '<b>plain</b>');
    expect((await loader.load('plain', 'main')).textContent).toBe('plain');
    await expect(loader.load('plain', 'other')).rejects.toThrow();
    loader.register('plain', '<i>changed</i>');
    expect((await loader.load('plain', 'main')).textContent).toBe('changed');
  });

  it('escapes template ids and reports fetch failures', async () => {
    const loader = new TemplateLoader();
    loader.register('x', '<template id="a.b"><i>ok</i></template>');
    expect((await loader.load('x', 'a.b')).textContent).toBe('ok');
    loader.setFetch(mockFetch(() => ({ status: 404 })));
    await expect(loader.load('/missing.html')).rejects.toThrow(/404/);
    await expect(loader.load('/missing.html')).rejects.toThrow(/404/); // not cached
    await loader.preload([]);
  });
});

describe('defineComponent', () => {
  it('registers the element and stores metadata', () => {
    class A extends HTMLElement {}
    defineComponent({ tag: 'test-a', html: '<b>x</b>' })(A);
    expect(customElements.get('test-a')).toBe(A);
    expect(getComponentMetadata(A)).toMatchObject({ tag: 'test-a', templateKey: 'inline:test-a' });
    class B extends HTMLElement {}
    defineComponent({ tag: 'test-b', template: '/b.html' })(B, { kind: 'class' });
    expect(getComponentMetadata(B)?.templateKey).toBe('/b.html');
    class C extends HTMLElement {}
    defineComponent({ tag: 'test-a' })(C); // already defined: kept
    expect(customElements.get('test-a')).toBe(A);
    expect(() => defineComponent({ tag: 'Nope' })).toThrow(/Invalid custom element name/);
    expect(getComponentMetadata(class {})).toBeUndefined();
  });

  it('works as a legacy decorator', () => {
    @defineComponent({ tag: 'test-decorated' })
    class D extends HTMLElement {}
    expect(customElements.get('test-decorated')).toBe(D);
  });
});
