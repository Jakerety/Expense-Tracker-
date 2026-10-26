import type { Budget, Category, Role, Transaction, User, Workspace } from '../types'
import { supabase } from './supabase'

const apiUrl = import.meta.env.DEV ? '' : import.meta.env.VITE_API_URL ?? ''

interface ApiRecord {
  id: string
  user_id?: string
  organization_id?: string | null
  category_id?: string | null
  transaction_type?: 'income' | 'expense'
  category_type?: 'income' | 'expense' | 'both'
  amount?: number | string
  currency?: string
  description?: string
  transaction_date?: string
  start_date?: string
  full_name?: string
  preferred_currency?: string
  name?: string
  type?: 'income' | 'expense' | 'both'
  is_default?: boolean
  created_at?: string
}

export interface AppBootstrap {
  user: User
  defaultWorkspaceId: string
  workspaces: Workspace[]
  workspaceRoles: Record<string, string>
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
}

export interface StatementPreviewRow {
  transactionDate: string
  description: string
  amount: number
  type: 'income' | 'expense'
  categoryId: string
  isDuplicate: boolean
  autoCategorized: boolean
}

export interface StatementImportResult {
  total: number
  new: number
  duplicates: number
  categorized: number
  uncategorized: number
  transactions: Transaction[]
}

export interface AdminMember {
  user_id: string
  email: string
  full_name: string
  role: Role
  created_at: string
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Your session has expired. Sign in again to continue.')

  const sendRequest = async (accessToken: string) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    if (init.body) headers.set('Content-Type', 'application/json')

