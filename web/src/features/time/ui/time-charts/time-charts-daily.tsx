import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { TimeChartsMode, TimeChartsRange } from '../../model'

import {
  BucketBarChart,
  formatDurationFromMinutes,
  fromDay,
  ToolbarSegment,
  ToolbarShell,
  WorkspacePanel,
  workspaceDesign,
  type PeriodBars,
} from '@/shared'

const MODES: { mode: TimeChartsMode; labelKey: string }[] = [
  { mode: 'projects', labelKey: 'time.charts.daily.byProject' },
  { mode: 'people', labelKey: 'time.charts.daily.byPeople' },
]

type Props = {
  range: TimeChartsRange
  /** The period's bars as the chosen mode splits them. */
  bars: PeriodBars
  mode: TimeChartsMode
  onModeChange: (mode: TimeChartsMode) => void
  /** The period holds no tracked time and no agent work. */
  empty: boolean
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
  bars,
  mode,
  onModeChange,
  empty,
  loading,
  failed,
  onRetry,
}: Props) => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language

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
        empty
          ? {
              title: t('dashboard.timeDaily.empty.title'),
              description: t('time.charts.daily.empty'),
            }
          : undefined
      }
    >
      <Chart
        orientation="auto"
        stacked={mode === 'projects'}
        height={workspaceDesign.chart.height}
        maxBarSize={workspaceDesign.chart.barMaxWidth}
        barRadius={workspaceDesign.chart.barRadius}
        gridDasharray="0"
        buckets={bars.buckets}
        series={bars.series}
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
