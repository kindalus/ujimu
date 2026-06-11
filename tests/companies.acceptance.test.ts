import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initializeDatabase } from '../server/utils/db'
import {
  CompanyValidationError,
  calculateEffectiveMemberLimit,
  createCompany,
  getActiveCompanyForUser,
  listUserCompanies,
  replaceCompanyMemberships,
  setActiveCompanyForUser,
  upsertCorporateSubscription
} from '../server/utils/companies/repository'

describe('corporate company data model acceptance', () => {
  it('creates companies, subscriptions, normalized memberships, and active company context', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-company-'))
    const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
    seedUser(database, 'buyer-user', ['Buyer@Example.COM'])
    seedUser(database, 'member-user', ['member@example.com'])

    const company = createCompany(database, {
      nif: '5001234567',
      name: 'Empresa Exemplo',
      phone: '+244923000000',
      address: 'Rua Principal, Luanda',
      now: new Date('2026-06-10T10:00:00.000Z')
    })
    upsertCorporateSubscription(database, {
      companyId: company.id,
      seats: 10,
      currentPeriodStart: '2026-06-10T10:00:00.000Z',
      currentPeriodEnd: '2026-09-10T10:00:00.000Z',
      now: new Date('2026-06-10T10:00:00.000Z')
    })

    const memberships = replaceCompanyMemberships(database, {
      companyId: company.id,
      admins: ['buyer@example.com'],
      members: ['member@example.com', ' MEMBER@example.com '],
      now: new Date('2026-06-10T10:00:00.000Z')
    })

    expect(calculateEffectiveMemberLimit(10)).toBe(11)
    expect(memberships).toEqual([
      expect.objectContaining({ email: 'buyer@example.com', role: 'admin', userId: 'buyer-user' }),
      expect.objectContaining({ email: 'member@example.com', role: 'member', userId: 'member-user' })
    ])

    expect(listUserCompanies(database, 'buyer-user')).toEqual([
      expect.objectContaining({ id: company.id, role: 'admin', seats: 10, active: true })
    ])
    expect(listUserCompanies(database, 'member-user')).toEqual([
      expect.objectContaining({ id: company.id, role: 'member', seats: 10, active: true })
    ])

    setActiveCompanyForUser(database, {
      userId: 'buyer-user',
      companyId: company.id,
      now: new Date('2026-06-10T10:00:00.000Z')
    })
    expect(getActiveCompanyForUser(database, 'buyer-user')).toMatchObject({ id: company.id, role: 'admin' })

    setActiveCompanyForUser(database, {
      userId: 'buyer-user',
      companyId: null,
      now: new Date('2026-06-10T10:05:00.000Z')
    })
    expect(getActiveCompanyForUser(database, 'buyer-user')).toBeNull()
    database.close()
  })

  it('rejects membership lists above effective capacity and invalid active-company choices', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'ujimu-company-'))
    const database = await initializeDatabase({ dataDir, dbPath: join(dataDir, 'db', 'ujimu.sqlite') })
    seedUser(database, 'buyer-user', ['buyer@example.com'])
    seedUser(database, 'outsider-user', ['outsider@example.com'])
    const company = createCompany(database, {
      nif: '5007654321',
      name: 'Empresa Limite',
      phone: '+244923111111',
      address: 'Rua do Limite, Luanda'
    })
    upsertCorporateSubscription(database, {
      companyId: company.id,
      seats: 10,
      currentPeriodStart: '2026-06-10T10:00:00.000Z',
      currentPeriodEnd: '2026-09-10T10:00:00.000Z'
    })

    expect(() => replaceCompanyMemberships(database, {
      companyId: company.id,
      admins: ['buyer@example.com'],
      members: Array.from({ length: 11 }, (_, index) => `user${index}@example.com`)
    })).toThrow(CompanyValidationError)

    replaceCompanyMemberships(database, {
      companyId: company.id,
      admins: ['buyer@example.com'],
      members: []
    })

    expect(() => setActiveCompanyForUser(database, {
      userId: 'outsider-user',
      companyId: company.id
    })).toThrow(CompanyValidationError)
    database.close()
  })
})

function seedUser(database: Awaited<ReturnType<typeof initializeDatabase>>, userId: string, contacts: string[]): void {
  database.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, '2026-06-10T10:00:00.000Z')
  contacts.forEach((contact, index) => {
    database
      .prepare('INSERT INTO user_identities (id, user_id, channel, contact, verified_at) VALUES (?, ?, ?, ?, ?)')
      .run(`${userId}-identity-${index}`, userId, 'email', contact, '2026-06-10T10:00:00.000Z')
  })
}
