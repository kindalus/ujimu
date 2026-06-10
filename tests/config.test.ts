import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAppConfig } from '../server/utils/config'

describe('resolveAppConfig', () => {
  it('uses ~/.local/share/ujimu as the default data directory', () => {
    const config = resolveAppConfig({ env: {} })

    expect(config.dataDir).toMatch(/\.local\/share\/ujimu$/)
    expect(config.dbDir).toBe(join(config.dataDir, 'db'))
    expect(config.dbPath).toBe(join(config.dataDir, 'db', 'ujimu.sqlite'))
    expect(config.publicAppName).toBe('Ujimu')
  })

  it('places the default SQLite database under UJIMU_DATA_DIR/db', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-config-'))
    const config = resolveAppConfig({ env: { UJIMU_DATA_DIR: dataDir } })

    expect(config.dataDir).toBe(dataDir)
    expect(config.dbDir).toBe(join(dataDir, 'db'))
    expect(config.dbPath).toBe(join(dataDir, 'db', 'ujimu.sqlite'))
  })

  it('limits the default OpenRouter chat model output tokens in the Pi agent config', async () => {
    const config = JSON.parse(await readFile('config/ujimu-pi-agent/models.json', 'utf8')) as {
      providers?: {
        openrouter?: {
          modelOverrides?: Record<string, { maxTokens?: number }>
        }
      }
    }

    expect(config.providers?.openrouter?.modelOverrides?.['moonshotai/kimi-k2.6']?.maxTokens).toBeLessThanOrEqual(8192)
  })

  it('allows an explicit UJIMU_DB_PATH while keeping dbDir inside the data directory', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-config-'))
    const explicitDbPath = join(dataDir, 'db', 'custom.sqlite')
    const config = resolveAppConfig({
      env: {
        UJIMU_DATA_DIR: dataDir,
        UJIMU_DB_PATH: explicitDbPath
      }
    })

    expect(config.dbDir).toBe(join(dataDir, 'db'))
    expect(config.dbPath).toBe(explicitDbPath)
  })
})
