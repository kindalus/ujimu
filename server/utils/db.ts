import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolveAppConfig } from './config'

export interface InitializeDatabaseOptions {
  dataDir?: string
  dbPath?: string
}

interface Migration {
  version: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  {
    version: '0001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    version: '0002_request_events',
    sql: `
      CREATE TABLE IF NOT EXISTS request_events (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('anonymous', 'registered', 'subscribed')),
        subject_id TEXT NOT NULL,
        specialist_id TEXT NOT NULL,
        occurred_at_utc TEXT NOT NULL,
        user_timezone TEXT NOT NULL,
        counted INTEGER NOT NULL CHECK (counted IN (0, 1)),
        decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied')),
        denial_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_request_events_subject_time
        ON request_events (subject_type, subject_id, occurred_at_utc);
    `
  },
  {
    version: '0003_auth_otp',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
        contact TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        UNIQUE (channel, contact)
      );

      CREATE INDEX IF NOT EXISTS idx_user_identities_user_id
        ON user_identities (user_id);

      CREATE TABLE IF NOT EXISTS otp_challenges (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
        contact TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        used_at TEXT,
        invalidated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_otp_challenges_contact
        ON otp_challenges (channel, contact, created_at);
    `
  },
  {
    version: '0004_conversation_history',
    sql: `
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        specialist_id TEXT NOT NULL,
        title TEXT NOT NULL,
        title_status TEXT NOT NULL CHECK (title_status IN ('generated', 'pending')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_user_specialist_updated
        ON conversations (user_id, specialist_id, updated_at);

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        message_order INTEGER NOT NULL,
        grounded INTEGER CHECK (grounded IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE (conversation_id, message_order)
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_order
        ON conversation_messages (conversation_id, message_order);

      CREATE TABLE IF NOT EXISTS message_citations (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
        source_file TEXT,
        source_title TEXT NOT NULL,
        article_refs_json TEXT NOT NULL,
        shown_order INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_message_citations_message_order
        ON message_citations (message_id, shown_order);
    `
  },
  {
    version: '0005_admin_audit_events',
    sql: `
      CREATE TABLE IF NOT EXISTS admin_audit_events (
        id TEXT PRIMARY KEY,
        admin_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        admin_contact TEXT NOT NULL,
        action TEXT NOT NULL,
        specialist_id TEXT,
        occurred_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_admin_audit_events_time
        ON admin_audit_events (occurred_at);

      CREATE INDEX IF NOT EXISTS idx_admin_audit_events_specialist
        ON admin_audit_events (specialist_id, occurred_at);
    `
  },
  {
    version: '0006_question_analytics',
    sql: `
      CREATE TABLE IF NOT EXISTS question_analytics_events (
        id TEXT PRIMARY KEY,
        specialist_id TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('answered', 'insufficient_context')),
        question_text TEXT NOT NULL,
        normalized_question TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        user_timezone TEXT NOT NULL,
        visitor_id TEXT,
        user_id TEXT,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        user_message_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_question_analytics_specialist_fingerprint_time
        ON question_analytics_events (specialist_id, fingerprint, occurred_at);

      CREATE INDEX IF NOT EXISTS idx_question_analytics_conversation
        ON question_analytics_events (conversation_id);

      CREATE TABLE IF NOT EXISTS question_analytics_reviews (
        specialist_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        reviewed_by_user_id TEXT NOT NULL,
        reviewed_by_contact TEXT NOT NULL,
        PRIMARY KEY (specialist_id, fingerprint)
      );

      CREATE TABLE IF NOT EXISTS visitor_events (
        id TEXT PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        user_id TEXT,
        occurred_at TEXT NOT NULL,
        month TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_visitor_events_month_identity
        ON visitor_events (month, user_id, visitor_id);
    `
  },
  {
    version: '0007_billing_subscriptions',
    sql: `
      CREATE TABLE IF NOT EXISTS billing_payments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('appy_pay', 'stripe')),
        method TEXT NOT NULL CHECK (method IN ('multicaixa_express', 'multicaixa_reference', 'qr_code', 'visa')),
        plan_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
        provider_reference TEXT NOT NULL,
        checkout_url TEXT,
        created_at TEXT NOT NULL,
        confirmed_at TEXT,
        UNIQUE (provider, provider_reference)
      );

      CREATE INDEX IF NOT EXISTS idx_billing_payments_user_time
        ON billing_payments (user_id, created_at);

      CREATE TABLE IF NOT EXISTS billing_provider_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('appy_pay', 'stripe')),
        event_id TEXT NOT NULL,
        payment_id TEXT,
        event_type TEXT NOT NULL,
        received_at TEXT NOT NULL,
        result TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (provider, event_id)
      );

      CREATE INDEX IF NOT EXISTS idx_billing_provider_events_payment
        ON billing_provider_events (payment_id, received_at);

      CREATE TABLE IF NOT EXISTS billing_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        current_period_start TEXT NOT NULL,
        current_period_end TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_payment_id TEXT NOT NULL REFERENCES billing_payments(id),
        UNIQUE (user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user_end
        ON billing_subscriptions (user_id, current_period_end);
    `
  },
  {
    version: '0008_passkeys',
    sql: `
      CREATE TABLE IF NOT EXISTS passkey_credentials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        deleted_at TEXT,
        deleted_by_user_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user_active
        ON passkey_credentials (user_id, deleted_at, created_at);

      CREATE TABLE IF NOT EXISTS passkey_challenges (
        id TEXT PRIMARY KEY,
        challenge TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_passkey_challenges_purpose_user
        ON passkey_challenges (purpose, user_id, expires_at, consumed_at);

      CREATE TABLE IF NOT EXISTS passkey_auth_attempts (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('visitor', 'ip', 'unknown')),
        subject_id TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('options', 'verify')),
        success INTEGER NOT NULL CHECK (success IN (0, 1)),
        failure_code TEXT,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_passkey_auth_attempts_subject_time
        ON passkey_auth_attempts (subject_type, subject_id, purpose, occurred_at);
    `
  },
  {
    version: '0009_background_jobs',
    sql: `
      CREATE TABLE IF NOT EXISTS background_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('specialist_initialization', 'specialist_ingestion')),
        specialist_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        locked_at TEXT,
        locked_by TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_background_jobs_status_time
        ON background_jobs (status, updated_at);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_background_jobs_specialist_active
        ON background_jobs (type, specialist_id)
        WHERE status IN ('queued', 'running');
    `
  },
  {
    version: '0010_corporate_accounts',
    sql: `
      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        nif TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS corporate_subscriptions (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        seats INTEGER NOT NULL CHECK (seats > 0),
        current_period_start TEXT NOT NULL,
        current_period_end TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_payment_id TEXT,
        UNIQUE (company_id)
      );

      CREATE INDEX IF NOT EXISTS idx_corporate_subscriptions_company_end
        ON corporate_subscriptions (company_id, current_period_end);

      CREATE TABLE IF NOT EXISTS company_memberships (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (company_id, email)
      );

      CREATE INDEX IF NOT EXISTS idx_company_memberships_email
        ON company_memberships (email);

      CREATE INDEX IF NOT EXISTS idx_company_memberships_user
        ON company_memberships (user_id);

      CREATE TABLE IF NOT EXISTS user_company_contexts (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        active_company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: '0011_company_quota_subject',
    sql: `
      CREATE TABLE request_events_new (
        id TEXT PRIMARY KEY,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('anonymous', 'registered', 'subscribed', 'company')),
        subject_id TEXT NOT NULL,
        specialist_id TEXT NOT NULL,
        occurred_at_utc TEXT NOT NULL,
        user_timezone TEXT NOT NULL,
        counted INTEGER NOT NULL CHECK (counted IN (0, 1)),
        decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied')),
        denial_reason TEXT
      );

      INSERT INTO request_events_new (
        id,
        subject_type,
        subject_id,
        specialist_id,
        occurred_at_utc,
        user_timezone,
        counted,
        decision,
        denial_reason
      )
      SELECT
        id,
        subject_type,
        subject_id,
        specialist_id,
        occurred_at_utc,
        user_timezone,
        counted,
        decision,
        denial_reason
      FROM request_events;

      DROP TABLE request_events;
      ALTER TABLE request_events_new RENAME TO request_events;

      CREATE INDEX IF NOT EXISTS idx_request_events_subject_time
        ON request_events (subject_type, subject_id, occurred_at_utc);
    `
  },
  {
    version: '0012_company_admin_audit_events',
    sql: `
      CREATE TABLE IF NOT EXISTS company_admin_audit_events (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        specialist_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('specialist_prompt_updated', 'raw_source_uploaded', 'raw_source_replaced')),
        occurred_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_company_admin_audit_company_time
        ON company_admin_audit_events (company_id, occurred_at);

      CREATE INDEX IF NOT EXISTS idx_company_admin_audit_specialist_time
        ON company_admin_audit_events (specialist_id, occurred_at);
    `
  },
  {
    version: '0013_specialist_initialization_jobs',
    sql: `
      CREATE TABLE background_jobs_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('specialist_initialization', 'specialist_ingestion')),
        specialist_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        locked_at TEXT,
        locked_by TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      INSERT INTO background_jobs_new (
        id,
        type,
        specialist_id,
        status,
        attempts,
        max_attempts,
        locked_at,
        locked_by,
        last_error_code,
        last_error_message,
        created_at,
        updated_at,
        completed_at
      )
      SELECT
        id,
        type,
        specialist_id,
        status,
        attempts,
        max_attempts,
        locked_at,
        locked_by,
        last_error_code,
        last_error_message,
        created_at,
        updated_at,
        completed_at
      FROM background_jobs;

      DROP TABLE background_jobs;
      ALTER TABLE background_jobs_new RENAME TO background_jobs;

      CREATE INDEX IF NOT EXISTS idx_background_jobs_status_time
        ON background_jobs (status, updated_at);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_background_jobs_specialist_active
        ON background_jobs (type, specialist_id)
        WHERE status IN ('queued', 'running');
    `
  },
  {
    version: '0014_otp_request_throttling',
    sql: `
      ALTER TABLE otp_challenges ADD COLUMN request_ip_hash TEXT;

      CREATE INDEX IF NOT EXISTS idx_otp_challenges_contact_time
        ON otp_challenges (channel, contact, created_at);

      CREATE INDEX IF NOT EXISTS idx_otp_challenges_ip_time
        ON otp_challenges (request_ip_hash, created_at);
    `
  },
  {
    version: '0015_user_session_epoch',
    sql: `
      ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    version: '0016_visitor_events_daily_dedupe',
    sql: `
      ALTER TABLE visitor_events ADD COLUMN day TEXT NOT NULL DEFAULT '';
      UPDATE visitor_events SET day = substr(occurred_at, 1, 10);

      DELETE FROM visitor_events
      WHERE id NOT IN (
        SELECT MIN(id) FROM visitor_events
        GROUP BY visitor_id, COALESCE(user_id, ''), day
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_events_daily_identity
        ON visitor_events (visitor_id, COALESCE(user_id, ''), day);
    `
  }
]

const sharedDatabases = new Map<string, Promise<DatabaseSync>>()

/**
 * Callers that pass an explicit `dbPath` always get their own connection and own its lifetime.
 * Callers that do not (every request handler) share one process-wide connection per resolved
 * path, so migrations run once and prepared statements stay compiled.
 */
export async function initializeDatabase(options: InitializeDatabaseOptions = {}): Promise<DatabaseSync> {
  if (options.dbPath) {
    return openDatabase(options.dbPath)
  }

  const dbPath = resolveAppConfig({ env: process.env }).dbPath
  const existing = sharedDatabases.get(dbPath)
  if (existing) {
    return existing
  }

  const opening = openDatabase(dbPath).catch((error: unknown) => {
    sharedDatabases.delete(dbPath)
    throw error
  })
  sharedDatabases.set(dbPath, opening)
  return opening
}

async function openDatabase(dbPath: string): Promise<DatabaseSync> {
  await mkdir(dirname(dbPath), { recursive: true })

  const database = new DatabaseSync(dbPath)
  // WAL keeps readers from blocking on writers; busy_timeout turns lock contention between the
  // request connection and the background worker into a short wait instead of SQLITE_BUSY.
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA synchronous = NORMAL')
  database.exec('PRAGMA busy_timeout = 5000')
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  applyMigrations(database)
  return database
}

function applyMigrations(database: DatabaseSync): void {
  const selectMigration = database.prepare('SELECT version FROM schema_migrations WHERE version = ?')
  const recordMigration = database.prepare('INSERT INTO schema_migrations (version) VALUES (?)')

  for (const migration of MIGRATIONS) {
    const existing = selectMigration.get(migration.version)

    if (existing) {
      continue
    }

    database.exec('BEGIN')
    try {
      database.exec(migration.sql)
      recordMigration.run(migration.version)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
}
