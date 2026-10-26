export interface StatementRow {
  transactionDate: string
  description: string
  amount: number
  type: 'income' | 'expense'
  categoryId: string
}

const datePattern = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3,9}[-\s,]+\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4})\b/
const amountPattern = /(?:[+-]\s*|\(\s*)?(?:(?:NGN|N|₦|\$|€|£)\s*)*(?:[+-]\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\s*\)?/gi

function toIsoDate(value: string): string | null {
  const trimmed = value.trim()
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const numeric = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2])
    const rawYear = Number(numeric[3])
    const year = rawYear < 100 ? (rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear) : rawYear
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
  }
  return null
}

export function parseStatementText(text: string): StatementRow[] {
  const rows: StatementRow[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    const dateMatch = datePattern.exec(line)
    datePattern.lastIndex = 0
    if (!dateMatch) continue

    const transactionDate = toIsoDate(dateMatch[0])
    if (!transactionDate) continue

    const lineWithoutDate = `${line.slice(0, dateMatch.index)} ${line.slice(dateMatch.index + dateMatch[0].length)}`
    const amounts = [...lineWithoutDate.matchAll(amountPattern)]
    amountPattern.lastIndex = 0
    const transactionAmount = amounts
      .map((match) => ({
        raw: match[0],
        value: Number(match[0].replace(/[^\d.]/g, '')),
      }))
      .find((match) => Number.isFinite(match.value) && match.value > 0)
    if (!transactionAmount) continue

    const hasExplicitPlus = transactionAmount.raw.includes('+')
    const hasExplicitMinus = transactionAmount.raw.includes('-') || transactionAmount.raw.includes('(')
    const hasIncomeSignal = /\b(credit|cr|deposit|salary|wages?|refund|cashback|transfer in|interest|freelance)\b/i.test(line)
    const hasExpenseSignal = /\b(debit|dr|withdrawal|transfer out)\b/i.test(line)
    const type = hasExplicitPlus
      ? 'income'
      : hasExplicitMinus || hasExpenseSignal
      ? 'expense'
      : hasIncomeSignal
        ? 'income'
        : 'expense'
    const description = lineWithoutDate
      .replace(amountPattern, ' ')
      .replace(/\b(?:NGN|N|CR|DR|CREDIT|DEBIT)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    rows.push({
      transactionDate,
      description: description.slice(0, 240),
      amount: transactionAmount.value,
      type,
      categoryId: '',
    })
  }

  return rows
}
