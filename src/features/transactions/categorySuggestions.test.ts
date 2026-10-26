import { describe, expect, it } from 'vitest'

import type { Category } from '../../types'
import { suggestCategoryId } from './categorySuggestions'

const categories: Category[] = [
  { id: 'travel', name: 'Travel', type: 'expense', workspaceId: 'organization' },
  { id: 'groceries', name: 'Meals & groceries', type: 'expense', workspaceId: 'organization' },
  { id: 'utilities', name: 'Utilities', type: 'expense', workspaceId: 'organization' },
  { id: 'revenue', name: 'Client Revenue', type: 'income', workspaceId: 'organization' },
  { id: 'other-expense', name: 'Other expenses', type: 'expense', workspaceId: 'organization' },
  { id: 'other-income', name: 'Other income', type: 'income', workspaceId: 'organization' },
]

describe('suggestCategoryId', () => {
  it.each([
    ['UBER TRIP', 'expense', 'travel'],
    ['Shoprite Lekki', 'expense', 'groceries'],
    ['MTN Airtime', 'expense', 'utilities'],
    ['Salary payment', 'income', 'revenue'],
    ['Monthly rent payment', 'expense', 'other-expense'],
    ['Pharmacy prescription', 'expense', 'other-expense'],
    ['Unrecognized card payment', 'expense', 'other-expense'],
    ['Unrecognized incoming payment', 'income', 'other-income'],
  ] as const)('suggests an existing workspace category for %s', (description, type, expected) => {
    expect(suggestCategoryId(description, type, categories)).toBe(expected)
  })

  it('leaves unmatched transactions uncategorized when no fallback is configured', () => {
    expect(suggestCategoryId('Unknown merchant', 'expense', categories.filter((category) => category.name !== 'Other expenses'))).toBeNull()
  })
})
