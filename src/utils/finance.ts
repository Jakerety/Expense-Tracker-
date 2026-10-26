import { endOfMonth, format, isAfter, isBefore, parseISO, startOfMonth } from 'date-fns'

import type { Budget, Category, Transaction, Workspace } from '../types'

export const formatCurrency = (value: number, currency = 'NGN') =>
  new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)

export const getCurrencySymbol = (currency: string) => {
  const map: Record<string, string> = {
    NGN: '₦',
    USD: '$',
    GBP: '£',
    EUR: '€',
  }

  return map[currency] ?? currency
}

export const calculateSummary = (
  transactions: Transaction[],
  workspaceId: string,
  startDate: string,
  endDate: string,
) => {
  const filtered = transactions.filter((transaction) => {
    if (transaction.workspaceId !== workspaceId) {
      return false
    }

    const date = parseISO(transaction.transactionDate)
    return !isBefore(date, parseISO(startDate)) && !isAfter(date, parseISO(endDate))
  })

  const income = filtered
    .filter((transaction) => transaction.type === 'income')
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0)

  const expense = filtered
    .filter((transaction) => transaction.type === 'expense')
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0)

  return {
    income,
    expense,
    net: income - expense,
    totalTransactions: filtered.length,
  }
}

export const buildTrendData = (
  transactions: Transaction[],
  workspaceId: string,
  startDate: string,
  endDate: string,
  granularity: 'day' | 'month' = 'day',
) => {
  const start = parseISO(startDate)
  const end = parseISO(endDate)
  const bucketLabels: Record<string, { income: number; expense: number }> = {}

  const date = granularity === 'month'
    ? new Date(start.getFullYear(), start.getMonth(), 1)
    : new Date(start)
  while (!isAfter(date, end)) {
    const key = format(date, granularity === 'month' ? 'MMM yy' : 'MMM d')
    bucketLabels[key] = { income: 0, expense: 0 }
    if (granularity === 'month') {
      date.setMonth(date.getMonth() + 1)
    } else {
      date.setDate(date.getDate() + 1)
    }
  }

  transactions.forEach((transaction) => {
    if (transaction.workspaceId !== workspaceId) {
      return
    }

    const date = parseISO(transaction.transactionDate)
    if (isBefore(date, start) || isAfter(date, end)) {
      return
    }

    const key = format(date, granularity === 'month' ? 'MMM yy' : 'MMM d')
    if (!bucketLabels[key]) {
      bucketLabels[key] = { income: 0, expense: 0 }
    }

    if (transaction.type === 'income') {
      bucketLabels[key].income += Number(transaction.amount)
    } else {
      bucketLabels[key].expense += Number(transaction.amount)
    }
  })

  return Object.entries(bucketLabels).map(([name, values]) => ({
    name,
    income: values.income,
    expense: values.expense,
  }))
}

export const buildCategoryBreakdown = (
  transactions: Transaction[],
  workspaceId: string,
  startDate: string,
  endDate: string,
  categories: Category[],
) => {
  const summary = new Map<string, number>()
  const categoryMap = new Map(categories.map((category) => [category.id, category]))

  transactions.forEach((transaction) => {
    if (transaction.workspaceId !== workspaceId) {
      return
    }

    const date = parseISO(transaction.transactionDate)
    if (isBefore(date, parseISO(startDate)) || isAfter(date, parseISO(endDate))) {
      return
    }

    if (transaction.type !== 'expense') {
      return
    }

    const category = categoryMap.get(transaction.categoryId)
    const label = category?.name ?? 'Uncategorized'
    summary.set(label, (summary.get(label) ?? 0) + Number(transaction.amount))
  })

  return Array.from(summary.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((current, next) => next.value - current.value)
}

export const buildBudgetStatus = (budget: Budget, transactions: Transaction[]) => {
  const spent = transactions
    .filter((transaction) => {
      if (transaction.workspaceId !== budget.workspaceId) {
        return false
      }

      if (transaction.type !== 'expense') {
        return false
      }

      if (budget.categoryId && transaction.categoryId !== budget.categoryId) {
        return false
      }

      const transactionDate = parseISO(transaction.transactionDate)
      const start = parseISO(budget.startDate)
      const end = endOfMonth(start)

      return !isBefore(transactionDate, start) && !isAfter(transactionDate, end)
    })
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0)

  const remaining = Number(budget.amount) - spent
  const progress = (spent / Number(budget.amount)) * 100

  return {
    spent,
    remaining,
    progress: Number.isFinite(progress) ? progress : 0,
    isOverBudget: remaining < 0,
  }
}

export const filterTransactions = (
  transactions: Transaction[],
  filters: {
    workspaceId?: string
    search?: string
    type?: 'income' | 'expense' | 'all'
    categoryId?: string
    dateFrom?: string
    dateTo?: string
  },
) => {
  return transactions.filter((transaction) => {
    if (filters.workspaceId && transaction.workspaceId !== filters.workspaceId) {
      return false
    }

    if (filters.type && filters.type !== 'all' && transaction.type !== filters.type) {
      return false
    }

    if (filters.categoryId && transaction.categoryId !== filters.categoryId) {
      return false
    }

    if (filters.search) {
      const query = filters.search.trim().toLowerCase()
      if (!transaction.description.toLowerCase().includes(query)) {
        return false
      }
    }

    if (filters.dateFrom) {
      const value = parseISO(filters.dateFrom)
      if (isBefore(parseISO(transaction.transactionDate), value)) {
        return false
      }
    }

    if (filters.dateTo) {
      const value = parseISO(filters.dateTo)
      if (isAfter(parseISO(transaction.transactionDate), value)) {
        return false
      }
    }

    return true
  })
}

export const getWorkspaceById = (workspaces: Workspace[], workspaceId: string) =>
  workspaces.find((workspace) => workspace.id === workspaceId)

export const canAccessWorkspace = (
  workspaceId: string,
  userId: string,
  memberships: { workspaceId: string; userId: string }[],
  workspaces: Workspace[],
) => {
  const workspace = getWorkspaceById(workspaces, workspaceId)
  if (!workspace) {
    return false
  }

  if (workspace.type === 'personal') {
    return workspace.ownerId === userId
  }

  return memberships.some(
    (membership) => membership.workspaceId === workspaceId && membership.userId === userId,
  )
}

export const getDefaultDateRange = () => {
  const now = new Date()
  const rangeStart = startOfMonth(now)

  return {
    startDate: format(rangeStart, 'yyyy-MM-dd'),
    endDate: format(now, 'yyyy-MM-dd'),
  }
}
