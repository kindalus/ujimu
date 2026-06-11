import type { DatabaseSync } from 'node:sqlite'
import { getCompany, getCorporateSubscription, listCompanyMemberships } from '../companies/repository'
import { getCompanyQuotaUsage } from '../quota/usage'
import { getSpecialistRegistry } from '../specialists/registry'
import { toAdminSpecialistPayload, type AdminSpecialistPayload } from './specialists'

export interface AdminCompanySummaryPayload {
  id: string
  nif: string
  name: string
  phone: string
  address: string
  status: 'active' | 'suspended'
  seats: number
  active: boolean
  current_period_end: string | null
  admin_count: number
  member_count: number
  assigned_specialist_count: number
}

export interface AdminCompanyDetailPayload {
  company: {
    id: string
    nif: string
    name: string
    phone: string
    address: string
    status: 'active' | 'suspended'
  }
  subscription: {
    seats: number
    currentPeriodStart: string
    currentPeriodEnd: string
    active: boolean
  } | null
  admins: Array<{ email: string; userId: string | null }>
  members: Array<{ email: string; userId: string | null }>
  quota: ReturnType<typeof getCompanyQuotaUsage>
  specialists: AdminSpecialistPayload[]
}

interface AdminCompanySummaryRow {
  id: string
  nif: string
  name: string
  phone: string
  address: string
  status: 'active' | 'suspended'
  seats: number | null
  current_period_end: string | null
  admin_count: number
  member_count: number
}

export async function listAdminCompaniesPayload(
  database: DatabaseSync,
  options: { now?: Date } = {}
): Promise<AdminCompanySummaryPayload[]> {
  const assignedCounts = await getAssignedSpecialistCountsByCompany()
  const nowMs = (options.now ?? new Date()).getTime()
  const rows = database
    .prepare(`
      SELECT
        c.id,
        c.nif,
        c.name,
        c.phone,
        c.address,
        c.status,
        s.seats,
        s.current_period_end,
        SUM(CASE WHEN m.role = 'admin' THEN 1 ELSE 0 END) AS admin_count,
        SUM(CASE WHEN m.role = 'member' THEN 1 ELSE 0 END) AS member_count
      FROM companies c
      LEFT JOIN corporate_subscriptions s ON s.company_id = c.id
      LEFT JOIN company_memberships m ON m.company_id = c.id
      GROUP BY c.id, s.seats, s.current_period_end
      ORDER BY c.name ASC, c.id ASC
    `)
    .all() as unknown as AdminCompanySummaryRow[]

  return rows.map((row) => ({
    id: row.id,
    nif: row.nif,
    name: row.name,
    phone: row.phone,
    address: row.address,
    status: row.status,
    seats: row.seats ?? 0,
    active: row.status === 'active' && Boolean(row.current_period_end) && new Date(row.current_period_end!).getTime() > nowMs,
    current_period_end: row.current_period_end,
    admin_count: row.admin_count ?? 0,
    member_count: row.member_count ?? 0,
    assigned_specialist_count: assignedCounts.get(row.id) ?? 0
  }))
}

export async function getAdminCompanyDetailPayload(
  database: DatabaseSync,
  companyId: string,
  options: { now?: Date } = {}
): Promise<AdminCompanyDetailPayload | null> {
  const company = getCompany(database, companyId)
  if (!company) return null

  const nowMs = (options.now ?? new Date()).getTime()
  const subscription = getCorporateSubscription(database, companyId)
  const memberships = listCompanyMemberships(database, companyId)
  const snapshot = await getSpecialistRegistry()
  const specialists = await Promise.all(
    snapshot.specialists
      .filter((specialist) => specialist.company_id === companyId)
      .map(toAdminSpecialistPayload)
  )

  return {
    company: {
      id: company.id,
      nif: company.nif,
      name: company.name,
      phone: company.phone,
      address: company.address,
      status: company.status
    },
    subscription: subscription
      ? {
          seats: subscription.seats,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          active: company.status === 'active' && new Date(subscription.currentPeriodEnd).getTime() > nowMs
        }
      : null,
    admins: memberships
      .filter((membership) => membership.role === 'admin')
      .map((membership) => ({ email: membership.email, userId: membership.userId })),
    members: memberships
      .filter((membership) => membership.role === 'member')
      .map((membership) => ({ email: membership.email, userId: membership.userId })),
    quota: getCompanyQuotaUsage(database, { companyId }),
    specialists
  }
}

async function getAssignedSpecialistCountsByCompany(): Promise<Map<string, number>> {
  const snapshot = await getSpecialistRegistry()
  const counts = new Map<string, number>()
  for (const specialist of snapshot.specialists) {
    if (!specialist.company_id) continue
    counts.set(specialist.company_id, (counts.get(specialist.company_id) ?? 0) + 1)
  }
  return counts
}
