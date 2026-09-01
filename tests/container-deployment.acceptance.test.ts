import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('Podman container deployment acceptance', () => {
  it('defines a slim multi-stage Node 26 image with Gemini CLI, non-root runtime, and healthcheck', async () => {
    const dockerfile = await readFile('Dockerfile', 'utf8')

    expect(dockerfile).toContain('FROM node:26-trixie-slim AS build')
    expect(dockerfile).toContain('FROM node:26-trixie-slim AS runtime')
    expect(dockerfile).toContain('npm ci')
    expect(dockerfile).toContain('npm run build')
    expect(dockerfile).toContain('npm install -g @google/gemini-cli')
    expect(dockerfile).toContain('ca-certificates')
    expect(dockerfile).toContain('coreutils')
    expect(dockerfile).toContain('groupadd')
    expect(dockerfile).toContain('useradd')
    expect(dockerfile).toContain('USER ujimu')
    expect(dockerfile).toContain('ENV HOST=0.0.0.0')
    expect(dockerfile).toContain('ENV PORT=3000')
    expect(dockerfile).toContain('HEALTHCHECK')
    expect(dockerfile).toContain('/healthz')
    expect(dockerfile).toContain('CMD ["node", ".output/server/index.mjs"]')
  })

  it('includes the dynamically loaded OpenAI Codex OAuth module in the Nitro server output', async () => {
    const nuxtConfig = await readFile('nuxt.config.ts', 'utf8')

    expect(nuxtConfig).toContain('traceInclude')
    expect(nuxtConfig).toContain('@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js')
  })

  it('keeps local build artefacts, env files, and real Pi credentials out of the image build context', async () => {
    const dockerignore = await readFile('.dockerignore', 'utf8')

    expect(dockerignore).toContain('node_modules')
    expect(dockerignore).toContain('.nuxt')
    expect(dockerignore).toContain('.output')
    expect(dockerignore).toContain('.env')
    expect(dockerignore).toContain('config/container/*.env')
    expect(dockerignore).toContain('config/pi/auth.json')
    expect(dockerignore).not.toContain('config/pi/settings.json')
  })

  it('documents production and test env profiles with persistence, timezone, Pi flags, and test no-op auth', async () => {
    const prod = await readFile('config/container/prod.env.example', 'utf8')
    const test = await readFile('config/container/test.env.example', 'utf8')

    for (const envFile of [prod, test]) {
      expect(envFile).toContain('TZ=Africa/Luanda')
      expect(envFile).toContain('UJIMU_DATA_DIR=/home/ujimu/.local/share/ujimu')
      expect(envFile).toContain('UJIMU_CONFIG_DIR=/home/ujimu/.config/ujimu')
      expect(envFile).toContain('UJIMU_PI_BUNDLE_DIR=/app/config/pi')
      expect(envFile).toContain('UJIMU_PI_CONVERSION_ENABLED=true')
      expect(envFile).toContain('UJIMU_PI_INGESTION_ENABLED=true')
      expect(envFile).toContain('UJIMU_PI_INGESTION_THINKING_LEVEL=')
      expect(envFile).toContain('UJIMU_PI_CHAT_ENABLED=true')
      expect(envFile).toContain('GEMINI_API_KEY=')
    }

    expect(prod).toContain('UJIMU_HOST_PI_DIR=/srv/ujimu/prod/pi')
    expect(prod).toContain('UJIMU_HOST_DATA_DIR=/srv/ujimu/prod/data')
    expect(prod).toContain('UJIMU_SESSION_SECRET=')
    expect(prod).toContain('UJIMU_OTP_PEPPER=')
    expect(prod).toContain('UJIMU_BILLING_WEBHOOK_SECRET=')
    expect(prod).toContain('UJIMU_ADMIN_CONTACTS=')

    expect(test).toContain('NODE_ENV=development')
    expect(test).toContain('UJIMU_AUTH_FAKE_DELIVERY_ENABLED=true')
    expect(test).toContain('UJIMU_HOST_PI_DIR=/srv/ujimu/test/pi')
    expect(test).toContain('UJIMU_HOST_DATA_DIR=/srv/ujimu/test/data')
  })

  it('creates the test container with the expected Podman profile and persistent mounts', async () => {
    const workspace = await createScriptWorkspace({ containerExists: false })
    const envFile = await writeProfileEnv(workspace.root, 'test')

    const result = await runScript('scripts/container/create.sh', ['test'], {
      PATH: `${workspace.bin}:${process.env.PATH ?? ''}`,
      UJIMU_ENV_FILE: envFile,
      UJIMU_IMAGE: 'localhost/ujimu:test'
    })

    expect(result).toMatchObject({ code: 0, stderr: '' })
    const log = await readFile(workspace.log, 'utf8')
    expect(log).toContain('network exists ujimu')
    expect(log).toContain('network create ujimu')
    expect(log).toContain('container exists ujimu-test')
    expect(log).toContain(`create --name ujimu-test --network ujimu --env-file ${envFile} -p 3001:3000`)
    expect(log).toContain(`${workspace.root}/test/pi:/home/ujimu/.config/ujimu`)
    expect(log).toContain(`${workspace.root}/test/data:/home/ujimu/.local/share/ujimu`)
    expect(log).toContain('localhost/ujimu:test')
  })

  it('restarts an existing prod container on deploy and rebuilds/replaces it on redeploy without deleting data directories', async () => {
    const workspace = await createScriptWorkspace({ containerExists: true })
    const envFile = await writeProfileEnv(workspace.root, 'prod')

    const deploy = await runScript('scripts/container/deploy.sh', ['prod'], {
      PATH: `${workspace.bin}:${process.env.PATH ?? ''}`,
      UJIMU_ENV_FILE: envFile
    })
    expect(deploy).toMatchObject({ code: 0, stderr: '' })

    const redeploy = await runScript('scripts/container/redeploy.sh', ['prod'], {
      PATH: `${workspace.bin}:${process.env.PATH ?? ''}`,
      UJIMU_ENV_FILE: envFile
    })
    expect(redeploy).toMatchObject({ code: 0, stderr: '' })

    const log = await readFile(workspace.log, 'utf8')
    expect(log).toContain('restart ujimu-prod')
    expect(log).toContain('build --format docker -t localhost/ujimu:latest .')
    expect(log).toContain('stop ujimu-prod')
    expect(log).toContain('rm ujimu-prod')
    expect(log).toContain('start ujimu-prod')
    expect(log).not.toContain('volume rm')
  })
})

