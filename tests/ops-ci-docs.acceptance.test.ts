import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('operations CI and runbook acceptance', () => {
  it('defines a CI quality gate for install, tests, typecheck, build, and high-severity audit', async () => {
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8')

    expect(workflow).toContain('actions/checkout@v4')
    expect(workflow).toContain('actions/setup-node@v4')
    expect(workflow).toContain('node-version: 22')
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm test')
    expect(workflow).toContain('npm run typecheck')
    expect(workflow).toContain('npm run build')
    expect(workflow).toContain('npm audit --audit-level=high')
  })

  it('documents health/readiness, JSONL logs, secrets, and SQLite backup/restore operations', async () => {
    const runbook = await readFile('docs/operations.md', 'utf8')

    expect(runbook).toContain('/healthz')
    expect(runbook).toContain('/api/admin/ops/readyz')
    expect(runbook).toContain('logs/operational/operational-YYYY-MM-DD.jsonl')
    expect(runbook).toContain('UJIMU_BILLING_WEBHOOK_SECRET')
    expect(runbook).toContain('UJIMU_SESSION_SECRET')
    expect(runbook).toContain('UJIMU_OTP_PEPPER')
    expect(runbook).toContain('UJIMU_PASSKEYS_ENABLED')
    expect(runbook).toContain('UJIMU_PASSKEY_RP_ID')
    expect(runbook).toContain('UJIMU_PASSKEY_RP_NAME')
    expect(runbook).toContain('UJIMU_PASSKEY_ORIGIN')
    expect(runbook).toContain('UJIMU_CONFIG_DIR')
    expect(runbook).toContain('UJIMU_PI_BUNDLE_DIR')
    expect(runbook).toContain('UJIMU_PI_CONVERSION_ENABLED')
    expect(runbook).toContain('UJIMU_PI_CONVERSION_MAX_MARKDOWN_BYTES')
    expect(runbook).toContain('Pi conversion, ingestion, and consultation smoke test')
    expect(runbook).toContain('OTP continues to be the fallback')
    expect(runbook).toContain('sqlite3')
    expect(runbook).toContain('.backup')
    expect(runbook).toContain('.restore')
  })

  it('does not expose removed legacy Pi environment keys as configuration', async () => {
    const files = [
      '.env.sample',
      'config/container/prod.env.example',
      'config/container/test.env.example',
      'docs/operations.md',
      'docs/specs/slices/13-pi-agent-pipeline.html',
      'docs/specs/slices/15-podman-container-deployment.html',
      'docs/specs/slices/STATUS.md'
    ]
    const removedKeys = [
      `UJIMU_PI_${'AGENT_DIR'}`,
      `UJIMU_PI_CONVERSION_${'THINKING_LEVEL'}`,
      `UJIMU_PI_INGESTION_${'THINKING_LEVEL'}`
    ]

    for (const file of files) {
      const content = await readFile(file, 'utf8')
      for (const key of removedKeys) {
        expect(content, `${file} must not contain ${key}`).not.toContain(key)
      }
    }
  })
})
