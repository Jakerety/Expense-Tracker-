import { useState, type FormEvent } from 'react'
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import { LogOut, Repeat2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { Category, Transaction, User, Workspace } from '../../types'
import { formatCurrency } from '../../utils/finance'

interface AccountPageProps {
  profile: User
  workspace: Workspace
  role: string
  transactions: Transaction[]
  categories: Category[]
  onSaveName: (name: string) => Promise<void>
  onSignOut: () => void
  onSwitchAccount: () => void
}

const chartColors = ['#0f766e', '#f97316', '#2563eb', '#a16207', '#db2777', '#475569']

export function AccountPage({ profile, workspace, role, transactions, categories, onSaveName, onSignOut, onSwitchAccount }: AccountPageProps) {
  const [nameBusy, setNameBusy] = useState(false)
  const [nameError, setNameError] = useState('')

  const workspaceTransactions = transactions.filter((transaction) => transaction.workspaceId === workspace.id)
  const income = workspaceTransactions.filter((transaction) => transaction.type === 'income').reduce((sum, transaction) => sum + Number(transaction.amount), 0)
  const expenses = workspaceTransactions.filter((transaction) => transaction.type === 'expense').reduce((sum, transaction) => sum + Number(transaction.amount), 0)
  const categoryTotals = categories
    .map((category) => ({
      name: category.name,
      amount: workspaceTransactions
        .filter((transaction) => transaction.type === 'expense' && transaction.categoryId === category.id)
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0),
    }))
    .filter((category) => category.amount > 0)
    .sort((current, next) => next.amount - current.amount)
  const now = new Date()
  const monthlyData = Array.from({ length: 6 }, (_, index) => {
    const month = startOfMonth(subMonths(now, 5 - index))
    const monthTransactions = workspaceTransactions.filter((transaction) => {
      const date = new Date(`${transaction.transactionDate}T00:00:00`)
      return date >= month && date <= endOfMonth(month)
    })
    return {
      month: format(month, 'MMM yy'),
      income: monthTransactions.filter((transaction) => transaction.type === 'income').reduce((sum, transaction) => sum + Number(transaction.amount), 0),
      expenses: monthTransactions.filter((transaction) => transaction.type === 'expense').reduce((sum, transaction) => sum + Number(transaction.amount), 0),
    }
  })
  const initials = profile.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U'
  const mostRecent = [...workspaceTransactions].sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)).slice(0, 5)

  const saveName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const name = String(new FormData(form).get('displayName') ?? '').trim()
    if (!name) {
      setNameError('Enter a name to show on your dashboard.')
      return
    }
    setNameBusy(true)
    setNameError('')
    try {
      await onSaveName(name)
    } catch (caught) {
      setNameError(caught instanceof Error ? caught.message : 'Could not save your name.')
    } finally {
      setNameBusy(false)
    }
  }

  return (
    <div className="account-page">
      <section className="account-identity panel card">
        <div className="account-profile">
          <div className="account-avatar" aria-hidden="true">{initials}</div>
          <div className="account-profile-copy">
            <p className="eyebrow">Account profile</p>
            <h3>{profile.name || 'Your account'}</h3>
            <p>{profile.email || 'No email available'}</p>
          </div>
        </div>
        <dl className="account-details">
          <div><dt>Workspace</dt><dd>{workspace.name}</dd></div>
          <div><dt>Workspace type</dt><dd>{workspace.type === 'organization' ? 'Organization' : 'Personal'}</dd></div>
          <div><dt>Role</dt><dd>{role}</dd></div>
          <div><dt>Preferred currency</dt><dd>{profile.preferredCurrency}</dd></div>
        </dl>
        <div className="account-actions">
          <button type="button" className="secondary-button" onClick={onSwitchAccount}><Repeat2 size={17} aria-hidden="true" /> Switch account</button>
          <button type="button" className="danger-outline-button" onClick={onSignOut}><LogOut size={17} aria-hidden="true" /> Sign out</button>
        </div>
        <form className="account-name-form" onSubmit={saveName}>
          <label className="field">
            <span>Name shown on your dashboard</span>
            <input name="displayName" type="text" minLength={2} maxLength={120} required defaultValue={profile.name} placeholder="Enter your name" />
          </label>
          <button type="submit" className="primary-button" disabled={nameBusy}>{nameBusy ? 'Saving…' : 'Save name'}</button>
          {nameError && <p className="auth-message error" role="alert">{nameError}</p>}
        </form>
      </section>

      <section className="account-finances" aria-labelledby="account-finances-heading">
        <div className="section-heading"><div><p className="eyebrow">Financial activity</p><h3 id="account-finances-heading">Your spending summary</h3></div><span className="account-period">All recorded activity</span></div>
        <div className="summary-grid account-summary-grid">
          <article className="metric-card income"><span>Total income</span><strong>{formatCurrency(income, workspace.currency)}</strong></article>
          <article className="metric-card expense"><span>Total expenses</span><strong>{formatCurrency(expenses, workspace.currency)}</strong></article>
          <article className="metric-card net"><span>Net balance</span><strong>{formatCurrency(income - expenses, workspace.currency)}</strong></article>
        </div>
        <section className="panel card account-chart-panel">
          <div className="panel-header"><div><h4>Income and expenses</h4><p>Monthly totals for the last six months</p></div><div className="chart-legend"><span><i className="legend-income" />Income</span><span><i className="legend-expense" />Expenses</span></div></div>
          <div className="account-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}><CartesianGrid stroke="#e8edf2" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12 }} /><YAxis tickLine={false} axisLine={false} width={58} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)} /><Tooltip formatter={(value) => formatCurrency(Number(value), workspace.currency)} /><Bar dataKey="income" name="Income" fill="#0f766e" radius={[4, 4, 0, 0]} maxBarSize={28} /><Bar dataKey="expenses" name="Expenses" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={28} /></BarChart></ResponsiveContainer></div>
        </section>

        <div className="account-detail-grid">
          <section className="panel card account-category-panel">
            <div className="panel-header"><div><h4>Spending by category</h4><p>All recorded expenses</p></div></div>
            {categoryTotals.length ? <div className="account-category-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={categoryTotals} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={116} tickLine={false} axisLine={false} tick={{ fill: '#475569', fontSize: 12 }} /><Tooltip formatter={(value) => formatCurrency(Number(value), workspace.currency)} /><Bar dataKey="amount" name="Spent" radius={[0, 4, 4, 0]}>{categoryTotals.map((category, index) => <Cell key={category.name} fill={chartColors[index % chartColors.length]} />)}</Bar></BarChart></ResponsiveContainer></div> : <p className="empty-state-copy">No expenses recorded for this workspace yet.</p>}
          </section>
          <section className="panel card account-recent-panel">
            <div className="panel-header"><div><h4>Recent activity</h4><p>Latest workspace transactions</p></div></div>
            {mostRecent.length ? <ul className="account-recent-list">{mostRecent.map((transaction) => <li key={transaction.id}><div><strong>{transaction.description || categories.find((category) => category.id === transaction.categoryId)?.name || 'Transaction'}</strong><small>{format(new Date(`${transaction.transactionDate}T00:00:00`), 'MMM d, yyyy')}</small></div><strong className={transaction.type === 'income' ? 'account-positive' : 'account-negative'}>{transaction.type === 'income' ? '+' : '-'}{formatCurrency(transaction.amount, transaction.currency)}</strong></li>)}</ul> : <p className="empty-state-copy">No recent activity.</p>}
          </section>
        </div>
      </section>
    </div>
  )
}
