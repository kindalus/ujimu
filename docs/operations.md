# Ujimu operations runbook

This runbook captures the MVP operational checks required before production use. Keep secrets in environment variables or a secret manager; never commit `.env` files.

Launch roadmap note: live payments are not part of the first launch scope. Appy Pay, Stripe/VISA, and SendGrid integrations are deferred until after launch. Before production launch, clarify the OTP/contact-delivery path if OTP authentication remains in launch scope without SendGrid.

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
- `UJIMU_BILLING_WEBHOOK_SECRET` — required only when billing webhook confirmation is enabled; live Appy Pay and Stripe/VISA integrations are post-launch.
- `UJIMU_ADMIN_CONTACTS` — required to grant the single `admin` role.
- `UJIMU_PASSKEYS_ENABLED` — set to `true` to expose passkey registration and login.
- `UJIMU_PASSKEY_RP_ID` — WebAuthn relying-party ID; required in production when passkeys are enabled.
- `UJIMU_PASSKEY_RP_NAME` — user-visible relying-party name; required in production when passkeys are enabled.
- `UJIMU_PASSKEY_ORIGIN` — exact origin used for WebAuthn verification; required in production when passkeys are enabled.
- `UJIMU_DATA_DIR` — storage root for SQLite, specialties, trash, and logs.
- `UJIMU_DB_PATH` — optional SQLite override; defaults under `UJIMU_DATA_DIR`.
- `UJIMU_CONFIG_DIR` — mutable application configuration directory; defaults to `~/.config/ujimu` and stores Pi `auth.json`, `models.json`, and `settings.json`.
- `UJIMU_PI_BUNDLE_DIR` — optional override for bundled Pi resources; defaults to `config/pi` and stores product skills, tools, extensions, and seed config files.
- `UJIMU_PI_CONVERSION_ENABLED` — legacy/manual conversion endpoint flag; the normal ingestion worker no longer depends on this flag.
- `UJIMU_PI_INGESTION_ENABLED` — set to `true` only where admins may let the ingestion agent convert `raw/` into `converted/` and ingest into specialist wikis.
- `UJIMU_PI_CHAT_ENABLED` — set to `true` only where user consultations may call the Pi chat runner.
- `UJIMU_PI_CONVERSION_MAX_MARKDOWN_BYTES` — legacy/manual conversion endpoint maximum validated Markdown size; defaults to `1048576`.
- `UJIMU_PI_PIPELINE_STALE_PROCESSING_MINUTES` — retry age for stale conversion/ingestion processing records; defaults to `30`.
- `GEMINI_API_KEY` — required when PDF-to-Markdown conversion through Gemini CLI is enabled. Keep it only in environment variables or a secret manager; never put it in `<UJIMU_CONFIG_DIR>/settings.json`, prompts, `.env` files committed to source control, or any versioned file.

## Passkey configuration

Passkeys are disabled unless `UJIMU_PASSKEYS_ENABLED=true`. In development, passkey configuration may default to `localhost`, `Ujimu`, and `http://localhost:3000`. In production, configure the RP ID, RP name, and origin explicitly; passkey endpoints fail safely when enabled but not configured.

Passkeys require the correct browser origin and HTTPS in production. OTP continues to be the fallback and recovery path after passkeys are added or removed.

The admin readiness endpoint reports only passkey booleans such as enabled/configured status. It must not expose RP IDs, origins, challenges, public keys, credential IDs, or WebAuthn payloads.

## Ujimu configuration and bundled Pi resources

Mutable Ujimu Pi configuration lives under `<UJIMU_CONFIG_DIR>`, defaulting to `~/.config/ujimu/`. On startup, Ujimu creates this directory when it is missing and seeds only missing files from the bundled Pi directory:

```text
<UJIMU_CONFIG_DIR>/
  auth.json      # seeded from config/pi/auth.json.sample
  models.json    # seeded from config/pi/models.json
  settings.json  # seeded from config/pi/settings.json
```

Versioned Ujimu Pi resources live under `config/pi/`: product skills, extensions, tools, and the seed copies of the three mutable config files. Do not move product skills, extensions, or tools back under the repository `.pi/` directory: Pi CLI reserves `.pi/` for project-local developer runtime configuration and will auto-discover resources there during development.

Keep real `auth.json` files out of Git. If a local environment previously used `.pi/auth.json`, copy the credentials to `<UJIMU_CONFIG_DIR>/auth.json`.

### Pi file-tool sandboxing

Ujimu wraps Pi file tools with a virtual `/data` mount plus a realpath-based allowlist before exposing them to conversion, ingestion, or chat sessions. The model sees specialist files as `/data/...`; host paths are not shown in prompts or expected tool inputs.

- Chat sessions may read/search/list only `/data/wiki/` and cannot write files.
- Ingestion sessions may read `/data/raw/`, `/data/converted/`, `/data/wiki/`, `AGENTS.md`, and `ingest/state.json`; they may write `/data/converted/`, `/data/wiki/`, and `.ujimu/ingestion-manifest.json`.
- Legacy conversion sessions may read only the selected `/data/raw/` source and write only its derived Markdown output.
- Paths outside `/data`, including `/config`, `/bundle`, host absolute paths, home-relative paths, resource-prefixed paths, `..` escapes, and symlink escapes are reported as not found.
- Permission-denied errors are reserved for existing `/data` paths that are real specialist resources but outside the session allowlist, such as a conversion session trying to write `/data/wiki/`.
- `bash` remains unavailable to Ujimu Pi sessions.
- Ujimu Pi sessions load only bundled Ujimu skills from `config/pi/skills`; user-global skills such as `~/.agents/skills` are intentionally not exposed.

