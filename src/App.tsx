import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CircleUserRound, ChevronDown, FileUp, TrendingUp } from 'lucide-react'

import { demoData, generateId } from './data/demo'
import './App.css'
import { AdminDashboard } from './features/admin/AdminDashboard'
import { AccountPage } from './features/account/AccountPage'
import { AuthPage } from './features/auth/AuthPage'
import { OrganizationPage } from './features/organizations/OrganizationPage'
import { SupportCenter } from './features/support/SupportCenter'
import { suggestCategoryId } from './features/transactions/categorySuggestions'
import type { StatementRow } from './features/transactions/statementParser'
import { categorizeUncategorizedTransactions, createBudget as createRemoteBudget, createOrganization as createRemoteOrganization, createTransaction as createRemoteTransaction, deleteTransaction as deleteRemoteTransaction, importTransactions as importRemoteTransactions, loadAppBootstrap, previewStatementImport as previewRemoteStatementImport, updateProfile as updateRemoteProfile, updateTransaction as updateRemoteTransaction, updateTransactionCategory as updateRemoteTransactionCategory, type StatementImportResult, type StatementPreviewRow } from './lib/api'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import type { Budget, Transaction } from './types'
import {
  buildBudgetStatus,
  buildCategoryBreakdown,
  buildTrendData,
  calculateSummary,
  filterTransactions,
  formatCurrency,
  getDefaultDateRange,
} from './utils/finance'

const defaultRange = getDefaultDateRange()
const StatementImportDialog = lazy(() => import('./features/transactions/StatementImportDialog').then((module) => ({ default: module.StatementImportDialog })))

const navigation = [
  { to: '/', label: 'Dashboard' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/budgets', label: 'Budgets' },
  { to: '/reports', label: 'Reports' },
  { to: '/organization', label: 'Organization' },
  { to: '/support', label: 'Support' },
  { to: '/admin', label: 'Admin' },
  { to: '/settings', label: 'Settings' },
]

function readStored<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? (JSON.parse(stored) as T) : fallback
  } catch {
    return fallback
  }
}

function exportCsv(rows: string[][], filename: string) {
  const content = rows
    .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','))
    .join('\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function loadDemoTransactions() {
  const legacyDates: Record<string, string> = {
    'txn-1': '2026-09-01',
    'txn-2': '2026-09-05',
    'txn-3': '2026-09-07',
    'txn-4': '2026-09-10',
    'txn-5': '2026-09-02',
    'txn-6': '2026-09-13',
    'txn-7': '2026-09-18',
  }
  const stored = readStored('expense-tracker-transactions', demoData.transactions)
  const updated = stored.map((transaction) => {
    const seed = demoData.transactions.find((item) => item.id === transaction.id)
    if (
      seed &&
      transaction.transactionDate === legacyDates[transaction.id] &&
      transaction.description === seed.description &&
      transaction.amount === seed.amount
    ) {
      return { ...transaction, transactionDate: seed.transactionDate, createdAt: seed.createdAt }
    }
    return transaction
  })
  const existingIds = new Set(updated.map((transaction) => transaction.id))
  return [...updated, ...demoData.transactions.filter((transaction) => !existingIds.has(transaction.id))]
}

function loadDemoBudgets() {
  const stored = readStored('expense-tracker-budgets', demoData.budgets)
  const updated = stored.map((budget) => budget.startDate === '2026-09-01'
    ? { ...budget, startDate: demoData.budgets.find((seed) => seed.id === budget.id)?.startDate ?? budget.startDate }
    : budget)
  const existingIds = new Set(updated.map((budget) => budget.id))
  return [...updated, ...demoData.budgets.filter((budget) => !existingIds.has(budget.id))]
}

function statementTransactionKey(transaction: Pick<Transaction, 'transactionDate' | 'type' | 'amount' | 'currency' | 'description'>, workspaceId: string) {
  return [
    workspaceId,
    transaction.transactionDate,
    transaction.type,
    transaction.amount.toFixed(2),
    transaction.currency,
    transaction.description.replace(/\s+/g, ' ').trim().toLocaleLowerCase(),
  ].join('|')
}

function loadDemoProfile() {
  const stored = readStored('expense-tracker-profile', demoData.users[0])
  return {
    ...demoData.users[0],
    ...stored,
    name: stored.name?.trim() || demoData.users[0].name,
    email: stored.email?.trim() || demoData.users[0].email,
    preferredCurrency: stored.preferredCurrency || demoData.users[0].preferredCurrency,
  }
}

function App() {
  return <BrowserRouter><AppContent /></BrowserRouter>
}

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [authenticated, setAuthenticated] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [demoAccess, setDemoAccess] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setAuthenticated(Boolean(data.session))
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthenticated(Boolean(session))
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (!authReady) return <div className="loading-screen" role="status">Checking your session…</div>
  if (recoveryMode || (!authenticated && !demoAccess && ['/login', '/sign-in'].includes(location.pathname))) {
    const initialMode = recoveryMode
      ? 'new-password'
      : new URLSearchParams(location.search).get('mode') === 'sign-up' ? 'sign-up' : 'sign-in'
    return <AuthPage initialMode={initialMode} onAuthenticated={() => { setAuthenticated(true); setDemoAccess(false); navigate('/', { replace: true }) }} onPasswordUpdated={() => { setRecoveryMode(false); setAuthenticated(true); navigate('/', { replace: true }) }} onDemoAccess={() => { setDemoAccess(true); navigate('/', { replace: true }) }} />
  }

  if (!authenticated && !demoAccess) return <PublicLanding />

  const leaveAccount = async () => {
    if (supabase) await supabase.auth.signOut()
    setAuthenticated(false)
    setDemoAccess(false)
    navigate('/account', { replace: true })
  }

  return <ExpenseApp authenticated={authenticated} demoAccess={demoAccess} onSignOut={leaveAccount} onSwitchAccount={leaveAccount} />
}

