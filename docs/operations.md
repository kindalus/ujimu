# Ujimu operations runbook

This runbook captures the MVP operational checks required before production use. Keep secrets in environment variables or a secret manager; never commit `.env` files.

Launch roadmap note: live payments are not part of the first launch scope. The first deployment runs anonymously when no OTP delivery channel is configured; account login becomes available per channel when SendGrid email and/or Twilio SMS configuration is complete.

## Health and readiness

- Public liveness: `GET /healthz`
  - Returns only `{ "ok": true, "service": "ujimu" }`.
  - Use it for load balancer or process liveness checks.
- Admin readiness: `GET /api/admin/ops/readyz`
  - Requires an authenticated admin session.
  - Returns safe booleans and numeric counts only.
  - Does not expose filesystem paths, secret values, cookies, JWTs, OTPs, or provider credentials.

Readiness checks include database access, data-directory write access, operational-log write access, applied migration count, and secrets required by enabled features. Billing secrets are not required while subscriptions are disabled; the OTP pepper is not required while no OTP channel is configured.

## Public SEO identity

- Set `NUXT_PUBLIC_SITE_URL` to the canonical HTTPS origin; production uses `https://ujimu.com`.
- Verify `/robots.txt`, `/sitemap.xml`, `/favicon.svg`, `/site.webmanifest`, and `/ujimu-social.png` after every public deployment.
- Fetch `/` with a non-browser crawler user agent and confirm that title, description, canonical, Open Graph, and Twitter Card tags are present in the initial HTML.
- Private and operational pages plus `/api/**` must return `X-Robots-Tag: noindex, nofollow`.
- The social image is a 1200 × 630 PNG. Social platforms may cache older previews after a deployment even when the origin HTML is correct.

## Operational logs

Operational logs are written as JSON Lines files under:

```text
<UJIMU_DATA_DIR>/logs/operational/operational-YYYY-MM-DD.jsonl
```

Each line is one sanitized JSON object. Logs may include event category, event name, severity, specialist ID, safe outcomes, counts, provider names, and error codes. Logs must not include raw questions, answers, OTP codes, session cookies, JWTs, webhook secrets, document contents, or full email/phone contact values.

## Required and recommended secrets

Configure these outside source control:

- `UJIMU_SESSION_SECRET` — required for readiness. Signs session cookies and the anonymous quota cookie, and keeps both valid across restarts.
- `UJIMU_OTP_PEPPER` — required for readiness. Keeps OTP verification working across restarts.
- `UJIMU_OTP_PROVIDER` — global OTP provider: `direct`, `twilio-verify`, or `disabled`; omission means `direct`, while unknown values fail closed.
- `UJIMU_SENDGRID_API_KEY` and `UJIMU_SENDGRID_FROM_EMAIL` — together enable email OTP delivery in `direct` mode; `UJIMU_SENDGRID_FROM_NAME` defaults to `Ujimu`.
- `UJIMU_TWILIO_ACCOUNT_SID`, `UJIMU_TWILIO_AUTH_TOKEN`, and `UJIMU_TWILIO_FROM_PHONE` — together enable Twilio Messaging SMS OTP delivery in `direct` mode.
- `UJIMU_TWILIO_VERIFY_SERVICE_SID` — required with Account SID and Auth Token in `twilio-verify` mode; it must identify an existing Verify Service and start with `VA`.
- `UJIMU_SUBSCRIPTIONS_ENABLED` — defaults to `false`; set to `true` only when individual subscription pages, APIs, quota upgrades, and billing are ready for launch.
- `UJIMU_COMPANIES_ENABLED` — defaults to `false`; set to `true` only when company pages, APIs, quota, and private-specialist access are ready for launch.
- `UJIMU_BILLING_WEBHOOK_SECRET` — required for readiness only when `UJIMU_SUBSCRIPTIONS_ENABLED=true`; live Appy Pay and Stripe/VISA integrations are post-launch.
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
- `UJIMU_PI_INGESTION_PROVIDER` and `UJIMU_PI_INGESTION_MODEL` — optional model override shared by ingestion and administrative derivation jobs; there is no separate derivation provider configuration.
- `UJIMU_PI_INGESTION_THINKING_LEVEL` — optional ingestion-only override; accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Missing or empty input preserves `defaultThinkingLevel` from `<UJIMU_CONFIG_DIR>/settings.json`; invalid input aborts session creation. The Pi SDK may clamp a valid level to the selected model's capabilities.
- `UJIMU_PI_CHAT_ENABLED` — set to `true` only where user consultations may call the Pi chat runner.
- `UJIMU_PI_CONVERSION_MAX_MARKDOWN_BYTES` — legacy/manual conversion endpoint maximum validated Markdown size; defaults to `1048576`.
- `UJIMU_PI_PIPELINE_STALE_PROCESSING_MINUTES` — retry age for stale conversion/ingestion processing records; defaults to `30`.