This is an application-level guard. For a stronger production isolation boundary, run the process or tool execution inside a container, VM, or equivalent sandbox with only the required specialist directory mounted.

### Agent-owned conversion during ingestion

The normal source-processing path is now owned by the `llm-wiki` skill inside the ingestion agent session. The agent converts each pending source from `raw/` to `converted/<raw relative path>.md`, then ingests only from `converted/` into the OKF-compliant `wiki/`. Ujimu validates the resulting manifest, converted file paths/hashes, wiki page paths, and citation shape before updating `ingest/state.json`; it does not validate conversion fidelity or source content.

The legacy DOCX/PDF conversion utilities and `/conversion/run` endpoint remain for transitional/manual use, but the background ingestion worker does not call them.

## Legacy Gemini PDF-to-Markdown conversion dependency

Manual PDF conversion through the legacy `pdf_to_markdown` tool depends on the Gemini CLI in the production/container runtime:

- `gemini` must be installed and available on `PATH`.
- `timeout` must be available on `PATH` in the container runtime; the script uses `timeout 600s` per PDF.
- `GEMINI_API_KEY` must be set in the environment or secret manager.
- `GEMINI_API_KEY` is sensitive and must not be written to `<UJIMU_CONFIG_DIR>/settings.json`, prompts, operational logs, or versioned files.

Manual smoke test in a configured non-production environment:

```bash
command -v gemini
command -v timeout
test -n "$GEMINI_API_KEY"
cd /path/to/specialist-root
/path/to/ujimu/config/pi/tools/pdf_to_markdown.sh raw/small-sample.pdf
```

Expected result: the command prints JSON metadata only and creates `raw/small-sample.pdf.md`. This is not the normal ingestion-worker path. Do not run this smoke test in CI because it requires real Gemini credentials and an external service call.

## Pi conversion, ingestion, and consultation smoke test

Run this smoke path only in a configured non-production environment with `<UJIMU_CONFIG_DIR>/auth.json` present outside source control or credentials provided through environment variables, and with the Pi enable flags set deliberately. Before production, run it with the exact provider/model configuration intended for production; a successful smoke with a temporary model proves the pipeline shape, not the final production model choice.

1. Upload a small official source through the admin console.
2. Click `Executar ingestão` and confirm that the ingestion agent creates or updates `converted/<original filename>.md`, then updates `wiki/`.
3. Confirm that the wiki source pages trace to both the original uploaded file and the converted file, while chat citations still reference the original uploaded file.
4. Ask a scoped chat question and confirm that the response streams only after validated citations are available.
5. Review admin audit events and specialist-local agent logs; do not log source contents, prompts, answers, or secrets outside the intended agent-session log.

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

## Podman container deployment

Ujimu provides a single Podman-compatible image with production and test profiles. The same image is configured at runtime by env files and host volume mappings.

Build the default local image:

```bash
scripts/container/build.sh
```

Default image tag: `localhost/ujimu:latest`. Override with `UJIMU_IMAGE` when needed.

Profile defaults:

| Profile | Container | Host port | Ujimu config host dir | Ujimu data host dir |
| --- | --- | --- | --- | --- |
| `prod` | `ujimu-prod` | `3000` | `/srv/ujimu/prod/pi` | `/srv/ujimu/prod/data` |
| `test` | `ujimu-test` | `3001` | `/srv/ujimu/test/pi` | `/srv/ujimu/test/data` |

Inside the container both profiles use:

```text
/home/ujimu/.config/ujimu
/home/ujimu/.local/share/ujimu
```

The image creates and runs as internal user/group `ujimu:ujimu`, listens on internal port `3000`, defaults `TZ=Africa/Luanda`, sets `UJIMU_DATA_DIR=/home/ujimu/.local/share/ujimu`, sets `UJIMU_CONFIG_DIR=/home/ujimu/.config/ujimu`, and keeps bundled Pi resources under `/app/config/pi`. It includes Gemini CLI through `npm install -g @google/gemini-cli` and exposes a `/healthz` Dockerfile healthcheck.

Create real env files from the examples, keeping secrets out of Git:

```bash
cp config/container/prod.env.example config/container/prod.env
cp config/container/test.env.example config/container/test.env
```

Alternatively point scripts at an external env file:

```bash
UJIMU_ENV_FILE=/secure/path/prod.env scripts/container/deploy.sh prod
```

Lifecycle scripts:

```bash
scripts/container/create.sh prod|test    # create network, dirs, and stopped container; fails if container exists
scripts/container/deploy.sh prod|test    # create if missing, otherwise restart
scripts/container/redeploy.sh prod|test  # build, replace container, start; preserves host data
scripts/container/remove.sh prod|test    # remove only the target container
```

The scripts create missing profile host directories with `mkdir -p`, but never delete Ujimu config or data directories, images, networks, env files, or secrets. Reverse proxy, TLS, DNS, certificates, and CI/CD automation are intentionally outside this deployment slice.

The test profile enables existing fake/no-op auth delivery and mock billing paths while keeping Pi conversion, ingestion, and chat enabled for validation. Do not put real external auth, payment, or communication provider secrets in `test.env`.

For first launch, do not require live Appy Pay, Stripe/VISA, or SendGrid configuration. Those provider integrations are planned for post-launch work.

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
