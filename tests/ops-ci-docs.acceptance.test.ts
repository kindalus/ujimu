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
    expect(runbook).toContain('sqlite3')
    expect(runbook).toContain('.backup')
    expect(runbook).toContain('.restore')
  })
})
