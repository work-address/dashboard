import { useUnit } from 'effector-react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  AGENT_RUN_ENDINGS,
  agentChartsKey,
  agentHoursOf,
  agentRunEndingsOf,
  agentStateHoursOf,
  getAgentChartsRange,
  type AgentRunEnding,
} from '../model/agent-charts'
import { agentChartsRequested } from '../model/agent-charts.model'

import { AgentsChartPanel } from './agents-chart-panel'

import type { AgentRunFilters } from '../model/agent-runs'

import { statisticsAgentRunsQuery } from '@/entities/statistics'
import {
  askGrain,
  formatCount,
  formatDurationFromMinutes,
  fromDay,
  periodBars,
  ranked,
  WorkspaceHiddenHistory,
  workspaceDesign,
} from '@/shared'

const ENDING_COLORS: Record<AgentRunEnding, string> = {
  completed: 'var(--ui-chart-1)',
  failed: 'var(--ui-chart-4)',
  cancelled: 'var(--ui-chart-other)',
  running: 'var(--ui-chart-3)',
}

const ENDING_LABELS: Record<AgentRunEnding, string> = {
  completed: 'dashboard.agents.status.completed',
  failed: 'dashboard.agents.status.failed',
  cancelled: 'dashboard.agents.status.cancelled',
  running: 'dashboard.worklogsTable.agents.status.running',
}

type Props = {
  filters: AgentRunFilters
  /** The reader's name for each agent they may see runs of. */
  agentNames: Map<string, string>
}

/**
 * The period's runs as charts, above the list of them: each agent's hours,
 * how those hours were spent, and how the runs ended. They follow the days,
 * project, person and agent the page is filtered to.
 */
export const AgentsCharts = ({ filters, agentNames }: Props) => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language

  const { data, pending, failed, request } = useUnit({
    data: statisticsAgentRunsQuery.$data,
    pending: statisticsAgentRunsQuery.$pending,
    failed: statisticsAgentRunsQuery.$failed,
    request: agentChartsRequested,
  })

  const key = agentChartsKey(filters)
  const retry = useCallback(
    () => request(filters),
    // The filters the charts follow are all in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, request],
  )

  useEffect(() => {
    retry()
  }, [retry])

  const charts = useMemo(() => {
    const range = getAgentChartsRange(filters)
    const grain = askGrain(range)
    const daily = data?.daily
    // An agent the reader's team no longer lists still ran: it keeps a
    // series, under the name the page has for such agents.
    const named = new Map(agentNames)

    for (const row of daily ?? []) {
      if (!named.has(row.agentId)) {
        named.set(row.agentId, t('agents.charts.unnamed'))
      }
    }

    const shared = { period: range, language }

    return {
      range,
      hours: periodBars({
        ...shared,
        sources: [{ rows: daily, grain, values: agentHoursOf }],
        // By name, so an agent keeps its place and colour between periods.
        series: ranked(
          [...named]
            .map(([id, title]) => ({ id, title }))
            .sort(
              (a, b) =>
                a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
            ),
          t('dashboard.charts.other'),
        ),
      }),
      states: periodBars({
        ...shared,
        sources: [{ rows: daily, grain, values: agentStateHoursOf }],
        series: [
          {
            key: 'assisted',
            label: t('dashboard.agents.assisted'),
            color: 'var(--ui-chart-1)',
          },
          {
            key: 'autonomous',
            label: t('dashboard.agents.autonomous'),
            color: 'var(--ui-chart-2)',
          },
          {
            key: 'waiting',
            label: t('dashboard.agents.waiting'),
            color: 'var(--ui-chart-other)',
          },
        ],
      }),
      // Runs are counted by day, which the bars then follow.
      endings: periodBars({
        ...shared,
        sources: [
          { rows: data?.runsDaily, grain: 'day', values: agentRunEndingsOf },
        ],
        series: AGENT_RUN_ENDINGS.map((ending) => ({
          key: ending,
          label: t(ENDING_LABELS[ending]),
          color: ENDING_COLORS[ending],
        })),
      }),
    }
  }, [agentNames, data, filters, language, t])

  const loading = pending && data === null
  const nothing =
    data !== null && data.daily.length === 0 && data.runsDaily.length === 0

  // The list below says the days hold no runs; three empty charts add nothing.
  if (nothing && !failed && !data?.hidden) {
    return null
  }

  const period = new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatRange(fromDay(charts.range.from), fromDay(charts.range.to))
  const hoursValue = (hours: number) =>
    formatDurationFromMinutes(Math.round(hours * 60), t)
  const hoursTick = (hours: number) =>
    t('dashboard.charts.hoursTick', { value: hours })
  const shared = { loading, failed, onRetry: retry }

  return (
    <Root>
      {data?.hidden ? (
        <WorkspaceHiddenHistory
          before={data.hidden.before}
          canUpgrade={data.hidden.canUpgrade}
        />
      ) : null}
      {nothing ? null : (
        <>
          <AgentsChartPanel
            title={t('agents.charts.hours.title')}
            description={period}
            buckets={charts.hours.buckets}
            series={charts.hours.series}
            height={workspaceDesign.chart.minHeight}
            formatValue={hoursValue}
            formatTick={hoursTick}
            totalLabel={t('dashboard.charts.total')}
            {...shared}
          />
          <Pair>
            <AgentsChartPanel
              title={t('agents.charts.states.title')}
              buckets={charts.states.buckets}
              series={charts.states.series}
              height={workspaceDesign.chart.agentHeight}
              formatValue={hoursValue}
              formatTick={hoursTick}
              {...shared}
            />
            <AgentsChartPanel
              title={t('agents.charts.endings.title')}
              buckets={charts.endings.buckets}
              series={charts.endings.series}
              height={workspaceDesign.chart.agentHeight}
              formatValue={(count) =>
                t('agents.list.count', { count: Math.round(count) })
              }
              formatTick={(count) =>
                Number.isInteger(count) ? formatCount(count) : ''
              }
              totalLabel={t('dashboard.charts.total')}
              {...shared}
            />
          </Pair>
        </>
      )}
    </Root>
  )
}

const Root = styled.section`
  display: grid;
  gap: var(--ui-section-gap);
  min-width: 0;
`

const Pair = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--ui-section-gap);
  min-width: 0;

  ${(p) => p.theme.breakpoints.up('xl')} {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`
