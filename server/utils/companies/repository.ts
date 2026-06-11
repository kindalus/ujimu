import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type CompanyRole = 'admin' | 'member'

export interface CompanyRecord {
  id: string
  nif: string
  name: string
  phone: string
  address: string
  status: 'active' | 'suspended'
  createdAt: string
  updatedAt: string
}

export interface CorporateSubscriptionRecord {
  id: string
  companyId: string
  planId: string
  seats: number
  currentPeriodStart: string
  currentPeriodEnd: string
  createdAt: string
  updatedAt: string
  lastPaymentId: string | null
}

export interface CompanyMembershipRecord {
  id: string
  companyId: string
  email: string
  userId: string | null
  role: CompanyRole
  createdAt: string
  updatedAt: string
}

export interface UserCompanyRecord extends CompanyRecord {
  role: CompanyRole
  seats: number
  active: boolean
  currentPeriodEnd: string
}

export class CompanyValidationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_COMPANY_INPUT'
      | 'INVALID_COMPANY_EMAIL'
      | 'COMPANY_NOT_FOUND'
      | 'CORPORATE_SUBSCRIPTION_REQUIRED'
      | 'MEMBER_LIMIT_EXCEEDED'
      | 'COMPANY_ADMIN_REQUIRED'
      | 'USER_NOT_COMPANY_MEMBER',
    message: string
  ) {
    super(message)
    this.name = 'CompanyValidationError'
  }
}

const CORPORATE_PLAN_ID = 'corporate-quarterly-user'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function calculateEffectiveMemberLimit(seats: number): number {
  return Math.max(0, Math.floor(seats) + Math.floor(Math.floor(seats) * 0.10))
}

