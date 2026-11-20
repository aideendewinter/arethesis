import { describe, expect, it } from 'vitest';
import { markdownOutline, renderInline, renderMarkdown } from '../markdown/render';
import { highlightLine, highlightMarkdown, START_STATE } from '../markdown/highlight';

const text = (html: string) => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent;
};

describe('renderMarkdown', () => {
  it('renders headings, paragraphs and inline formatting', () => {
    expect(renderMarkdown('# Title\n\nSome **bold**, *em*, _also em_, ~~gone~~ and `co*de*`.')).toBe(
      '<h1 data-line="0">Title</h1><p data-line="2">Some <strong>bold</strong>, <em>em</em>, <em>also em</em>, <del>gone</del> and <code>co*de*</code>.</p>'
    );
    expect(renderInline('snake_case_name and 2*3*4')).toBe('snake_case_name and 2*3*4');
    expect(renderInline('line  \nbreak')).toBe('line<br>break');
    expect(renderInline('\\*not em\\*')).toBe('*not em*');
  });

  it('renders links, images and autolinks, dropping unsafe URLs', () => {
    expect(renderInline('[Docs](https://example.com "The docs")')).toBe('<a href="https://example.com" title="The docs">Docs</a>');
    expect(renderInline('[`code` link](/x)')).toBe('<a href="/x"><code>code</code> link</a>');
    expect(renderInline('![A vase](https://example.com/v.png)')).toBe('<img src="https://example.com/v.png" alt="A vase">');
    expect(renderInline('<https://example.com>')).toBe('<a href="https://example.com">https://example.com</a>');
    expect(renderMarkdown('[click](javascript:alert(1))')).not.toContain('javascript');
    expect(renderMarkdown('![x](javascript:alert(1))')).not.toContain('<img');
  });

  it('never lets HTML through', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n**<b onclick="x">hi</b>**\n\n```\n<script>\n```');
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('script, img, b, [onerror], [onclick]')).toBeNull();
    expect(div.textContent).toContain('<script>alert(1)</script>');
    expect(div.querySelector('pre code')!.textContent).toBe('<script>');
  });

  it('renders fenced code, quotes and rules', () => {
    expect(renderMarkdown('```ts\nconst a = 1 < 2;\n```')).toBe('<pre data-line="0"><code class="language-ts">const a = 1 &lt; 2;</code></pre>');
    expect(renderMarkdown('> quoted *text*\n> more')).toBe('<blockquote data-line="0"><p data-line="0">quoted <em>text</em>\nmore</p></blockquote>');
    expect(renderMarkdown('---')).toBe('<hr data-line="0">');
  });

  it('renders nested, numbered and task lists', () => {
    const html = renderMarkdown('- one\n- two\n  - nested\n\n3. three\n4. four\n\n* [x] done\n* [ ] todo');
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelectorAll(':scope > ul')).toHaveLength(2);
    expect(div.querySelector('ul')!.querySelectorAll(':scope > li')).toHaveLength(2);
    expect(div.querySelector('ul ul li')!.textContent).toBe('nested');
    expect(div.querySelector('ol')!.getAttribute('start')).toBe('3');
    expect(div.querySelectorAll('.md-task')).toHaveLength(2);
    expect(div.querySelector('.md-check.is-checked')!.getAttribute('aria-label')).toBe('Done');
  });

  it('renders pipe tables with alignment', () => {
    const html = renderMarkdown('| Polis | Tribute |\n|:--|--:|\n| Naxos | 6 |\n| Thasos | 30 |');
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(div.querySelector('th')!.className).toBe('md-align-left');
    expect(div.querySelector('td + td')!.className).toBe('md-align-right');
  });

  it('outlines headings, skipping code blocks', () => {
    expect(markdownOutline('# A\ntext\n```\n# not a heading\n```\n## B *x*')).toEqual([
      { level: 1, text: 'A', line: 0, offset: 0 },
      { level: 2, text: 'B x', line: 5, offset: 33 },
    ]);
  });
});

describe('highlightMarkdown', () => {
  const sample = [
    '# Περὶ ἀρετῆς',
    '',
    'Is **virtue** _teachable_? See [Meno](https://example.com/meno) & `code` <here>.',
    '> - quoted list',
    '1. first',
    '- [x] done',
    '```js',
    'const x = "**not bold**";',
    '```',
    '| a | b |',
    '|---|---|',
    '***',
    'a\\*b ~~old~~ <https://x.y>',
  ].join('\n');

  it('keeps the text exactly, so it lines up with the textarea', () => {
    const lines = highlightMarkdown(sample);
    expect(lines.map(text)).toEqual(sample.split('\n'));
  });

  it('marks up the syntax', () => {
    const [heading, , para, quote, ordered, task, fence, code] = highlightMarkdown(sample);
    expect(heading).toContain('class="md-h md-h1"');
    expect(para).toContain('<span class="md-strong">');
    expect(para).toContain('<span class="md-em">');
    expect(para).toContain('<span class="md-url">https://example.com/meno</span>');
    expect(para).toContain('&lt;here&gt;');
    expect(quote).toContain('md-quote');
    expect(quote).toContain('md-list');
    expect(ordered).toContain('<span class="md-list">1.</span>');
    expect(task).toContain('md-task is-done');
    expect(fence).toContain('md-fence');
    expect(code).toBe('<span class="md-codeblock">const x = "**not bold**";</span>');
  });

  it('carries the code-block state from line to line', () => {
    const open = highlightLine('~~~~', START_STATE);
    expect(open.state.fence).toBe('~~~~');
    expect(highlightLine('~~~', open.state).state.fence).toBe('~~~~'); // too short to close
    expect(highlightLine('~~~~~', open.state).state.fence).toBeNull();
    expect(highlightLine('```js `inline` ```', START_STATE).state.fence).toBeNull();
  });
});
