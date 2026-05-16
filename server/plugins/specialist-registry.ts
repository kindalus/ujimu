import { defineNitroPlugin } from 'nitropack/runtime'
import { scanRegistryRawSources } from '../utils/ingestion/registry'
import { loadSpecialistRegistry } from '../utils/specialists/registry'

export default defineNitroPlugin(async () => {
  const snapshot = await loadSpecialistRegistry()
  await scanRegistryRawSources(snapshot)
})
