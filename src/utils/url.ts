/**
 * URL sanitizing for values written into `href` / `src`.
 *
 * @module utils/url
 */

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'blob:']);
const DATA_IMAGE = /^data:image\/(png|gif|jpe?g|webp|avif|svg\+xml);/i;

/**
 * Return the URL if it is safe for the given use, or `''` otherwise.
 *
 * - `link`: http(s), mailto, tel, and relative URLs.
 * - `image`: http(s), blob, raster `data:image/*`, and relative URLs.
 *
 * `javascript:`, `vbscript:`, `data:text/html` and similar are rejected, including
 * obfuscated forms with whitespace or control characters.
 */
export function sanitizeUrl(value: unknown, kind: 'link' | 'image' = 'link'): string {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (raw === '') return '';
  // Strip characters browsers ignore when parsing the scheme.
  // eslint-disable-next-line no-control-regex
  const normalized = raw.replace(/[\u0000-\u001F\u007F\s]+/g, '');
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
  if (!schemeMatch) {
    // Relative URL (path, query, fragment, protocol-relative).
    return raw;
  }
  const protocol = `${schemeMatch[1].toLowerCase()}:`;
  if (kind === 'image') {
    if (protocol === 'data:') return DATA_IMAGE.test(normalized) && !/svg/i.test(normalized) ? raw : '';
    return SAFE_IMAGE_PROTOCOLS.has(protocol) ? raw : '';
  }
  return SAFE_LINK_PROTOCOLS.has(protocol) ? raw : '';
}
