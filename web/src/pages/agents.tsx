import { useUnit } from 'effector-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useSearchParams } from 'react-router-dom'
import styled from 'styled-components'

import { $user } from '@/entities/profile'
import {
  AgentRunDialog,
  AgentRunList,
  AgentsCharts,
  type AgentRunFilters,
  type AgentRunNames,
  agentRunQuery,
  agentRunsQuery,
  AgentsFilters,
  fromAgentsAddress,
} from '@/features/agents'
import { $canSeeTeam, fetchTeam, teamQuery } from '@/features/team'
import { routes } from '@/routes'
import {
  Button,
  type DateRangePreset,
  PageHelmet,
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from '@/shared'

/**
 * Every run of the reader's agents, and of their contributors' agents on the
 * projects they own: the place to read what the agents did, with all that
 * was collected about each run. Its address holds the filters and the open
 * run, so a link can point at either.
 */
export default function AgentsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [pages, setPages] = useState(1)

  const {
    reader,
    canSee,
    team,
    fetchTeamEvent,
    result,
    pending,
    failed,
    askRuns,
    linkedRun,
    askRun,
  } = useUnit({
    reader: $user,
    canSee: $canSeeTeam,
    team: teamQuery.$data,
    fetchTeamEvent: fetchTeam,
    result: agentRunsQuery.$data,
    pending: agentRunsQuery.$pending,
    failed: agentRunsQuery.$failed,
    askRuns: agentRunsQuery.start,
    linkedRun: agentRunQuery.$data,
    askRun: agentRunQuery.start,
  })

  useEffect(() => {
    fetchTeamEvent()
  }, [fetchTeamEvent])

  const search = params.toString()
  const address = useMemo(
    () => routes.agents.read(new URLSearchParams(search)),
    [search],
  )
  const filters = useMemo(() => fromAgentsAddress(address), [address])
  const preset: DateRangePreset = address.period ?? 'custom'
  const runKey = address.run ?? null
  const filterKey = JSON.stringify(filters)

  // New filters start from the first page again.
  useEffect(() => {
    setPages(1)
  }, [filterKey])

  useEffect(() => {
    askRuns({ filters: JSON.parse(filterKey) as AgentRunFilters, pages })
  }, [askRuns, filterKey, pages])

  const runs = result?.runs ?? []
  const listed = runKey ? runs.find((run) => run.runKey === runKey) : undefined

  // A link to a run outside the list's filters still opens it.
  useEffect(() => {
    if (runKey && !listed) {
      askRun(runKey)
    }
  }, [askRun, runKey, listed])

  const openRun =
    listed ?? (runKey && linkedRun?.runKey === runKey ? linkedRun : null)

  const names = useMemo((): AgentRunNames => {
    const projects = new Map<string, string>()
    const people = new Map<string, string>()
    for (const project of team?.projects ?? []) {
      projects.set(project.id, project.title)
      for (const person of project.people) {
        if (person.userId) {
          people.set(person.userId, person.name || person.address)
        }
      }
    }

    return { projects, people }
  }, [team])

  const change = (
    next: Partial<AgentRunFilters>,
    nextPreset?: DateRangePreset,
  ) => {
    const kept = nextPreset ?? preset
    setParams(
      routes.agents.write({
        ...filters,
        ...next,
        period: kept === 'custom' ? undefined : kept,
      }),
    )
  }

  // Opening or closing a run keeps the filters, as the address has them.
  const setRun = (key: string | null) => {
    setParams(routes.agents.write({ ...address, run: key ?? undefined }))
  }

  if (!canSee) {
    return <Navigate to={routes.dashboard.build()} replace />
  }

  const total = result?.total ?? 0

  return (
    <Root>
      <PageHelmet
        title={t('agents.page.title')}
        description={t('agents.page.meta')}
      />
      <WorkspacePageHeader
        title={t('agents.page.title')}
        description={t('agents.page.description')}
      />
      <AgentsCharts filters={filters} />
      <WorkspacePanel
        title={t('agents.list.title')}
        aside={
          result ? (
            <Count>{t('agents.list.count', { count: total })}</Count>
          ) : undefined
        }
        toolbar={
          <AgentsFilters
            filters={filters}
            preset={preset}
            team={team}
            onChange={change}
          />
        }
        loading={pending && !result}
        failed={failed && !result}
        onRetry={() => askRuns({ filters, pages })}
        empty={
          result && runs.length === 0
            ? {
                title: t('agents.list.empty.title'),
                description: t('agents.list.empty.description'),
              }
            : undefined
        }
      >
        <AgentRunList
          runs={runs}
          names={names}
          userId={reader?.id}
          onOpen={(run) => setRun(run.runKey)}
        />
        {runs.length < total && (
          <More>
            <Button
              variant="soft"
              loading={pending}
              onClick={() => setPages((value) => value + 1)}
            >
              {t('agents.list.more')}
            </Button>
          </More>
        )}
      </WorkspacePanel>
      <AgentRunDialog
        run={openRun ?? null}
        names={names}
        userId={reader?.id}
        onOpenRun={(key) => setRun(key)}
        onClose={() => setRun(null)}
      />
    </Root>
  )
}

const Root = styled(WorkspacePage)`
  display: grid;
  align-content: start;
  gap: var(--ui-section-gap);
`

const Count = styled.span`
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  font-variant-numeric: tabular-nums;
`

const More = styled.div`
  display: flex;
  justify-content: center;
  padding-top: var(--ui-space-3);
`
