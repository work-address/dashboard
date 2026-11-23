import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  getTimePeopleAgents,
  type TimeChartsMode,
  type TimeChartsRange,
} from '../../model'

import type {
  StatisticsAgentDailyRow,
  StatisticsDailyRow,
} from '@/entities/statistics'

import {
  BucketBarChart,
  bucketKeyOf,
  bucketLabels,
  formatDurationFromMinutes,
  fromDay,
  periodBuckets,
  ToolbarSegment,
  ToolbarShell,
  useBreakpoint,
  visibleBuckets,
  weekStartsOnFor,
  WorkspacePanel,
  workspaceDesign,
  type Bucket,
  type BucketSeries,
} from '@/shared'

/** The most buckets a phone lists as rows: a week, or a working day by hour. */
const ROWS_MAX = 12

const MODES: { mode: TimeChartsMode; labelKey: string }[] = [
  { mode: 'projects', labelKey: 'time.charts.daily.byProject' },
  { mode: 'people', labelKey: 'time.charts.daily.byPeople' },
]

type Props = {
  range: TimeChartsRange
  daily: StatisticsDailyRow[] | null
  agents: StatisticsAgentDailyRow[]
  /** The projects that get a colour of their own, as the share list draws them. */
  projectSeries: BucketSeries[]
  seriesKeyOf: (projectId: string) => string
  mode: TimeChartsMode
  onModeChange: (mode: TimeChartsMode) => void
  loading: boolean
  failed: boolean
  onRetry: () => void
}

/**
 * Tracked hours across the period, a bar per day, week or month: stacked by
 * project, or people beside their agents - side by side, since an agent's
 * hour often overlaps its person's and a stack would count it twice.
 */
export const TimeChartsDaily = ({
  range,
  daily,
  agents,
  projectSeries,
  seriesKeyOf,
  mode,
  onModeChange,
  loading,
  failed,
  onRetry,
}: Props) => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const isMobile = useBreakpoint('isMobile')

  const chart = useMemo(() => {
    const weekStartsOn = weekStartsOnFor(language)
    const periods = periodBuckets(range, weekStartsOn)
    const size = periods[0]?.size ?? 'day'
    const values = new Map<string, Record<string, number>>()

    if (mode === 'projects') {
      for (const row of daily ?? []) {
        const key = bucketKeyOf(row.day, size, weekStartsOn)
        const bar = values.get(key) ?? {}
        const seriesKey = seriesKeyOf(row.projectId)

        bar[seriesKey] = (bar[seriesKey] ?? 0) + row.trackedSeconds / 3600
        values.set(key, bar)
      }
    } else {
      for (const [key, bar] of getTimePeopleAgents(
        daily ?? [],
        agents,
        size,
        weekStartsOn,
      )) {
        values.set(key, bar)
      }
    }

    const buckets: Bucket[] = visibleBuckets(
      periods,
      new Set(values.keys()),
    ).map((period) => ({
      key: period.key,
      ...bucketLabels(period, language),
      values: values.get(period.key) ?? {},
    }))

    return { buckets }
  }, [agents, daily, language, mode, range, seriesKeyOf])

  const series: BucketSeries[] =
    mode === 'projects'
      ? projectSeries
      : [
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
        ]

  const period = new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatRange(fromDay(range.from), fromDay(range.to))

  return (
    <Root
      title={t('time.charts.daily.title')}
      description={period}
      aside={
        <Modes role="group" aria-label={t('time.charts.daily.modeLabel')}>
          {MODES.map((option) => (
            <ToolbarSegment
              key={option.mode}
              type="button"
              aria-pressed={mode === option.mode}
              onClick={() => onModeChange(option.mode)}
            >
              {t(option.labelKey)}
            </ToolbarSegment>
          ))}
        </Modes>
      }
      loading={loading}
      failed={failed}
      onRetry={onRetry}
      empty={
        daily !== null && daily.length === 0 && agents.length === 0
          ? {
              title: t('dashboard.timeDaily.empty.title'),
              description: t('time.charts.daily.empty'),
            }
          : undefined
      }
    >
      <Chart
        // A phone lists a week's days as rows; more bars than that keep
        // their columns rather than a long list.
        orientation={
          isMobile && chart.buckets.length <= ROWS_MAX ? 'rows' : 'columns'
        }
        stacked={mode === 'projects'}
        height={workspaceDesign.chart.height}
        maxBarSize={workspaceDesign.chart.barMaxWidth}
        barRadius={workspaceDesign.chart.barRadius}
        gridDasharray="0"
        buckets={chart.buckets}
        series={series}
        formatValue={(hours) =>
          formatDurationFromMinutes(Math.round(hours * 60), t)
        }
        formatTick={(hours) =>
          t('dashboard.charts.hoursTick', { value: hours })
        }
        totalLabel={
          mode === 'projects' ? t('dashboard.charts.total') : undefined
        }
        emptyLabel={t('dashboard.timeDaily.tooltipEmpty')}
      />
    </Root>
  )
}

const Root = styled(WorkspacePanel)`
  --chart-label-size: var(--ui-meta-size);
`

const Modes = ToolbarShell

const Chart = styled(BucketBarChart)`
  min-width: 0;
  gap: var(--ui-space-5);
`
