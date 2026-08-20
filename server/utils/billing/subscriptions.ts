import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { QuotaSubject } from '../quota/policy'
import {
  CompanyValidationError,
  createCompany,
  getActiveCompanyForUser,
  getCompanyByNif,
  getCorporateSubscription,
  listCompanyMemberships,
  listUserCompanies,
  replaceCompanyMemberships,
  updateCompany,
  upsertCorporateSubscription,
  type CompanyMembershipRecord,
  type UserCompanyRecord
} from '../companies/repository'
import { createMockCheckoutDetails } from './providers/mock'

export type BillingProvider = 'appy_pay' | 'stripe'
export type BillingPaymentMethod = 'multicaixa_express' | 'multicaixa_reference' | 'qr_code' | 'visa'
export type BillingPaymentStatus = 'pending' | 'confirmed' | 'failed'
export type BillingWebhookResult = 'confirmed' | 'duplicate' | 'already_confirmed' | 'ignored'

export interface BillingPlan {
  id: string
  name: string
  amount: {
    value: string
    cents: number
    currency: 'AOA'
  }
  intervalMonths: number
}

export interface BillingCheckoutPayload {
  id: string
  provider: BillingProvider
  method: BillingPaymentMethod
  status: BillingPaymentStatus
  amount: {
    value: string
    currency: 'AOA'
  }
  checkoutUrl: string
  providerReference: string
  instructions: string
  createdAt: string
}

export interface BillingSubscriptionPayload {
  active: boolean
  planId: string
  currentPeriodStart: string
  currentPeriodEnd: string
  expiresAt: string
}

export interface CorporateBillingCompanyPayload {
  id: string
  nif: string
  name: string
  role: 'admin' | 'member'
  seats: number
  active: boolean
  expiresAt: string
}

export interface CorporateBillingStatusPayload {
  subscribed: boolean
  companies: CorporateBillingCompanyPayload[]
  activeCompany: CorporateBillingCompanyPayload | null
}

export interface BillingStatusPayload {
  authenticated: boolean
  subscribed: boolean
  plan: BillingPlan
  subscription: BillingSubscriptionPayload | null
  corporate: CorporateBillingStatusPayload
  expiryWarning: {
    message: string
    expiresAt: string
    daysRemaining: number
  } | null
  ads: {
    visible: boolean
  }
}

export interface CorporateCheckoutPayload {
  checkout: BillingCheckoutPayload
  company: {
    id: string
    nif: string
    name: string
    phone: string
    address: string
  }
  subscription: BillingSubscriptionPayload & { seats: number }
  memberships: Array<Pick<CompanyMembershipRecord, 'email' | 'role' | 'userId'>>
}

export interface BillingWebhookProcessingResult {
  result: BillingWebhookResult
  paymentId?: string
  subscription: BillingSubscriptionPayload | null
}

export class BillingValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'BillingValidationError'
  }
}

export const QUARTERLY_PLAN: BillingPlan = {
  id: 'quarterly-public',
  name: 'Subscrição trimestral',
  amount: {
    value: '50000.00',
    cents: 5_000_000,
    currency: 'AOA'
  },
  intervalMonths: 3
}

export const CORPORATE_QUARTERLY_PLAN: BillingPlan = {
  id: 'corporate-quarterly-user',
  name: 'Subscrição corporativa trimestral por utilizador',
  amount: {
    value: '35000.00',
    cents: 3_500_000,
    currency: 'AOA'
  },
  intervalMonths: 3
}

const EXPIRY_WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const EXPIRY_WARNING_MESSAGE = 'A sua subscrição termina em menos de uma semana.'

const PROVIDER_METHODS: Record<BillingProvider, BillingPaymentMethod[]> = {
  appy_pay: ['multicaixa_express', 'multicaixa_reference', 'qr_code'],
  stripe: ['visa']
}

export function createBillingCheckout(
  database: DatabaseSync,
  input: {
    userId: string
    provider: BillingProvider
    method: BillingPaymentMethod
    now?: Date
  }
): BillingCheckoutPayload {
  assertSupportedProviderMethod(input.provider, input.method)

  const now = input.now ?? new Date()
  const paymentId = randomUUID()
  const checkout = createMockCheckoutDetails({ paymentId, provider: input.provider, method: input.method })

  database
    .prepare(`
      INSERT INTO billing_payments (
        id,
        user_id,
        provider,
        method,
        plan_id,
        amount_cents,
        currency,
        status,
        provider_reference,
        checkout_url,
        created_at,
        confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL)
    `)
    .run(
      paymentId,
      input.userId,
      input.provider,
      input.method,
      QUARTERLY_PLAN.id,
      QUARTERLY_PLAN.amount.cents,
      QUARTERLY_PLAN.amount.currency,
      checkout.providerReference,
      checkout.checkoutUrl,
      now.toISOString()
    )

  return {
    id: paymentId,
    provider: input.provider,
    method: input.method,
    status: 'pending',
    amount: {
      value: QUARTERLY_PLAN.amount.value,
      currency: QUARTERLY_PLAN.amount.currency
    },
    checkoutUrl: checkout.checkoutUrl,
    providerReference: checkout.providerReference,
    instructions: checkout.instructions,
    createdAt: now.toISOString()
  }
}