    try {
      return await fetch(`${apiUrl}${path}`, { ...init, headers })
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('Could not connect to the Expense Tracker API. Start the app with npm run dev and check that the API service is available.')
      }
      throw error
    }
  }

  let response = await sendRequest(session.access_token)
  let body: { detail?: string } | null = null
  if (response.status === 401) {
    body = await response.json().catch(() => null) as { detail?: string } | null
    if (body?.detail === 'The access token is invalid or expired') {
      const { data, error } = await supabase.auth.refreshSession()
      if (error || !data.session) throw new Error('Your session has expired. Sign in again to continue.')
      response = await sendRequest(data.session.access_token)
      body = null
    }
  }

  if (!response.ok) {
    body ??= await response.json().catch(() => null) as { detail?: string } | null
    if (body?.detail) throw new Error(body.detail)
    if (response.status >= 500) {
      throw new Error(`The Expense Tracker API returned an internal server error (${response.status}). Check the API terminal for details.`)
    }
    throw new Error(`Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

const toTransaction = (row: ApiRecord): Transaction => ({
  id: row.id,
  workspaceId: row.organization_id ?? 'personal',
  userId: row.user_id ?? '',
  categoryId: row.category_id ?? '',
  type: row.transaction_type ?? 'expense',
  amount: Number(row.amount ?? 0),
  currency: row.currency ?? 'NGN',
  description: row.description ?? '',
  transactionDate: row.transaction_date ?? '',
  createdAt: row.created_at ?? '',
})

const toBudget = (row: ApiRecord): Budget => ({
  id: row.id,
  workspaceId: row.organization_id ?? 'personal',
  categoryId: row.category_id,
  amount: Number(row.amount ?? 0),
  currency: row.currency ?? 'NGN',
  period: 'monthly',
  startDate: row.start_date ?? '',
})

const toCategory = (row: ApiRecord): Category => ({
  id: row.id,
  name: row.name ?? 'Category',
  type: row.category_type ?? row.type ?? 'both',
  workspaceId: row.organization_id ?? 'personal',
  ownerUserId: row.user_id,
  isDefault: row.is_default,
})

const getDisplayName = (user: { user_metadata?: Record<string, unknown>; email?: string } | null | undefined) => {
  const suppliedName = String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? '').trim()
  if (suppliedName) return suppliedName
  const emailName = user?.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  return emailName ? emailName.replace(/\b\w/g, (letter) => letter.toUpperCase()) : ''
}

export async function loadAppBootstrap(): Promise<AppBootstrap> {
  const payload = await request<{
    profile: ApiRecord | null
    email: string
    default_workspace_id: string
    organizations: { role: string; organizations: { id: string; name: string; currency: string } | null }[]
    categories: ApiRecord[]
    transactions: ApiRecord[]
    budgets: ApiRecord[]
  }>('/api/bootstrap')

  const authUser = supabase ? (await supabase.auth.getSession()).data.session?.user : null
  const currency = payload.profile?.preferred_currency ?? 'NGN'
  const organizations = payload.organizations.flatMap((membership) => membership.organizations ? [{
    id: membership.organizations.id,
    name: membership.organizations.name,
    type: 'organization' as const,
    currency: membership.organizations.currency,
  }] : [])
  return {
    user: {
      id: payload.profile?.id ?? authUser?.id ?? '',
      name: payload.profile?.full_name?.trim() || getDisplayName(authUser),
      email: payload.email || authUser?.email || '',
      preferredCurrency: currency,
    },
    defaultWorkspaceId: payload.default_workspace_id,
    workspaces: [{ id: 'personal', name: 'Personal workspace', type: 'personal', currency }, ...organizations],
      workspaceRoles: Object.fromEntries(payload.organizations.flatMap((membership) => membership.organizations ? [[membership.organizations.id, membership.role]] : [])),
    categories: payload.categories.map(toCategory),
    transactions: payload.transactions.map(toTransaction),
    budgets: payload.budgets.map(toBudget),
  }
}

export async function listCategories(workspaceId: string): Promise<Category[]> {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  const rows = await request<ApiRecord[]>(`/api/categories?${params}`)
  return rows.map(toCategory)
}

export async function createTransaction(workspaceId: string, transaction: Omit<Transaction, 'id' | 'createdAt'>): Promise<Transaction> {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  const row = await request<ApiRecord>(`/api/transactions?${params}`, {
    method: 'POST',
    body: JSON.stringify({
      category_id: transaction.categoryId || null,
      transaction_type: transaction.type,
      amount: transaction.amount,
      currency: transaction.currency,
      description: transaction.description,
      transaction_date: transaction.transactionDate,
    }),
  })
  return toTransaction(row)
}

function statementRowsBody(transactions: Omit<Transaction, 'id' | 'createdAt'>[]) {
  return {
    transactions: transactions.map((transaction) => ({
      category_id: transaction.categoryId || null,
      transaction_type: transaction.type,
      amount: transaction.amount,
      currency: transaction.currency,
      description: transaction.description,
      transaction_date: transaction.transactionDate,
    })),
  }
}

export async function previewStatementImport(
  workspaceId: string,
  transactions: Omit<Transaction, 'id' | 'createdAt'>[],
): Promise<StatementPreviewRow[]> {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  const response = await request<{
    transactions: {
      transaction_date: string
      description: string
      amount: number | string
      transaction_type: 'income' | 'expense'
      category_id: string | null
      is_duplicate: boolean
      auto_categorized: boolean
    }[]
  }>(`/api/transactions/import/preview?${params}`, {
    method: 'POST',
    body: JSON.stringify(statementRowsBody(transactions)),
  })
  return response.transactions.map((row) => ({
    transactionDate: row.transaction_date,
    description: row.description,
    amount: Number(row.amount),
    type: row.transaction_type,
    categoryId: row.category_id ?? '',
    isDuplicate: row.is_duplicate,
    autoCategorized: row.auto_categorized,
  }))
}

export async function importTransactions(
  workspaceId: string,
  transactions: Omit<Transaction, 'id' | 'createdAt'>[],
): Promise<StatementImportResult> {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  const response = await request<{
    total: number
    new: number
    duplicates: number
    categorized: number
    uncategorized: number
    transactions: ApiRecord[]
  }>(`/api/transactions/import?${params}`, {
    method: 'POST',
    body: JSON.stringify(statementRowsBody(transactions)),
  })
  return {
    total: response.total,
    new: response.new,
    duplicates: response.duplicates,
    categorized: response.categorized,
    uncategorized: response.uncategorized,
    transactions: response.transactions.map(toTransaction),
  }
}

export async function updateTransactionCategory(id: string, categoryId: string): Promise<Transaction> {
  const row = await request<ApiRecord>(`/api/transactions/${id}/category`, {
    method: 'PATCH',
    body: JSON.stringify({ category_id: categoryId || null }),
  })
  return toTransaction(row)
}

export async function categorizeUncategorizedTransactions(workspaceId: string): Promise<Transaction[]> {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  const rows = await request<ApiRecord[]>(`/api/transactions/categorize-uncategorized?${params}`, {
    method: 'POST',
  })
  return rows.map(toTransaction)
}

export async function updateTransaction(id: string, transaction: Omit<Transaction, 'id' | 'createdAt'>): Promise<Transaction> {
  const row = await request<ApiRecord>(`/api/transactions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      category_id: transaction.categoryId || null,
      transaction_type: transaction.type,
      amount: transaction.amount,
      currency: transaction.currency,
      description: transaction.description,
      transaction_date: transaction.transactionDate,
    }),
  })
  return toTransaction(row)
}

export async function deleteTransaction(id: string): Promise<void> {
  await request<void>(`/api/transactions/${id}`, { method: 'DELETE' })
}

export async function createBudget(workspaceId: string, budget: Omit<Budget, 'id'>): Promise<Budget> {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  const row = await request<ApiRecord>(`/api/budgets?${params}`, {
    method: 'POST',
    body: JSON.stringify({ category_id: budget.categoryId, amount: budget.amount, currency: budget.currency, start_date: budget.startDate }),
  })
  return toBudget(row)
}

