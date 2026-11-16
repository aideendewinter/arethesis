# Contributing

Thanks for helping improve Arethesis!

## Setup

```bash
npm install
npx playwright install chromium   # for end-to-end tests
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run examples` | Start the example gallery with hot reload |
| `npm test` | Unit tests in watch mode |
| `npm run coverage` | Unit tests with coverage (thresholds enforced) |
| `npm run e2e` | Build the examples and run the Playwright suite (including axe accessibility checks) |
| `npm run typecheck` | Type-check the library, tests and examples |
| `npm run lint` | ESLint |
| `npm run build` | Build `dist/` |
| `npm run docs` | Generate the API reference into `docs/api/` |

## Guidelines

- **Tests first.** Every bug fix comes with a regression test; every feature with unit tests. UI behavior that depends on a real browser gets an end-to-end test.
- **No runtime dependencies.** The published package has none; please keep it that way.
- **Accessibility is a feature.** New UI must be keyboard operable, expose correct ARIA roles and states, and pass the axe checks in `e2e/a11y.spec.ts`.
- **Safe by default.** Never write untrusted values with `innerHTML`; sanitize URLs; don't send credentials to untrusted origins.
- **Keep the public API documented.** Exported symbols need TSDoc comments, and user-facing changes need a line in `CHANGELOG.md` and the relevant guide in `docs/`.

## Releasing

Releases are published to npm by [`.github/workflows/release.yml`](.github/workflows/release.yml) when a `v*` tag is pushed. It runs every check, publishes with [provenance](https://docs.npmjs.com/generating-provenance-statements) through npm trusted publishing (no npm token is stored anywhere), and creates a GitHub release from the matching `CHANGELOG.md` section.

1. Add a section for the new version at the top of `CHANGELOG.md` (`## 0.1.1`).
2. `npm version patch` (or `minor` / `major`). This updates `package.json`, commits and tags.
3. `git push --follow-tags`.

The workflow refuses to publish if the tag doesn't match the `package.json` version.

## Notes for unusual environments

Some sandboxed Linux environments (for example WSL 1) can't run headless Chromium reliably. Setting `PW_SINGLE_PROCESS=1` and pointing `TMPDIR` at a regular filesystem helps there, but multi-page tests may still fail. CI runs the full suite on Ubuntu.
