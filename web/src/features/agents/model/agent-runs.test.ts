import { describe, expect, it } from 'vitest'

import { agentRunMode, readAgentRunFilters, type AgentRun } from './agent-runs'

import { routes } from '@/routes'

const PROJECT = '0b6c6f6e-6b1a-4c3e-9a51-2f0b7c1d9e01'
const PERSON = '5f2d1c3b-8e4a-4b7f-a0c9-6d1e2f3a4b5c'

const now = new Date(2026, 10, 14, 12)

describe('readAgentRunFilters', () => {
  it('falls back to the last seven days', () => {
    expect(readAgentRunFilters(new URLSearchParams(), now)).toMatchObject({
      from: '2026-11-08',
      to: '2026-11-14',
    })
    // days the wrong way round are not a range either
    expect(
      readAgentRunFilters(
        new URLSearchParams({ from: '2026-11-10', to: '2026-11-01' }),
        now,
      ),
    ).toMatchObject({ from: '2026-11-08', to: '2026-11-14' })
  })

  it('reads every filter, and drops a mode it does not know', () => {
    const filters = readAgentRunFilters(
      new URLSearchParams({
        from: '2026-11-01',
        to: '2026-11-02',
        projects: PROJECT,
        people: PERSON,
        agent: 'a',
        mode: 'fixed',
        status: 'failed',
        session: 's',
      }),
      now,
    )
    expect(filters).toEqual({
      from: '2026-11-01',
      to: '2026-11-02',
      projectId: PROJECT,
      userId: PERSON,
      agentId: 'a',
      mode: 'fixed',
      status: 'failed',
      sessionId: 's',
    })
    expect(
      readAgentRunFilters(new URLSearchParams({ mode: 'phone' }), now).mode,
    ).toBeUndefined()
  })
})

describe('the agents address', () => {
  it('writes what readAgentRunFilters reads, and the run to open', () => {
    const params = routes.agents.write({
      from: '2026-11-01',
      to: '2026-11-02',
      agentId: 'a',
      mode: 'timer',
      run: 'key',
    })
    expect(params.get('run')).toBe('key')
    expect(readAgentRunFilters(params, now)).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-02',
      agentId: 'a',
      mode: 'timer',
    })
  })

  it('still reads the singular project and person of older links', () => {
    expect(
      readAgentRunFilters(
        new URLSearchParams({ project: PROJECT, person: PERSON }),
        now,
      ),
    ).toMatchObject({ projectId: PROJECT, userId: PERSON })
  })
})

describe('agentRunMode', () => {
  it("is a server's only when the run says fixed", () => {
    const run = { measurement: { mode: 'fixed' } } as AgentRun
    expect(agentRunMode(run)).toBe('fixed')
    expect(agentRunMode({} as AgentRun)).toBe('timer')
  })
})
