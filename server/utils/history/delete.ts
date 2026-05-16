export async function deleteConversationHistoryForSpecialist(_specialistId: string): Promise<void> {
  // Conversation history tables are introduced in the history slice.
  // This contract is intentionally present now so destructive specialist deletion
  // already calls the future history cleanup boundary.
}
