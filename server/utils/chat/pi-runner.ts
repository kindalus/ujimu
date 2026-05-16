import type { ChatEngineRunner } from './types'

const SERVICE_UNAVAILABLE_MESSAGE =
  'O serviço de resposta está temporariamente indisponível. Tente novamente dentro de alguns minutos.'

export function isPiChatEnabled(option: boolean | undefined): boolean {
  return option ?? process.env.UJIMU_PI_CHAT_ENABLED === 'true'
}

export function createDefaultChatRunner(piChatEnabled: boolean): ChatEngineRunner {
  return piChatEnabled ? createPiChatRunnerPlaceholder() : createUnavailableChatRunner()
}

export function createUnavailableChatRunner(message = SERVICE_UNAVAILABLE_MESSAGE): ChatEngineRunner {
  return {
    async run() {
      return {
        grounded: false,
        citations: [],
        deltas: toAsyncDeltas([message])
      }
    }
  }
}

function createPiChatRunnerPlaceholder(): ChatEngineRunner {
  return createUnavailableChatRunner()
}

async function* toAsyncDeltas(deltas: string[]): AsyncIterable<string> {
  for (const delta of deltas) {
    yield delta
  }
}
