export const INLINE_AD_MIN_ASSISTANT_RESPONSES = 5
export const INLINE_AD_MAX_ASSISTANT_RESPONSES = 10

export interface InlineAdMessageLike {
  id: string
  role: 'user' | 'assistant'
  status?: 'streaming' | 'done' | 'error'
}

export type InlineAdStreamItem<T extends InlineAdMessageLike> =
  | {
      id: string
      type: 'message'
      message: T
    }
  | {
      id: string
      type: 'ad'
      afterMessageId: string
      afterAssistantResponse: number
    }

export function createInlineAdInterval(random: () => number = Math.random): number {
  const range = INLINE_AD_MAX_ASSISTANT_RESPONSES - INLINE_AD_MIN_ASSISTANT_RESPONSES + 1
  const randomValue = Math.min(Math.max(random(), 0), 1 - Number.EPSILON)

  return INLINE_AD_MIN_ASSISTANT_RESPONSES + Math.floor(randomValue * range)
}

export function extendInlineAdSchedule(
  currentSchedule: number[],
  completedAssistantResponses: number,
  random: () => number = Math.random
): number[] {
  const schedule = [...currentSchedule]
  let nextThreshold = schedule.at(-1) ?? 0

  while (nextThreshold < completedAssistantResponses) {
    nextThreshold += createInlineAdInterval(random)
    schedule.push(nextThreshold)
  }

  return schedule
}

export function countCompletedAssistantResponses(messages: InlineAdMessageLike[]): number {
  return messages.filter(isCompletedAssistantMessage).length
}

export function buildInlineAdStreamItems<T extends InlineAdMessageLike>(
  messages: T[],
  schedule: number[],
  adsVisible: boolean
): InlineAdStreamItem<T>[] {
  const items: InlineAdStreamItem<T>[] = []
  let completedAssistantResponses = 0
  let scheduleIndex = 0

  for (const message of messages) {
    items.push({ id: `message-${message.id}`, type: 'message', message })

    if (!adsVisible || !isCompletedAssistantMessage(message)) {
      continue
    }

    completedAssistantResponses += 1
    if (schedule[scheduleIndex] === completedAssistantResponses) {
      items.push({
        id: `inline-ad-${completedAssistantResponses}-${message.id}`,
        type: 'ad',
        afterMessageId: message.id,
        afterAssistantResponse: completedAssistantResponses
      })
      scheduleIndex += 1
    }
  }

  return items
}

function isCompletedAssistantMessage(message: InlineAdMessageLike): boolean {
  return message.role === 'assistant' && message.status !== 'streaming' && message.status !== 'error'
}
