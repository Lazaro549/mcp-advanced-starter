# Contributing

Thanks for helping improve DevNotes MCP!

## Development setup

- Install Node.js 20 or newer.
- Install dependencies with `npm ci`.
- Run `npm run typecheck`, `npm test`, and `npm run test:coverage` before opening a pull request.

The normal test suite must be deterministic and must not require real API keys, external services, or network access.

## Pull requests

- Keep changes focused and explain the motivation and behavior change.
- Add or update tests for bug fixes and new behavior.
- For transport, OAuth, and resumability changes, cover both expected behavior and relevant failure cases.
- Update documentation when commands, configuration, or supported behavior changes.
- Never commit secrets, local environment files, generated coverage output, or benchmark output that is not intentionally maintained.

Open a pull request against `main`, describe the change and how it was tested, and link any related issue. Please keep discussions respectful and constructive.
