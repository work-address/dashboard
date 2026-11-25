import { allSettled, fork } from 'effector'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $isProjectDialogOpen,
  projectDeleteRequested,
} from './projects-table.model'

const { remove, confirm, toast } = vi.hoisted(() => ({
  remove: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('@/entities/projects', async () => {
  const { createEvent } = await import('effector')
  const { createMutation } = await import('@farfetched/core')
  return {
    changeProjectStateFilter: createEvent(),
    deleteProjectMutation: createMutation({ handler: remove }),
  }
})
vi.mock('@/shared', async () => {
  const { createEffect } = await import('effector')
  return {
    confirmFx: createEffect(confirm),
    showToastFx: createEffect(toast),
    translate: (key: string) => key,
  }
})

const row = { id: 'p1', name: 'Creds' } as never

describe('deleting a project', () => {
  beforeEach(() => {
    remove.mockReset().mockResolvedValue()
    confirm.mockReset()
    toast.mockReset()
  })

  it('deletes the project the user confirmed', async () => {
    confirm.mockResolvedValue({})
    const scope = fork({ values: [[$isProjectDialogOpen, true]] })

    await allSettled(projectDeleteRequested, { scope, params: row })

    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls[0][0]).toBe('p1')
    expect(scope.getState($isProjectDialogOpen)).toBe(false)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        messageKey: 'dashboard.projectsTable.deletedMessage',
      }),
    )
  })

  it('deletes nothing when the user cancels', async () => {
    confirm.mockRejectedValue({})
    const scope = fork({ values: [[$isProjectDialogOpen, true]] })

    await allSettled(projectDeleteRequested, { scope, params: row })

    expect(remove).not.toHaveBeenCalled()
    expect(scope.getState($isProjectDialogOpen)).toBe(true)
  })

  it('does not reuse a cancelled id for the next delete', async () => {
    const scope = fork()
    confirm.mockRejectedValueOnce({}).mockResolvedValueOnce({})

    await allSettled(projectDeleteRequested, { scope, params: row })
    await allSettled(projectDeleteRequested, {
      scope,
      params: { id: 'p2' } as never,
    })

    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls[0][0]).toBe('p2')
  })
})
