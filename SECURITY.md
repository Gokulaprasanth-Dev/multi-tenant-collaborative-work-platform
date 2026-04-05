# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security vulnerabilities by emailing the maintainers directly. Include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You will receive a response within 72 hours. Once the vulnerability is confirmed, we will:

1. Work on a fix in a private branch
2. Release a patch version
3. Credit you in the release notes (unless you prefer anonymity)

## Security Design

This project implements several security controls:

- **Authentication**: RS256 JWT with short-lived access tokens (15m) and refresh tokens (7d)
- **Authorization**: Role-based access control enforced at the middleware layer
- **Multi-tenancy isolation**: All queries are scoped by `org_id` with row-level validation
- **Secrets management**: All credentials via environment variables — never hardcoded
- **Input validation**: Zod schemas at every API boundary
- **SQL injection prevention**: Parameterized queries throughout; no string interpolation in SQL
- **SSRF prevention**: Outbound webhook URLs validated against private IP ranges
- **Rate limiting**: Per-endpoint rate limits on auth and API routes
- **Audit logging**: Append-only audit log table; no UPDATE/DELETE permitted
- **File upload security**: MIME type validation, virus scanning (ClamAV), size limits
- **Encryption at rest**: AES-256-GCM for sensitive fields

## Dependency Vulnerabilities

Run `npm audit` to check for known vulnerabilities in dependencies. We run this automatically in CI.
