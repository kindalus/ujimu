import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '../server/utils/db'
import {
  GENERIC_OTP_FAILURE_MESSAGE,
  GENERIC_OTP_REQUEST_MESSAGE,
  OtpDeliveryError,
  OtpValidationError,
  getActiveOtpChallengeCount,
  requestOtp,
  verifyOtp
} from '../server/utils/auth/otp'
import { verifySessionToken } from '../server/utils/auth/session'
import { resolveQuotaSubjectFromCookies } from '../server/utils/quota/identity'
import type { NotificationProvider } from '../server/utils/notifications/provider'

describe('OTP authentication acceptance', () => {
  it('signs a new user in with a verified email OTP and exposes a registered quota subject', async () => {
    const database = await createTempDatabase()
    const provider = fakeProvider()

    const requested = await requestOtp(
      database,
      { channel: 'email', contact: ' USER@Example.COM ' },
      { provider, now: new Date('2026-05-16T12:00:00.000Z'), generateCode: () => '123456', pepper: 'pepper' }
    )

    expect(requested).toEqual({ message: GENERIC_OTP_REQUEST_MESSAGE })
    expect(provider.deliverOtp).toHaveBeenCalledWith({
      channel: 'email',
      contact: 'user@example.com',
      code: '123456'
    })
    expect(readStoredOtpHash(database)).not.toContain('123456')

    const verified = await verifyOtp(
      database,
      { channel: 'email', contact: 'user@example.com', code: '123456' },
      {
        now: new Date('2026-05-16T12:03:00.000Z'),
        pepper: 'pepper',
        sessionSecret: 'session-secret'
      }
    )

    expect(verified.user.displayContact).toBe('user@example.com')
    const session = verifySessionToken(verified.sessionToken, {
      now: new Date('2026-05-16T12:03:00.000Z'),
      sessionSecret: 'session-secret'
    })
    expect(session).toMatchObject({ userId: verified.user.id, authMethod: 'otp' })
    expect(
      resolveQuotaSubjectFromCookies({ sessionCookie: verified.sessionToken, sessionSecret: 'session-secret' })
    ).toEqual({ type: 'registered', id: verified.user.id })
    database.close()
  })

  it('signs a new user in with a verified E.164 mobile-phone OTP', async () => {
    const database = await createTempDatabase()
    const provider = fakeProvider()

    await requestOtp(
      database,
      { channel: 'phone', contact: '+244 923 000 000' },
      { provider, now: new Date('2026-05-16T12:00:00.000Z'), generateCode: () => '654321', pepper: 'pepper' }
    )

    expect(provider.deliverOtp).toHaveBeenCalledWith({
      channel: 'phone',
      contact: '+244923000000',
      code: '654321'
    })

    const verified = await verifyOtp(
      database,
      { channel: 'phone', contact: '+244923000000', code: '654321' },
      {
        now: new Date('2026-05-16T12:02:00.000Z'),
        pepper: 'pepper',
        sessionSecret: 'session-secret'
      }
    )

    expect(verified.user.displayContact).toBe('+244923000000')
    database.close()
  })

  it('rejects invalid contacts without calling the delivery provider', async () => {
    const database = await createTempDatabase()
    const provider = fakeProvider()

    await expect(
      requestOtp(database, { channel: 'email', contact: 'not-an-email' }, { provider, pepper: 'pepper' })
    ).rejects.toBeInstanceOf(OtpValidationError)

    await expect(
      requestOtp(database, { channel: 'phone', contact: '923000000' }, { provider, pepper: 'pepper' })
    ).rejects.toBeInstanceOf(OtpValidationError)

    expect(provider.deliverOtp).not.toHaveBeenCalled()
    database.close()
  })

  it('does not leave an active OTP when delivery fails', async () => {
    const database = await createTempDatabase()
    const provider = fakeProvider(async () => {
      throw new Error('provider down')
    })

    await expect(
      requestOtp(
        database,
        { channel: 'email', contact: 'user@example.com' },
        { provider, generateCode: () => '123456', pepper: 'pepper' }
      )
    ).rejects.toBeInstanceOf(OtpDeliveryError)

    expect(getActiveOtpChallengeCount(database, { channel: 'email', contact: 'user@example.com' })).toBe(0)
    database.close()
  })

  it('rejects expired, reused, and over-attempted OTP codes with the same generic message', async () => {
    const database = await createTempDatabase()
    const provider = fakeProvider()

    await requestOtp(
      database,
      { channel: 'email', contact: 'expired@example.com' },
      { provider, now: new Date('2026-05-16T12:00:00.000Z'), generateCode: () => '111111', pepper: 'pepper' }
    )
    await expect(
      verifyOtp(
        database,
        { channel: 'email', contact: 'expired@example.com', code: '111111' },
        { now: new Date('2026-05-16T12:11:00.000Z'), pepper: 'pepper', sessionSecret: 'session-secret' }
      )
    ).rejects.toMatchObject({ message: GENERIC_OTP_FAILURE_MESSAGE })

    await requestOtp(
      database,
      { channel: 'email', contact: 'used@example.com' },
      { provider, now: new Date('2026-05-16T12:00:00.000Z'), generateCode: () => '222222', pepper: 'pepper' }
    )
    await verifyOtp(
      database,
      { channel: 'email', contact: 'used@example.com', code: '222222' },
      { now: new Date('2026-05-16T12:01:00.000Z'), pepper: 'pepper', sessionSecret: 'session-secret' }
    )
    await expect(
      verifyOtp(
        database,
        { channel: 'email', contact: 'used@example.com', code: '222222' },
        { now: new Date('2026-05-16T12:02:00.000Z'), pepper: 'pepper', sessionSecret: 'session-secret' }
      )
    ).rejects.toMatchObject({ message: GENERIC_OTP_FAILURE_MESSAGE })

    await requestOtp(
      database,
      { channel: 'email', contact: 'attempts@example.com' },
      { provider, now: new Date('2026-05-16T12:00:00.000Z'), generateCode: () => '333333', pepper: 'pepper' }
    )
    for (let index = 0; index < 5; index += 1) {
      await expect(
        verifyOtp(
          database,
          { channel: 'email', contact: 'attempts@example.com', code: '000000' },
          { now: new Date('2026-05-16T12:01:00.000Z'), pepper: 'pepper', sessionSecret: 'session-secret' }
        )
      ).rejects.toMatchObject({ message: GENERIC_OTP_FAILURE_MESSAGE })
    }
    await expect(
      verifyOtp(
        database,
        { channel: 'email', contact: 'attempts@example.com', code: '333333' },
        { now: new Date('2026-05-16T12:02:00.000Z'), pepper: 'pepper', sessionSecret: 'session-secret' }
      )
    ).rejects.toMatchObject({ message: GENERIC_OTP_FAILURE_MESSAGE })

    database.close()
  })

  it('links a newly verified identity to the current session user', async () => {
    const database = await createTempDatabase()
    const provider = fakeProvider()

    await requestOtp(
      database,
      { channel: 'email', contact: 'owner@example.com' },
      { provider, generateCode: () => '123456', pepper: 'pepper' }
    )
    const emailSession = await verifyOtp(
      database,
      { channel: 'email', contact: 'owner@example.com', code: '123456' },
      { pepper: 'pepper', sessionSecret: 'session-secret' }
    )

    await requestOtp(
      database,
      { channel: 'phone', contact: '+244923000000' },
      { provider, generateCode: () => '789012', pepper: 'pepper' }
    )
    const linked = await verifyOtp(
      database,
      { channel: 'phone', contact: '+244923000000', code: '789012' },
      { pepper: 'pepper', sessionSecret: 'session-secret', currentUserId: emailSession.user.id }
    )

    expect(linked.user.id).toBe(emailSession.user.id)
    expect(readIdentityContacts(database, emailSession.user.id).sort()).toEqual([
      '+244923000000',
      'owner@example.com'
    ])
    database.close()
  })
})

async function createTempDatabase(): Promise<DatabaseSync> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-auth-db-'))
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

function fakeProvider(implementation?: NotificationProvider['deliverOtp']): NotificationProvider {
  return {
    deliverOtp: vi.fn(implementation ?? (async () => undefined))
  }
}

function readStoredOtpHash(database: DatabaseSync): string {
  const row = database.prepare('SELECT code_hash FROM otp_challenges ORDER BY created_at DESC LIMIT 1').get() as {
    code_hash: string
  }
  return row.code_hash
}

function readIdentityContacts(database: DatabaseSync, userId: string): string[] {
  return database
    .prepare('SELECT contact FROM user_identities WHERE user_id = ? ORDER BY contact')
    .all(userId)
    .map((row) => (row as { contact: string }).contact)
}
