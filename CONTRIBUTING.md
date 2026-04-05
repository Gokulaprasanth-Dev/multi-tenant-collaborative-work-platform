# Contributing

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository and clone your fork
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` and fill in the required values
4. Start infrastructure: `docker-compose up postgres redis -d`
5. Run migrations: `npm run migrate:up`
6. Start dev server: `npm run dev`

## Development Workflow

- Create a branch from `main`: `git checkout -b feat/your-feature`
- Make your changes
- Run tests before submitting: `npm run test:unit && npm run test:integration`
- Run lint: `npm run lint`
- Run type check: `npm run typecheck`
- Open a pull request against `main`

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/description` | `feat/add-webhook-retry` |
| Bug fix | `fix/description` | `fix/comment-403-response` |
| Docs | `docs/description` | `docs/update-runbook` |
| Refactor | `refactor/description` | `refactor/extract-audit-service` |

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new behaviour
- Update relevant documentation
- All CI checks must pass before merge
- Squash commits before merging

## Running Tests

```bash
# Unit tests (no external services required)
npm run test:unit

# Integration tests (requires PostgreSQL + Redis)
npm run test:integration

# Type check
npm run typecheck
```

See [README.md](README.md) for full environment setup.

## Code Style

- TypeScript strict mode is enabled
- ESLint with `--max-warnings 0` — no warnings allowed
- All SQL must use parameterized queries — no string interpolation
- Validate all external input with Zod schemas

## Reporting Bugs

Open a GitHub issue using the **Bug Report** template. Include reproduction steps and environment details.

## Suggesting Features

Open a GitHub issue using the **Feature Request** template.

## Security Issues

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md).
