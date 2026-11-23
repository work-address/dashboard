import { addDays } from 'date-fns'
import { useUnit } from 'effector-react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  AGENT_RUN_ENDINGS,
  agentChartsKey,
  getAgentChartsRange,
  getAgentHours,
  getAgentRunEndings,
  getAgentStates,
  type AgentRunEnding,
} from '../model/agent-charts'
import { agentChartsRequested } from '../model/agent-charts.model'

import { AgentsChartPanel } from './agents-chart-panel'

import type { AgentRunFilters } from '../model/agent-runs'

import { statisticsAgentRunsQuery } from '@/entities/statistics'
import {
  bucketLabels,
  formatCount,
  formatDurationFromMinutes,
  fromDay,
  periodBuckets,
  projectSeries,
  toDay,
  visibleBuckets,
  weekStartsOnFor,
  WorkspaceHiddenHistory,
  workspaceDesign,
  type Bucket,
  type BucketSeries,
  type PeriodBucket,
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
    const weekStartsOn = weekStartsOnFor(language)
    const range = getAgentChartsRange(filters)
    const periods = periodBuckets(range, weekStartsOn)
    const size = periods[0]?.size ?? 'day'
    const daily = data?.daily ?? []
    const toBuckets = (
      shown: PeriodBucket[],
      values: Map<string, Record<string, number>>,
    ): Bucket[] =>
      visibleBuckets(shown, new Set(values.keys())).map((period) => ({
        key: period.key,
        ...bucketLabels(period, language),
        values: values.get(period.key) ?? {},
      }))

    const hours = getAgentHours(daily, size, weekStartsOn)
    const { keyOf, series } = projectSeries(
      [...hours.totals.keys()].map((id) => ({
        id,
        title: agentNames.get(id) ?? t('agents.charts.unnamed'),
      })),
      hours.totals,
      t('dashboard.charts.other'),
    )
    const byAgent = new Map<string, Record<string, number>>()

    // Agents past the named colours share one "Other" series.
    for (const [bucket, bar] of hours.bars) {
      const merged: Record<string, number> = {}

      for (const [agentId, value] of Object.entries(bar)) {
        merged[keyOf(agentId)] = (merged[keyOf(agentId)] ?? 0) + value
      }

      byAgent.set(bucket, merged)
    }

    // Runs are counted by day, so a period drawn by the hour shows its days.
    const days: PeriodBucket[] = []

    if (size === 'hour') {
      for (
        let day = fromDay(range.from);
        day <= fromDay(range.to);
        day = addDays(day, 1)
      ) {
        days.push({ key: toDay(day), start: day, size: 'day' })
      }
    }

    return {
      range,
      agentSeries: series,
      hours: toBuckets(periods, byAgent),
      states: toBuckets(periods, getAgentStates(daily, size, weekStartsOn)),
      endings: toBuckets(
        size === 'hour' ? days : periods,
        getAgentRunEndings(data?.runsDaily ?? [], size, weekStartsOn),
      ),
    }
  }, [agentNames, data, filters, language, t])

  const stateSeries: BucketSeries[] = [
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
  ]
  const endingSeries: BucketSeries[] = AGENT_RUN_ENDINGS.map((ending) => ({
    key: ending,
    label: t(ENDING_LABELS[ending]),
    color: ENDING_COLORS[ending],
  }))

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
            buckets={charts.hours}
            series={charts.agentSeries}
            height={workspaceDesign.chart.minHeight}
            formatValue={hoursValue}
            formatTick={hoursTick}
            totalLabel={t('dashboard.charts.total')}
            {...shared}
          />
          <Pair>
            <AgentsChartPanel
              title={t('agents.charts.states.title')}
              buckets={charts.states}
              series={stateSeries}
              height={workspaceDesign.chart.agentHeight}
              formatValue={hoursValue}
              formatTick={hoursTick}
              {...shared}
            />
            <AgentsChartPanel
              title={t('agents.charts.endings.title')}
              buckets={charts.endings}
              series={endingSeries}
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
