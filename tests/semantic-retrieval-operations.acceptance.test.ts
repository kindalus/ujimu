import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const acceptedAdvisories = [
  'https://github.com/advisories/GHSA-f88m-g3jw-g9cj',
  'https://github.com/advisories/GHSA-xcpc-8h2w-3j85'
]

describe('semantic retrieval operations acceptance', () => {
  it('pins Transformers 4.2 and exposes an opt-in container flag', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
    const prodEnv = await readFile('config/container/prod.env.example', 'utf8')
    const testEnv = await readFile('config/container/test.env.example', 'utf8')

    expect(packageJson.dependencies['@huggingface/transformers']).toBe('4.2.0')
    expect(packageJson.scripts['audit:high']).toBe('node scripts/audit-high.mjs')
    expect(prodEnv).toContain('UJIMU_SEMANTIC_RETRIEVAL_ENABLED=false')
    expect(testEnv).toContain('UJIMU_SEMANTIC_RETRIEVAL_ENABLED=false')
  })

  it('documents local model provisioning, readiness, thresholds, and the accepted risk', async () => {
    const operations = await readFile('docs/operations.md', 'utf8')
    const readyRoute = await readFile('server/api/admin/ops/readyz.get.ts', 'utf8')
    const plugin = await readFile('server/plugins/semantic-retrieval.ts', 'utf8')
    const runtime = await readFile('server/utils/chat/semantic-retrieval.ts', 'utf8')

    expect(operations).toContain('UJIMU_SEMANTIC_RETRIEVAL_ENABLED')
    expect(operations).toContain('<UJIMU_DATA_DIR>/models/transformers')
    expect(operations).toContain('0.92')
    expect(operations).toContain('0.003')
    for (const advisory of acceptedAdvisories) expect(operations).toContain(advisory)
    expect(readyRoute).toContain('semanticRetrievalReady')
    expect(plugin).toContain('warmSemanticRetrieval')
    expect(runtime).toContain('env.allowRemoteModels = false')
    expect(runtime).toContain('4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c')
  })

  it('allows only the two approved high advisories and rejects new or stale exceptions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ujimu-audit-allowlist-'))
    const acceptedPath = join(directory, 'accepted.json')
    const unexpectedPath = join(directory, 'unexpected.json')
    const stalePath = join(directory, 'stale.json')
    await writeFile(acceptedPath, JSON.stringify(auditFixture()))
    await writeFile(unexpectedPath, JSON.stringify(auditFixture({ unexpected: true })))
    await writeFile(stalePath, JSON.stringify(auditFixture({ omitAdmZip: true })))

    const accepted = runAudit(acceptedPath)
    expect(accepted.status).toBe(0)
    expect(accepted.stdout).toContain('2 accepted high advisories')

    const unexpected = runAudit(unexpectedPath)
    expect(unexpected.status).toBe(1)
    expect(unexpected.stderr).toContain('unaccepted high or critical advisory')

    const stale = runAudit(stalePath)
    expect(stale.status).toBe(1)
    expect(stale.stderr).toContain('stale accepted advisory')
  })

  it('keeps the native runtime in the Nitro trace and uses the guarded audit in CI', async () => {
    const nuxtConfig = await readFile('nuxt.config.ts', 'utf8')
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8')

    expect(nuxtConfig).toContain('node_modules/onnxruntime-node')
    expect(workflow).toContain('npm run audit:high')
    expect(workflow).not.toContain('npm audit --audit-level=high')
  })
})

function runAudit(path: string) {
  return spawnSync(process.execPath, ['scripts/audit-high.mjs', '--input', path], {
    encoding: 'utf8'
  })
}

function auditFixture(options: { unexpected?: boolean; omitAdmZip?: boolean } = {}) {
  const vulnerabilities: Record<string, unknown> = {
    sharp: {
      severity: 'high',
      via: [{ url: acceptedAdvisories[0], severity: 'high' }]
    },
    transformers: {
      severity: 'high',
      via: ['sharp', ...(options.omitAdmZip ? [] : ['onnxruntime-node'])]
    }
  }
  if (!options.omitAdmZip) {
    vulnerabilities['adm-zip'] = {
      severity: 'high',
      via: [{ url: acceptedAdvisories[1], severity: 'high' }]
    }
    vulnerabilities['onnxruntime-node'] = { severity: 'high', via: ['adm-zip'] }
  }
  if (options.unexpected) {
    vulnerabilities.unexpected = {
      severity: 'critical',
      via: [{ url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz', severity: 'critical' }]
    }
  }
  return { vulnerabilities, metadata: { vulnerabilities: {} } }
}
