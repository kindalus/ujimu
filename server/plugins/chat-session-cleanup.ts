import { defineNitroPlugin } from 'nitropack/runtime'
import { cleanupExpiredChatSessions, reconcilePendingChatSessions } from '../utils/chat/session-store'
import { initializeDatabase } from '../utils/db'
import { hasConversationPiEntryPairById } from '../utils/history/repository'

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export default defineNitroPlugin(async (nitroApp) => {
  const database = await initializeDatabase()
  await reconcilePendingChatSessions({
    isPersistedEntryPair: (entryIds) => hasConversationPiEntryPairById(database, {
      conversationId: entryIds.internalConversationId,
      userPiEntryId: entryIds.userPiEntryId,
      assistantPiEntryId: entryIds.assistantPiEntryId
    })
  }).catch(logCleanupFailure)
  await cleanupExpiredChatSessions().catch(logCleanupFailure)

  const timer = setInterval(() => {
    void cleanupExpiredChatSessions().catch(logCleanupFailure)
  }, CLEANUP_INTERVAL_MS)
  timer.unref()

  nitroApp.hooks.hook('close', () => {
    clearInterval(timer)
  })
})

function logCleanupFailure(error: unknown): void {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    event: 'ujimu_chat_session_cleanup_failed',
    message: error instanceof Error ? error.message : 'Unknown cleanup failure.'
  }))
}
