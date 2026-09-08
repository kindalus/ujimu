import { defineNitroPlugin } from 'nitropack/runtime'
import { warmSemanticRetrieval } from '../utils/chat/semantic-retrieval'

export default defineNitroPlugin(async () => {
  await warmSemanticRetrieval()
})