export function createCompany(
  database: DatabaseSync,
  input: { nif: string; name: string; phone: string; address: string; now?: Date }
): CompanyRecord {
  const now = (input.now ?? new Date()).toISOString()
  const company: CompanyRecord = {
    id: randomUUID(),
    nif: readRequiredString(input.nif, 'nif'),
    name: readRequiredString(input.name, 'name'),
    phone: readRequiredString(input.phone, 'phone'),
    address: readRequiredString(input.address, 'address'),
    status: 'active',
    createdAt: now,
    updatedAt: now
  }

  database
    .prepare(`
      INSERT INTO companies (id, nif, name, phone, address, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      company.id,
      company.nif,
      company.name,
      company.phone,
      company.address,
      company.status,
      company.createdAt,
      company.updatedAt
    )

  return company
}

export function upsertCorporateSubscription(
  database: DatabaseSync,
  input: {
    companyId: string
    seats: number
    currentPeriodStart: string
    currentPeriodEnd: string
    lastPaymentId?: string | null
    now?: Date
  }
): CorporateSubscriptionRecord {
  assertCompanyExists(database, input.companyId)
  const seats = readPositiveInteger(input.seats, 'seats')
  const now = (input.now ?? new Date()).toISOString()
  const existing = getCorporateSubscription(database, input.companyId)

  if (existing) {
    database
      .prepare(`
        UPDATE corporate_subscriptions
        SET seats = ?,
            current_period_start = ?,
            current_period_end = ?,
            updated_at = ?,
            last_payment_id = ?
        WHERE company_id = ?
      `)
      .run(
        seats,
        input.currentPeriodStart,
        input.currentPeriodEnd,
        now,
        input.lastPaymentId ?? existing.lastPaymentId,
        input.companyId
      )

    return {
      ...existing,
      seats,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      updatedAt: now,
      lastPaymentId: input.lastPaymentId ?? existing.lastPaymentId
    }
  }

  const subscription: CorporateSubscriptionRecord = {
    id: randomUUID(),
    companyId: input.companyId,
    planId: CORPORATE_PLAN_ID,
    seats,
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
    createdAt: now,
    updatedAt: now,
    lastPaymentId: input.lastPaymentId ?? null
  }

  database
    .prepare(`
      INSERT INTO corporate_subscriptions (
        id,
        company_id,
        plan_id,
        seats,
        current_period_start,
        current_period_end,
        created_at,
        updated_at,
        last_payment_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      subscription.id,
      subscription.companyId,
      subscription.planId,
      subscription.seats,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
      subscription.createdAt,
      subscription.updatedAt,
      subscription.lastPaymentId
    )

  return subscription
}

export function replaceCompanyMemberships(
  database: DatabaseSync,
  input: { companyId: string; admins: string[]; members: string[]; now?: Date; transaction?: boolean }
): CompanyMembershipRecord[] {
  assertCompanyExists(database, input.companyId)
  const subscription = getCorporateSubscription(database, input.companyId)
  if (!subscription) {
    throw new CompanyValidationError('CORPORATE_SUBSCRIPTION_REQUIRED', 'Company needs a corporate subscription before members can be configured.')
  }

  const desired = normalizeMembershipEmails(input.admins, input.members)
  if (!desired.some((entry) => entry.role === 'admin')) {
    throw new CompanyValidationError('COMPANY_ADMIN_REQUIRED', 'At least one company administrator is required.')
  }

  const effectiveLimit = calculateEffectiveMemberLimit(subscription.seats)
  if (desired.length > effectiveLimit) {
    throw new CompanyValidationError(
      'MEMBER_LIMIT_EXCEEDED',
      `Company subscription allows at most ${effectiveLimit} people.`
    )
  }

  const now = (input.now ?? new Date()).toISOString()
  const useTransaction = input.transaction !== false
  if (useTransaction) database.exec('BEGIN')
  try {
    database.prepare('DELETE FROM company_memberships WHERE company_id = ?').run(input.companyId)
    for (const entry of desired) {
      database
        .prepare(`
          INSERT INTO company_memberships (id, company_id, email, user_id, role, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          input.companyId,
          entry.email,
          findUserIdByVerifiedEmail(database, entry.email),
          entry.role,
          now,
          now
        )
    }
    if (useTransaction) database.exec('COMMIT')
  } catch (error) {
    if (useTransaction) database.exec('ROLLBACK')
    throw error
  }

  return listCompanyMemberships(database, input.companyId)
}

export function listUserCompanies(
  database: DatabaseSync,
  userId: string,
  options: { now?: Date } = {}
): UserCompanyRecord[] {
  const emails = getVerifiedEmailsForUser(database, userId)
  if (emails.length === 0) return []

  const rows = database
    .prepare(`
      SELECT
        c.id,
        c.nif,
        c.name,
        c.phone,
        c.address,
        c.status,
        c.created_at,
        c.updated_at,
        m.role,
        s.seats,
        s.current_period_end
      FROM company_memberships m
      JOIN companies c ON c.id = m.company_id
      JOIN corporate_subscriptions s ON s.company_id = c.id
      WHERE m.email IN (${emails.map(() => '?').join(',')})
      ORDER BY c.name ASC, c.id ASC, m.role ASC
    `)
    .all(...emails) as unknown as Array<CompanyJoinRow & { role: CompanyRole }>

  const nowMs = (options.now ?? new Date()).getTime()
  const byCompany = new Map<string, UserCompanyRecord>()
  for (const row of rows) {
    const existing = byCompany.get(row.id)
    if (existing) {
      if (row.role === 'admin') existing.role = 'admin'
      continue
    }

    byCompany.set(row.id, {
      id: row.id,
      nif: row.nif,
      name: row.name,
      phone: row.phone,
      address: row.address,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      role: row.role,
      seats: row.seats,
      currentPeriodEnd: row.current_period_end,
      active: row.status === 'active' && new Date(row.current_period_end).getTime() > nowMs
    })
  }

  return [...byCompany.values()]
}

export function setActiveCompanyForUser(
  database: DatabaseSync,
  input: { userId: string; companyId: string | null; now?: Date }
): void {
  const now = (input.now ?? new Date()).toISOString()
  if (!input.companyId) {
    database.prepare('DELETE FROM user_company_contexts WHERE user_id = ?').run(input.userId)
    return
  }

  const companies = listUserCompanies(database, input.userId)
  if (!companies.some((company) => company.id === input.companyId)) {
    throw new CompanyValidationError('USER_NOT_COMPANY_MEMBER', 'User does not belong to this company.')
  }

  database
    .prepare(`
      INSERT INTO user_company_contexts (user_id, active_company_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        active_company_id = excluded.active_company_id,
        updated_at = excluded.updated_at
    `)
    .run(input.userId, input.companyId, now)
}

export function getActiveCompanyForUser(database: DatabaseSync, userId: string): UserCompanyRecord | null {
  const row = database
    .prepare('SELECT active_company_id FROM user_company_contexts WHERE user_id = ?')
    .get(userId) as { active_company_id: string | null } | undefined
  if (!row?.active_company_id) return null

  return listUserCompanies(database, userId).find((company) => company.id === row.active_company_id) ?? null
}

export function updateCompany(
  database: DatabaseSync,
  companyId: string,
  input: { nif: string; name: string; phone: string; address: string; now?: Date }
): CompanyRecord {
  assertCompanyExists(database, companyId)
  const now = (input.now ?? new Date()).toISOString()
  database
    .prepare(`
      UPDATE companies
      SET nif = ?, name = ?, phone = ?, address = ?, updated_at = ?
      WHERE id = ?
    `)
    .run(
      readRequiredString(input.nif, 'nif'),
      readRequiredString(input.name, 'name'),
      readRequiredString(input.phone, 'phone'),
      readRequiredString(input.address, 'address'),
      now,
      companyId
    )

  return getCompany(database, companyId)!
}

export function getCompany(database: DatabaseSync, companyId: string): CompanyRecord | undefined {
  const row = database
    .prepare('SELECT id, nif, name, phone, address, status, created_at, updated_at FROM companies WHERE id = ?')
    .get(companyId) as CompanyRow | undefined
  return row ? toCompanyRecord(row) : undefined
}

export function getCompanyByNif(database: DatabaseSync, nif: string): CompanyRecord | undefined {
  const row = database
    .prepare('SELECT id, nif, name, phone, address, status, created_at, updated_at FROM companies WHERE nif = ?')
    .get(readRequiredString(nif, 'nif')) as CompanyRow | undefined
  return row ? toCompanyRecord(row) : undefined
}

export function getCorporateSubscription(
  database: DatabaseSync,
  companyId: string
): CorporateSubscriptionRecord | undefined {
  const row = database
    .prepare(`
      SELECT id, company_id, plan_id, seats, current_period_start, current_period_end, created_at, updated_at, last_payment_id
      FROM corporate_subscriptions
      WHERE company_id = ?
    `)
    .get(companyId) as CorporateSubscriptionRow | undefined

  return row ? toCorporateSubscriptionRecord(row) : undefined
}

export function listCompanyMemberships(database: DatabaseSync, companyId: string): CompanyMembershipRecord[] {
  return database
    .prepare(`
      SELECT id, company_id, email, user_id, role, created_at, updated_at
      FROM company_memberships
      WHERE company_id = ?
      ORDER BY email ASC
    `)
    .all(companyId)
    .map((row) => toCompanyMembershipRecord(row as unknown as CompanyMembershipRow))
}

function normalizeMembershipEmails(admins: string[], members: string[]): Array<{ email: string; role: CompanyRole }> {
  const byEmail = new Map<string, CompanyRole>()
  for (const email of members) {
    byEmail.set(normalizeCompanyEmail(email), 'member')
  }
  for (const email of admins) {
    byEmail.set(normalizeCompanyEmail(email), 'admin')
  }

  return [...byEmail.entries()]
    .map(([email, role]) => ({ email, role }))
    .sort((left, right) => left.email.localeCompare(right.email))
}

function normalizeCompanyEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    throw new CompanyValidationError('INVALID_COMPANY_EMAIL', `Invalid company email: ${value}`)
  }
  return email
}

function getVerifiedEmailsForUser(database: DatabaseSync, userId: string): string[] {
  return database
    .prepare("SELECT contact FROM user_identities WHERE user_id = ? AND channel = 'email' ORDER BY verified_at ASC")
    .all(userId)
    .map((row) => normalizeCompanyEmail((row as { contact: string }).contact))
}

function findUserIdByVerifiedEmail(database: DatabaseSync, email: string): string | null {
  const row = database
    .prepare("SELECT user_id FROM user_identities WHERE channel = 'email' AND lower(contact) = ? ORDER BY verified_at ASC LIMIT 1")
    .get(email) as { user_id: string } | undefined

  return row?.user_id ?? null
}

function assertCompanyExists(database: DatabaseSync, companyId: string): void {
  if (!getCompany(database, companyId)) {
    throw new CompanyValidationError('COMPANY_NOT_FOUND', 'Company was not found.')
  }
}

function readRequiredString(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new CompanyValidationError('INVALID_COMPANY_INPUT', `Invalid company field: ${field}`)
  }
  return trimmed
}

function readPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new CompanyValidationError('INVALID_COMPANY_INPUT', `Invalid positive integer field: ${field}`)
  }
  return value
}

function toCompanyRecord(row: CompanyRow): CompanyRecord {
  return {
    id: row.id,
    nif: row.nif,
    name: row.name,
    phone: row.phone,
    address: row.address,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toCorporateSubscriptionRecord(row: CorporateSubscriptionRow): CorporateSubscriptionRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    planId: row.plan_id,
    seats: row.seats,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPaymentId: row.last_payment_id
  }
}

function toCompanyMembershipRecord(row: CompanyMembershipRow): CompanyMembershipRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    email: row.email,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

interface CompanyRow {
  id: string
  nif: string
  name: string
  phone: string
  address: string
  status: 'active' | 'suspended'
  created_at: string
  updated_at: string
}

interface CorporateSubscriptionRow {
  id: string
  company_id: string
  plan_id: string
  seats: number
  current_period_start: string
  current_period_end: string
  created_at: string
  updated_at: string
  last_payment_id: string | null
}

interface CompanyMembershipRow {
  id: string
  company_id: string
  email: string
  user_id: string | null
  role: CompanyRole
  created_at: string
  updated_at: string
}

interface CompanyJoinRow extends CompanyRow {
  seats: number
  current_period_end: string
}
