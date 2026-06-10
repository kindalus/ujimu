import { loadSpecialistsFromDisk, type LoadSpecialistsOptions, type SpecialistRegistrySnapshot } from './loader'
import { filterAccessibleSpecialists, type SpecialistAccessSubject } from './access'
import { type PublicSpecialist, type SpecialistRuntime, toPublicSpecialist } from './schema'

let registrySnapshot: SpecialistRegistrySnapshot | undefined

export async function loadSpecialistRegistry(
  options: LoadSpecialistsOptions = {}
): Promise<SpecialistRegistrySnapshot> {
  registrySnapshot = await loadSpecialistsFromDisk(options)
  return registrySnapshot
}

export async function reloadSpecialistRegistry(
  options: LoadSpecialistsOptions = {}
): Promise<SpecialistRegistrySnapshot> {
  return loadSpecialistRegistry(options)
}

export async function getSpecialistRegistry(
  options: LoadSpecialistsOptions = {}
): Promise<SpecialistRegistrySnapshot> {
  registrySnapshot ??= await loadSpecialistsFromDisk(options)
  return registrySnapshot
}

export async function getSpecialistById(
  specialistId: string,
  options: LoadSpecialistsOptions = {}
): Promise<SpecialistRuntime | undefined> {
  const snapshot = await getSpecialistRegistry(options)
  return snapshot.specialists.find((specialist) => specialist.id === specialistId)
}

export async function getPublicSpecialists(
  options: LoadSpecialistsOptions & { accessSubject?: SpecialistAccessSubject } = {}
): Promise<PublicSpecialist[]> {
  const snapshot = await getSpecialistRegistry(options)
  const subject = options.accessSubject ?? { type: 'anonymous' }
  return filterAccessibleSpecialists(snapshot.specialists, subject).map(toPublicSpecialist)
}

export function resetSpecialistRegistryForTests(): void {
  registrySnapshot = undefined
}
