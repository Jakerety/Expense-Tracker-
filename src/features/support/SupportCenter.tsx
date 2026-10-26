import { useEffect, useState, type FormEvent } from 'react'

import { createSupportTicket, getSupportAdminAccess, listSupportInboxTickets, listSupportMessages, listSupportTickets, postSupportMessage, setSupportTicketStatus } from '../../lib/api'

export type TicketStatus = 'open' | 'in_progress' | 'resolved'
export interface SupportTicket { id: string; requesterId: string; subject: string; status: TicketStatus; organizationId: string | null; createdAt: string }
export interface SupportMessage { id: string; ticketId: string; senderId: string; body: string; createdAt: string }

interface SupportCenterProps {
  workspaceId: string
  userId: string
  authenticated: boolean
  canAdminWorkspace: boolean
}

const ticketsKey = 'expense-tracker-demo-support-tickets'
const messagesKey = 'expense-tracker-demo-support-messages'

function readDemo<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') as T[] } catch { return [] }
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function SupportCenter({ workspaceId, userId, authenticated, canAdminWorkspace }: SupportCenterProps) {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [selectedTicketId, setSelectedTicketId] = useState('')
  const [isSupportAdmin, setIsSupportAdmin] = useState(false)
  const [supportAccessChecked, setSupportAccessChecked] = useState(!authenticated)
  const [inboxMode, setInboxMode] = useState<'workspace' | 'team'>('workspace')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!authenticated) return
    let active = true
    getSupportAdminAccess().then((access) => {
      if (!active) return
      setIsSupportAdmin(access)
      setSupportAccessChecked(true)
    }).catch((caught: unknown) => {
      if (!active) return
      setError(caught instanceof Error ? caught.message : 'Could not verify support inbox access.')
      setSupportAccessChecked(true)
    })
    return () => { active = false }
  }, [authenticated])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        if (!supportAccessChecked || (inboxMode === 'team' && !isSupportAdmin)) return
        const next = inboxMode === 'team'
          ? await listSupportInboxTickets()
          : authenticated
            ? await listSupportTickets(workspaceId)
            : readDemo<SupportTicket>(ticketsKey).filter((ticket) => ticket.organizationId === (workspaceId === 'personal' ? null : workspaceId))
        if (!active) return
        setTickets(next)
        setSelectedTicketId((current) => next.some((ticket) => ticket.id === current) ? current : next[0]?.id ?? '')
        setError('')
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load support tickets.')
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 12000)
    return () => { active = false; window.clearInterval(timer) }
  }, [authenticated, inboxMode, isSupportAdmin, supportAccessChecked, workspaceId])

  useEffect(() => {
    if (!selectedTicketId) {
      return
    }
    let active = true
    const refresh = async () => {
      try {
        const next = authenticated
          ? await listSupportMessages(selectedTicketId)
          : readDemo<SupportMessage>(messagesKey).filter((message) => message.ticketId === selectedTicketId)
        if (active) setMessages(next)
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load this conversation.')
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 8000)
    return () => { active = false; window.clearInterval(timer) }
  }, [authenticated, selectedTicketId])

  const createTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true)
    try {
      const subject = String(values.get('subject')).trim()
      const body = String(values.get('message')).trim()
      let ticket: SupportTicket
      if (authenticated) {
        ticket = await createSupportTicket(workspaceId, subject, body)
      } else {
        ticket = { id: newId(), requesterId: userId, subject, status: 'open', organizationId: workspaceId === 'personal' ? null : workspaceId, createdAt: new Date().toISOString() }
        localStorage.setItem(ticketsKey, JSON.stringify([ticket, ...readDemo<SupportTicket>(ticketsKey)]))
        localStorage.setItem(messagesKey, JSON.stringify([{ id: newId(), ticketId: ticket.id, senderId: 'demo-user', body, createdAt: new Date().toISOString() }, ...readDemo<SupportMessage>(messagesKey)]))
      }
      setTickets((current) => [ticket, ...current])
      setSelectedTicketId(ticket.id)
      form.reset()
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create your support request.')
    } finally { setBusy(false) }
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const body = String(values.get('message')).trim()
    if (!body) return
    setBusy(true)
    try {
      if (authenticated) {
        await postSupportMessage(selectedTicketId, body)
        setMessages(await listSupportMessages(selectedTicketId))
      } else {
        const message: SupportMessage = { id: newId(), ticketId: selectedTicketId, senderId: 'demo-user', body, createdAt: new Date().toISOString() }
        const next = [...readDemo<SupportMessage>(messagesKey), message]
        localStorage.setItem(messagesKey, JSON.stringify(next))
        setMessages(next.filter((item) => item.ticketId === selectedTicketId))
      }
      form.reset()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send this message.')
    } finally { setBusy(false) }
  }

  const updateStatus = async (status: TicketStatus) => {
    if (!selectedTicketId) return
    try {
      if (authenticated) await setSupportTicketStatus(selectedTicketId, status)
      const next = tickets.map((ticket) => ticket.id === selectedTicketId ? { ...ticket, status } : ticket)
      setTickets(next)
      if (!authenticated) localStorage.setItem(ticketsKey, JSON.stringify(next))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update ticket status.')
    }
  }

  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId)
  const canManageTicket = isSupportAdmin || canAdminWorkspace
  const switchInbox = (mode: 'workspace' | 'team') => {
    setInboxMode(mode)
    setSelectedTicketId('')
    setMessages([])
    setError('')
  }

  return (
    <section className="support-page">
      <div className="section-heading"><div><p className="eyebrow">Support desk</p><h3>Live support</h3></div><span className="sync-status">{authenticated ? 'Connected' : 'Demo inbox'}</span></div>
      {error && <p className="auth-message error" role="alert">{error}</p>}
      {isSupportAdmin && <div className="support-inbox-tabs" role="tablist" aria-label="Support inbox views">
        <button type="button" role="tab" aria-selected={inboxMode === 'workspace'} className={inboxMode === 'workspace' ? 'selected' : ''} onClick={() => switchInbox('workspace')}>My workspace</button>
        <button type="button" role="tab" aria-selected={inboxMode === 'team'} className={inboxMode === 'team' ? 'selected' : ''} onClick={() => switchInbox('team')}>Support inbox</button>
      </div>}
      {inboxMode === 'team' && <div className="support-inbox-intro panel card"><strong>Incoming support queries</strong><p>Review tickets from all workspaces and reply directly to the requester. The newest activity appears first.</p></div>}
      <div className="support-layout">
        <aside className="support-tickets panel card">
          <h4>{inboxMode === 'team' ? 'Incoming queries' : 'Conversations'}</h4>
          {!supportAccessChecked
            ? <p className="empty-state-copy">Checking support inbox access…</p>
            : <ul className="list list-plain">{tickets.map((ticket) => <li key={ticket.id}><button type="button" className={selectedTicketId === ticket.id ? 'ticket-link active' : 'ticket-link'} onClick={() => setSelectedTicketId(ticket.id)}><strong>{ticket.subject}</strong><small>{ticket.status.replace('_', ' ')}</small>{inboxMode === 'team' && <small>{ticket.organizationId ? `Organization ${ticket.organizationId.slice(0, 8)}` : 'Personal workspace'} · Requester {ticket.requesterId.slice(0, 8)}</small>}</button></li>)}</ul>}
          {supportAccessChecked && tickets.length === 0 && <p className="empty-state-copy">{inboxMode === 'team' ? 'No support queries yet.' : 'No support conversations yet.'}</p>}
        </aside>
        <section className="support-conversation panel card" aria-label={inboxMode === 'team' ? 'Support inbox conversation' : 'Support conversation'}>
          {selectedTicket ? <>
            <div className="panel-header"><div><h4>{selectedTicket.subject}</h4><small>{inboxMode === 'team' ? `Requester ${selectedTicket.requesterId.slice(0, 8)} · ${selectedTicket.organizationId ? `Organization ${selectedTicket.organizationId.slice(0, 8)}` : 'Personal workspace'}` : selectedTicket.status.replace('_', ' ')}</small></div>{canManageTicket && <select aria-label="Ticket status" value={selectedTicket.status} onChange={(event) => void updateStatus(event.target.value as TicketStatus)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select>}</div>
            <div className="support-messages" aria-live="polite">{messages.map((message) => <article key={message.id} className="support-message"><strong>{message.senderId === userId || (!authenticated && message.senderId === 'demo-user') ? 'You' : inboxMode === 'team' ? 'Requester' : 'Support team'}</strong><p>{message.body}</p><time>{new Date(message.createdAt).toLocaleString()}</time></article>)}</div>
            {selectedTicket.status === 'resolved'
              ? <p className="support-resolved-note">This query is resolved. Reopen it to send another reply.</p>
              : <form className="support-reply" onSubmit={sendMessage}><label className="field"><span>{inboxMode === 'team' ? 'Reply to requester' : 'Reply'}</span><textarea name="message" maxLength={3000} required placeholder={inboxMode === 'team' ? 'Write a response to this query…' : 'Write a message…'} disabled={busy} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Sending…' : inboxMode === 'team' ? 'Send response' : 'Send reply'}</button></form>}
          </> : <div className="empty-state"><h4>{inboxMode === 'team' ? 'Select a support query' : 'Start a conversation'}</h4><p>{inboxMode === 'team' ? 'Choose a ticket to read the conversation and respond.' : 'Send a message to the support team.'}</p></div>}
        </section>
      </div>
      {inboxMode === 'workspace' && <form className="panel card support-new-ticket" onSubmit={createTicket}><h4>New support request</h4><div className="form-two-up"><label className="field"><span>Subject</span><input name="subject" minLength={4} maxLength={140} required placeholder="What can we help with?" /></label><label className="field"><span>Message</span><input name="message" maxLength={3000} required placeholder="Describe the issue briefly" /></label></div><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Open support request'}</button></form>}
    </section>
  )
}
