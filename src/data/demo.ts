import { format, startOfMonth, subDays } from 'date-fns'

import type { AppData, Category, Membership, User, Workspace } from '../types'

const today = new Date()
const demoDate = (daysAgo: number) => format(
  new Date(Math.max(startOfMonth(today).getTime(), subDays(today, daysAgo).getTime())),
  'yyyy-MM-dd',
)

export const generateId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `id-${Math.random().toString(36).slice(2, 11)}`
}

export const demoUser: User = {
  id: 'user-ada',
  name: 'Ada Okafor',
  email: 'ada@demo.example',
  preferredCurrency: 'NGN',
}

export const demoOrgWorkspace: Workspace = {
  id: 'workspace-org',
  name: 'Nexa Digital Ops',
  type: 'organization',
  currency: 'NGN',
  ownerId: demoUser.id,
}

export const demoPersonalWorkspace: Workspace = {
  id: 'workspace-personal',
  name: "Ada's Personal",
  type: 'personal',
  currency: 'NGN',
  ownerId: demoUser.id,
}

const defaultCategories: Category[] = [
  { id: 'cat-salary', name: 'Salary', type: 'income', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-freelance', name: 'Freelance', type: 'income', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-housing', name: 'Housing', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-food', name: 'Food & Dining', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-grocery', name: 'Groceries', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-clothing', name: 'Clothing', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-utilities', name: 'Utilities', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-transport', name: 'Transportation', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-bills', name: 'Bills', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-health', name: 'Health & wellness', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-entertainment', name: 'Entertainment', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-subscriptions', name: 'Subscriptions', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-personal-care', name: 'Personal care', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-other-expense', name: 'Other expenses', type: 'expense', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-other-income', name: 'Other income', type: 'income', workspaceId: 'workspace-personal', ownerUserId: demoUser.id, isDefault: true },
  { id: 'cat-revenue', name: 'Client Revenue', type: 'income', workspaceId: 'workspace-org', isDefault: true },
  { id: 'cat-operations', name: 'Operations', type: 'expense', workspaceId: 'workspace-org', isDefault: true },
  { id: 'cat-travel', name: 'Travel', type: 'expense', workspaceId: 'workspace-org', isDefault: true },
  { id: 'cat-software', name: 'Software', type: 'expense', workspaceId: 'workspace-org', isDefault: true },
  { id: 'cat-org-grocery', name: 'Meals & groceries', type: 'expense', workspaceId: 'workspace-org', isDefault: true },
  { id: 'cat-org-utilities', name: 'Utilities', type: 'expense', workspaceId: 'workspace-org', isDefault: true },
  { id: 'cat-org-marketing', name: 'Marketing', type: 'expense', workspaceId: 'workspace-org', isDefault: true },
  { id: 'cat-org-payroll', name: 'Payroll', type: 'expense', workspaceId: 'workspace-org', isDefault: true },
  { id: 'cat-org-other-expense', name: 'Other expenses', type: 'expense', workspaceId: 'workspace-org', isDefault: true },
  { id: 'cat-org-other-income', name: 'Other income', type: 'income', workspaceId: 'workspace-org', isDefault: true },
]

const demoMemberships: Membership[] = [
  { id: 'member-ada-org', workspaceId: 'workspace-org', userId: demoUser.id, role: 'owner' },
]

export const demoData: AppData = {
  users: [demoUser],
  workspaces: [demoPersonalWorkspace, demoOrgWorkspace],
  categories: defaultCategories,
  transactions: [
    {
      id: 'txn-1',
      workspaceId: 'workspace-personal',
      userId: demoUser.id,
      categoryId: 'cat-salary',
      type: 'income',
      amount: 500000,
      currency: 'NGN',
      description: 'Monthly salary',
      transactionDate: demoDate(4),
      createdAt: `${demoDate(4)}T08:00:00.000Z`,
    },
    {
      id: 'txn-2',
      workspaceId: 'workspace-personal',
      userId: demoUser.id,
      categoryId: 'cat-food',
      type: 'expense',
      amount: 48000,
      currency: 'NGN',
      description: 'Groceries and lunch',
      transactionDate: demoDate(3),
      createdAt: `${demoDate(3)}T09:15:00.000Z`,
    },
    {
      id: 'txn-3',
      workspaceId: 'workspace-personal',
      userId: demoUser.id,
      categoryId: 'cat-transport',
      type: 'expense',
      amount: 18000,
      currency: 'NGN',
      description: 'Fuel and commute',
      transactionDate: demoDate(2),
      createdAt: `${demoDate(2)}T12:30:00.000Z`,
    },
    {
      id: 'txn-4',
      workspaceId: 'workspace-personal',
      userId: demoUser.id,
      categoryId: 'cat-bills',
      type: 'expense',
      amount: 25000,
      currency: 'NGN',
      description: 'Internet and utilities',
      transactionDate: demoDate(1),
      createdAt: `${demoDate(1)}T16:10:00.000Z`,
    },
    {
      id: 'txn-5',
      workspaceId: 'workspace-org',
      userId: demoUser.id,
      categoryId: 'cat-revenue',
      type: 'income',
      amount: 1200000,
      currency: 'NGN',
      description: 'Client payment for phase 2',
      transactionDate: demoDate(4),
      createdAt: `${demoDate(4)}T11:00:00.000Z`,
    },
    {
      id: 'txn-6',
      workspaceId: 'workspace-org',
      userId: demoUser.id,
      categoryId: 'cat-software',
      type: 'expense',
      amount: 260000,
      currency: 'NGN',
      description: 'Team SaaS subscriptions',
      transactionDate: demoDate(2),
      createdAt: `${demoDate(2)}T14:00:00.000Z`,
    },
    {
      id: 'txn-7',
      workspaceId: 'workspace-org',
      userId: demoUser.id,
      categoryId: 'cat-travel',
      type: 'expense',
      amount: 95000,
      currency: 'NGN',
      description: 'Flight for stakeholder visit',
      transactionDate: demoDate(1),
      createdAt: `${demoDate(1)}T09:45:00.000Z`,
    },
  ],
  budgets: [
    {
      id: 'budget-1',
      workspaceId: 'workspace-personal',
      categoryId: 'cat-food',
      amount: 70000,
      currency: 'NGN',
      period: 'monthly',
      startDate: demoDate(0).slice(0, 8) + '01',
    },
    {
      id: 'budget-2',
      workspaceId: 'workspace-org',
      categoryId: 'cat-software',
      amount: 300000,
      currency: 'NGN',
      period: 'monthly',
      startDate: demoDate(0).slice(0, 8) + '01',
    },
  ],
  memberships: demoMemberships,
}
