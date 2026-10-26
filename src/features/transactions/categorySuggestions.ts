import type { Category, TransactionType } from '../../types'

const rules: Array<{ pattern: RegExp; names: string[]; type: TransactionType }> = [
  { pattern: /\b(?:salary|wages?|payroll|staff pay)\b/i, names: ['Salary', 'Payroll', 'Revenue', 'Client Revenue'], type: 'income' },
  { pattern: /\b(?:freelance|client payment|invoice paid|sales revenue|dividend|interest earned|refund|cashback|reversal|credit received|transfer in|deposit)\b/i, names: ['Freelance', 'Revenue', 'Client Revenue', 'Other income'], type: 'income' },
  { pattern: /\b(?:uber|bolt|indrive|yango|taxi|cab fare|ride[- ]hailing|bus fare|train fare|transport|fuel|petrol|gas station|parking|toll)\b/i, names: ['Transportation', 'Transport', 'Travel', 'Operations'], type: 'expense' },
  { pattern: /\b(?:shoprite|spar|supermarket|grocery|groceries|market|foodstuff)\b/i, names: ['Groceries', 'Meals & groceries', 'Food & Dining'], type: 'expense' },
  { pattern: /\b(?:restaurant|cafe|coffee|bakery|food|meal|lunch|dinner|breakfast|chicken republic|kfc|domino'?s|pizza|mcdonald)\b/i, names: ['Food & Dining', 'Meals & groceries', 'Groceries'], type: 'expense' },
  { pattern: /\b(?:rent|landlord|mortgage|housing|house lease)\b/i, names: ['Housing', 'Operations'], type: 'expense' },
  { pattern: /\b(?:electricity|power bill|phcn|aedc|ekedc|ibedc|water bill|utility|utilities|internet|broadband|wifi|airtel|mtn|glo|9mobile|airtime|data bundle|dstv|gotv|startimes)\b/i, names: ['Utilities', 'Bills', 'Operations'], type: 'expense' },
  { pattern: /\b(?:netflix|spotify|youtube premium|showmax|prime video|subscription|apple music)\b/i, names: ['Subscriptions', 'Entertainment', 'Software'], type: 'expense' },
  { pattern: /\b(?:software|saas|hosting|domain renewal|cloud service|adobe|microsoft 365|google workspace)\b/i, names: ['Software', 'Subscriptions', 'Operations'], type: 'expense' },
  { pattern: /\b(?:hospital|clinic|pharmacy|chemist|medical|doctor|health|laboratory|dental|medicine|prescription)\b/i, names: ['Health & wellness', 'Operations'], type: 'expense' },
  { pattern: /\b(?:clothing|apparel|fashion|shoes|tailor|garment)\b/i, names: ['Clothing', 'Personal care', 'Operations'], type: 'expense' },
  { pattern: /\b(?:school|tuition|university|education|course fee|textbook|training)\b/i, names: ['Education', 'Operations'], type: 'expense' },
  { pattern: /\b(?:cinema|movie|concert|entertainment|game|event ticket)\b/i, names: ['Entertainment', 'Operations'], type: 'expense' },
  { pattern: /\b(?:office supplies|stationery|contractor|marketing|advertising|tax|payroll|business expense)\b/i, names: ['Office supplies', 'Contractors', 'Marketing', 'Taxes & fees', 'Payroll', 'Operations'], type: 'expense' },
]

export function suggestCategoryId(description: string, type: TransactionType, categories: Category[]): string | null {
  const matchCategory = (names: string[]) => {
    for (const name of names) {
      const category = categories.find(
        (item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
          && (item.type === type || item.type === 'both'),
      )
      if (category) return category.id
    }
    return null
  }

  for (const rule of rules) {
    if (rule.type !== type || !rule.pattern.test(description)) continue
    const categoryId = matchCategory(rule.names)
    if (categoryId) return categoryId
  }
  return matchCategory(type === 'income'
    ? ['Other income', 'Revenue', 'Client Revenue']
    : ['Other expenses', 'Operations'])
}
