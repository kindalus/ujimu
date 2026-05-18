import { join, resolve } from 'node:path'

export const DEFAULT_UJIMU_PI_AGENT_DIR = join('config', 'ujimu-pi-agent')

export function resolveUjimuPiAgentDir(): string {
  return resolve(process.env.UJIMU_PI_AGENT_DIR || join(process.cwd(), DEFAULT_UJIMU_PI_AGENT_DIR))
}

export function resolveUjimuPiToolPath(toolName: string): string {
  return join(resolveUjimuPiAgentDir(), 'tools', toolName)
}
