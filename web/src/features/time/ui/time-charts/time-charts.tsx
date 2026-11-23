import { useStoreMap, useUnit } from 'effector-react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  $timeChartsMode,
  getTimeBilling,
  getTimeChartsRange,
  getTimeProjectShares,
  getTimeWeek,
  getTimeWeekAnchor,
  timeChartsModeChanged,
  timeChartsRequested,
} from '../../model'

import { TimeChartsBilling } from './time-charts-billing'
import { TimeChartsDaily } from './time-charts-daily'
import { TimeChartsShare } from './time-charts-share'

import { $projects } from '@/entities/projects'
import {
  statisticsPeriodAgentsQuery,
  statisticsPeriodDailyQuery,
  statisticsPeriodOverviewQuery,
} from '@/entities/statistics'
import { $timeFilters } from '@/entities/time'
import {
  OTHER_SERIES_KEY,
  projectSeries,
  weekStartsOnFor,
  WorkspaceHiddenHistory,
  type ShareListRow,
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

  const view = useMemo(() => {
    const totals = overview?.totals ?? []
    const shares = getTimeProjectShares(totals)
    const { keyOf, series } = projectSeries(
      projects,
      new Map(shares.map((share) => [share.projectId, share.seconds])),
      t('dashboard.charts.other'),
    )
    const colors = new Map(series.map((item) => [item.key, item.color]))
    const titles = new Map(projects.map((item) => [item.id, item.title]))
    const rows = new Map<string, ShareListRow>()

    // Projects past the named colours share one "Other" row, as in the bars.
    for (const share of shares) {
      const key = keyOf(share.projectId)
      const row = rows.get(key)

      rows.set(key, {
        key,
        title:
          key === OTHER_SERIES_KEY
            ? t('dashboard.charts.other')
            : (titles.get(share.projectId) ?? t('dashboard.charts.other')),
        color: colors.get(key) ?? 'var(--ui-chart-other)',
        seconds: (row?.seconds ?? 0) + share.seconds,
        share: (row?.share ?? 0) + share.share,
      })
    }

    return {
      series,
      keyOf,
      shares: [...rows.values()],
      billing: getTimeBilling(totals),
    }
  }, [overview, projects, t])

  const overviewLoading = overviewPending && overview === null
  const worked = view.shares.length > 0
  const withSide = overviewLoading || overviewFailed || worked

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
          daily={daily}
          agents={agents?.daily ?? []}
          projectSeries={view.series}
          seriesKeyOf={view.keyOf}
          mode={mode}
          onModeChange={changeMode}
          loading={dailyPending && daily === null}
          failed={dailyFailed}
          onRetry={retry}
        />
        {withSide ? (
          <Side>
            <TimeChartsShare
              rows={view.shares}
              loading={overviewLoading}
              failed={overviewFailed}
              onRetry={retry}
            />
            {view.billing ? (
              <TimeChartsBilling
                billing={view.billing}
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