export function createCorporateBillingCheckout(
  database: DatabaseSync,
  input: {
    userId: string
    company: { nif: string; name: string; phone: string; address: string }
    seats: number
    adminEmails?: string[]
    memberEmails?: string[]
    now?: Date
  }
): CorporateCheckoutPayload {
  const now = input.now ?? new Date()
  const buyerEmail = getPrimaryVerifiedEmail(database, input.userId)
  if (!buyerEmail) {
    throw new BillingValidationError('VERIFIED_EMAIL_REQUIRED', 'A verified email is required for corporate checkout.')
  }

  const seats = readPositiveSeats(input.seats)
  const paymentId = randomUUID()
  const amountCents = CORPORATE_QUARTERLY_PLAN.amount.cents * seats
  const providerReference = `mock-corporate-${paymentId}`

  const boundCompany = getCompanyByNif(database, input.company.nif)
  if (boundCompany && !isCompanyAdminEmail(database, boundCompany.id, buyerEmail)) {
    throw new BillingValidationError(
      'COMPANY_ADMIN_REQUIRED',
      'Only an administrator of the company registered with this NIF can renew its subscription.'
    )
  }

  database.exec('BEGIN')
  try {
    const existingCompany = boundCompany
    const company = existingCompany
      ? updateCompany(database, existingCompany.id, { ...input.company, now })
      : createCompany(database, { ...input.company, now })
    const existingSubscription = getCorporateSubscription(database, company.id)
    const baseDate = existingSubscription && new Date(existingSubscription.currentPeriodEnd).getTime() > now.getTime()
      ? new Date(existingSubscription.currentPeriodEnd)
      : now
    const periodStart = existingSubscription && new Date(existingSubscription.currentPeriodEnd).getTime() > now.getTime()
      ? existingSubscription.currentPeriodStart
      : now.toISOString()
    const nextExpiry = addUtcMonths(baseDate, CORPORATE_QUARTERLY_PLAN.intervalMonths)

    database
      .prepare(`
        INSERT INTO billing_payments (
          id,
          user_id,
          provider,
          method,
          plan_id,
          amount_cents,
          currency,
          status,
          provider_reference,
          checkout_url,
          created_at,
          confirmed_at
        ) VALUES (?, ?, 'appy_pay', 'multicaixa_reference', ?, ?, ?, 'confirmed', ?, ?, ?, ?)
      `)
      .run(
        paymentId,
        input.userId,
        CORPORATE_QUARTERLY_PLAN.id,
        amountCents,
        CORPORATE_QUARTERLY_PLAN.amount.currency,
        providerReference,
        `mock://billing/corporate/${paymentId}`,
        now.toISOString(),
        now.toISOString()
      )

    const subscription = upsertCorporateSubscription(database, {
      companyId: company.id,
      seats,
      currentPeriodStart: periodStart,
      currentPeriodEnd: nextExpiry.toISOString(),
      lastPaymentId: paymentId,
      now
    })
    const memberships = replaceCompanyMemberships(database, {
      companyId: company.id,
      admins: [buyerEmail, ...(input.adminEmails ?? [])],
      members: input.memberEmails ?? [],
      now,
      transaction: false
    })
    database.exec('COMMIT')

    return {
      checkout: {
        id: paymentId,
        provider: 'appy_pay',
        method: 'multicaixa_reference',
        status: 'confirmed',
        amount: { value: formatCents(amountCents), currency: CORPORATE_QUARTERLY_PLAN.amount.currency },
        checkoutUrl: `mock://billing/corporate/${paymentId}`,
        providerReference,
        instructions: 'Pagamento simulado confirmado. A subscrição corporativa está activa.',
        createdAt: now.toISOString()
      },
      company: {
        id: company.id,
        nif: company.nif,
        name: company.name,
        phone: company.phone,
        address: company.address
      },
      subscription: {
        active: true,
        seats: subscription.seats,
        planId: subscription.planId,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        expiresAt: subscription.currentPeriodEnd
      },
      memberships: memberships.map((membership) => ({
        email: membership.email,
        role: membership.role,
        userId: membership.userId
      }))
    }
  } catch (error) {
    database.exec('ROLLBACK')
    if (error instanceof CompanyValidationError) {
      throw new BillingValidationError(error.code, error.message)
    }
    throw error
  }
}

