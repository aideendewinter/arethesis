# Security

Arethesis tries to make the safe thing the default. Here's what it does for you, and what is still up to you.

## What the framework does

- **Text is text.** Bindings write with `textContent` and create badges, tags, links and images with DOM APIs, never by building markup strings.
- **URLs are sanitized.** Values bound to `href`, `src` and other URL attributes go through `sanitizeUrl`: `javascript:`, `vbscript:`, `data:text/html` and obfuscated variants are dropped. Images allow `http(s)`, `blob:` and raster `data:image/*`.
- **HTML is sanitized.** The `html` display type and the rich-text editor use an allowlist sanitizer: scripts, event handlers, iframes, SVG/MathML, forms and unknown attributes are removed, and `target="_blank"` links get `rel="noopener noreferrer"`. Opt out with `trusted: true` only for content you control completely.
- **Event-handler attributes can't be bound.** `attribute: 'onclick'` (any `on*`) is ignored.
- **Tokens stay home.** The bearer token is only attached to requests for the page origin, the `baseUrl` origin, or `trustedOrigins`. SSE and WebSocket URLs only get `?token=` when they point at a trusted origin.
- **No prototype pollution.** Merges, response mapping and path helpers skip `__proto__`, `constructor` and `prototype`.
- **Cache isolation on logout.** `app.logout()` clears tokens, the in-memory store, list views and IndexedDB, so the next person on a shared device sees nothing.
- **Peer messages can't edit your cache.** With Azure Web PubSub cache invalidation, only messages sent by the server are applied.
- **Safe retries.** POST and PATCH are never retried unless you opt in, so a slow response can't create duplicates.

## What's up to you

- **Token storage.** Tokens default to `localStorage`, which any script on your origin can read. Use `storage: 'session'` or `'memory'` to limit exposure, use HTTP-only cookies (`credentials: 'include'`) if your backend supports them, and deploy a strict Content Security Policy.
- **Tokens in URLs.** `EventSource` can't send headers, so SSE (and, by default, WebSocket) connections carry the token as a query parameter. Make sure your servers and proxies don't log it, or disable it with `tokenParam: false` and authenticate with cookies instead.
- **Your own templates.** Template files and inline `html` are trusted markup. Don't build them from user input.
- **`innerHTML` in your code.** Hooks like `onBind` are plain DOM code; use `textContent` (or the binder) for user data.
- **Validation is UX, not security.** Always validate on the server too.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
