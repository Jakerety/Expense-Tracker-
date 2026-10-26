import { useState, type FormEvent } from 'react'

import type { Workspace } from '../../types'

interface OrganizationPageProps {
  workspaces: Workspace[]
  workspaceRoles: Record<string, string>
  onCreate: (name: string, currency: string) => Promise<void>
}

export function OrganizationPage({ workspaces, workspaceRoles, onCreate }: OrganizationPageProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true)
    setError('')
    try {
      await onCreate(String(values.get('name')).trim(), String(values.get('currency')))
      form.reset()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the workspace.')
    } finally { setBusy(false) }
  }

  return (
    <section className="organization-page">
      <div className="section-heading"><div><p className="eyebrow">Shared finances</p><h3>Organization workspaces</h3></div></div>
      {error && <p className="auth-message error" role="alert">{error}</p>}
      <section className="panel card"><h4>Create an organization</h4><form className="form-two-up organization-form" onSubmit={submit}><label className="field"><span>Workspace name</span><input name="name" minLength={2} maxLength={120} required placeholder="e.g. Northstar Studio" /></label><label className="field"><span>Currency</span><select name="currency" defaultValue="NGN"><option value="NGN">NGN</option><option value="USD">USD</option><option value="GBP">GBP</option><option value="EUR">EUR</option></select></label><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button></form></section>
      <section className="panel card organization-list"><h4>Your workspaces</h4><ul className="list list-plain">{workspaces.filter((workspace) => workspace.type === 'organization').map((workspace) => <li className="list-row" key={workspace.id}><span><strong>{workspace.name}</strong><small>{workspace.currency}</small></span><span className="role-label">{workspaceRoles[workspace.id] ?? 'member'}</span></li>)}</ul>{workspaces.every((workspace) => workspace.type !== 'organization') && <p className="empty-state-copy">No organization workspaces yet.</p>}</section>
    </section>
  )
}
