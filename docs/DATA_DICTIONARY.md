# Data Dictionary — PII Classification and Retention Policy

This document classifies every PII field in the database, specifying retention policy and erasure action per GDPR Article 17.

---

## Table: `users`

| Column | PII Classification | Retention Policy | Erasure Action |
|---|---|---|---|
| `id` | Pseudonymous identifier | Indefinite (key for FK integrity) | Retained |
| `email` | Direct PII — contact data | Until erasure request | Anonymised: `deleted_<id>@anonymised.invalid` |
| `name` | Direct PII — identity | Until erasure request | Overwritten: `Deleted User` |
| `phone` | Direct PII — contact data | Until erasure request | Set to `NULL` |
| `avatar_url` | Indirect PII — visual identity | Until erasure request | Set to `NULL` |
| `password_hash` | Credential | Until erasure request | Set to `NULL` |
| `totp_secret` | Credential (MFA seed) | Until erasure request | Set to `NULL` |
| `totp_enabled` | MFA state | Until erasure request | Set to `false` |
| `mfa_backup_codes` | Credential (recovery) | Until erasure request | Set to `NULL` |
| `status` | Operational | Indefinite | Set to `deleted` on erasure |
| `deleted_at` | Operational | Indefinite | Set to `NOW()` on erasure |
| `last_seen_at` | Behavioural metadata | Until erasure request | Set to `NULL` (implicitly via anonymisation) |

---

## Table: `audit_logs`

| Column | PII Classification | Retention Policy | Erasure Action |
|---|---|---|---|
| `id` | Pseudonymous identifier | Per `retention_audit_days` org setting | Partition DROP (not DELETE) |
| `org_id` | Org identifier | Per org retention setting | Partition DROP |
| `actor_id` | Indirect PII — FK to users | Per org retention setting | Set to `NULL` on user erasure (row retained for compliance) |
| `actor_type` | Operational | Per org retention setting | Retained |
| `event_type` | Operational | Per org retention setting | Retained |
| `entity_type` | Operational | Per org retention setting | Retained |
| `entity_id` | Pseudonymous | Per org retention setting | Retained |
| `payload` | May contain PII (varies by event) | Per org retention setting | Retained — payload redaction reviewed per event type |
| `ip_address` | Indirect PII — network data | Per org retention setting | **Retained** (legal/compliance requirement — GDPR Recital 49) |
| `user_agent` | Indirect PII — device data | Per org retention setting | Retained |
| `occurred_at` | Temporal metadata | Per org retention setting | Retained |

**Note:** Audit log cleanup is performed by `DROP TABLE` on monthly partitions (never `DELETE FROM`). The minimum retention across all active orgs' `retention_audit_days` settings determines the oldest partition kept.

---

## Table: `payments`

| Column | PII Classification | Retention Policy | Erasure Action |
|---|---|---|---|
| `id` | Pseudonymous identifier | **7 years** (financial/legal obligation) | **Retained — not anonymised** |
| `org_id` | Org identifier | 7 years | Retained |
| `user_id` | Indirect PII — FK to users | 7 years | Retained — `user_id` preserved for financial record integrity |
| `razorpay_order_id` | Payment provider reference | 7 years | Retained |
| `razorpay_payment_id` | Payment provider reference | 7 years | Retained |
| `amount_paise` | Financial data | 7 years | Retained |
| `currency` | Financial data | 7 years | Retained |
| `status` | Financial state | 7 years | Retained |
| `created_at` | Temporal metadata | 7 years | Retained |

**Retention basis:** Financial records must be retained for 7 years under Indian Companies Act 2013 and GST regulations.

---

## Table: `subscriptions`

| Column | PII Classification | Retention Policy | Erasure Action |
|---|---|---|---|
| All columns | Financial/contractual data | **7 years** | **Retained — not anonymised** |

---

## Table: `auth_providers`

| Column | PII Classification | Retention Policy | Erasure Action |
|---|---|---|---|
| `user_id` | Pseudonymous FK | Until erasure request | **Deleted** (entire row) |
| `provider` | Operational | Until erasure request | Deleted |
| `provider_user_id` | Direct PII — external identity | Until erasure request | Deleted (row deleted) |
| `email` | Direct PII — contact data | Until erasure request | Deleted (row deleted) |

---

## Table: `organization_members`

| Column | PII Classification | Retention Policy | Erasure Action |
|---|---|---|---|
| `user_id` | Pseudonymous FK | Until member removed | Not anonymised (FK constraint; user record anonymised separately) |
| `role` | Operational | Until removed | Retained |
| `joined_at` | Operational | Until removed | Retained |
| `removed_at` | Operational | Until removed | Retained |

---

## Table: `task_comments`

| Column | PII Classification | Retention Policy | Erasure Action |
|---|---|---|---|
| `author_id` | Pseudonymous FK | Until org deleted | Retained (author record anonymised at user level) |
| `body` | User-generated content (may contain PII) | Until org deleted or task deleted | Not anonymised automatically; org admin may delete comments |

---

## Table: `chat_messages`

| Column | PII Classification | Retention Policy | Erasure Action |
|---|---|---|---|
| `sender_id` | Pseudonymous FK | Until channel/org deleted | Retained |
| `body` | User-generated content (may contain PII) | Until message deleted | Not anonymised automatically |

---

## Table: `files`

| Column | PII Classification | Retention Policy | Erasure Action |
|---|---|---|---|
| `uploader_id` | Pseudonymous FK | Until org deleted | Retained |
| `filename` | May contain PII | Until org deleted | Soft-deleted at org offboarding |
| `storage_key` | Pseudonymous (UUID) | Until file deleted | S3 object deleted at offboarding |

---

## Erasure Execution Summary

1. **User erasure (`user.erased` event):**
   - Anonymise `users` row in place (email, name, phone, avatar_url, password_hash, totp_secret, mfa_backup_codes)
   - Revoke all active tokens
   - Set `audit_logs.actor_id = NULL` for all actor rows (rows retained)
   - Delete `auth_providers` rows
   - Retain `payments` and `subscriptions` rows intact
   - Clear Redis user cache

2. **Org offboarding (`org.deleted` event):**
   - Enqueue `erase-user` for all active members
   - Soft-delete: workspaces, tasks, channels, files, webhooks
   - Retain payments and subscriptions
   - Set `organizations.status = 'deleted'`

3. **Audit log cleanup:**
   - Performed by cleanup worker via `DROP TABLE audit_logs_YYYY_MM`
   - Never via `DELETE FROM audit_logs`

---

## GDPR Data Subject Rights Implementation

| Right | Implementation |
|---|---|
| Right of Access (Art. 15) | `POST /orgs/:orgId/gdpr/export-request` — streaming ZIP export |
| Right to Erasure (Art. 17) | `POST /orgs/:orgId/gdpr/erasure-request` — re-auth gate + erase-user job |
| Right to Restriction | Not yet implemented — raise support ticket |
| Right to Portability | Covered by export (JSON format) |
| Right to Object | Opt-out via account deletion |
