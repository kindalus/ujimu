import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { QuotaSubject } from '../quota/policy'
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

export interface BillingStatusPayload {
  authenticated: boolean
  subscribed: boolean
  plan: BillingPlan
  subscription: BillingSubscriptionPayload | null
  expiryWarning: {
    message: string
    expiresAt: string
    daysRemaining: number
  } | null
  ads: {
    visible: boolean
  }
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

  return {
    authenticated: true,
    subscribed,
    plan: QUARTERLY_PLAN,
    subscription,
    expiryWarning: subscribed && subscription ? buildExpiryWarning(subscription, now) : null,
    ads: { visible: !subscribed }
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
