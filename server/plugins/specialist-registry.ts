import { defineNitroPlugin } from 'nitropack/runtime'
import { scanRegistryRawSources } from '../utils/ingestion/registry'
import { scheduleDueBackgroundJobs } from '../utils/jobs/background'
import { ensureUjimuPiConfigDir } from '../utils/pi/paths'
import { ensureSpecialistConsultationPolicies } from '../utils/specialists/consultation-policy'
import { loadSpecialistRegistry } from '../utils/specialists/registry'

export default defineNitroPlugin(async () => {
  await ensureUjimuPiConfigDir()
  const snapshot = await loadSpecialistRegistry()
  await ensureSpecialistConsultationPolicies(snapshot.specialists)
  await scanRegistryRawSources(snapshot)
  scheduleDueBackgroundJobs()
})
