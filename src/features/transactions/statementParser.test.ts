import { describe, expect, it } from 'vitest'

import { parseStatementText } from './statementParser'

describe('bank statement text parsing', () => {
  it('extracts dates, amounts, descriptions, and obvious income/expense types', () => {
    const rows = parseStatementText([
      'Date Description Amount Balance',
      '01/09/2026 Ride service debit NGN 4,500.00 NGN 95,500.00',
      '02/09/2026 Salary payment NGN 500,000.00 NGN 595,500.00',
      '03/09/2026 Monthly payment debit NGN 1,500.00 NGN 594,000.00',
    ].join('\n'))

    expect(rows).toEqual([
      expect.objectContaining({ transactionDate: '2026-09-01', description: 'Ride service', amount: 4500, type: 'expense' }),
      expect.objectContaining({ transactionDate: '2026-09-02', description: 'Salary payment', amount: 500000, type: 'income' }),
      expect.objectContaining({ transactionDate: '2026-09-03', description: 'Monthly payment', amount: 1500, type: 'expense' }),
    ])
  })

  it('ignores headings and rows without a parseable amount', () => {
    expect(parseStatementText('Statement period 01/09/2026\nTransaction date description\n02/09/2026 Monthly fee')).toEqual([])
  })

  it('uses explicit amount signs to determine income and expense types', () => {
    const rows = parseStatementText([
      '04/09/2026 Salary credit +NGN 12,500.00 NGN 40,000.00',
      '05/09/2026 Refund debit -NGN 2,300.00 NGN 37,700.00',
      '06/09/2026 + 850.00 NGN 38,550.00',
      '07/09/2026 - 120.00 NGN 38,430.00',
      '08/09/2026 NGN +1,000.00 NGN 39,430.00',
      '09/09/2026 NGN -500.00 NGN 38,930.00',
      '10/08/2026 — +$ $ 14,250.00 $ 38,680.00',
    ].join('\n'))

    expect(rows).toEqual([
      expect.objectContaining({ amount: 12500, type: 'income' }),
      expect.objectContaining({ amount: 2300, type: 'expense' }),
      expect.objectContaining({ amount: 850, type: 'income' }),
      expect.objectContaining({ amount: 120, type: 'expense' }),
      expect.objectContaining({ amount: 1000, type: 'income' }),
      expect.objectContaining({ amount: 500, type: 'expense' }),
      expect.objectContaining({ amount: 14250, type: 'income' }),
    ])
  })
})
