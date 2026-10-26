import { useEffect, useState, type FormEvent } from 'react'

import { fetchAdminOverview, fetchOrganizationMembers, inviteOrganizationMember, removeOrganizationMember, updateOrganizationMemberRole, type AdminMember } from '../../lib/api'
import { formatCurrency } from '../../utils/finance'
import type { Budget, Transaction } from '../../types'

interface AdminOverviewData {
  member_count: number
  transaction_count: number
  budget_count: number
  income: string
  expenses: string
  net: string
  recent_transactions: { id: string; transaction_type: 'income' | 'expense'; amount: string; description: string; transaction_date: string }[]
}

interface AdminDashboardProps {
  organizationId: string
  currency: string
  authenticated: boolean
  transactions: Transaction[]
  budgets: Budget[]
  demoMemberCount: number
  currentUserId: string
  role: string
}

export function AdminDashboard({ organizationId, currency, authenticated, transactions, budgets, demoMemberCount, currentUserId, role }: AdminDashboardProps) {
  const [overview, setOverview] = useState<AdminOverviewData | null>(null)
  const [members, setMembers] = useState<AdminMember[]>([])
  const [membersLoading, setMembersLoading] = useState(authenticated)
  const [memberBusy, setMemberBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!authenticated) return
    let active = true
    fetchAdminOverview(organizationId).then((data) => {
      if (active) {
        setOverview(data)
      }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Unable to load admin data.')
    })
    fetchOrganizationMembers(organizationId).then((data) => {
      if (active) {
        setMembers(data)
        setMembersLoading(false)
      }
    }).catch((caught: unknown) => {
      if (active) {
        setError(caught instanceof Error ? caught.message : 'Unable to load workspace members.')
        setMembersLoading(false)
      }
    })
    return () => { active = false }
  }, [authenticated, organizationId])

  const refreshMembers = async () => {
    const data = await fetchOrganizationMembers(organizationId)
    setMembers(data)
    setOverview((current) => current ? { ...current, member_count: data.length } : current)
  }

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setMemberBusy(true)
    setError('')
    setMessage('')
    try {
      const invited = await inviteOrganizationMember(
        organizationId,
        String(values.get('email')).trim(),
        String(values.get('role')) as 'admin' | 'member',
      )
      await refreshMembers()
      form.reset()
      setMessage(invited.invitation_sent
        ? `Supabase accepted the invitation request for ${invited.email}. Ask them to check their inbox and spam folder.`
        : `${invited.email} already has an account and was added to the workspace.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not invite this member.')
    } finally {
      setMemberBusy(false)
    }
  }

  const changeMemberRole = async (member: AdminMember, nextRole: 'admin' | 'member') => {
    setMemberBusy(true)
    setError('')
    setMessage('')
    try {
      await updateOrganizationMemberRole(organizationId, member.user_id, nextRole)
      await refreshMembers()
      setMessage(`Updated ${member.email}'s role.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update this member role.')
    } finally {
      setMemberBusy(false)
    }
  }

  const removeMember = async (member: AdminMember) => {
    if (!window.confirm(`Remove ${member.email} from this organization?`)) return
    setMemberBusy(true)
    setError('')
    setMessage('')
    try {
      await removeOrganizationMember(organizationId, member.user_id)
      await refreshMembers()
      setMessage(`${member.email} was removed from the organization.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this member.')
    } finally {
      setMemberBusy(false)
    }
  }

  const workspaceTransactions = transactions.filter((transaction) => transaction.workspaceId === organizationId)
  const income = workspaceTransactions.filter((transaction) => transaction.type === 'income').reduce((sum, transaction) => sum + transaction.amount, 0)
  const expenses = workspaceTransactions.filter((transaction) => transaction.type === 'expense').reduce((sum, transaction) => sum + transaction.amount, 0)
  const rows = overview?.recent_transactions ?? workspaceTransactions.slice(0, 8).map((transaction) => ({
    id: transaction.id,
    transaction_type: transaction.type,
    amount: String(transaction.amount),
    description: transaction.description,
    transaction_date: transaction.transactionDate,
  }))

  return (
    <section className="admin-page">
      <div className="section-heading"><div><p className="eyebrow">Workspace controls</p><h3>Admin dashboard</h3></div><span className="role-label">Owner / Admin</span></div>
      {error && <p className="auth-message error" role="alert">{error}</p>}
      <div className="summary-grid admin-metrics">
        <article className="metric-card net"><span>Members</span><strong>{overview?.member_count ?? demoMemberCount}</strong></article>
        <article className="metric-card income"><span>Transactions</span><strong>{overview?.transaction_count ?? workspaceTransactions.length}</strong></article>
        <article className="metric-card expense"><span>Active budgets</span><strong>{overview?.budget_count ?? budgets.filter((budget) => budget.workspaceId === organizationId).length}</strong></article>
      </div>
      <div className="report-summary admin-totals">
        <div><span>Income recorded</span><strong>{formatCurrency(Number(overview?.income ?? income), currency)}</strong></div>
        <div><span>Expenses recorded</span><strong>{formatCurrency(Number(overview?.expenses ?? expenses), currency)}</strong></div>
        <div><span>Net position</span><strong>{formatCurrency(Number(overview?.net ?? income - expenses), currency)}</strong></div>
      </div>
      <section className="panel card admin-activity">
        <div className="panel-header"><h3>Recent workspace activity</h3><span className="sync-status">Workspace data</span></div>
        {rows.length === 0 ? <p className="empty-state-copy">No workspace activity yet.</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Description</th><th>Type</th><th>Date</th><th>Amount</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.description || 'No description'}</td><td>{row.transaction_type}</td><td>{row.transaction_date}</td><td>{formatCurrency(Number(row.amount), currency)}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="panel card admin-members">
        <div className="panel-header"><div><h3>Members and roles</h3><p className="empty-state-copy">Manage access to this organization's workspace.</p></div></div>
        {authenticated ? <>
          <form className="admin-invite-form" onSubmit={inviteMember}>
            <label className="field"><span>Email address</span><input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="person@example.com" /></label>
            <label className="field"><span>Invite as</span><select name="role" defaultValue="member"><option value="member">Member</option>{role === 'owner' && <option value="admin">Admin</option>}</select></label>
            <button type="submit" className="primary-button" disabled={memberBusy}>{memberBusy ? 'Working…' : 'Send invitation'}</button>
          </form>
          <p className="empty-state-copy">Invitation emails are delivered by Supabase Auth. If the recipient does not receive one, check the email address and configure custom SMTP in Supabase Auth settings.</p>
          {message && <p className="statement-status" role="status">{message}</p>}
          {membersLoading ? <p className="empty-state-copy">Loading members…</p> : members.length === 0 ? <p className="empty-state-copy">No members found.</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead><tbody>{members.map((member) => {
            const canManage = member.role !== 'owner'
              && member.user_id !== currentUserId
              && (role === 'owner' || member.role === 'member')
            return <tr key={member.user_id}>
              <td><strong>{member.full_name || member.email}</strong><small>{member.full_name ? member.email : ''}</small></td>
              <td>{canManage && role === 'owner' ? <select aria-label={`Role for ${member.email}`} value={member.role} disabled={memberBusy} onChange={(event) => changeMemberRole(member, event.target.value as 'admin' | 'member')}><option value="member">Member</option><option value="admin">Admin</option></select> : <span className="role-label">{member.role}{member.user_id === currentUserId ? ' · you' : ''}</span>}</td>
              <td>{member.created_at ? member.created_at.slice(0, 10) : '—'}</td>
              <td>{canManage ? <button type="button" className="secondary-button" onClick={() => removeMember(member)} disabled={memberBusy}>Remove</button> : member.role === 'owner' ? 'Workspace owner' : '—'}</td>
            </tr>
          })}</tbody></table></div>}
        </> : <p className="empty-state-copy">Sign in to manage organization members.</p>}
      </section>
    </section>
  )
}
