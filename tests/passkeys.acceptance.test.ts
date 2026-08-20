import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { requestOtp, verifyOtp } from '../server/utils/auth/otp'
import { verifySessionToken, type SessionClaims } from '../server/utils/auth/session'
import { initializeDatabase } from '../server/utils/db'
import type { NotificationProvider } from '../server/utils/notifications/provider'

const passkeyEnv = {
  NODE_ENV: 'development',
  UJIMU_PASSKEYS_ENABLED: 'true',
  UJIMU_PASSKEY_RP_ID: 'localhost',
  UJIMU_PASSKEY_RP_NAME: 'Ujimu',
  UJIMU_PASSKEY_ORIGIN: 'http://localhost:3000'
}
const sessionSecret = 'passkey-test-session-secret'

describe('passkey authentication acceptance', () => {
  it('lets recent OTP users add, use, remove, and recover from passkeys', async () => {
    const database = await createTempDatabase()
    const adapter = createFakePasskeyAdapter()
    const otp = await createOtpSession(database, {
      contact: 'passkey-user@example.com',
      code: '123456',
      issuedAt: new Date('2026-05-16T12:00:00.000Z')
    })

    const otpSession = verifySessionToken(otp.sessionToken, {
      sessionSecret,
      now: new Date('2026-05-16T12:01:00.000Z')
    }) as PasskeySession | undefined
    expect(otpSession).toMatchObject({ userId: otp.userId, authMethod: 'otp' })

    const passkeys = await loadPasskeys()
    const registrationOptions = await passkeys.createPasskeyRegistrationOptions(
      database,
      {
        userId: otp.userId,
        session: otpSession!,
        origin: 'http://localhost:3000'
      },
      { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:02:00.000Z') }
    )

    expect(registrationOptions.options).toMatchObject({
      challenge: 'registration-challenge-1',
      rp: { id: 'localhost', name: 'Ujimu' },
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred'
      },
      attestation: 'none',
      excludeCredentials: []
    })

    const registered = await passkeys.verifyPasskeyRegistration(
      database,
      {
        userId: otp.userId,
        session: otpSession!,
        origin: 'http://localhost:3000',
        response: {
          challenge: 'registration-challenge-1',
          credentialId: 'credential-one'
        }
      },
      { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:03:00.000Z') }
    )

    expect(registered.credential).toMatchObject({
      id: expect.any(String),
      createdAt: '2026-05-16T12:03:00.000Z',
      transports: ['internal']
    })
    expect(registered.credential).not.toHaveProperty('publicKey')
    expect(registered.credential).not.toHaveProperty('rawCredentialId')

    const credentials = passkeys.listPasskeyCredentials(database, { userId: otp.userId })
    expect(credentials).toEqual([registered.credential])

    const authenticationOptions = await passkeys.createPasskeyAuthenticationOptions(
      database,
      {
        origin: 'http://localhost:3000',
        subject: { type: 'visitor', id: 'visitor-one' }
      },
      { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:04:00.000Z') }
    )
    expect(authenticationOptions.options).toMatchObject({
      challenge: 'authentication-challenge-1',
      rpId: 'localhost',
      userVerification: 'preferred'
    })
    expect(authenticationOptions.options).not.toHaveProperty('allowCredentials')

    const passkeyLogin = await passkeys.verifyPasskeyAuthentication(
      database,
      {
        origin: 'http://localhost:3000',
        subject: { type: 'visitor', id: 'visitor-one' },
        response: {
          challenge: 'authentication-challenge-1',
          credentialId: 'credential-one'
        }
      },
      {
        adapter,
        env: passkeyEnv,
        sessionSecret,
        now: new Date('2026-05-16T12:05:00.000Z')
      }
    )
    const passkeySession = verifySessionToken(passkeyLogin.sessionToken, {
      sessionSecret,
      now: new Date('2026-05-16T12:05:00.000Z')
    })
    expect(passkeySession).toMatchObject({ userId: otp.userId, authMethod: 'passkey' })

    const removed = passkeys.deletePasskeyCredential(database, {
      userId: otp.userId,
      credentialId: registered.credential.id,
      now: new Date('2026-05-16T12:06:00.000Z')
    })
    expect(removed).toEqual({ deleted: true })
    expect(passkeys.listPasskeyCredentials(database, { userId: otp.userId })).toEqual([])

    const postDeleteOptions = await passkeys.createPasskeyAuthenticationOptions(
      database,
      {
        origin: 'http://localhost:3000',
        subject: { type: 'visitor', id: 'visitor-one' }
      },
      { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:07:00.000Z') }
    )
    await expect(
      passkeys.verifyPasskeyAuthentication(
        database,
        {
          origin: 'http://localhost:3000',
          subject: { type: 'visitor', id: 'visitor-one' },
          response: {
            challenge: postDeleteOptions.options.challenge,
            credentialId: 'credential-one'
          }
        },
        { adapter, env: passkeyEnv, sessionSecret, now: new Date('2026-05-16T12:08:00.000Z') }
      )
    ).rejects.toMatchObject({ code: 'PASSKEY_AUTHENTICATION_FAILED' })

    const fallbackOtp = await createOtpSession(database, {
      contact: 'passkey-user@example.com',
      code: '654321',
      issuedAt: new Date('2026-05-16T12:09:00.000Z')
    })
    expect(fallbackOtp.userId).toBe(otp.userId)
    database.close()
  })

  it('requires recent OTP authentication before registering a passkey', async () => {
    const database = await createTempDatabase()
    const adapter = createFakePasskeyAdapter()
    const otp = await createOtpSession(database, {
      contact: 'recent-otp@example.com',
      code: '222222',
      issuedAt: new Date('2026-05-16T12:00:00.000Z')
    })
    const passkeys = await loadPasskeys()

    await expect(
      passkeys.createPasskeyRegistrationOptions(
        database,
        {
          userId: otp.userId,
          session: {
            userId: otp.userId,
            authMethod: 'otp',
            issuedAt: new Date('2026-05-16T12:00:00.000Z'),
            expiresAt: new Date('2026-08-14T12:00:00.000Z'),
            epoch: 0
          },
          origin: 'http://localhost:3000'
        },
        { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:16:00.000Z') }
      )
    ).rejects.toMatchObject({ code: 'RECENT_AUTH_REQUIRED' })

    await expect(
      passkeys.createPasskeyRegistrationOptions(
        database,
        {
          userId: otp.userId,
          session: {
            userId: otp.userId,
            authMethod: 'passkey',
            issuedAt: new Date('2026-05-16T12:15:00.000Z'),
            expiresAt: new Date('2026-08-14T12:15:00.000Z'),
            epoch: 0
          },
          origin: 'http://localhost:3000'
        },
        { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:16:00.000Z') }
      )
    ).rejects.toMatchObject({ code: 'RECENT_AUTH_REQUIRED' })

    database.close()
  })

  it('treats challenges as one-shot and rejects duplicate or replayed credentials safely', async () => {
    const database = await createTempDatabase()
    const adapter = createFakePasskeyAdapter()
    const otp = await createOtpSession(database, {
      contact: 'replay@example.com',
      code: '333333',
      issuedAt: new Date('2026-05-16T12:00:00.000Z')
    })
    const passkeys = await loadPasskeys()
    const session: PasskeySession = {
      userId: otp.userId,
      authMethod: 'otp',
      issuedAt: new Date('2026-05-16T12:00:00.000Z'),
      expiresAt: new Date('2026-08-14T12:00:00.000Z'),
      epoch: 0
    }

    await passkeys.createPasskeyRegistrationOptions(
      database,
      { userId: otp.userId, session, origin: 'http://localhost:3000' },
      { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:01:00.000Z') }
    )
    await passkeys.verifyPasskeyRegistration(
      database,
      {
        userId: otp.userId,
        session,
        origin: 'http://localhost:3000',
        response: { challenge: 'registration-challenge-1', credentialId: 'credential-one' }
      },
      { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:02:00.000Z') }
    )

    await passkeys.createPasskeyRegistrationOptions(
      database,
      { userId: otp.userId, session, origin: 'http://localhost:3000' },
      { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:03:00.000Z') }
    )
    await expect(
      passkeys.verifyPasskeyRegistration(
        database,
        {
          userId: otp.userId,
          session,
          origin: 'http://localhost:3000',
          response: { challenge: 'registration-challenge-2', credentialId: 'credential-one' }
        },
        { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:04:00.000Z') }
      )
    ).rejects.toMatchObject({ code: 'PASSKEY_ALREADY_REGISTERED' })

    await expect(
      passkeys.verifyPasskeyRegistration(
        database,
        {
          userId: otp.userId,
          session,
          origin: 'http://localhost:3000',
          response: { challenge: 'registration-challenge-2', credentialId: 'credential-one' }
        },
        { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:04:30.000Z') }
      )
    ).rejects.toMatchObject({ code: 'PASSKEY_AUTHENTICATION_FAILED' })

    database.close()
  })

  it('fails safely when disabled, misconfigured, or rate limited', async () => {
    const database = await createTempDatabase()
    const adapter = createFakePasskeyAdapter()
    const passkeys = await loadPasskeys()

    await expect(
      passkeys.createPasskeyAuthenticationOptions(
        database,
        { origin: 'http://localhost:3000', subject: { type: 'visitor', id: 'disabled-visitor' } },
        { adapter, env: { ...passkeyEnv, UJIMU_PASSKEYS_ENABLED: 'false' } }
      )
    ).rejects.toMatchObject({ code: 'PASSKEYS_DISABLED' })

    await expect(
      passkeys.createPasskeyAuthenticationOptions(
        database,
        { origin: 'https://ujimu.example', subject: { type: 'visitor', id: 'misconfigured-visitor' } },
        { adapter, env: { NODE_ENV: 'production', UJIMU_PASSKEYS_ENABLED: 'true' } }
      )
    ).rejects.toMatchObject({ code: 'PASSKEYS_NOT_CONFIGURED' })

    for (let index = 0; index < 20; index += 1) {
      await passkeys.createPasskeyAuthenticationOptions(
        database,
        { origin: 'http://localhost:3000', subject: { type: 'visitor', id: 'limited-visitor' } },
        { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:00:00.000Z') }
      )
    }
    await expect(
      passkeys.createPasskeyAuthenticationOptions(
        database,
        { origin: 'http://localhost:3000', subject: { type: 'visitor', id: 'limited-visitor' } },
        { adapter, env: passkeyEnv, now: new Date('2026-05-16T12:09:00.000Z') }
      )
    ).rejects.toMatchObject({ code: 'PASSKEY_RATE_LIMITED' })

    database.close()
  })
})

interface PasskeySession extends SessionClaims {
  authMethod: 'otp' | 'passkey' | 'unknown'
}

interface PublicPasskeyCredential {
  id: string
  createdAt: string
  lastUsedAt: string | null
  transports: string[]
}

interface PasskeysModule {
  createPasskeyRegistrationOptions(
    database: DatabaseSync,
    input: {
      userId: string
      session: PasskeySession
      origin: string
    },
    options: PasskeyServiceOptions
  ): Promise<{ options: Record<string, unknown> }>
  verifyPasskeyRegistration(
    database: DatabaseSync,
    input: {
      userId: string
      session: PasskeySession
      origin: string
      response: Record<string, unknown>
    },
    options: PasskeyServiceOptions
  ): Promise<{ credential: PublicPasskeyCredential }>
  createPasskeyAuthenticationOptions(
    database: DatabaseSync,
    input: {
      origin: string
      subject: { type: 'visitor' | 'ip' | 'unknown'; id: string }
    },
    options: PasskeyServiceOptions
  ): Promise<{ options: Record<string, unknown> }>
  verifyPasskeyAuthentication(
    database: DatabaseSync,
    input: {
      origin: string
      subject: { type: 'visitor' | 'ip' | 'unknown'; id: string }
      response: Record<string, unknown>
    },
    options: PasskeyServiceOptions & { sessionSecret: string }
  ): Promise<{ sessionToken: string; user: { id: string; displayContact: string } }>
  listPasskeyCredentials(database: DatabaseSync, input: { userId: string }): PublicPasskeyCredential[]
  deletePasskeyCredential(
    database: DatabaseSync,
    input: { userId: string; credentialId: string; now?: Date }
  ): { deleted: true }
}

interface PasskeyServiceOptions {
  adapter: FakePasskeyAdapter
  env: Record<string, string | undefined>
  now?: Date
}

interface FakePasskeyAdapter {
  generateRegistrationOptions(input: Record<string, unknown>): Promise<{ challenge: string; options: Record<string, unknown> }>
  verifyRegistrationResponse(input: Record<string, unknown>): Promise<{
    verified: boolean
    credential: {
      credentialId: string
      publicKey: string
      counter: number
      transports: string[]
    }
  }>
  generateAuthenticationOptions(input: Record<string, unknown>): Promise<{ challenge: string; options: Record<string, unknown> }>
  verifyAuthenticationResponse(input: Record<string, unknown>): Promise<{
    verified: boolean
    credentialId: string
    newCounter: number
  }>
}

async function loadPasskeys(): Promise<PasskeysModule> {
  const modulePath = '../server/utils/auth/passkeys'
  return (await import(modulePath)) as PasskeysModule
}

async function createTempDatabase(): Promise<DatabaseSync> {
  const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-passkeys-db-'))
  return initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
}

async function createOtpSession(
  database: DatabaseSync,
  input: { contact: string; code: string; issuedAt: Date }
): Promise<{ userId: string; sessionToken: string }> {
  const provider = fakeProvider()
  await requestOtp(
    database,
    { channel: 'email', contact: input.contact },
    {
      provider,
      now: input.issuedAt,
      generateCode: () => input.code,
      pepper: 'passkey-pepper'
    }
  )
  const verified = await verifyOtp(
    database,
    { channel: 'email', contact: input.contact, code: input.code },
    {
      now: new Date(input.issuedAt.getTime() + 60_000),
      pepper: 'passkey-pepper',
      sessionSecret
    }
  )

  return { userId: verified.user.id, sessionToken: verified.sessionToken }
}

function fakeProvider(implementation?: NotificationProvider['deliverOtp']): NotificationProvider {
  return {
    deliverOtp: vi.fn(implementation ?? (async () => undefined))
  }
}

function createFakePasskeyAdapter(): FakePasskeyAdapter {
  let registrationChallengeCount = 0
  let authenticationChallengeCount = 0

  return {
    async generateRegistrationOptions(input) {
      registrationChallengeCount += 1
      const challenge = `registration-challenge-${registrationChallengeCount}`
      return {
        challenge,
        options: {
          challenge,
          rp: input.rp,
          user: input.user,
          attestation: input.attestation,
          authenticatorSelection: input.authenticatorSelection,
          excludeCredentials: input.excludeCredentials ?? []
        }
      }
    },
    async verifyRegistrationResponse(input) {
      const response = input.response as { credentialId?: string }
      return {
        verified: true,
        credential: {
          credentialId: response.credentialId ?? 'credential-one',
          publicKey: 'public-key-one',
          counter: 1,
          transports: ['internal']
        }
      }
    },
    async generateAuthenticationOptions(input) {
      authenticationChallengeCount += 1
      const challenge = `authentication-challenge-${authenticationChallengeCount}`
      return {
        challenge,
        options: {
          challenge,
          rpId: input.rpId,
          userVerification: input.userVerification
        }
      }
    },
    async verifyAuthenticationResponse(input) {
      const response = input.response as { credentialId?: string }
      return {
        verified: true,
        credentialId: response.credentialId ?? 'credential-one',
        newCounter: 2
      }
    }
  }
}
