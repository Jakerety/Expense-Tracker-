import { describe, expect, it } from 'vitest'

import { demoData } from '../data/demo'
import type { Transaction } from '../types'
import {
  buildCategoryBreakdown,
  buildTrendData,
  buildBudgetStatus,
  calculateSummary,
  canAccessWorkspace,
  filterTransactions,
  getDefaultDateRange,
} from './finance'

describe('finance calculations', () => {
  it('computes income, expense and net totals for a workspace and range', () => {
    const range = getDefaultDateRange()
    const totals = calculateSummary(demoData.transactions, 'workspace-personal', range.startDate, range.endDate)

    expect(totals.income).toBe(500000)
    expect(totals.expense).toBe(91000)
    expect(totals.net).toBe(409000)
  })

  it('computes a budget status including remaining and overspend', () => {
    const status = buildBudgetStatus(
      {
        id: 'budget-test',
        workspaceId: 'workspace-personal',
        categoryId: 'cat-food',
        amount: 70000,
        currency: 'NGN',
        period: 'monthly',
        startDate: getDefaultDateRange().startDate,
      },
      demoData.transactions,
    )

    expect(status.spent).toBe(48000)
    expect(status.remaining).toBe(22000)
    expect(status.isOverBudget).toBe(false)
  })

  it('filters transactions by workspace, type and date range', () => {
    const filtered = filterTransactions(demoData.transactions, {
      workspaceId: 'workspace-org',
      type: 'expense',
      dateFrom: getDefaultDateRange().startDate,
      dateTo: getDefaultDateRange().endDate,
    })

    expect(filtered).toHaveLength(2)
    expect(filtered.every((transaction) => transaction.workspaceId === 'workspace-org')).toBe(true)
    expect(filtered.every((transaction) => transaction.type === 'expense')).toBe(true)
  })

  it('keeps historical transactions visible when no date range is requested', () => {
    const historicalTransactions = filterTransactions(demoData.transactions, {
      workspaceId: 'workspace-org',
    })

    expect(historicalTransactions.length).toBeGreaterThan(0)
    expect(historicalTransactions.every((transaction) => transaction.workspaceId === 'workspace-org')).toBe(true)
  })

  it('builds a category breakdown without double counting unrelated workspace data', () => {
    const breakdown = buildCategoryBreakdown(
      demoData.transactions,
      'workspace-org',
      getDefaultDateRange().startDate,
      getDefaultDateRange().endDate,
      demoData.categories,
    )

    expect(breakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Software', value: 260000 }),
        expect.objectContaining({ name: 'Travel', value: 95000 }),
      ]),
    )
  })

  it('provides category-specific demo budgets for common spending types', () => {
    const personalExpenses = demoData.categories
      .filter((category) => category.workspaceId === 'workspace-personal' && category.type === 'expense')
      .map((category) => category.name)

    expect(personalExpenses).toEqual(expect.arrayContaining(['Groceries', 'Clothing', 'Utilities', 'Health & wellness']))
  })

  it('prevents access to another users personal workspace', () => {
    expect(canAccessWorkspace('workspace-personal', 'user-other', [], demoData.workspaces)).toBe(false)
  })

  it('builds a trend series with totals for each day in the selected range', () => {
    const trend = buildTrendData(demoData.transactions, 'workspace-personal', '2026-09-01', '2026-09-10')

    expect(trend.length).toBeGreaterThan(0)
    expect(trend[0]).toMatchObject({
      income: expect.any(Number),
      expense: expect.any(Number),
    })
  })

  it('keeps date-labeled zero-value buckets for intervals without transactions', () => {
    const trend = buildTrendData([], 'workspace-personal', '2026-10-01', '2026-10-03')

    expect(trend).toEqual([
      { name: 'Oct 1', income: 0, expense: 0 },
      { name: 'Oct 2', income: 0, expense: 0 },
      { name: 'Oct 3', income: 0, expense: 0 },
    ])
  })

  it('aggregates trend values by month for long date ranges', () => {
    const transactions: Transaction[] = [
      {
        ...demoData.transactions[0],
        transactionDate: '2026-09-10',
        amount: 100,
        type: 'income',
      },
      {
        ...demoData.transactions[1],
        transactionDate: '2026-10-10',
        amount: 25,
        type: 'expense',
      },
    ]
    const trend = buildTrendData(transactions, 'workspace-personal', '2026-09-01', '2026-10-31', 'month')

    expect(trend.map((item) => item.name)).toEqual(['Sep 26', 'Oct 26'])
    expect(trend).toEqual([
      { name: 'Sep 26', income: 100, expense: 0 },
      { name: 'Oct 26', income: 0, expense: 25 },
    ])
  })

  it('defaults to the current month through today', () => {
    const today = new Date()
    const range = getDefaultDateRange()

    expect(range.startDate).toBe(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`)
    expect(range.endDate).toBe(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`)
  })

  it('includes seeded demo transactions in the current month-to-date dashboard', () => {
    const range = getDefaultDateRange()
    const summary = calculateSummary(demoData.transactions, 'workspace-personal', range.startDate, range.endDate)

    expect(summary.totalTransactions).toBeGreaterThan(0)
    expect(summary.income).toBeGreaterThan(0)
    expect(summary.expense).toBeGreaterThan(0)
  })
})