export async function updateProfile(profile: Pick<User, 'name' | 'preferredCurrency'>): Promise<void> {
  await request('/api/profile', {
    method: 'PATCH',
    body: JSON.stringify({ full_name: profile.name, preferred_currency: profile.preferredCurrency }),
  })
}

export interface SupportTicketRecord {
  id: string
  requesterId: string
  subject: string
  status: 'open' | 'in_progress' | 'resolved'
  organizationId: string | null
  createdAt: string
}

export interface SupportMessageRecord {
  id: string
  ticketId: string
  senderId: string
  body: string
  createdAt: string
}

const toSupportTicket = (row: { id: string; requester_id: string; subject: string; status: SupportTicketRecord['status']; organization_id: string | null; created_at: string }): SupportTicketRecord => ({
  id: row.id,
  requesterId: row.requester_id,
  subject: row.subject,
  status: row.status,
  organizationId: row.organization_id,
  createdAt: row.created_at,
})

const toSupportMessage = (row: { id: string; ticket_id: string; sender_id: string; body: string; created_at: string }): SupportMessageRecord => ({
  id: row.id,
  ticketId: row.ticket_id,
  senderId: row.sender_id,
  body: row.body,
  createdAt: row.created_at,
})

export async function fetchAdminOverview(organizationId: string) {
  const params = new URLSearchParams({ organization_id: organizationId })
  return request<{
    member_count: number
    transaction_count: number
    budget_count: number
    income: string
    expenses: string
    net: string
    recent_transactions: { id: string; transaction_type: 'income' | 'expense'; amount: string; description: string; transaction_date: string }[]
  }>(`/api/admin/overview?${params}`)
}

export async function fetchOrganizationMembers(organizationId: string): Promise<AdminMember[]> {
  const params = new URLSearchParams({ organization_id: organizationId })
  return request<AdminMember[]>(`/api/admin/members?${params}`)
}

export async function inviteOrganizationMember(organizationId: string, email: string, role: Exclude<Role, 'owner'>): Promise<AdminMember & { invitation_sent?: boolean }> {
  const params = new URLSearchParams({ organization_id: organizationId })
  return request<AdminMember>(`/api/admin/members?${params}`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  })
}

export async function updateOrganizationMemberRole(organizationId: string, userId: string, role: Exclude<Role, 'owner'>): Promise<void> {
  const params = new URLSearchParams({ organization_id: organizationId })
  await request<void>(`/api/admin/members/${encodeURIComponent(userId)}?${params}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export async function removeOrganizationMember(organizationId: string, userId: string): Promise<void> {
  const params = new URLSearchParams({ organization_id: organizationId })
  await request<void>(`/api/admin/members/${encodeURIComponent(userId)}?${params}`, { method: 'DELETE' })
}

export async function createOrganization(name: string, currency: string): Promise<{ workspace: Workspace; categories: Category[] }> {
  const row = await request<{ id: string; name: string; currency: string }>('/api/organizations', {
    method: 'POST',
    body: JSON.stringify({ name, currency }),
  })
  const workspace = { id: row.id, name: row.name, currency: row.currency, type: 'organization' as const }
  const categories = await listCategories(workspace.id)
  return { workspace, categories }
}

export async function listSupportTickets(workspaceId: string): Promise<SupportTicketRecord[]> {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  const rows = await request<Parameters<typeof toSupportTicket>[0][]>(`/api/support/tickets?${params}`)
  return rows.map(toSupportTicket)
}

export async function getSupportAdminAccess(): Promise<boolean> {
  const response = await request<{ is_support_admin: boolean }>('/api/support/admin/access')
  return response.is_support_admin
}

export async function listSupportInboxTickets(): Promise<SupportTicketRecord[]> {
  const rows = await request<Parameters<typeof toSupportTicket>[0][]>('/api/support/admin/tickets')
  return rows.map(toSupportTicket)
}

export async function createSupportTicket(workspaceId: string, subject: string, message: string): Promise<SupportTicketRecord> {
  const params = new URLSearchParams({ workspace_id: workspaceId })
  const row = await request<Parameters<typeof toSupportTicket>[0]>(`/api/support/tickets?${params}`, {
    method: 'POST',
    body: JSON.stringify({ subject, message }),
  })
  return toSupportTicket(row)
}

export async function listSupportMessages(ticketId: string): Promise<SupportMessageRecord[]> {
  const rows = await request<Parameters<typeof toSupportMessage>[0][]>(`/api/support/tickets/${ticketId}/messages`)
  return rows.map(toSupportMessage)
}

export async function postSupportMessage(ticketId: string, message: string): Promise<SupportMessageRecord> {
  const row = await request<Parameters<typeof toSupportMessage>[0]>(`/api/support/tickets/${ticketId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
  return toSupportMessage(row)
}

export async function setSupportTicketStatus(ticketId: string, status: SupportTicketRecord['status']): Promise<void> {
  await request(`/api/support/tickets/${ticketId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}