function PublicLanding() {
  return (
    <main className="public-home">
      <header className="public-nav">
        <Link to="/" className="public-brand" aria-label="Expense Tracker home">
          <span className="brand-mark" aria-hidden="true"><img src="/ChatGPT%20Image%20Oct%207,%202026,%2002_42_38%20PM.png" alt="" /></span>
          <span>Expense Tracker</span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#features">Why Expense Tracker</a>
          <Link to="/login">Sign in</Link>
          <Link to="/login?mode=sign-up" className="public-nav-cta">Get started <ArrowRight size={15} aria-hidden="true" /></Link>
        </nav>
      </header>

      <section className="public-hero" aria-labelledby="public-hero-title">
        <video
          className="public-hero-video"
          autoPlay
          muted
          loop
          playsInline
          poster="https://images.pexels.com/videos/7735809/pexels-photo-7735809.jpeg?auto=compress&cs=tinysrgb&w=1600"
          aria-hidden="true"
        >
          <source src="https://videos.pexels.com/video-files/7735809/7735809-hd_1920_1080_25fps.mp4" type="video/mp4" />
        </video>
        <div className="public-hero-shade" aria-hidden="true" />
        <div className="public-hero-copy">
          <p className="public-kicker"><span /> A CALMER WAY TO MANAGE MONEY</p>
          <h1 id="public-hero-title">Make your money feel more <em>like yours.</em></h1>
          <p className="public-hero-description">Know what comes in, what goes out, and what you can do next. Simple, thoughtful tools for spending with intention.</p>
          <div className="public-hero-actions">
            <Link to="/login?mode=sign-up" className="public-primary-cta">Create your free account <ArrowUpRight size={17} aria-hidden="true" /></Link>
            <Link to="/login" className="public-secondary-cta">I already have an account</Link>
          </div>
          <p className="public-trust-note"><Check size={15} aria-hidden="true" /> Personal and shared workspaces, all in one place</p>
        </div>
        <aside className="public-video-note">
          <span className="public-video-note-dot" />
          <span>Make room for what matters</span>
        </aside>
      </section>

      <section className="public-features" id="features" aria-labelledby="public-features-title">
        <div className="public-features-heading">
          <p className="eyebrow">A clearer picture, every day</p>
          <h2 id="public-features-title">Everything you need to feel in control.</h2>
          <p>Less guesswork. More confidence in every money decision.</p>
        </div>
        <div className="public-feature-grid">
          <article className="public-feature-card">
            <span className="public-feature-number">01</span>
            <h3>See the full picture</h3>
            <p>Bring income and expenses together in one clear, up-to-date view.</p>
          </article>
          <article className="public-feature-card">
            <span className="public-feature-number">02</span>
            <h3>Make a plan that fits</h3>
            <p>Set practical monthly budgets and see how your spending is tracking.</p>
          </article>
          <article className="public-feature-card">
            <span className="public-feature-number">03</span>
            <h3>Move forward together</h3>
            <p>Keep personal finances and shared workspace spending organized in one place.</p>
          </article>
        </div>
      </section>

      <footer className="public-footer">
        <Link to="/" className="public-brand"><span className="brand-mark" aria-hidden="true"><img src="/ChatGPT%20Image%20Oct%207,%202026,%2002_42_38%20PM.png" alt="" /></span><span>Expense Tracker</span></Link>
        <span>A little more clarity, a lot more possibility.</span>
        <Link to="/login">Sign in <ArrowRight size={14} aria-hidden="true" /></Link>
      </footer>
    </main>
  )
}

interface ExpenseAppProps {
  authenticated: boolean
  demoAccess: boolean
  onSignOut: () => void
  onSwitchAccount: () => void
}

