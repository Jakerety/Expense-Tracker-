export type WorkspaceType = 'personal' | 'organization'
export type TransactionType = 'income' | 'expense'
export type CategoryType = 'income' | 'expense' | 'both'
export type Role = 'owner' | 'admin' | 'member'

export interface User {
  id: string
  name: string
  email: string
  preferredCurrency: string
}

export interface Workspace {
  id: string
  name: string
  type: WorkspaceType
  currency: string
  ownerId?: string
}

export interface Category {
  id: string
  name: string
  type: CategoryType
  workspaceId: string
  ownerUserId?: string | null
  isDefault?: boolean
}

export interface Transaction {
  id: string
  workspaceId: string
  userId: string
  categoryId: string
  type: TransactionType
  amount: number
  currency: string
  description: string
  transactionDate: string
  createdAt: string
}

export interface Budget {
  id: string
  workspaceId: string
  categoryId?: string | null
  amount: number
  currency: string
  period: 'monthly'
  startDate: string
}

export interface Membership {
  id: string
  workspaceId: string
  userId: string
  role: Role
}

export interface AppData {
  users: User[]
  workspaces: Workspace[]
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
  memberships: Membership[]
}

export interface SessionState {
  userId: string
  selectedWorkspaceId: string
}