## OTP delivery configuration

`UJIMU_OTP_PROVIDER` selects one global mode:

- `direct` preserves the existing independent SendGrid email and Twilio Messaging SMS channels. It is also the default when the selector is absent.
- `twilio-verify` exposes SMS only and requires a valid Account SID (`AC…`), Auth Token, and Verify Service SID (`VA…`). Create and configure that Verify Service in Twilio before deployment. Ujimu references it in `/v2/Services/{ServiceSid}/Verifications` and `/VerificationCheck`; it does not use `UJIMU_TWILIO_FROM_PHONE` in this mode.
- `disabled` exposes no OTP channel. Unknown selector values also fail closed.

Incomplete provider configuration leaves OTP unavailable. Ujimu then exposes anonymous consultation only and hides new-login controls; already valid sessions remain accepted. Provider failures and malformed responses return generic errors without exposing Twilio response bodies or credentials. Local contact/IP request limits and verification-attempt limits remain active alongside Twilio Verify protections.

Official provider references:

- https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
- https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource
- https://www.twilio.com/docs/verify/sms
- https://www.twilio.com/docs/verify/api/verification
- https://www.twilio.com/docs/verify/api/verification-check

## Launch feature flags

`UJIMU_SUBSCRIPTIONS_ENABLED` and `UJIMU_COMPANIES_ENABLED` are strict opt-in flags. Omitted values are treated as `false`. Disabled page and API routes return `404`, their links and controls are hidden, and existing billing/company records remain dormant. Enabling a flag restores the existing code path without migrating or deleting data.

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

Keep real `auth.json` files out of Git. If a local environment previously used `.pi/auth.json`, copy the credentials to `<UJIMU_CONFIG_DIR>/auth.json`. Pi `auth.json` environment references must use explicit `$ENV_VAR` interpolation, for example `"key": "$OPENROUTER_API_KEY"`; a bare uppercase value is treated as a literal key by current Pi releases.

Ujimu exposes a closed bundle of three product skills from `config/pi/skills/`:

- `llm-wiki` builds and maintains the auditable OKF-backed specialist wiki across the `raw/`, `converted/`, and `wiki/` layers.
- `unslop` removes generic AI-writing patterns and keeps generated prose direct and natural. Specialist initialization requires each generated `AGENTS.md` to invoke it before the final consultation answer without changing grounded facts, legal meaning, citations, or output structure.
- `research` defines a primary-source-first research workflow that records cited findings in a repository Markdown file. Loading this skill does not add a background-agent executor to Ujimu; that capability remains outside the current runtime.

The Pi resource loader disables implicit skill discovery and then loads this directory explicitly. Global or user-installed skills are therefore not available to Ujimu sessions and cannot override a bundled skill through a name collision.

The bundled `llm-wiki` skill is an external, generated copy under `config/pi/skills/llm-wiki/` and is intentionally ignored by Git. `npm run dev`, `npm test`, `npm run typecheck`, and `npm run build` run `npm run skills:sync` first, copying the skill only when it is missing. Refresh the local copy explicitly with:

```bash
npm run skills:update
```

By default the updater clones `https://github.com/kindalus/skills.git` and copies `skills/llm-wiki`. Use `UJIMU_LLM_WIKI_SOURCE_DIR` for a local checkout, or pin a branch, tag, or commit with `UJIMU_LLM_WIKI_REF` for reproducible builds.

The `unslop` and `research` snapshots are versioned because their confirmed official source is the local global skill installation and no remote distribution source exists. To refresh them, review the upstream changes and copy the complete directories, including auxiliary files:

```bash
rm -rf config/pi/skills/unslop config/pi/skills/research
cp -R ~/.agents/skills/unslop config/pi/skills/unslop
cp -R ~/.agents/skills/research config/pi/skills/research
```

### Pi agent workspace and tools

Ujimu now uses the Pi agent directly instead of wrapping file tools with a virtual `/data` mount or per-task allowlist. Each Pi session runs with its real current working directory set to the selected specialist root directory. Prompts and manifests refer to real relative paths such as `raw/`, `converted/`, `wiki/`, `AGENTS.md`, and `ingest/state.json`.

Pi tools are scoped by task. Ingestion has file tools (`read`, `edit`, `write`, `grep`, `find`, `ls`) without `bash`, plus `prepare_pdf_ocr`, `render_pdf_ocr_page`, `confirm_pdf_ocr_page`, and `publish_pdf_ocr_markdown`. Its path policy keeps `raw/` immutable, blocks direct PDF writes to `converted/`, and blocks wiki publication until visual coverage passes. The manual conversion task retains only the local DOCX converter plus normal file tools for supported non-PDF formats. Ujimu loads its explicit skill bundle from `config/pi/skills`, bundled extensions from `config/pi/extensions`, and mutable configuration from `<UJIMU_CONFIG_DIR>`; it does not discover skills from global agent directories.

