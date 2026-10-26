import { afterEach, describe, expect, it, vi } from 'vitest'

const { auth } = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    refreshSession: vi.fn(),
  },
}))

vi.mock('./supabase', () => ({
  supabase: { auth },
}))

import { listCategories } from './api'

describe('authenticated API requests', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    auth.getSession.mockReset()
    auth.refreshSession.mockReset()
  })

  it('refreshes an expired access token and retries the request once', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'expired-token' } },
    })
    auth.refreshSession.mockResolvedValue({
      data: { session: { access_token: 'refreshed-token' } },
      error: null,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'The access token is invalid or expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    await expect(listCategories('personal')).resolves.toEqual([])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer expired-token')
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer refreshed-token')
    expect(auth.refreshSession).toHaveBeenCalledOnce()
  })

  it('asks the user to sign in again when the expired session cannot be refreshed', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'expired-token' } },
    })
    auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: new Error('Refresh token is invalid'),
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ detail: 'The access token is invalid or expired' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ))

    await expect(listCategories('personal')).rejects.toThrow('Your session has expired. Sign in again to continue.')
  })
})