export function processBillingWebhookEvent(
  database: DatabaseSync,
  input: {
    provider: BillingProvider
    eventId: string
    paymentId: string
    status: BillingPaymentStatus
    receivedAt?: Date
  }
): BillingWebhookProcessingResult {
  assertProvider(input.provider)
  assertWebhookEventInput(input)

  const receivedAt = input.receivedAt ?? new Date()

  database.exec('BEGIN')
  try {
    const existingEvent = getBillingProviderEvent(database, input.provider, input.eventId)
    if (existingEvent) {
      const subscription = existingEvent.payment_id
        ? getSubscriptionForPayment(database, existingEvent.payment_id, receivedAt)
        : null
      database.exec('COMMIT')
      return {
        result: 'duplicate',
        ...(existingEvent.payment_id ? { paymentId: existingEvent.payment_id } : {}),
        subscription
      }
    }

    const payment = getBillingPayment(database, input.provider, input.paymentId)
    if (!payment) {
      insertBillingProviderEvent(database, {
        provider: input.provider,
        eventId: input.eventId,
        paymentId: input.paymentId,
        eventType: input.status,
        receivedAt,
        result: 'ignored_unknown_payment',
        payload: input
      })
      database.exec('COMMIT')
      return { result: 'ignored', paymentId: input.paymentId, subscription: null }
    }

    if (payment.status === 'confirmed') {
      insertBillingProviderEvent(database, {
        provider: input.provider,
        eventId: input.eventId,
        paymentId: payment.id,
        eventType: input.status,
        receivedAt,
        result: 'already_confirmed',
        payload: input
      })
      const subscription = getBillingStatus(database, { userId: payment.user_id, now: receivedAt }).subscription
      database.exec('COMMIT')
      return { result: 'already_confirmed', paymentId: payment.id, subscription }
    }

    if (input.status !== 'confirmed') {
      database
        .prepare("UPDATE billing_payments SET status = 'failed' WHERE id = ? AND status = 'pending'")
        .run(payment.id)
      insertBillingProviderEvent(database, {
        provider: input.provider,
        eventId: input.eventId,
        paymentId: payment.id,
        eventType: input.status,
        receivedAt,
        result: 'ignored_unconfirmed_status',
        payload: input
      })
      database.exec('COMMIT')
      return { result: 'ignored', paymentId: payment.id, subscription: null }
    }

    database
      .prepare("UPDATE billing_payments SET status = 'confirmed', confirmed_at = ? WHERE id = ?")
      .run(receivedAt.toISOString(), payment.id)

    const subscription = activateQuarterlySubscription(database, {
      userId: payment.user_id,
      paymentId: payment.id,
      now: receivedAt
    })

    insertBillingProviderEvent(database, {
      provider: input.provider,
      eventId: input.eventId,
      paymentId: payment.id,
      eventType: input.status,
      receivedAt,
      result: 'confirmed',
      payload: input
    })

    database.exec('COMMIT')
    return { result: 'confirmed', paymentId: payment.id, subscription }
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

export function getBillingStatus(
  database: DatabaseSync,
  input: { userId?: string; now?: Date } = {}
): BillingStatusPayload {
  if (!input.userId) {
    return buildUnauthenticatedBillingStatus()
  }

  const now = input.now ?? new Date()
  const row = getSubscriptionRow(database, input.userId)
  const subscription = row ? toSubscriptionPayload(row, now) : null
  const subscribed = Boolean(subscription?.active)
  const corporate = buildCorporateBillingStatus(database, input.userId, now)

  return {
    authenticated: true,
    subscribed,
    plan: QUARTERLY_PLAN,
    subscription,
    corporate,
    expiryWarning: subscribed && subscription ? buildExpiryWarning(subscription, now) : null,
    ads: { visible: !(subscribed || corporate.subscribed) }
  }
}

export function resolveQuotaSubjectWithSubscription(
  database: DatabaseSync,
  subject: QuotaSubject,
  options: { now?: Date } = {}
): QuotaSubject {
  if (subject.type !== 'registered') {
    return subject
  }

  const status = getBillingStatus(database, { userId: subject.id, now: options.now })
  return status.subscribed ? { type: 'subscribed', id: subject.id } : subject
}

export function getTrustedBillingProviderEventCount(database: DatabaseSync): number {
  const row = database.prepare('SELECT COUNT(*) AS count FROM billing_provider_events').get() as { count: number }
  return row.count
}

export function parseBillingProvider(value: unknown): BillingProvider | undefined {
  return value === 'appy_pay' || value === 'stripe' ? value : undefined
}

export function parseBillingPaymentMethod(value: unknown): BillingPaymentMethod | undefined {
  return value === 'multicaixa_express' ||
    value === 'multicaixa_reference' ||
    value === 'qr_code' ||
    value === 'visa'
    ? value
    : undefined
}

export function assertSupportedProviderMethod(provider: BillingProvider, method: BillingPaymentMethod): void {
  assertProvider(provider)
  if (!PROVIDER_METHODS[provider].includes(method)) {
    throw new BillingValidationError('UNSUPPORTED_PAYMENT_METHOD', 'Payment method is not supported by provider.')
  }
}

function buildCorporateBillingStatus(
  database: DatabaseSync,
  userId: string,
  now: Date
): CorporateBillingStatusPayload {
  const companies = listUserCompanies(database, userId, { now }).map(toCorporateBillingCompanyPayload)
  const activeCompany = getActiveCompanyForUser(database, userId)
  const activePayload = activeCompany ? toCorporateBillingCompanyPayload(activeCompany) : null

  return {
    subscribed: companies.some((company) => company.active),
    companies,
    activeCompany: activePayload?.active ? activePayload : null
  }
}

function toCorporateBillingCompanyPayload(company: UserCompanyRecord): CorporateBillingCompanyPayload {
  return {
    id: company.id,
    nif: company.nif,
    name: company.name,
    role: company.role,
    seats: company.seats,
    active: company.active,
    expiresAt: company.currentPeriodEnd
  }
}

function getPrimaryVerifiedEmail(database: DatabaseSync, userId: string): string | undefined {
  const row = database
    .prepare("SELECT contact FROM user_identities WHERE user_id = ? AND channel = 'email' ORDER BY verified_at ASC LIMIT 1")
    .get(userId) as { contact: string } | undefined

  return row?.contact.trim().toLowerCase()
}

function isCompanyAdminEmail(database: DatabaseSync, companyId: string, email: string): boolean {
  return listCompanyMemberships(database, companyId).some(
    (membership) => membership.role === 'admin' && membership.email === email
  )
}

function readPositiveSeats(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BillingValidationError('INVALID_CORPORATE_SEATS', 'Corporate seats must be a positive integer.')
  }

  return value
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

function activateQuarterlySubscription(
  database: DatabaseSync,
  input: { userId: string; paymentId: string; now: Date }
): BillingSubscriptionPayload {
  const existing = getSubscriptionRow(database, input.userId)
  const baseDate = existing && new Date(existing.current_period_end).getTime() > input.now.getTime()
    ? new Date(existing.current_period_end)
    : input.now
  const nextExpiry = addUtcMonths(baseDate, QUARTERLY_PLAN.intervalMonths)
  const periodStart = existing && new Date(existing.current_period_end).getTime() > input.now.getTime()
    ? existing.current_period_start
    : input.now.toISOString()

  if (existing) {
    database
      .prepare(`
        UPDATE billing_subscriptions
        SET current_period_start = ?,
            current_period_end = ?,
            updated_at = ?,
            last_payment_id = ?
        WHERE user_id = ?
      `)
      .run(periodStart, nextExpiry.toISOString(), input.now.toISOString(), input.paymentId, input.userId)
  } else {
    database
      .prepare(`
        INSERT INTO billing_subscriptions (
          id,
          user_id,
          plan_id,
          current_period_start,
          current_period_end,
          created_at,
          updated_at,
          last_payment_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        input.userId,
        QUARTERLY_PLAN.id,
        periodStart,
        nextExpiry.toISOString(),
        input.now.toISOString(),
        input.now.toISOString(),
        input.paymentId
      )
  }

  return {
    active: true,
    planId: QUARTERLY_PLAN.id,
    currentPeriodStart: periodStart,
    currentPeriodEnd: nextExpiry.toISOString(),
    expiresAt: nextExpiry.toISOString()
  }
}

function buildUnauthenticatedBillingStatus(): BillingStatusPayload {
  return {
    authenticated: false,
    subscribed: false,
    plan: QUARTERLY_PLAN,
    subscription: null,
    corporate: { subscribed: false, companies: [], activeCompany: null },
    expiryWarning: null,
    ads: { visible: true }
  }
}

function buildExpiryWarning(
  subscription: BillingSubscriptionPayload,
  now: Date
): BillingStatusPayload['expiryWarning'] {
  const remainingMs = new Date(subscription.expiresAt).getTime() - now.getTime()
  if (remainingMs <= 0 || remainingMs >= EXPIRY_WARNING_WINDOW_MS) {
    return null
  }

  return {
    message: EXPIRY_WARNING_MESSAGE,
    expiresAt: subscription.expiresAt,
    daysRemaining: Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
  }
}

function toSubscriptionPayload(row: BillingSubscriptionRow, now: Date): BillingSubscriptionPayload {
  const active = new Date(row.current_period_end).getTime() > now.getTime()
  return {
    active,
    planId: row.plan_id,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    expiresAt: row.current_period_end
  }
}

function getSubscriptionForPayment(
  database: DatabaseSync,
  paymentId: string,
  now: Date
): BillingSubscriptionPayload | null {
  const payment = database
    .prepare('SELECT user_id FROM billing_payments WHERE id = ?')
    .get(paymentId) as { user_id: string } | undefined

  return payment ? getBillingStatus(database, { userId: payment.user_id, now }).subscription : null
}

function getSubscriptionRow(database: DatabaseSync, userId: string): BillingSubscriptionRow | undefined {
  return database
    .prepare(`
      SELECT id, user_id, plan_id, current_period_start, current_period_end, created_at, updated_at, last_payment_id
      FROM billing_subscriptions
      WHERE user_id = ?
    `)
    .get(userId) as BillingSubscriptionRow | undefined
}

function getBillingPayment(
  database: DatabaseSync,
  provider: BillingProvider,
  paymentId: string
): BillingPaymentRow | undefined {
  return database
    .prepare(`
      SELECT id, user_id, provider, method, plan_id, amount_cents, currency, status, provider_reference, checkout_url, created_at, confirmed_at
      FROM billing_payments
      WHERE provider = ? AND id = ?
    `)
    .get(provider, paymentId) as BillingPaymentRow | undefined
}

function getBillingProviderEvent(
  database: DatabaseSync,
  provider: BillingProvider,
  eventId: string
): BillingProviderEventRow | undefined {
  return database
    .prepare(`
      SELECT id, provider, event_id, payment_id, event_type, received_at, result, payload_json
      FROM billing_provider_events
      WHERE provider = ? AND event_id = ?
    `)
    .get(provider, eventId) as BillingProviderEventRow | undefined
}

function insertBillingProviderEvent(
  database: DatabaseSync,
  input: {
    provider: BillingProvider
    eventId: string
    paymentId: string
    eventType: string
    receivedAt: Date
    result: string
    payload: unknown
  }
): void {
  database
    .prepare(`
      INSERT INTO billing_provider_events (
        id,
        provider,
        event_id,
        payment_id,
        event_type,
        received_at,
        result,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      input.provider,
      input.eventId,
      input.paymentId,
      input.eventType,
      input.receivedAt.toISOString(),
      input.result,
      JSON.stringify(input.payload)
    )
}

function assertProvider(provider: BillingProvider): void {
  if (!parseBillingProvider(provider)) {
    throw new BillingValidationError('INVALID_PAYMENT_PROVIDER', 'Invalid payment provider.')
  }
}

function assertWebhookEventInput(input: { eventId: string; paymentId: string; status: string }): void {
  if (!input.eventId.trim() || input.eventId.length > 200) {
    throw new BillingValidationError('INVALID_PROVIDER_EVENT', 'Invalid provider event id.')
  }

  if (!input.paymentId.trim() || input.paymentId.length > 200) {
    throw new BillingValidationError('INVALID_PROVIDER_EVENT', 'Invalid payment id.')
  }

  if (input.status !== 'confirmed' && input.status !== 'failed') {
    throw new BillingValidationError('INVALID_PROVIDER_EVENT', 'Invalid payment status.')
  }
}

function addUtcMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime())
  next.setUTCMonth(next.getUTCMonth() + months)
  return next
}

interface BillingPaymentRow {
  id: string
  user_id: string
  provider: BillingProvider
  method: BillingPaymentMethod
  plan_id: string
  amount_cents: number
  currency: string
  status: BillingPaymentStatus
  provider_reference: string
  checkout_url: string | null
  created_at: string
  confirmed_at: string | null
}

interface BillingProviderEventRow {
  id: string
  provider: BillingProvider
  event_id: string
  payment_id: string | null
  event_type: string
  received_at: string
  result: string
  payload_json: string
}

interface BillingSubscriptionRow {
  id: string
  user_id: string
  plan_id: string
  current_period_start: string
  current_period_end: string
  created_at: string
  updated_at: string
  last_payment_id: string
}
