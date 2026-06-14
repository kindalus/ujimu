import type { SpecialistRuntime } from '../specialists/schema'
import { readIngestionState } from '../ingestion/state'
import { isUsableCitationSource, normalizeChatCitation, sourceToChatCitations } from './citations'
import type { ChatCitation } from './types'

export async function getCitationEvidence(specialist: SpecialistRuntime): Promise<ChatCitation[]> {
  const state = await readIngestionState(specialist.paths.ingestState)

  return Object.values(state.sources)
    .filter(isUsableCitationSource)
    .flatMap(sourceToChatCitations)
    .map(normalizeChatCitation)
    .filter((citation): citation is ChatCitation => Boolean(citation))
}