function ExpenseApp({ authenticated, demoAccess, onSignOut, onSwitchAccount }: ExpenseAppProps) {
  const [session, setSession] = useState({
    userId: demoData.users[0].id,
    selectedWorkspaceId: authenticated ? 'personal' : demoData.workspaces[0].id,
  })
  const [transactions, setTransactions] = useState(() => authenticated ? [] : loadDemoTransactions())
  const [budgetData, setBudgetData] = useState(() => authenticated ? [] : loadDemoBudgets())
  const [profile, setProfile] = useState(() => authenticated
    ? { id: '', name: '', email: '', preferredCurrency: 'NGN' }
    : loadDemoProfile())
  const [workspaces, setWorkspaces] = useState(() => authenticated
    ? [{ id: 'personal', name: 'Personal workspace', type: 'personal' as const, currency: 'NGN' }]
    : readStored('expense-tracker-workspaces', demoData.workspaces))
  const [categoryData, setCategoryData] = useState(() => {
    if (authenticated) return []
    const stored = readStored('expense-tracker-categories', demoData.categories)
    return [
      ...stored,
      ...demoData.categories.filter((defaultCategory) => !stored.some(
        (category) => category.workspaceId === defaultCategory.workspaceId && category.name === defaultCategory.name,
      )),
    ]
  })
  const [workspaceRoles, setWorkspaceRoles] = useState<Record<string, string>>(authenticated ? {} : Object.fromEntries(demoData.memberships.map((membership) => [membership.workspaceId, membership.role])))
  const [workspaceDataLoaded, setWorkspaceDataLoaded] = useState(!authenticated)
  const [rangePreset, setRangePreset] = useState<'all' | 'month' | '30days' | '12months'>('all')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all')
  const [showTransactionForm, setShowTransactionForm] = useState(false)
  const [showStatementImport, setShowStatementImport] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [transactionType, setTransactionType] = useState<Transaction['type']>('expense')
  const [showBudgetForm, setShowBudgetForm] = useState(false)
  const [notice, setNotice] = useState('')
  const location = useLocation()

  useEffect(() => {
    if (demoAccess) localStorage.setItem('expense-tracker-transactions', JSON.stringify(transactions))
  }, [demoAccess, transactions])
  useEffect(() => {
    if (demoAccess) localStorage.setItem('expense-tracker-budgets', JSON.stringify(budgetData))
  }, [budgetData, demoAccess])
  useEffect(() => {
    if (demoAccess) localStorage.setItem('expense-tracker-profile', JSON.stringify(profile))
  }, [demoAccess, profile])
  useEffect(() => {
    if (demoAccess) localStorage.setItem('expense-tracker-workspaces', JSON.stringify(workspaces))
  }, [demoAccess, workspaces])
  useEffect(() => {
    if (demoAccess) localStorage.setItem('expense-tracker-categories', JSON.stringify(categoryData))
  }, [categoryData, demoAccess])
  useEffect(() => {
    if (!authenticated) return
    let active = true
    supabase?.auth.getSession().then(({ data, error }) => {
      if (error) throw error
      const authUser = data.session?.user
      if (!active || !authUser) return
      setProfile((current) => ({
        ...current,
        id: current.id || authUser.id,
        name: current.name || String(authUser.user_metadata?.full_name ?? ''),
        email: authUser.email || current.email,
      }))
    }).catch((error: unknown) => {
      if (active) setNotice(error instanceof Error ? error.message : 'Could not load your account details.')
    })
    loadAppBootstrap().then((data) => {
      if (!active) return
      setProfile((current) => ({
        ...data.user,
        name: data.user.name || current.name,
        email: data.user.email || current.email,
      }))
      setWorkspaces(data.workspaces)
      setWorkspaceRoles(data.workspaceRoles)
      setCategoryData(data.categories)
      setTransactions(data.transactions)
      setBudgetData(data.budgets)
      setSession({ userId: data.user.id, selectedWorkspaceId: data.defaultWorkspaceId })
      setWorkspaceDataLoaded(true)
    }).catch((error: unknown) => {
      if (active) setNotice(error instanceof Error ? error.message : 'Could not load workspace data.')
    })
    return () => { active = false }
  }, [authenticated])
  useEffect(() => {
    if (!authenticated || !workspaceDataLoaded) return
    let active = true
    categorizeUncategorizedTransactions(session.selectedWorkspaceId).then((updated) => {
      if (!active || updated.length === 0) return
      const updatedById = new Map(updated.map((transaction) => [transaction.id, transaction]))
      setTransactions((current) => current.map((transaction) => updatedById.get(transaction.id) ?? transaction))
      setNotice(`${updated.length} existing transaction${updated.length === 1 ? '' : 's'} automatically categorized.`)
    }).catch((error: unknown) => {
      if (active) setNotice(error instanceof Error ? error.message : 'Could not automatically categorize existing transactions.')
    })
    return () => { active = false }
  }, [authenticated, session.selectedWorkspaceId, workspaceDataLoaded])
  useEffect(() => {
    if (authenticated || !workspaceDataLoaded) return
    const workspaceId = session.selectedWorkspaceId
    const workspaceCategories = categoryData.filter((category) => category.workspaceId === workspaceId)
    const suggestions = transactions
      .filter((transaction) => transaction.workspaceId === workspaceId && !transaction.categoryId)
      .map((transaction) => ({
        id: transaction.id,
        categoryId: suggestCategoryId(transaction.description, transaction.type, workspaceCategories),
      }))
      .filter((item): item is { id: string; categoryId: string } => item.categoryId !== null)
    if (suggestions.length) {
      const categoryById = new Map(suggestions.map((item) => [item.id, item.categoryId]))
      setTransactions((current) => current.map((transaction) => {
        const categoryId = categoryById.get(transaction.id)
        return categoryId ? { ...transaction, categoryId } : transaction
      }))
    }
  }, [authenticated, categoryData, session.selectedWorkspaceId, transactions, workspaceDataLoaded])
  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === session.selectedWorkspaceId) ??
    workspaces[0]

  const dateRange = useMemo(() => {
    const today = new Date()
    const endDate = format(today, 'yyyy-MM-dd')
    if (rangePreset === 'month') {
      return { startDate: format(new Date(today.getFullYear(), today.getMonth(), 1), 'yyyy-MM-dd'), endDate }
    }
    if (rangePreset === '30days') {
      const start = new Date(today)
      start.setDate(start.getDate() - 29)
      return { startDate: format(start, 'yyyy-MM-dd'), endDate }
    }
    if (rangePreset === '12months') {
      return { startDate: format(new Date(today.getFullYear(), today.getMonth() - 11, 1), 'yyyy-MM-dd'), endDate }
    }

    const workspaceDates = transactions
      .filter((transaction) => transaction.workspaceId === session.selectedWorkspaceId)
      .map((transaction) => transaction.transactionDate)
      .filter(Boolean)
      .sort()
    return {
      startDate: workspaceDates[0] ?? defaultRange.startDate,
      endDate: workspaceDates[workspaceDates.length - 1] && workspaceDates[workspaceDates.length - 1] > endDate
        ? workspaceDates[workspaceDates.length - 1]
        : endDate,
    }
  }, [rangePreset, session.selectedWorkspaceId, transactions])

  const dateFilteredTransactions = useMemo(
    () =>
      filterTransactions(transactions, {
        workspaceId: session.selectedWorkspaceId,
        dateFrom: dateRange.startDate,
        dateTo: dateRange.endDate,
      }),
    [dateRange, session.selectedWorkspaceId, transactions],
  )
  const filteredTransactions = useMemo(
    () => filterTransactions(dateFilteredTransactions, { search, type: typeFilter }),
    [dateFilteredTransactions, search, typeFilter],
  )
  const transactionList = useMemo(
    () => filterTransactions(transactions, {
      workspaceId: session.selectedWorkspaceId,
      search,
      type: typeFilter,
    }),
    [search, session.selectedWorkspaceId, transactions, typeFilter],
  )

  const summary = useMemo(
    () =>
      calculateSummary(
        transactions,
        session.selectedWorkspaceId,
        dateRange.startDate,
        dateRange.endDate,
      ),
    [dateRange, session.selectedWorkspaceId, transactions],
  )

  const categoryBreakdown = useMemo(
    () =>
      buildCategoryBreakdown(
        transactions,
        session.selectedWorkspaceId,
        dateRange.startDate,
        dateRange.endDate,
        categoryData,
      ),
    [categoryData, dateRange, session.selectedWorkspaceId, transactions],
  )

  const trendData = useMemo(
    () =>
      buildTrendData(
        transactions,
        session.selectedWorkspaceId,
        dateRange.startDate,
        dateRange.endDate,
        rangePreset === 'all' || rangePreset === '12months' ? 'month' : 'day',
      ),
    [dateRange, rangePreset, session.selectedWorkspaceId, transactions],
  )
  const trendMaximum = Math.max(
    0,
    ...trendData.flatMap((item) => [item.income, item.expense]),
  )

  const budgets = useMemo(
    () => budgetData.filter((budget) => budget.workspaceId === session.selectedWorkspaceId),
    [budgetData, session.selectedWorkspaceId],
  )

  const categories = categoryData.filter((category) => category.workspaceId === session.selectedWorkspaceId)
  const transactionCategories = categories.filter((category) => category.type === transactionType || category.type === 'both')
  const budgetCategories = categories.filter((category) => category.type !== 'income')
  const currentMonth = format(new Date(), 'yyyy-MM')

  const openTransactionForm = (transaction?: Transaction) => {
    setEditingTransaction(transaction ?? null)
    setTransactionType(transaction?.type ?? 'expense')
    setShowTransactionForm(true)
  }

  const saveTransaction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const existing = editingTransaction
    const updated: Transaction = {
      id: existing?.id ?? generateId(),
      workspaceId: session.selectedWorkspaceId,
      userId: session.userId,
      categoryId: String(values.get('categoryId')),
      type: values.get('type') as Transaction['type'],
      amount: Number(values.get('amount')),
      currency: selectedWorkspace.currency,
      description: String(values.get('description')).trim(),
      transactionDate: String(values.get('transactionDate')),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    try {
      const draft = {
        workspaceId: updated.workspaceId,
        userId: updated.userId,
        categoryId: updated.categoryId,
        type: updated.type,
        amount: updated.amount,
        currency: updated.currency,
        description: updated.description,
        transactionDate: updated.transactionDate,
      }
      const id = updated.id
      const saved = authenticated
        ? existing ? await updateRemoteTransaction(id, draft) : await createRemoteTransaction(session.selectedWorkspaceId, draft)
        : updated
      setTransactions((current) => existing
        ? current.map((transaction) => transaction.id === existing.id ? saved : transaction)
        : [saved, ...current])
      setShowTransactionForm(false)
      setNotice(existing ? 'Transaction updated' : 'Transaction added')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save this transaction.')
    }
  }

  const importStatementRows = async (rows: StatementRow[]) => {
    const drafts = rows.map((row) => ({
      workspaceId: session.selectedWorkspaceId,
      userId: session.userId,
      categoryId: row.categoryId,
      type: row.type,
      amount: row.amount,
      currency: selectedWorkspace.currency,
      description: row.description,
      transactionDate: row.transactionDate,
    }))
    let result: StatementImportResult
    if (authenticated) {
      result = await importRemoteTransactions(session.selectedWorkspaceId, drafts)
    } else {
      const existingKeys = new Set(transactions.map((transaction) => statementTransactionKey(transaction, session.selectedWorkspaceId)))
      const imported: Transaction[] = []
      for (const transaction of drafts) {
        const key = statementTransactionKey(transaction, session.selectedWorkspaceId)
        if (existingKeys.has(key)) continue
        existingKeys.add(key)
        imported.push({ ...transaction, id: generateId(), createdAt: new Date().toISOString() })
      }
      const categorized = imported.filter((transaction) => transaction.categoryId).length
      result = {
        total: drafts.length,
        new: imported.length,
        duplicates: drafts.length - imported.length,
        categorized,
        uncategorized: imported.length - categorized,
        transactions: imported,
      }
    }
    setTransactions((current) => [...result.transactions, ...current])
    setNotice(`${result.new} imported; ${result.duplicates} duplicates skipped`)
    return result
  }

  const previewStatementRows = async (rows: StatementRow[]): Promise<StatementPreviewRow[]> => {
    const drafts = rows.map((row) => ({
      workspaceId: session.selectedWorkspaceId,
      userId: session.userId,
      categoryId: row.categoryId,
      type: row.type,
      amount: row.amount,
      currency: selectedWorkspace.currency,
      description: row.description,
      transactionDate: row.transactionDate,
    }))
    if (authenticated) return previewRemoteStatementImport(session.selectedWorkspaceId, drafts)

    const seen = new Set(transactions.map((transaction) => statementTransactionKey(transaction, session.selectedWorkspaceId)))
    return drafts.map((transaction) => {
      const key = statementTransactionKey(transaction, session.selectedWorkspaceId)
      const isDuplicate = seen.has(key)
      seen.add(key)
      const suggestedCategoryId = transaction.categoryId || suggestCategoryId(transaction.description, transaction.type, categories)
      return {
        ...transaction,
        categoryId: suggestedCategoryId ?? '',
        isDuplicate,
        autoCategorized: suggestedCategoryId !== null
          && (!transaction.categoryId || transaction.categoryId === suggestedCategoryId),
      }
    })
  }

  const saveTransactionCategory = async (transaction: Transaction, categoryId: string) => {
    try {
      const saved = authenticated
        ? await updateRemoteTransactionCategory(transaction.id, categoryId)
        : { ...transaction, categoryId }
      setTransactions((current) => current.map((item) => item.id === transaction.id ? saved : item))
      setNotice('Transaction category updated')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update this transaction category.')
    }
  }

  const saveBudget = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const budget: Budget = {
      id: generateId(),
      workspaceId: session.selectedWorkspaceId,
      categoryId: String(values.get('categoryId')) || null,
      amount: Number(values.get('amount')),
      currency: selectedWorkspace.currency,
      period: 'monthly',
      startDate: `${String(values.get('month'))}-01`,
    }
    try {
      const saved = authenticated ? await createRemoteBudget(session.selectedWorkspaceId, budget) : budget
      setBudgetData((current) => [saved, ...current])
      setShowBudgetForm(false)
      setNotice('Monthly budget created')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create this budget.')
    }
  }

  const deleteTransaction = async (transaction: Transaction) => {
    if (!window.confirm(`Delete “${transaction.description || 'this transaction'}”?`)) return
    try {
      if (authenticated) await deleteRemoteTransaction(transaction.id)
      setTransactions((current) => current.filter((item) => item.id !== transaction.id))
      setNotice('Transaction deleted')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete this transaction.')
    }
  }

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const updated = {
      ...profile,
      name: String(values.get('name')).trim(),
      email: String(values.get('email')).trim(),
      preferredCurrency: String(values.get('currency')),
    }
    try {
      if (authenticated) await updateRemoteProfile(updated)
      setProfile(updated)
      setNotice('Profile settings saved')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save your profile.')
    }
  }

  const saveProfileName = async (name: string) => {
    const updated = { ...profile, name }
    if (authenticated) await updateRemoteProfile(updated)
    setProfile(updated)
    setNotice('Dashboard name updated')
  }

  const pageTitle = location.pathname === '/account'
    ? 'Account'
    : navigation.find((item) => item.to === location.pathname)?.label ?? 'Dashboard'

  const handleWorkspaceChange = (workspaceId: string) => {
    setSession((current) => ({ ...current, selectedWorkspaceId: workspaceId }))
  }

  const canAdminWorkspace = selectedWorkspace.type === 'organization' && ['owner', 'admin'].includes(workspaceRoles[selectedWorkspace.id] ?? '')

  const createWorkspace = async (name: string, currency: string) => {
    const created = authenticated
      ? await createRemoteOrganization(name, currency)
      : { workspace: { id: generateId(), name, currency, type: 'organization' as const }, categories: [] }
    const { workspace } = created
    setWorkspaces((current) => [...current, workspace])
    setWorkspaceRoles((current) => ({ ...current, [workspace.id]: 'owner' }))
    if (!authenticated) {
      setCategoryData((current) => [...current, ...[
        { name: 'Revenue', type: 'income' as const },
        { name: 'Operations', type: 'expense' as const },
        { name: 'Travel', type: 'expense' as const },
        { name: 'Software', type: 'expense' as const },
        { name: 'Meals & groceries', type: 'expense' as const },
        { name: 'Utilities', type: 'expense' as const },
        { name: 'Marketing', type: 'expense' as const },
        { name: 'Payroll', type: 'expense' as const },
      ].map((category) => ({ ...category, id: generateId(), workspaceId: workspace.id, ownerUserId: null, isDefault: true }))])
    } else {
      setCategoryData((current) => [...current, ...created.categories])
    }
    handleWorkspaceChange(workspace.id)
    setNotice('Organization workspace created')
  }

  return (
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true"><img src="/ChatGPT%20Image%20Oct%207,%202026,%2002_42_38%20PM.png" alt="" /></div>
            <div>
              <p className="eyebrow">Workspace</p>
              <h1>Expense Tracker</h1>
            </div>
          </div>

          <label className="field compact">
            <span>Workspace</span>
            <select
              value={session.selectedWorkspaceId}
              onChange={(event) => handleWorkspaceChange(event.target.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>

          <nav className="nav">
            {navigation.filter((item) => item.to !== '/admin' || canAdminWorkspace).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="sidebar-card">
            <p className="eyebrow">Current workspace</p>
            <strong>{selectedWorkspace.name}</strong>
            <small>{selectedWorkspace.type}</small>
          </div>
        </aside>

        <main className="content-panel">
          <header className="topbar">
            <div>
              <p className="eyebrow">{pageTitle}</p>
                  <h2>{location.pathname === '/' ? `Welcome${profile.name.trim() ? `, ${profile.name.trim()}` : ''}` : selectedWorkspace.name}</h2>
                  {location.pathname === '/' && <p className="workspace-context">{selectedWorkspace.name}</p>}
            </div>
            <div className="topbar-right">
              {location.pathname !== '/account' && <div className="topbar-actions">
                <div className="date-range-summary" aria-label={`Month to date, ${format(parseISO(dateRange.startDate), 'MMM d')} to ${format(parseISO(dateRange.endDate), 'MMM d')}`}>
                  <span className="date-range-icon"><CalendarDays size={17} aria-hidden="true" /></span>
                  <span><small>Month to date</small><strong>{format(parseISO(dateRange.startDate), 'MMM d')} – {format(parseISO(dateRange.endDate), 'MMM d')}</strong></span>
                </div>
                <button type="button" className="primary-button" onClick={() => openTransactionForm()}>Add transaction</button>
              </div>}
              <Link to="/account" className="account-trigger" aria-label="Open account details" title="Account details">
                <CircleUserRound size={21} strokeWidth={1.8} aria-hidden="true" />
                <span>{profile.name || 'Account'}</span>
                <ChevronDown size={15} aria-hidden="true" />
              </Link>
            </div>
          </header>

          {authenticated && categoryData.length === 0 && <p className="sync-status" role="status">Loading your secure workspace…</p>}
          <Routes>
            <Route
              path="/"
              element={
                <div className="page-grid">
                  <div className="panel-header dashboard-period-control">
                    <h3>Financial overview</h3>
                    <label className="field filter-field">
                      <span>Show</span>
                      <select aria-label="Dashboard date range" value={rangePreset} onChange={(event) => setRangePreset(event.target.value as typeof rangePreset)}>
                        <option value="all">All loaded history</option>
                        <option value="month">This month</option>
                        <option value="30days">Last 30 days</option>
                        <option value="12months">Last 12 months</option>
                      </select>
                    </label>
                  </div>
                  <section className="budget-hero" aria-labelledby="budget-hero-title">
                    <video
                      className="budget-hero-video"
                      autoPlay
                      muted
                      loop
                      playsInline
                      poster="https://images.pexels.com/videos/7735809/pexels-photo-7735809.jpeg?auto=compress&cs=tinysrgb&w=1600"
                      aria-hidden="true"
                    >
                      <source src="https://videos.pexels.com/video-files/7735809/7735809-hd_1920_1080_25fps.mp4" type="video/mp4" />
                    </video>
                    <div className="budget-hero-shade" aria-hidden="true" />
                    <div className="budget-hero-copy">
                      <p className="budget-hero-kicker"><span /> YOUR MONEY, IN FOCUS</p>
                      <h2 id="budget-hero-title">Feel good about where your money goes.</h2>
                      <p>See the full picture, build better habits, and make room for what matters.</p>
                      <div className="budget-hero-actions">
                        <button type="button" className="budget-hero-primary" onClick={() => openTransactionForm()}>
                          Add an expense <ArrowUpRight size={17} aria-hidden="true" />
                        </button>
                        <Link to="/budgets" className="budget-hero-secondary">
                          Explore budgets <ArrowUpRight size={16} aria-hidden="true" />
                        </Link>
                      </div>
                    </div>
                    <aside className="budget-hero-insight" aria-label={`Net this period: ${formatCurrency(summary.net, selectedWorkspace.currency)}`}>
                      <span className="budget-hero-insight-icon"><TrendingUp size={19} aria-hidden="true" /></span>
                      <span className="budget-hero-insight-label">Net this period</span>
                      <strong>{formatCurrency(summary.net, selectedWorkspace.currency)}</strong>
                      <small>Across your selected dates</small>
                    </aside>
                    <span className="budget-hero-caption">A clearer way forward</span>
                  </section>

                  <section className="summary-grid">
                    <article className="metric-card income">
                      <span>Total income</span>
                      <strong>{formatCurrency(summary.income, selectedWorkspace.currency)}</strong>
                    </article>
                    <article className="metric-card expense">
                      <span>Total expenses</span>
                      <strong>{formatCurrency(summary.expense, selectedWorkspace.currency)}</strong>
                    </article>
                    <article className="metric-card net">
                      <span>Net</span>
                      <strong>{formatCurrency(summary.net, selectedWorkspace.currency)}</strong>
                    </article>
                  </section>

                  <section className="panel-grid two-up">
                    <div className="panel card trend-panel">
                      <div className="panel-header">
                        <div>
                          <h3>Income and expense trend</h3>
                          <p className="trend-period-note">{rangePreset === 'all' || rangePreset === '12months' ? 'Monthly totals' : 'Daily totals'} · {dateRange.startDate} to {dateRange.endDate}</p>
                        </div>
                        <div className="chart-legend"><span><i className="bar income" />Income</span><span><i className="bar expense" />Expenses</span></div>
                      </div>
                      <div className="chart-shell trend-chart-shell">
                        <div className="trend-y-axis" aria-hidden="true">
                          {[1, 0.75, 0.5, 0.25, 0].map((fraction) => (
                            <small key={fraction}>{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(trendMaximum * fraction)}</small>
                          ))}
                        </div>
                        <div className="trend-plot">
                          <div className="trend-gridlines" aria-hidden="true">
                            {[1, 0.75, 0.5, 0.25, 0].map((fraction) => <span key={fraction} />)}
                          </div>
                          <div className="bar-chart" aria-label="Income and expense trend chart">
                          {trendData.map((item, index) => (
                            <div key={item.name} className="bar-group">
                              <div className="bar-stack">
                                <span
                                  className={item.income > 0 ? 'bar income' : 'bar income is-empty'}
                                  title={`${item.name} income: ${formatCurrency(item.income, selectedWorkspace.currency)}`}
                                  style={{ height: `${trendMaximum > 0 && item.income > 0 ? Math.max((item.income / trendMaximum) * 100, 2) : 2}%` }}
                                />
                                <span
                                  className={item.expense > 0 ? 'bar expense' : 'bar expense is-empty'}
                                  title={`${item.name} expenses: ${formatCurrency(item.expense, selectedWorkspace.currency)}`}
                                  style={{ height: `${trendMaximum > 0 && item.expense > 0 ? Math.max((item.expense / trendMaximum) * 100, 2) : 2}%` }}
                                />
                              </div>
                              <small>{trendData.length > 15 ? index % 5 === 0 ? item.name : '' : item.name}</small>
                            </div>
                          ))}
                          </div>
                        </div>
                      </div>
                      {summary.totalTransactions === 0 && <p className="empty-state-copy">No transactions in this date range. Import a statement or add a transaction to see your trend.</p>}
                    </div>

                    <div className="panel card category-breakdown-panel">
                      <h3>Category breakdown</h3>
                      <ul className="list list-plain">
                        {categoryBreakdown.map((item) => (
                          <li key={item.name} className="list-row">
                            <span>{item.name}</span>
                            <strong>{formatCurrency(item.value, selectedWorkspace.currency)}</strong>
                          </li>
                        ))}
                      </ul>
                      {categoryBreakdown.length === 0 && <p className="empty-state-copy">No expenses in this date range.</p>}
                    </div>
                  </section>

                  <section className="panel card">
                    <div className="panel-header">
                      <h3>Recent transactions</h3>
                      <Link className="text-button" to="/transactions">
                        View all
                      </Link>
                    </div>
                    <ul className="transaction-list">
                      {filteredTransactions.slice(0, 5).map((transaction) => {
                        const category = categoryData.find(
                          (item) => item.id === transaction.categoryId,
                        )
                        return (
                          <li key={transaction.id} className="transaction-row">
                            <div>
                              <strong>{category?.name ?? 'Uncategorized'}</strong>
                              <small>{transaction.description || 'No description'}</small>
                            </div>
                            <div className="transaction-meta">
                              <span className={transaction.type === 'income' ? 'pill income' : 'pill expense'}>
                                {transaction.type}
                              </span>
                              <strong>
                                {transaction.type === 'income' ? '+' : '-'}
                                {formatCurrency(transaction.amount, transaction.currency)}
                              </strong>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                    {filteredTransactions.length === 0 && <p className="empty-state-copy">No transactions in this date range.</p>}
                  </section>
                </div>
              }
            />

            <Route
              path="/transactions"
              element={
                <div className="panel card">
                  <div className="panel-header">
                    <h3>Transactions</h3>
                    <div className="transaction-actions transaction-split-action" role="group" aria-label="Transaction actions"><button type="button" className="primary-button transaction-add-button" onClick={() => openTransactionForm()}>Add transaction</button><button type="button" className="primary-button transaction-import-button" aria-label="Import PDF statement" title="Import PDF statement" onClick={() => setShowStatementImport(true)}><FileUp size={18} aria-hidden="true" /></button></div>
                  </div>
                  <div className="table-controls">
                    <label className="field filter-field"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Description" /></label>
                    <label className="field filter-field"><span>Type</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="all">All types</option><option value="income">Income</option><option value="expense">Expenses</option></select></label>
                  </div>
                  <div className="table-scroll"><table className="data-table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Type</th>
                        <th>Category</th>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactionList.map((transaction) => {
                        return (
                          <tr key={transaction.id}>
                            <td>{transaction.description || 'No description'}</td>
                            <td>{transaction.type}</td>
                            <td><select aria-label={`Category for ${transaction.description || 'transaction'}`} value={transaction.categoryId} onChange={(event) => saveTransactionCategory(transaction, event.target.value)}><option value="">Uncategorized</option>{categoryData.filter((item) => item.workspaceId === session.selectedWorkspaceId && (item.type === transaction.type || item.type === 'both')).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td>
                            <td>{transaction.transactionDate}</td>
                            <td>
                              {transaction.type === 'income' ? '+' : '-'}
                              {formatCurrency(transaction.amount, transaction.currency)}
                            </td>
                            <td className="row-actions"><button type="button" className="text-button" onClick={() => openTransactionForm(transaction)}>Edit</button><button type="button" className="danger-button" onClick={() => deleteTransaction(transaction)}>Delete</button></td>
                          </tr>
                        )
                      })}
                      {transactionList.length === 0 && <tr><td colSpan={6} className="empty-cell">No transactions match these filters.</td></tr>}
                    </tbody>
                  </table></div>
                </div>
              }
            />

            <Route
              path="/budgets"
              element={
                <div className="panel-grid">
                  <div className="section-heading"><div><p className="eyebrow">Monthly limits</p><h3>Budgets</h3></div><button type="button" className="primary-button" onClick={() => setShowBudgetForm(true)}>Create budget</button></div>
                  {budgets.map((budget) => {
                    const status = buildBudgetStatus(budget, transactions)
                    const category = categoryData.find((item) => item.id === budget.categoryId)
                    return (
                      <div key={budget.id} className="panel card budget-card">
                        <div className="panel-header">
                          <h3>{category?.name ?? 'Overall budget'}</h3>
                          <span className="progress-badge">{Math.round(status.progress)}%</span>
                        </div>
                        <p className="budget-total">{formatCurrency(budget.amount, budget.currency)}</p>
                        <div className="progress-bar">
                          <span style={{ width: `${Math.min(status.progress, 100)}%` }} />
                        </div>
                        <div className="budget-meta">
                          <span>Spent {formatCurrency(status.spent, budget.currency)}</span>
                          <span>Remaining {formatCurrency(status.remaining, budget.currency)}</span>
                        </div>
                      </div>
                    )
                  })}
                  {budgets.length === 0 && <div className="panel card empty-state"><h3>No budgets yet</h3><p>Create a monthly limit to track category spending.</p><button type="button" className="primary-button" onClick={() => setShowBudgetForm(true)}>Create budget</button></div>}
                </div>
              }
            />

            <Route
              path="/reports"
              element={
                <div className="panel card">
                  <div className="panel-header"><h3>Reports</h3><button type="button" className="primary-button" onClick={() => exportCsv([['Date', 'Description', 'Type', 'Category', 'Amount', 'Currency'], ...dateFilteredTransactions.map((transaction) => [transaction.transactionDate, transaction.description, transaction.type, categoryData.find((category) => category.id === transaction.categoryId)?.name ?? 'Uncategorized', String(transaction.amount), transaction.currency])], `expense-report-${dateRange.startDate}-to-${dateRange.endDate}.csv`)}>Export CSV</button></div>
                  <div className="report-summary">
                    <div>
                      <span>Income</span>
                      <strong>{formatCurrency(summary.income, selectedWorkspace.currency)}</strong>
                    </div>
                    <div>
                      <span>Expenses</span>
                      <strong>{formatCurrency(summary.expense, selectedWorkspace.currency)}</strong>
                    </div>
                    <div>
                      <span>Net</span>
                      <strong>{formatCurrency(summary.net, selectedWorkspace.currency)}</strong>
                    </div>
                  </div>
                  <h4 className="subheading">Spending by category</h4>
                  <ul className="list list-plain">{categoryBreakdown.map((item) => <li key={item.name} className="list-row"><span>{item.name}</span><strong>{formatCurrency(item.value, selectedWorkspace.currency)}</strong></li>)}</ul>
                  {categoryBreakdown.length === 0 && <p className="empty-state-copy">No expenses in this date range.</p>}
                </div>
              }
            />

            <Route
              path="/organization"
              element={<OrganizationPage workspaces={workspaces} workspaceRoles={workspaceRoles} onCreate={createWorkspace} />}
            />

            <Route
              path="/support"
              element={<SupportCenter key={`${session.userId}-${authenticated}`} workspaceId={session.selectedWorkspaceId} userId={session.userId} authenticated={authenticated} canAdminWorkspace={canAdminWorkspace} />}
            />

            <Route
              path="/admin"
              element={canAdminWorkspace ? <AdminDashboard key={selectedWorkspace.id} organizationId={selectedWorkspace.id} currency={selectedWorkspace.currency} authenticated={authenticated} transactions={transactions} budgets={budgetData} demoMemberCount={demoData.memberships.filter((membership) => membership.workspaceId === selectedWorkspace.id).length} currentUserId={session.userId} role={workspaceRoles[selectedWorkspace.id] ?? ''} /> : <div className="panel card"><h3>Access restricted</h3><p>An owner or admin role in the selected organization is required.</p></div>}
            />

            <Route
              path="/settings"
              element={
                <div className="panel card">
                  <h3>Profile & Settings</h3>
                  <form className="settings-form" onSubmit={saveProfile}>
                    <label className="field"><span>Full name</span><input name="name" required defaultValue={profile.name} /></label>
                    <label className="field"><span>Email</span><input name="email" type="email" required defaultValue={profile.email} /></label>
                    <label className="field"><span>Preferred currency</span><select name="currency" defaultValue={profile.preferredCurrency}><option value="NGN">NGN · Nigerian naira</option><option value="USD">USD · US dollar</option><option value="GBP">GBP · British pound</option><option value="EUR">EUR · Euro</option></select></label>
                    <button type="submit" className="primary-button">Save settings</button>
                  </form>
                </div>
              }
            />

            <Route
              path="/account"
              element={<AccountPage key={profile.name} profile={profile} workspace={selectedWorkspace} role={selectedWorkspace.type === 'organization' ? workspaceRoles[selectedWorkspace.id] ?? 'Member' : 'Owner'} transactions={transactions} categories={categoryData} onSaveName={saveProfileName} onSignOut={onSignOut} onSwitchAccount={onSwitchAccount} />}
            />
          </Routes>
        </main>
        {notice && <div className="toast" role="status">{notice}</div>}
        {showTransactionForm && (
          <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowTransactionForm(false) }}>
            <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="transaction-dialog-title">
              <div className="panel-header"><h3 id="transaction-dialog-title">{editingTransaction ? 'Edit transaction' : 'Add transaction'}</h3><button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setShowTransactionForm(false)}>×</button></div>
              <form className="dialog-form" onSubmit={saveTransaction}>
                <label className="field"><span>Description</span><input name="description" autoFocus defaultValue={editingTransaction?.description ?? ''} placeholder="e.g. Groceries" /></label>
                <div className="form-two-up"><label className="field"><span>Type</span><select name="type" value={transactionType} onChange={(event) => setTransactionType(event.target.value as Transaction['type'])}><option value="expense">Expense</option><option value="income">Income</option></select></label><label className="field"><span>Amount ({selectedWorkspace.currency})</span><input name="amount" type="number" min="0.01" step="0.01" required defaultValue={editingTransaction?.amount ?? ''} /></label></div>
                <div className="form-two-up"><label className="field"><span>Category</span><select key={transactionType} name="categoryId" defaultValue={editingTransaction?.categoryId ?? transactionCategories[0]?.id ?? ''}><option value="">Uncategorized</option>{transactionCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{transactionCategories.length === 0 && <small className="field-help">Create default categories by applying the Supabase schema, or switch to a workspace with categories.</small>}</label><label className="field"><span>Date</span><input name="transactionDate" type="date" required defaultValue={editingTransaction?.transactionDate ?? new Date().toISOString().slice(0, 10)} /></label></div>
                <div className="dialog-actions">{!editingTransaction && <button type="button" className="secondary-button transaction-dialog-import" onClick={() => { setShowTransactionForm(false); setShowStatementImport(true) }}><FileUp size={17} aria-hidden="true" /> Import PDF</button>}<button type="button" className="secondary-button" onClick={() => setShowTransactionForm(false)}>Cancel</button><button type="submit" className="primary-button">{editingTransaction ? 'Save changes' : 'Add transaction'}</button></div>
              </form>
            </section>
          </div>
        )}
        {showStatementImport && <Suspense fallback={<div className="loading-screen" role="status">Loading PDF tools…</div>}><StatementImportDialog currency={selectedWorkspace.currency} categories={categories} onClose={() => setShowStatementImport(false)} onPreview={previewStatementRows} onImport={importStatementRows} /></Suspense>}
        {showBudgetForm && (
          <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowBudgetForm(false) }}>
            <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="budget-dialog-title">
              <div className="panel-header"><h3 id="budget-dialog-title">Create monthly budget</h3><button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setShowBudgetForm(false)}>×</button></div>
              <form className="dialog-form" onSubmit={saveBudget}>
                <label className="field"><span>Category</span><select name="categoryId" defaultValue=""><option value="">Overall budget</option>{budgetCategories.map((category) => <option key={category.id} value={category.id}>{category.name} budget</option>)}</select>{budgetCategories.length === 0 && <small className="field-help">Expense categories will appear when your workspace data finishes loading.</small>}</label>
                <label className="field"><span>Monthly limit ({selectedWorkspace.currency})</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
                <label className="field"><span>Month</span><input name="month" type="month" required min={currentMonth} defaultValue={currentMonth} /></label>
                <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setShowBudgetForm(false)}>Cancel</button><button type="submit" className="primary-button">Create budget</button></div>
              </form>
            </section>
          </div>
        )}
      </div>
  )
}

export default App
