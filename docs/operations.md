# Ujimu operations runbook

This runbook captures the MVP operational checks required before production use. Keep secrets in environment variables or a secret manager; never commit `.env` files.

## Health and readiness

- Public liveness: `GET /healthz`
  - Returns only `{ "ok": true, "service": "ujimu" }`.
  - Use it for load balancer or process liveness checks.
- Admin readiness: `GET /api/admin/ops/readyz`
  - Requires an authenticated admin session.
  - Returns safe booleans and numeric counts only.
  - Does not expose filesystem paths, secret values, cookies, JWTs, OTPs, or provider credentials.

Readiness checks include database access, data-directory write access, operational-log write access, applied migration count, and whether required secrets are configured.

## Operational logs

Operational logs are written as JSON Lines files under:

```text
<UJIMU_DATA_DIR>/logs/operational/operational-YYYY-MM-DD.jsonl
```

Each line is one sanitized JSON object. Logs may include event category, event name, severity, specialist ID, safe outcomes, counts, provider names, and error codes. Logs must not include raw questions, answers, OTP codes, session cookies, JWTs, webhook secrets, document contents, or full email/phone contact values.

## Required and recommended secrets

Configure these outside source control:

- `UJIMU_SESSION_SECRET` — recommended for durable JWT session validation across restarts.
- `UJIMU_OTP_PEPPER` — recommended for durable OTP verification across restarts.
- `UJIMU_BILLING_WEBHOOK_SECRET` — required for billing webhook confirmation.
- `UJIMU_ADMIN_CONTACTS` — required to grant the single `admin` role.
- `UJIMU_PASSKEYS_ENABLED` — set to `true` to expose passkey registration and login.
- `UJIMU_PASSKEY_RP_ID` — WebAuthn relying-party ID; required in production when passkeys are enabled.
- `UJIMU_PASSKEY_RP_NAME` — user-visible relying-party name; required in production when passkeys are enabled.
- `UJIMU_PASSKEY_ORIGIN` — exact origin used for WebAuthn verification; required in production when passkeys are enabled.
- `UJIMU_DATA_DIR` — storage root for SQLite, specialties, trash, and logs.
- `UJIMU_DB_PATH` — optional SQLite override; defaults under `UJIMU_DATA_DIR`.
- `UJIMU_PI_AGENT_DIR` — optional Pi agent directory override; defaults to the project-local `.pi` directory.
- `UJIMU_PI_CONVERSION_ENABLED` — set to `true` only where admins may run raw-to-Markdown conversion.
- `UJIMU_PI_INGESTION_ENABLED` — set to `true` only where admins may ingest converted Markdown into specialist wikis.
- `UJIMU_PI_CHAT_ENABLED` — set to `true` only where user consultations may call the Pi chat runner.
- `UJIMU_PI_CONVERSION_MAX_MARKDOWN_BYTES` — maximum validated converted Markdown size; defaults to `1048576`.
- `UJIMU_PI_PIPELINE_STALE_PROCESSING_MINUTES` — retry age for stale conversion/ingestion processing records; defaults to `30`.

## Passkey configuration

Passkeys are disabled unless `UJIMU_PASSKEYS_ENABLED=true`. In development, passkey configuration may default to `localhost`, `Ujimu`, and `http://localhost:3000`. In production, configure the RP ID, RP name, and origin explicitly; passkey endpoints fail safely when enabled but not configured.

Passkeys require the correct browser origin and HTTPS in production. OTP continues to be the fallback and recovery path after passkeys are added or removed.

The admin readiness endpoint reports only passkey booleans such as enabled/configured status. It must not expose RP IDs, origins, challenges, public keys, credential IDs, or WebAuthn payloads.

## Pi conversion, ingestion, and consultation smoke test

Run this smoke path only in a configured non-production environment with `.pi/auth.json` present outside source control and the Pi enable flags set deliberately:

1. Upload a small official source through the admin console.
2. Click `Executar conversão` and confirm that `raw/<original filename>.md` is created and the source state becomes conversion `converted` / ingestion `pending`.
3. Click `Executar ingestão` and confirm that the wiki is updated while citations still reference the original uploaded file.
4. Ask a scoped chat question and confirm that the response streams only after validated citations are available.
5. Review admin audit events for safe conversion counts; do not log source contents, prompts, answers, or secrets.

## SQLite backup

The default SQLite database is `<UJIMU_DATA_DIR>/db/ujimu.sqlite`. Prefer the `sqlite3` shell backup command so the backup is consistent while the app may be running:

```bash
sqlite3 "$UJIMU_DATA_DIR/db/ujimu.sqlite" ".backup '$UJIMU_DATA_DIR/backups/ujimu-$(date -u +%Y-%m-%dT%H-%M-%SZ).sqlite'"
```

Store backups outside the application host when possible. Protect backups as sensitive data because they may contain contacts, subscriptions, chat history, analytics, and audit records.

## SQLite restore

Stop the application before restoring. Restore to a new file first, then move it into place after validation:

```bash
sqlite3 "$UJIMU_DATA_DIR/db/ujimu-restored.sqlite" ".restore '$UJIMU_DATA_DIR/backups/ujimu-backup.sqlite'"
sqlite3 "$UJIMU_DATA_DIR/db/ujimu-restored.sqlite" "PRAGMA integrity_check;"
```

If the integrity check returns `ok`, replace the active database while the app is stopped:

```bash
mv "$UJIMU_DATA_DIR/db/ujimu.sqlite" "$UJIMU_DATA_DIR/db/ujimu.sqlite.before-restore"
mv "$UJIMU_DATA_DIR/db/ujimu-restored.sqlite" "$UJIMU_DATA_DIR/db/ujimu.sqlite"
```

Restart the app and check `/healthz` plus `/api/admin/ops/readyz`.

## Deployment quality gate

Every change should pass:

```bash
npm ci
npm test
npm run typecheck
npm run build
npm audit --audit-level=high
```

The GitHub Actions workflow mirrors this quality gate.
