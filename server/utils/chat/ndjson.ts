import type { ChatStreamEvent } from './types'

export function serializeChatEvent(event: ChatStreamEvent): string {
  return `${JSON.stringify(event)}\n`
}

export async function* chatEventsToNdjson(
  events: AsyncIterable<ChatStreamEvent>
): AsyncIterable<string> {
  for await (const event of events) {
    yield serializeChatEvent(event)
  }
}
