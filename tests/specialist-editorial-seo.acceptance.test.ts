import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSpecialist, editSpecialist } from '../server/utils/specialists/manager'
import { resetSpecialistRegistryForTests } from '../server/utils/specialists/registry'
import { SpecialistConfigError, toPublicSpecialist, validateSpecialistConfig } from '../server/utils/specialists/schema'

const baseConfig = {
  id: 'laboral',
  name: 'Legislação Laboral Angolana',
  description: 'Especialista sobre legislação laboral.',
  wiki_type: 'legislation-regulatory',
  system_prompt: 'Use apenas a wiki.',
  citations_required: true,
  streaming_enabled: true
} as const

describe('specialist editorial SEO acceptance', () => {
  it('keeps existing specialist files valid and applies safe public fallbacks', () => {
    const specialist = validateSpecialistConfig(baseConfig, 'laboral')

    expect(specialist.seo).toEqual({
      title: '',
      description: '',
      introduction: '',
      topics: [],
      limitations: '',
      call_to_action: ''
    })
    expect(toPublicSpecialist(specialist).seo).toEqual({
      title: 'Legislação Laboral Angolana',
      description: 'Especialista sobre legislação laboral.',
      introduction: '',
      topics: [],
      limitations: '',
      call_to_action: ''
    })
  })

  it('normalizes editorial text and rejects content outside the approved limits', () => {
    const specialist = validateSpecialistConfig({
      ...baseConfig,
      seo: {
        title: '  Trabalho em Angola  ',
        description: '  Respostas laborais fundamentadas.  ',
        introduction: '  Consulte a legislação laboral aplicável.  ',
        topics: [' Contratos ', 'Férias', 'Contratos'],
        limitations: '  Informação geral, não substitui aconselhamento.  ',
        call_to_action: '  Iniciar consulta  '
      }
    }, 'laboral')

    expect(specialist.seo).toEqual({
      title: 'Trabalho em Angola',
      description: 'Respostas laborais fundamentadas.',
      introduction: 'Consulte a legislação laboral aplicável.',
      topics: ['Contratos', 'Férias'],
      limitations: 'Informação geral, não substitui aconselhamento.',
      call_to_action: 'Iniciar consulta'
    })

    expect(() => validateSpecialistConfig({
      ...baseConfig,
      seo: { title: 'x'.repeat(71) }
    }, 'laboral')).toThrow(SpecialistConfigError)
    expect(() => validateSpecialistConfig({
      ...baseConfig,
      seo: { topics: Array.from({ length: 13 }, (_, index) => `Tema ${index}`) }
    }, 'laboral')).toThrow(SpecialistConfigError)
  })

  it('persists only populated editorial fields and preserves them on partial edits', async () => {
    resetSpecialistRegistryForTests()
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-seo-specialist-'))
    const specialtiesRoot = join(dataDir, 'specialties')
    await mkdir(specialtiesRoot, { recursive: true })

    await createSpecialist({
      ...baseConfig,
      seo: {
        title: 'Direito laboral em Angola',
        description: 'Consulte respostas com fontes oficiais.',
        topics: ['Contratos', 'Férias']
      }
    }, { specialtiesRoot })

    await editSpecialist('laboral', {
      seo: { call_to_action: 'Fazer uma pergunta' }
    }, { specialtiesRoot })

    const yaml = await readFile(join(specialtiesRoot, 'laboral', 'specialist.yaml'), 'utf8')
    expect(yaml).toContain('seo:')
    expect(yaml).toContain('title: Direito laboral em Angola')
    expect(yaml).toContain('description: Consulte respostas com fontes oficiais.')
    expect(yaml).toContain('call_to_action: Fazer uma pergunta')
    expect(yaml).not.toContain('introduction: ""')
  })
})
