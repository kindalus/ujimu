#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const DEFAULT_REPO = 'https://github.com/kindalus/skills.git'
const DEFAULT_SUBDIR = 'skills/llm-wiki'
const DEFAULT_DEST = 'config/pi/skills/llm-wiki'

const args = new Set(process.argv.slice(2))

if (args.has('--help') || args.has('-h')) {
  printUsage()
  process.exit(0)
}

const ifMissing = args.has('--if-missing')
const force = args.has('--force')

if (ifMissing === force) {
  printUsage()
  process.exitCode = 2
} else {
  syncLlmWiki({ ifMissing, force }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

function printUsage() {
  console.error(`Usage: node scripts/sync-llm-wiki.mjs --if-missing|--force

Environment:
  UJIMU_LLM_WIKI_SOURCE_DIR  Optional local llm-wiki skill dir, or a repo root containing skills/llm-wiki.
  UJIMU_LLM_WIKI_REPO        Git repository to clone when SOURCE_DIR is not set. Default: ${DEFAULT_REPO}
  UJIMU_LLM_WIKI_REF         Optional branch, tag, or commit to checkout from the repository.
  UJIMU_LLM_WIKI_SUBDIR      Skill subdirectory inside the repository. Default: ${DEFAULT_SUBDIR}
  UJIMU_LLM_WIKI_DEST_DIR    Destination directory. Default: ${DEFAULT_DEST}`)
}

async function syncLlmWiki(options) {
  const destination = resolve(process.env.UJIMU_LLM_WIKI_DEST_DIR || DEFAULT_DEST)

  if (options.ifMissing && await pathExists(destination)) {
    console.log(`llm-wiki skill already exists: ${destination}`)
    return
  }

  const source = await resolveSourceSkillDir()
  try {
    await copySkillDirectory(source.dir, destination)
    console.log(`llm-wiki skill synced: ${destination}`)
  } finally {
    await source.cleanup()
  }
}

async function resolveSourceSkillDir() {
  const subdir = process.env.UJIMU_LLM_WIKI_SUBDIR || DEFAULT_SUBDIR
  const localSource = process.env.UJIMU_LLM_WIKI_SOURCE_DIR

  if (localSource) {
    const source = await resolveLocalSourceDir(localSource, subdir)
    return { dir: source, cleanup: async () => undefined }
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'ujimu-llm-wiki-'))
  const cloneDir = join(tempRoot, 'skills')
  try {
    await cloneRepository({
      repo: process.env.UJIMU_LLM_WIKI_REPO || DEFAULT_REPO,
      ref: process.env.UJIMU_LLM_WIKI_REF,
      cloneDir
    })
    const source = resolve(cloneDir, subdir)
    await assertSkillDir(source)
    return { dir: source, cleanup: async () => rm(tempRoot, { recursive: true, force: true }) }
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true })
    throw error
  }
}

async function resolveLocalSourceDir(localSource, subdir) {
  const direct = resolve(localSource)
  if (await isSkillDir(direct)) {
    return direct
  }

  const nested = resolve(direct, subdir)
  if (await isSkillDir(nested)) {
    return nested
  }

  throw new Error(`UJIMU_LLM_WIKI_SOURCE_DIR must point to an llm-wiki skill directory or a repository root containing ${subdir}: ${direct}`)
}

async function cloneRepository(options) {
  if (!options.ref) {
    await run('git', ['clone', '--depth', '1', options.repo, options.cloneDir])
    return
  }

  try {
    await run('git', ['clone', '--depth', '1', '--branch', options.ref, options.repo, options.cloneDir])
  } catch {
    await rm(options.cloneDir, { recursive: true, force: true })
    await run('git', ['clone', '--depth', '1', options.repo, options.cloneDir])
    await run('git', ['-C', options.cloneDir, 'fetch', '--depth', '1', 'origin', options.ref])
    await run('git', ['-C', options.cloneDir, 'checkout', '--detach', 'FETCH_HEAD'])
  }
}

async function copySkillDirectory(source, destination) {
  await assertSkillDir(source)
  const parent = dirname(destination)
  await mkdir(parent, { recursive: true })
  const staging = join(parent, `.llm-wiki-${process.pid}-${Date.now()}`)

  try {
    await rm(staging, { recursive: true, force: true })
    await cp(source, staging, { recursive: true, force: true })
    await assertSkillDir(staging)
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

async function assertSkillDir(path) {
  const skillFile = join(path, 'SKILL.md')
  const info = await stat(skillFile).catch(() => undefined)
  if (!info?.isFile()) {
    throw new Error(`llm-wiki source is missing SKILL.md: ${path}`)
  }
}

async function isSkillDir(path) {
  const skillFile = join(path, 'SKILL.md')
  const info = await stat(skillFile).catch(() => undefined)
  return Boolean(info?.isFile())
}

async function pathExists(path) {
  return Boolean(await stat(path).catch(() => undefined))
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}.${stderr ? `\n${stderr.trim()}` : ''}`))
    })
  })
}