async function createScriptWorkspace(options: { containerExists: boolean }): Promise<{ root: string; bin: string; log: string }> {
  const root = await mkdtemp(join(tmpdir(), 'ujimu-container-scripts-'))
  const bin = join(root, 'bin')
  await mkdir(bin, { recursive: true })
  const log = join(root, 'podman.log')
  const podman = join(bin, 'podman')
  await writeFile(podman, `#!/bin/sh
printf '%s\\n' "$*" >> "${log}"
if [ "$1 $2" = "container exists" ]; then
  ${options.containerExists ? 'exit 0' : 'exit 1'}
fi
if [ "$1 $2" = "network exists" ]; then
  exit 1
fi
exit 0
`)
  await chmod(podman, 0o755)
  return { root, bin, log }
}

async function writeProfileEnv(root: string, profile: 'prod' | 'test'): Promise<string> {
  const envFile = join(root, `${profile}.env`)
  await writeFile(envFile, [
    `UJIMU_HOST_PI_DIR=${root}/${profile}/pi`,
    `UJIMU_HOST_DATA_DIR=${root}/${profile}/data`,
    'TZ=Africa/Luanda',
    'UJIMU_DATA_DIR=/home/ujimu/.local/share/ujimu'
  ].join('\n'))
  return envFile
}

async function runScript(script: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn('bash', [script, ...args], { env: { ...process.env, ...env } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