If production needs a stronger isolation boundary, provide it outside the Pi harness, for example by running the application or tool execution in a container, VM, or equivalent runtime with the intended specialist directory mounted as the workspace.

### Persistent consultation sessions

Consultation context is stored separately from the canonical SQLite history under:

```text
<UJIMU_DATA_DIR>/pi/chat-sessions/
  anonymous/<specialist-id>/<session-id>/
  registered/<specialist-id>/<conversation-id>/
```

Each conversation directory is private to the application user and contains the active Pi JSONL, non-content metadata, and a temporary recovery journal only while a turn is pending. Treat the whole tree as sensitive because JSONL files contain user questions, generated answers, and tool context. Never expose this directory through Nginx or include its paths in API responses or logs.

Anonymous sessions become inaccessible after 24 hours without a committed turn. Registered sessions become inaccessible after 30 days; their visible SQLite history remains and is used to reconstruct a less rich Pi session when the conversation resumes. Startup reconciliation handles interrupted turns, and an hourly in-process cleanup removes expired directories. Explicit conversation deletion removes its registered JSONL before deleting SQLite history. Specialist deletion removes all anonymous and registered session directories for that specialist.

SQLite remains sufficient for product-history recovery. Backing up the Pi session tree is optional: omitting it loses native tool and compaction context but not registered conversation history. If it is backed up, apply the same access controls as the SQLite backup.

### Agent-owned conversion during ingestion

The normal source-processing path is now owned by the `llm-wiki` skill inside the ingestion agent session. The agent converts each pending source from `raw/` to `converted/<raw relative path>.md`, then ingests only from `converted/` into the OKF-compliant `wiki/`. Ujimu validates the resulting manifest, converted file paths/hashes, wiki page paths, and citation shape before updating `ingest/state.json`; it does not validate conversion fidelity or source content.

The legacy non-PDF conversion utilities and `/conversion/run` endpoint remain for transitional/manual use, but the background ingestion worker does not call them.

## Manual PDF conversion

PDFs are not converted through `/conversion/run`. A pending PDF records `PDF_CONVERSION_REQUIRES_INGESTION` without creating Markdown. Run normal ingestion instead so every PDF page passes local OCR, visual confirmation, coverage validation, and atomic publication.

## Pi conversion, ingestion, and consultation smoke test

Run this smoke path only in a configured non-production environment with `<UJIMU_CONFIG_DIR>/auth.json` present outside source control or credentials provided through environment variables, and with the Pi enable flags set deliberately. Before production, run it with the exact provider/model configuration intended for production; a successful smoke with a temporary model proves the pipeline shape, not the final production model choice.

1. Upload a small official source through the admin console.
2. Click `Executar ingestão` and confirm that the ingestion agent creates or updates `converted/<original filename>.md`, then updates `wiki/`.
3. Confirm that the wiki source pages trace to both the original uploaded file and the converted file, while chat citations still reference the original uploaded file.
4. Ask a scoped chat question and confirm that the response streams. If the agent emits well-formed citations, confirm that the UI shows them; if citations are missing or malformed, confirm that the answer still renders without citation entries.
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

## Production reverse proxy

The public `https://ujimu.com` deployment terminates TLS in Nginx and proxies to the Podman container on `127.0.0.1:3010`. Keep the upstream bound to loopback, preserve streaming with `proxy_buffering off` on `/api/chat`, enable Gzip for text assets, and enable HTTP/2 in the TLS server with `http2 on;`. Validate every change with `nginx -t` before reloading Nginx.

## Podman container deployment

Ujimu provides a single Podman-compatible image with production and test profiles. The same image is configured at runtime by env files and host volume mappings.

Build the default local image:

```bash
scripts/container/build.sh
```

Default image tag: `localhost/ujimu:latest`. Override with `UJIMU_IMAGE` when needed. The Podman build excludes the local generated `config/pi/skills/llm-wiki/` copy from the build context and lets `npm run build` sync it inside the build stage. Pass `UJIMU_LLM_WIKI_REF`, `UJIMU_LLM_WIKI_REPO`, or `UJIMU_LLM_WIKI_SUBDIR` to `scripts/container/build.sh` to pin the external skill source used by the image.

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

The image creates and runs as internal user/group `ujimu:ujimu`, listens on internal port `3000`, defaults `TZ=Africa/Luanda`, sets `UJIMU_DATA_DIR=/home/ujimu/.local/share/ujimu`, sets `UJIMU_CONFIG_DIR=/home/ujimu/.config/ujimu`, and keeps bundled Pi resources under `/app/config/pi`. It includes OCRmyPDF, Poppler, qpdf, Tesseract, and Portuguese/English language data for the local PDF OCR foundation; no separate external PDF converter is installed. It exposes a `/healthz` Dockerfile healthcheck.

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
