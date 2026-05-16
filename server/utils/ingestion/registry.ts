import type { SpecialistRegistrySnapshot } from '../specialists/loader'
import { getSpecialistRegistry } from '../specialists/registry'
import { scanSpecialistRawSources } from './detect'
import type { IngestionState } from './types'

export async function scanRegistryRawSources(
  snapshot?: SpecialistRegistrySnapshot
): Promise<Record<string, IngestionState>> {
  const registry = snapshot ?? (await getSpecialistRegistry())
  const results: Record<string, IngestionState> = {}

  for (const specialist of registry.specialists) {
    results[specialist.id] = await scanSpecialistRawSources(specialist)
  }

  return results
}
