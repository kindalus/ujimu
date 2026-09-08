#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const acceptedAdvisories = new Set([
  'https://github.com/advisories/GHSA-f88m-g3jw-g9cj',
  'https://github.com/advisories/GHSA-xcpc-8h2w-3j85'
])

const audit = readAudit(process.argv.slice(2))
const vulnerabilities = audit.vulnerabilities ?? {}
const presentAcceptedAdvisories = new Set()
const memo = new Map()

function isAcceptedVulnerability(name, stack = new Set()) {
  if (memo.has(name)) return memo.get(name)
  const vulnerability = vulnerabilities[name]
  if (!vulnerability || stack.has(name) || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
    return false
  }

  const nextStack = new Set(stack).add(name)
  const accepted = vulnerability.via.every((via) => {
    if (typeof via === 'string') return isAcceptedVulnerability(via, nextStack)
    if (!via || typeof via.url !== 'string' || !acceptedAdvisories.has(via.url)) return false
    presentAcceptedAdvisories.add(via.url)
    return true
  })
  memo.set(name, accepted)
  return accepted
}

const unexpected = Object.entries(vulnerabilities)
  .filter(([, vulnerability]) => ['high', 'critical'].includes(vulnerability.severity))
  .map(([name]) => name)
  .filter((name) => !isAcceptedVulnerability(name))
const stale = [...acceptedAdvisories].filter((url) => !presentAcceptedAdvisories.has(url))

if (unexpected.length > 0) {
  console.error(`Found unaccepted high or critical advisory in: ${unexpected.join(', ')}`)
  process.exit(1)
}
if (stale.length > 0) {
  console.error(`Found stale accepted advisory: ${stale.join(', ')}`)
  process.exit(1)
}

console.log(`${presentAcceptedAdvisories.size} accepted high advisories; no unaccepted high or critical advisories.`)

function readAudit(args) {
  if (args.length === 2 && args[0] === '--input') {
    return JSON.parse(readFileSync(args[1], 'utf8'))
  }
  if (args.length > 0) throw new Error('Usage: node scripts/audit-high.mjs [--input audit.json]')

  const result = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })
  if (!result.stdout) throw new Error(result.stderr || 'npm audit produced no JSON output.')
  return JSON.parse(result.stdout)
}
