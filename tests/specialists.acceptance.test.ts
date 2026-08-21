import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createSpecialist,
  deleteSpecialist
} from '../server/utils/specialists/manager'
import {
  getPublicSpecialists,
  getSpecialistById,
  loadSpecialistRegistry,
  reloadSpecialistRegistry,
  resetSpecialistRegistryForTests
} from '../server/utils/specialists/registry'
import { loadSpecialistsFromDisk } from '../server/utils/specialists/loader'

const validYaml = (overrides: Partial<Record<string, string | boolean>> = {}) => ({
  id: 'iva',
  name: 'Legislação de IVA',
  description: 'Especialista sobre legislação de IVA.',
  wiki_type: 'legislation-regulatory',
  system_prompt: 'Answer only from this specialist wiki.',
  citations_required: true,
  streaming_enabled: true,
  ...overrides
})

describe('specialist registry acceptance', () => {
  it('loads a valid specialist folder into the runtime registry', async () => {
    const specialtiesRoot = await createTempSpecialtiesRoot()
    await writeSpecialistFolder(specialtiesRoot, 'iva', validYaml())

    const snapshot = await loadSpecialistRegistry({ specialtiesRoot })

    expect(snapshot.specialists).toHaveLength(1)
    expect(snapshot.errors).toEqual([])
    expect(snapshot.specialists[0]).toMatchObject({
      id: 'iva',
      name: 'Legislação de IVA',
      description: 'Especialista sobre legislação de IVA.',
      wiki_type: 'legislation-regulatory',
      citations_required: true,
      streaming_enabled: true
    })
  })

  it('reports invalid YAML and unsupported wiki types without hiding valid specialists', async () => {
    const specialtiesRoot = await createTempSpecialtiesRoot()
    await writeSpecialistFolder(specialtiesRoot, 'iva', validYaml())
    await writeInvalidSpecialistFolder(specialtiesRoot, 'broken-yaml', 'id: [')
    await writeSpecialistFolder(
      specialtiesRoot,
      'bad-type',
      validYaml({ id: 'bad-type', wiki_type: 'unknown-type' })
    )

    const snapshot = await loadSpecialistsFromDisk({ specialtiesRoot })

    expect(snapshot.specialists.map((specialist) => specialist.id)).toEqual(['iva'])
    expect(snapshot.errors.map((error) => error.code).sort()).toEqual([
      'INVALID_WIKI_TYPE',
      'INVALID_YAML'
    ])
  })

  it('manual reload refreshes the registry from disk', async () => {
    const specialtiesRoot = await createTempSpecialtiesRoot()
    await writeSpecialistFolder(specialtiesRoot, 'iva', validYaml())

    await reloadSpecialistRegistry({ specialtiesRoot })
    expect((await getPublicSpecialists()).map((specialist) => specialist.id)).toEqual(['iva'])

    await writeSpecialistFolder(
      specialtiesRoot,
      'legislacao-laboral',
      validYaml({
        id: 'legislacao-laboral',
        name: 'Legislação laboral',
        description: 'Especialista sobre legislação laboral.'
      })
    )

    await reloadSpecialistRegistry({ specialtiesRoot })

    expect((await getPublicSpecialists()).map((specialist) => specialist.id)).toEqual([
      'iva',
      'legislacao-laboral'
    ])
  })

  it('creates a specialist with the expected directory structure and YAML contract', async () => {
    const specialtiesRoot = await createTempSpecialtiesRoot()

    await createSpecialist(
      {
        id: 'pauta-aduaneira',
        name: 'Pauta aduaneira',
        description: 'Especialista sobre pauta aduaneira.',
        wiki_type: 'legislation-regulatory',
        system_prompt: 'Answer only from this specialist wiki.',
        citations_required: true,
        streaming_enabled: true
      },
      { specialtiesRoot }
    )

    const specialistDir = join(specialtiesRoot, 'pauta-aduaneira')
    expect((await stat(join(specialistDir, 'raw'))).isDirectory()).toBe(true)
    expect((await stat(join(specialistDir, 'converted'))).isDirectory()).toBe(true)
    expect((await stat(join(specialistDir, 'wiki'))).isDirectory()).toBe(true)
    expect((await stat(join(specialistDir, 'ingest'))).isDirectory()).toBe(true)
    expect((await stat(join(specialistDir, 'ingest', 'state.json'))).isFile()).toBe(true)

    const yaml = await readFile(join(specialistDir, 'specialist.yaml'), 'utf8')
    expect(yaml).toContain('id: pauta-aduaneira')
    expect(yaml).toContain('description: Especialista sobre pauta aduaneira.')
    expect(yaml).not.toContain('visibility:')
    expect(yaml.indexOf('id:')).toBeLessThan(yaml.indexOf('name:'))
    expect(yaml.indexOf('name:')).toBeLessThan(yaml.indexOf('description:'))
  })

  it('deletes a specialist, calls history deletion, and prevents further consultation', async () => {
    const specialtiesRoot = await createTempSpecialtiesRoot()
    await createSpecialist(
      {
        id: 'iva',
        name: 'Legislação de IVA',
        description: 'Especialista sobre legislação de IVA.',
        wiki_type: 'legislation-regulatory',
        system_prompt: 'Answer only from this specialist wiki.',
        citations_required: true,
        streaming_enabled: true
      },
      { specialtiesRoot }
    )

    const deletedHistoryFor: string[] = []
    await deleteSpecialist('iva', {
      specialtiesRoot,
      deleteHistoryForSpecialist: async (specialistId) => {
        deletedHistoryFor.push(specialistId)
      }
    })

    await expect(stat(join(specialtiesRoot, 'iva'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(deletedHistoryFor).toEqual(['iva'])
    expect(await getSpecialistById('iva')).toBeUndefined()
  })

  it('exposes only safe public specialist metadata', async () => {
    const specialtiesRoot = await createTempSpecialtiesRoot()
    await writeSpecialistFolder(specialtiesRoot, 'iva', validYaml())
    await reloadSpecialistRegistry({ specialtiesRoot })

    const [publicSpecialist] = await getPublicSpecialists()

    expect(publicSpecialist).toEqual({
      id: 'iva',
      name: 'Legislação de IVA',
      description: 'Especialista sobre legislação de IVA.',
      wiki_type: 'legislation-regulatory',
      citations_required: true,
      streaming_enabled: true,
      seo: {
        title: 'Legislação de IVA',
        description: 'Especialista sobre legislação de IVA.',
        introduction: '',
        topics: [],
        limitations: '',
        call_to_action: ''
      }
    })
    expect(publicSpecialist).not.toHaveProperty('system_prompt')
    expect(publicSpecialist).not.toHaveProperty('paths')
  })
})

async function createTempSpecialtiesRoot(): Promise<string> {
  resetSpecialistRegistryForTests()
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-specialists-'))
  const specialtiesRoot = join(dataDir, 'specialties')
  await mkdir(specialtiesRoot, { recursive: true })
  return specialtiesRoot
}

async function writeSpecialistFolder(
  specialtiesRoot: string,
  id: string,
  config: Record<string, string | boolean>
): Promise<void> {
  const specialistDir = join(specialtiesRoot, id)
  await mkdir(join(specialistDir, 'raw'), { recursive: true })
  await mkdir(join(specialistDir, 'wiki'), { recursive: true })
  await mkdir(join(specialistDir, 'ingest'), { recursive: true })
  await writeFile(join(specialistDir, 'specialist.yaml'), toYaml(config))
}

async function writeInvalidSpecialistFolder(
  specialtiesRoot: string,
  id: string,
  yaml: string
): Promise<void> {
  const specialistDir = join(specialtiesRoot, id)
  await mkdir(join(specialistDir, 'raw'), { recursive: true })
  await mkdir(join(specialistDir, 'wiki'), { recursive: true })
  await mkdir(join(specialistDir, 'ingest'), { recursive: true })
  await writeFile(join(specialistDir, 'specialist.yaml'), yaml)
}

function toYaml(config: Record<string, string | boolean>): string {
  return Object.entries(config)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : String(value)}`)
    .join('\n')
    .concat('\n')
}
