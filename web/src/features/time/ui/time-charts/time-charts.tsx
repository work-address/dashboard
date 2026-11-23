import { useStoreMap, useUnit } from 'effector-react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  $timeChartsMode,
  getTimeBilling,
  getTimeChartsRange,
  getTimeWeek,
  getTimeWeekAnchor,
  timeChartsModeChanged,
  timeChartsRequested,
} from '../../model'

import { TimeChartsBilling } from './time-charts-billing'
import { TimeChartsDaily } from './time-charts-daily'
import { TimeChartsShare } from './time-charts-share'

import { $projects, projectSeriesNames } from '@/entities/projects'
import {
  agentWorkedSeconds,
  statisticsPeriodAgentsQuery,
  statisticsPeriodDailyQuery,
  statisticsPeriodOverviewQuery,
} from '@/entities/statistics'
import { $timeFilters } from '@/entities/time'
import {
  askGrain,
  periodBars,
  ranked,
  weekStartsOnFor,
  WorkspaceHiddenHistory,
} from '@/shared'

/**
 * The period in charts, between the week strip and the entries: hours per
 * day, each project's share, and how much has been invoiced and paid. They
 * follow the page's project and date filters; with no dates set they show
 * the week the strip shows.
 */
export const TimeCharts = () => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language

  const filters = useStoreMap({
    store: $timeFilters,
    keys: [],
    fn: ({ fromAt, toAt, activityId }) => ({ fromAt, toAt, activityId }),
  })

  const {
    projects,
    overview,
    daily,
    agents,
    overviewPending,
    dailyPending,
    overviewFailed,
    dailyFailed,
    mode,
    changeMode,
    request,
  } = useUnit({
    projects: $projects,
    overview: statisticsPeriodOverviewQuery.$data,
    daily: statisticsPeriodDailyQuery.$data,
    agents: statisticsPeriodAgentsQuery.$data,
    overviewPending: statisticsPeriodOverviewQuery.$pending,
    dailyPending: statisticsPeriodDailyQuery.$pending,
    overviewFailed: statisticsPeriodOverviewQuery.$failed,
    dailyFailed: statisticsPeriodDailyQuery.$failed,
    mode: $timeChartsMode,
    changeMode: timeChartsModeChanged,
    request: timeChartsRequested,
  })

  const range = useMemo(
    () =>
      getTimeChartsRange(
        filters,
        getTimeWeek(
          getTimeWeekAnchor(filters, new Date()),
          weekStartsOnFor(language),
        ),
      ),
    [filters, language],
  )
  const projectId = filters.activityId

  const retry = useCallback(
    () => request({ range, projectId }),
    // The period is identified by its two days.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range.from, range.to, projectId, request],
  )

  useEffect(() => {
    retry()
  }, [retry])

  const grain = askGrain(range)
  // Hours by project: the bars' default split, and the share list's rows.
  const byProject = useMemo(
    () =>
      periodBars({
        period: range,
        language,
        sources: [
          {
            rows: daily,
            grain,
            values: (row) => ({ [row.projectId]: row.trackedSeconds / 3600 }),
          },
        ],
        series: ranked(
          projectSeriesNames(projects),
          t('dashboard.charts.other'),
        ),
      }),
    [daily, grain, language, projects, range, t],
  )
  // People beside their agents, never added: an agent often runs while its
  // person is tracking.
  const byKind = useMemo(
    () =>
      periodBars({
        period: range,
        language,
        sources: [
          {
            rows: daily,
            grain,
            values: (row) => ({ people: row.trackedSeconds / 3600 }),
          },
          {
            rows: agents?.daily,
            grain,
            values: (row) => ({ agents: agentWorkedSeconds(row) / 3600 }),
          },
        ],
        series: [
          {
            key: 'people',
            label: t('dashboard.agents.humanHours'),
            color: 'var(--ui-chart-1)',
          },
          {
            key: 'agents',
            label: t('dashboard.agents.agentHours'),
            color: 'var(--ui-chart-3)',
          },
        ],
      }),
    [agents, daily, grain, language, range, t],
  )
  const billing = useMemo(
    () => getTimeBilling(overview?.totals ?? []),
    [overview],
  )

  const dailyLoading = dailyPending && daily === null
  const overviewLoading = overviewPending && overview === null
  const worked = byProject.shares.length > 0
  const withSide = dailyLoading || dailyFailed || worked

  return (
    <Root>
      {overview?.hidden ? (
        <Hidden
          before={overview.hidden.before}
          canUpgrade={overview.hidden.canUpgrade}
        />
      ) : null}
      <Charts data-side={withSide || undefined}>
        <TimeChartsDaily
          range={range}
          bars={mode === 'projects' ? byProject : byKind}
          mode={mode}
          onModeChange={changeMode}
          empty={daily !== null && !worked && byKind.shares.length === 0}
          loading={dailyLoading}
          failed={dailyFailed}
          onRetry={retry}
        />
        {withSide ? (
          <Side>
            <TimeChartsShare
              rows={byProject.shares}
              loading={dailyLoading}
              failed={dailyFailed}
              onRetry={retry}
            />
            {billing ? (
              <TimeChartsBilling
                billing={billing}
                loading={overviewLoading}
                failed={overviewFailed}
                onRetry={retry}
              />
            ) : null}
          </Side>
        ) : null}
      </Charts>
    </Root>
  )
}

const Root = styled.section`
  display: grid;
  gap: var(--ui-section-gap);
  min-width: 0;
`

const Hidden = WorkspaceHiddenHistory

const Charts = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: var(--ui-section-gap);
  min-width: 0;

  ${(p) => p.theme.breakpoints.up('xl')} {
    &[data-side] {
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    }
  }
`

const Side = styled.div`
  display: grid;
  gap: var(--ui-section-gap);
  min-width: 0;
`
