import { describe, expect, it } from 'vitest';
import { escapeHtml, html, isSafeHtml, setHtml, unsafeHtml } from '../html';

describe('html', () => {
  it('escapes values in text and quoted attributes', () => {
    const name = `<img src=x onerror="alert(1)">`;
    expect(String(html`<p title="${name}">${name}</p>`)).toBe(
      '<p title="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;">&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>',
    );
    expect(String(html`<p title='${"it's"}'>${0}</p>`)).toBe(`<p title='it&#39;s'>0</p>`);
  });

  it('keeps nested markup and arrays, and drops null, undefined and false', () => {
    const items = ['a', '<b>'];
    const out = html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>${null}${undefined}${false}${unsafeHtml('<hr>')}`;
    expect(isSafeHtml(out)).toBe(true);
    expect(String(out)).toBe('<ul><li>a</li><li>&lt;b&gt;</li></ul><hr>');
    // Markup in an attribute is text.
    expect(String(html`<p title="${html`<b>`}">`)).toBe('<p title="&lt;b&gt;">');
  });

  it('scrubs unsafe URLs at the start of URL attributes', () => {
    expect(String(html`<a href="${'javascript:alert(1)'}">x</a>`)).toBe('<a href="about:invalid">x</a>');
    expect(String(html`<a href="${' JaVa\tscript:alert(1)'}">x</a>`)).toBe('<a href="about:invalid">x</a>');
    expect(String(html`<a href="${'/people?id=1&x=2'}">x</a>`)).toBe('<a href="/people?id=1&amp;x=2">x</a>');
    expect(String(html`<a href="/people/${'javascript:1'}">x</a>`)).toBe('<a href="/people/javascript:1">x</a>');
    expect(String(html`<img src="${'data:image/png;base64,AA'}" srcset="${'a.png'} 1x, ${'javascript:x'} 2x">`)).toBe(
      '<img src="data:image/png;base64,AA" srcset="a.png 1x, about:invalid 2x">',
    );
    expect(String(html`<a href="${''}">x</a>`)).toBe('<a href="">x</a>');
  });

  it('throws where escaping is not enough', () => {
    const x = 'y';
    expect(() => html`<p title=${x}>`).toThrow(/unquoted title/);
    expect(() => html`<p ${x}>`).toThrow(/inside a tag/);
    expect(() => html`<button onclick="${x}">`).toThrow(/onclick handler/);
    expect(() => html`<script>let a = ${x}</script>`).toThrow(/inside <script>/);
    expect(() => html`<style>p { color: ${x} }</style>`).toThrow(/inside <style>/);
  });

  it('tracks state across tags, comments and earlier values', () => {
    const x = '<';
    expect(String(html`<script>1</script><p>${x}</p>`)).toBe('<script>1</script><p>&lt;</p>');
    expect(String(html`<!-- <p title= --><b>${x}</b>`)).toBe('<!-- <p title= --><b>&lt;</b>');
    expect(String(html`<textarea>${x}</textarea>`)).toBe('<textarea>&lt;</textarea>');
    expect(String(html`<a class="${'a'} ${'b'}" href="/${'c'}">${'d'}</a>`)).toBe('<a class="a b" href="/c">d</a>');
    expect(String(html`<input disabled value="${x}"/><br/>${x}`)).toBe('<input disabled value="&lt;"/><br/>&lt;');
    expect(String(html`<p data-a = "${x}" data-b>${x}</p>`)).toBe('<p data-a = "&lt;" data-b>&lt;</p>');
    expect(String(html`a < b ${x}`)).toBe('a < b &lt;');
  });

  it('sets element content', () => {
    const el = document.createElement('div');
    setHtml(el, html`<b>${'<i>'}</b>`);
    expect(el.innerHTML).toBe('<b>&lt;i&gt;</b>');
    expect(escapeHtml(`&"'`)).toBe('&amp;&quot;&#39;');
  });
});
