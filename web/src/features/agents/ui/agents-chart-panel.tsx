import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  BucketBarChart,
  useBreakpoint,
  WorkspacePanel,
  workspaceDesign,
  type Bucket,
  type BucketSeries,
} from '@/shared'

/** The most buckets a phone lists as rows: a week, or a working day by hour. */
const ROWS_MAX = 12

type Props = {
  title: string
  description?: string
  buckets: Bucket[]
  series: BucketSeries[]
  height: number
  formatValue: (value: number) => string
  formatTick: (value: number) => string
  /** Set when the series add up to something worth naming. */
  totalLabel?: string
  loading: boolean
  failed: boolean
  onRetry: () => void
}

/** One of the Agents page's charts: a stacked bar per day, week or month. */
export const AgentsChartPanel = ({
  title,
  description,
  buckets,
  series,
  height,
  formatValue,
  formatTick,
  totalLabel,
  loading,
  failed,
  onRetry,
}: Props) => {
  const { t } = useTranslation()
  const isMobile = useBreakpoint('isMobile')

  return (
    <Root
      title={title}
      description={description}
      loading={loading}
      failed={failed}
      onRetry={onRetry}
    >
      <Chart
        // A phone lists a week's days as rows; more bars than that keep
        // their columns rather than a long list.
        orientation={
          isMobile && buckets.length <= ROWS_MAX ? 'rows' : 'columns'
        }
        height={height}
        maxBarSize={workspaceDesign.chart.barMaxWidth}
        barRadius={workspaceDesign.chart.agentBarRadius}
        gridDasharray="0"
        buckets={buckets}
        series={series}
        formatValue={formatValue}
        formatTick={formatTick}
        totalLabel={totalLabel}
        emptyLabel={t('agents.charts.none')}
      />
    </Root>
  )
}

const Root = styled(WorkspacePanel)`
  --chart-label-size: var(--ui-meta-size);

  min-width: 0;
`

const Chart = styled(BucketBarChart)`
  min-width: 0;
  gap: var(--ui-space-5);
`
