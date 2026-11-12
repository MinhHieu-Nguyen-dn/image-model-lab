# Contributing

Thanks for helping. This is a small local tool; keep changes focused and simple.

## Setup

Requires [Bun](https://bun.sh) 1.3 or newer.

```bash
bun install
bun test
bun run typecheck
```

`bun run mock` starts a fake Model Studio endpoint on `127.0.0.1:4199` (API key `good-key`) so you can work on the UI without a real key. Never put a real API key in tests, fixtures, issues or pull requests.

## Layout

- `src/server/`: Bun HTTP server, SQLite stores, provider client. Routes are in `src/server/routes/`.
- `public/`: vanilla ES-module frontend, no build step and no CDN; keep it that way.
- `tests/`: API tests that run the real server in-process against the mock.
- `docs/roadmap.md`: planned provider work; read it before adding a provider.

## Pull requests

- Open an issue first for anything bigger than a bug fix.
- Add or update a test for behaviour you change, and run `bun test` and `bun run typecheck` before pushing.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat(ui): ...`, `fix(api): ...`, `docs: ...`) and keep each commit to one concern.
- Keep user data out of the repo: `images/` is git-ignored and must stay that way.
- Security-relevant changes (request guard, file serving, credential handling) need a test in `tests/api-security-and-limits.test.ts`.

By contributing you agree that your work is released under the [MIT License](LICENSE).
