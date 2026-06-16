import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAgentSessionLogger } from '../server/utils/agents/logs'

describe('agent session audit logs acceptance', () => {
  it('writes useful specialist-local logs with complete assistant text and redacted tool arguments/results', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-agent-logs-'))
    const logger = await createAgentSessionLogger({
      dataDir,
      specialistId: 'iva-legislation',
      task: 'ingestion',
      now: new Date('2026-06-12T10:20:30.123Z')
    })

    logger.writeSessionCreated({
      tools: ['read', 'write'],
      model: 'configured',
      apiKey: 'sk-secret-value-that-must-not-appear'
    })
    logger.writeEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Processado por ' }
    })
    logger.writeEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'user@example.com.' }
    })
    logger.writeEvent({ type: 'turn_start' })
    logger.writeEvent({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'thinking_delta',
        delta: 'private chain of thought that must not be logged'
      }
    })
    logger.writeEvent({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Processado por user@example.com.' }] }
    })
    logger.writeEvent({
      type: 'tool_execution_start',
      toolCallId: 'call-read-1',
      toolName: 'read',
      args: { path: 'raw/codigo-iva.md', apiKey: 'sk-secret-value-that-must-not-appear' }
    })
    logger.writeEvent({
      type: 'tool_execution_update',
      toolCallId: 'call-read-1',
      toolName: 'read',
      args: { path: 'raw/codigo-iva.md' },
      partialResult: { content: [{ type: 'text', text: 'partial output should not be logged twice' }] }
    })
    logger.writeEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-read-1',
      toolName: 'read',
      isError: false,
      result: { content: [{ type: 'text', text: 'Conteúdo legal de user@example.com.' }] }
    })

    logger.writeEvent({ type: 'turn_end' })
    await logger.close('succeeded')

    expect(logger.path).toBe(join(dataDir, 'specialties', 'iva-legislation', 'logs', '2026-06-12T10-20-30-123Z-iva-legislation-ingestion.md'))

    const contents = await readFile(logger.path, 'utf8')
    expect(contents).toContain('# Ujimu agent session log')
    expect(contents).toContain('**Started:** `2026-06-12T10:20:30.123Z`')
    expect(contents).toContain('**Specialist:** `iva-legislation`')
    expect(contents).toContain('**Task:** `ingestion`')
    expect(contents).toContain('## Session configuration')
    expect(contents).toContain('"apiKey": "[redacted]"')
    expect(contents).toContain('## Assistant response')
    expect(contents).toContain('Processado por [redacted-email].')
    expect(contents).toContain('## ')
    expect(contents).toContain('Tool call: `read`')
    expect(contents).toContain('**Path:** `raw/codigo-iva.md`')
    expect(contents).toContain('Tool metadata')
    expect(contents).toContain('"apiKey": "[redacted]"')
    expect(contents).toContain('Tool result: `read` succeeded')
    expect(contents).toContain('Conteúdo legal de [redacted-email].')
    expect(contents).toContain('## Closed')
    expect(contents).toContain('✅ `succeeded`')
    expect(contents).not.toContain('] tool_call')
    expect(contents).not.toContain('turn_start')
    expect(contents).not.toContain('turn_end')
    expect(contents).not.toContain('text_delta')
    expect(contents).not.toContain('thinking_delta')
    expect(contents).not.toContain('toolcall_delta')
    expect(contents).not.toContain('partial output should not be logged twice')
    expect(contents).not.toContain('user@example.com')
    expect(contents).not.toContain('sk-secret-value-that-must-not-appear')
    expect(contents).not.toContain('private chain of thought')
  })
})
