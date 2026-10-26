import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getSupportAdminAccess, listSupportInboxTickets, listSupportMessages, listSupportTickets, postSupportMessage } from '../../lib/api'
import { SupportCenter } from './SupportCenter'

vi.mock('../../lib/api', () => ({
  createSupportTicket: vi.fn(),
  getSupportAdminAccess: vi.fn(),
  listSupportInboxTickets: vi.fn(),
  listSupportMessages: vi.fn(),
  listSupportTickets: vi.fn(),
  postSupportMessage: vi.fn(),
  setSupportTicketStatus: vi.fn(),
}))

const ticket = {
  id: 'ticket-1',
  requesterId: 'requester-1',
  subject: 'Cannot reset my password',
  status: 'open' as const,
  organizationId: null,
  createdAt: '2026-10-19T10:00:00Z',
}

describe('SupportCenter support inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSupportAdminAccess).mockResolvedValue(true)
    vi.mocked(listSupportTickets).mockResolvedValue([])
    vi.mocked(listSupportInboxTickets).mockResolvedValue([ticket])
    vi.mocked(listSupportMessages).mockResolvedValue([{
      id: 'message-1',
      ticketId: ticket.id,
      senderId: ticket.requesterId,
      body: 'I cannot get the reset email.',
      createdAt: '2026-10-19T10:01:00Z',
    }])
    vi.mocked(postSupportMessage).mockResolvedValue({
      id: 'message-2',
      ticketId: ticket.id,
      senderId: 'support-user',
      body: 'Please check your spam folder.',
      createdAt: '2026-10-19T10:02:00Z',
    })
  })

  it('shows all incoming tickets to support staff and allows a reply', async () => {
    render(<SupportCenter workspaceId="personal" userId="support-user" authenticated canAdminWorkspace={false} />)

    await screen.findByRole('tab', { name: 'Support inbox' })
    fireEvent.click(screen.getByRole('tab', { name: 'Support inbox' }))

    expect(await screen.findByRole('button', { name: /Cannot reset my password/ })).toBeInTheDocument()
    expect(listSupportInboxTickets).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Cannot reset my password/ }))
    expect(await screen.findByText('I cannot get the reset email.')).toBeInTheDocument()
    expect(screen.getByText('Requester')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Reply to requester' }), {
      target: { value: 'Please check your spam folder.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send response' }))

    await waitFor(() => expect(postSupportMessage).toHaveBeenCalledWith(ticket.id, 'Please check your spam folder.'))
  })

  it('does not show the staff inbox to regular users', async () => {
    vi.mocked(getSupportAdminAccess).mockResolvedValue(false)
    render(<SupportCenter workspaceId="personal" userId="user-1" authenticated canAdminWorkspace={false} />)

    await waitFor(() => expect(getSupportAdminAccess).toHaveResolved())
    expect(screen.queryByRole('tab', { name: 'Support inbox' })).not.toBeInTheDocument()
    expect(listSupportInboxTickets).not.toHaveBeenCalled()
  })
})
