import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './markdown';

/**
 * Тест МЕЖІ, а не оформлення: відповідь моделі — недовірений ввід, і жоден її
 * шматок не має права стати виконуваним HTML.
 */
describe('Markdown', () => {
  it('рендерить сирий <script> як ТЕКСТ, а не як тег', () => {
    const html = renderToStaticMarkup(
      <Markdown>{'Hello <script>alert(1)</script> world'}</Markdown>,
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('не пропускає інлайновий обробник події', () => {
    const html = renderToStaticMarkup(<Markdown>{'<img src="x" onerror="alert(1)">'}</Markdown>);

    // Перевіряємо СУТЬ, а не підрядок: живого тега немає, усе поїхало текстом.
    // (`onerror=` як підрядок у виводі Є — але всередині `onerror=&quot;`, тобто
    // вже екранованим, і виконуваним воно не стає)
    expect(html).not.toMatch(/<img\b/);
    expect(html).toContain('&lt;img');
    expect(html).toContain('onerror=&quot;');
  });

  it('відкидає javascript: у посиланні, лишаючи текст', () => {
    const html = renderToStaticMarkup(<Markdown>{'[click me](javascript:alert(1))'}</Markdown>);

    expect(html).not.toContain('javascript:');
    expect(html).toContain('click me');
  });

  it('пропускає звичайне https-посилання з noopener', () => {
    const html = renderToStaticMarkup(<Markdown>{'[docs](https://example.com)'}</Markdown>);

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('малює розмітку, яку віддає асистент: заголовки, списки, код', () => {
    const html = renderToStaticMarkup(
      <Markdown>{'## Title\n\n1. one\n2. two\n\n`inline`\n\n```\nblock\n```'}</Markdown>,
    );

    expect(html).toContain('<h2>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<code>');
    expect(html).toContain('<pre>');
  });
});
