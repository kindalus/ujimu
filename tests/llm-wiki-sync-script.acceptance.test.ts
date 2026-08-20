import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'sync-llm-wiki.mjs')

describe('llm-wiki external skill sync acceptance', () => {
  it('copies the external llm-wiki skill only when it is missing', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ujimu-llm-wiki-sync-'))
    const source = join(workspace, 'external', 'skills', 'llm-wiki')
    const destination = join(workspace, 'config', 'pi', 'skills', 'llm-wiki')
    await writeSkill(source, 'external v1')

    const first = await runSync(['--if-missing'], {
      UJIMU_LLM_WIKI_SOURCE_DIR: join(workspace, 'external'),
      UJIMU_LLM_WIKI_DEST_DIR: destination
    })

    expect(first).toMatchObject({ code: 0, stderr: '' })
    await expect(readFile(join(destination, 'SKILL.md'), 'utf8')).resolves.toContain('external v1')
    await expect(readFile(join(destination, 'references', 'operations.md'), 'utf8')).resolves.toContain('operations v1')

    await writeFile(join(destination, 'SKILL.md'), '# local change\n')
    await writeSkill(source, 'external v2')

    const second = await runSync(['--if-missing'], {
      UJIMU_LLM_WIKI_SOURCE_DIR: source,
      UJIMU_LLM_WIKI_DEST_DIR: destination
    })

    expect(second).toMatchObject({ code: 0, stderr: '' })
    await expect(readFile(join(destination, 'SKILL.md'), 'utf8')).resolves.toBe('# local change\n')
  })

  it('force-refreshes the generated llm-wiki copy and removes stale files', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ujimu-llm-wiki-update-'))
    const source = join(workspace, 'repo', 'skills', 'llm-wiki')
    const destination = join(workspace, 'config', 'pi', 'skills', 'llm-wiki')
    await writeSkill(source, 'external update')
    await writeSkill(destination, 'old generated copy')
    await writeFile(join(destination, 'stale.md'), 'stale')

    const result = await runSync(['--force'], {
      UJIMU_LLM_WIKI_SOURCE_DIR: join(workspace, 'repo'),
      UJIMU_LLM_WIKI_DEST_DIR: destination
    })

    expect(result).toMatchObject({ code: 0, stderr: '' })
    await expect(readFile(join(destination, 'SKILL.md'), 'utf8')).resolves.toContain('external update')
    await expect(stat(join(destination, 'stale.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('wires npm lifecycle scripts and keeps the generated skill out of Git and Podman build context', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> }
    const gitignore = await readFile('.gitignore', 'utf8')
    const dockerignore = await readFile('.dockerignore', 'utf8')
    const dockerfile = await readFile('Dockerfile', 'utf8')
    const buildScript = await readFile('scripts/container/build.sh', 'utf8')
    const envSample = await readFile('.env.sample', 'utf8')

    expect(packageJson.scripts.predev).toBe('npm run skills:sync')
    expect(packageJson.scripts.prebuild).toBe('npm run skills:sync')
    expect(packageJson.scripts.pretest).toBe('npm run skills:sync')
    expect(packageJson.scripts.pretypecheck).toBe('npm run skills:sync')
    expect(packageJson.scripts['skills:sync']).toContain('--if-missing')
    expect(packageJson.scripts['skills:update']).toContain('--force')
    expect(gitignore).toContain('config/pi/skills/llm-wiki/')
    expect(dockerignore).toContain('config/pi/skills/llm-wiki')
    expect(dockerfile).toContain('UJIMU_LLM_WIKI_REF')
    expect(dockerfile).toContain('apt-get install -y --no-install-recommends ca-certificates git')
    expect(buildScript).toContain('--build-arg')
    expect(envSample).toContain('UJIMU_LLM_WIKI_REPO=https://github.com/kindalus/skills.git')
    expect(envSample).toContain('UJIMU_LLM_WIKI_REF=')
  })
})

async function writeSkill(root: string, marker: string): Promise<void> {
  await mkdir(join(root, 'references'), { recursive: true })
  await writeFile(join(root, 'SKILL.md'), `---\nname: llm-wiki\n---\n# ${marker}\n`)
  await writeFile(join(root, 'references', 'operations.md'), 'operations v1\n')
}

async function runSync(
  args: string[],
  env: Record<string, string>
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [SCRIPT_PATH, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  const code = await new Promise<number | null>((resolve) => {
    child.on('close', resolve)
  })

  return { code, stdout: stdout.trim(), stderr: stderr.trim() }
}
