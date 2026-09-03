import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { createUjimuCustomToolsForTask } from '../server/utils/pi/session'

describe('Gemini dependency removal acceptance', () => {
  it('removes the Gemini runtime, project model, API-key contract, and PDF tool', async () => {
    const [dockerfile, models, rootEnv, prodEnv, testEnv] = await Promise.all([
      readFile('Dockerfile', 'utf8'),
      readFile('config/pi/models.json', 'utf8'),
      readFile('.env.sample', 'utf8'),
      readFile('config/container/prod.env.example', 'utf8'),
      readFile('config/container/test.env.example', 'utf8')
    ])

    expect(dockerfile).not.toContain('@google/gemini-cli')
    expect(models.toLowerCase()).not.toContain('gemini')
    for (const envFile of [rootEnv, prodEnv, testEnv]) {
      expect(envFile).not.toContain('GEMINI_API_KEY')
    }
    expect(existsSync('config/pi/tools/pdf_to_markdown.sh')).toBe(false)
    expect(existsSync('config/pi/extensions/pdf-to-markdown-tool.ts')).toBe(false)
    expect(existsSync('server/utils/pi/pdf-to-markdown-tool.ts')).toBe(false)
    expect(createUjimuCustomToolsForTask('conversion').map(tool => tool.name)).not.toContain('pdf_to_markdown')
  })
})
