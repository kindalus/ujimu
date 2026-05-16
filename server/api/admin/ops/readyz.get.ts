import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineEventHandler } from 'h3'
import { requireAdmin } from '../../../utils/admin/guards'
import { resolveAppConfig } from '../../../utils/config'
import { getPasskeyReadiness } from '../../../utils/auth/passkeys'
import { initializeDatabase } from '../../../utils/db'
import { getOperationalLogDirectory } from '../../../utils/ops/logger'

interface ReadinessChecks {
  database: boolean
  dataDirectoryWritable: boolean
  operationalLogsWritable: boolean
  migrationsApplied: number
  billingWebhookSecretConfigured: boolean
  sessionSecretConfigured: boolean
  otpPepperConfigured: boolean
  passkeysEnabled: boolean
  passkeysConfigured: boolean
}

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()

  try {
    requireAdmin(database, event)
    const config = resolveAppConfig({ env: process.env })
    const passkeyReadiness = getPasskeyReadiness(process.env)
    const checks: ReadinessChecks = {
      database: canQueryDatabase(database),
      dataDirectoryWritable: await canWriteToDirectory(config.dataDir),
      operationalLogsWritable: await canWriteToDirectory(getOperationalLogDirectory(config.dataDir)),
      migrationsApplied: getAppliedMigrationCount(database),
      billingWebhookSecretConfigured: Boolean(process.env.UJIMU_BILLING_WEBHOOK_SECRET),
      sessionSecretConfigured: Boolean(process.env.UJIMU_SESSION_SECRET),
      otpPepperConfigured: Boolean(process.env.UJIMU_OTP_PEPPER),
      passkeysEnabled: passkeyReadiness.passkeysEnabled,
      passkeysConfigured: passkeyReadiness.passkeysConfigured
    }

    return {
      ok: checks.database &&
        checks.dataDirectoryWritable &&
        checks.operationalLogsWritable &&
        checks.migrationsApplied > 0 &&
        checks.billingWebhookSecretConfigured,
      checks
    }
  } finally {
    database.close()
  }
})

function canQueryDatabase(database: Awaited<ReturnType<typeof initializeDatabase>>): boolean {
  try {
    database.prepare('SELECT 1 AS ok').get()
    return true
  } catch {
    return false
  }
}

function getAppliedMigrationCount(database: Awaited<ReturnType<typeof initializeDatabase>>): number {
  try {
    const row = database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }
    return row.count
  } catch {
    return 0
  }
}

async function canWriteToDirectory(directory: string): Promise<boolean> {
  const probePath = join(directory, `.readyz-${process.pid}-${Date.now()}`)

  try {
    await mkdir(directory, { recursive: true })
    await writeFile(probePath, 'ok\n', 'utf8')
    await unlink(probePath)
    return true
  } catch {
    return false
  }
}
