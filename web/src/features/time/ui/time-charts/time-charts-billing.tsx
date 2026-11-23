import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { TimeBilling } from '../../model'

import {
  formatCompactDurationFromMinutes,
  formatDurationFromMinutes,
  WorkspacePanel,
} from '@/shared'

type Props = {
  billing: TimeBilling
  loading: boolean
  failed: boolean
  onRetry: () => void
}

const PARTS = [
  { key: 'paid', labelKey: 'time.charts.billing.paid' },
  { key: 'awaiting', labelKey: 'time.charts.billing.awaiting' },
  { key: 'open', labelKey: 'time.charts.billing.open' },
] as const

/**
 * How far the period's time has got towards being paid: tracked, invoiced
 * and paid as figures, then one bar split into paid, invoiced and waiting,
 * and not yet invoiced. People's time only: agents are billed on invoices.
 */
export const TimeChartsBilling = ({
  billing,
  loading,
  failed,
  onRetry,
}: Props) => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language

  const compact = (seconds: number) =>
    formatCompactDurationFromMinutes(seconds / 60, language)
  const full = (seconds: number) =>
    formatDurationFromMinutes(Math.round(seconds / 60), t)

  const figures = [
    {
      labelKey: 'time.charts.billing.tracked',
      seconds: billing.trackedSeconds,
    },
    {
      labelKey: 'time.charts.billing.invoiced',
      seconds: billing.invoicedSeconds,
    },
    { labelKey: 'time.charts.billing.paid', seconds: billing.paidSeconds },
  ]

  return (
    <WorkspacePanel
      title={t('time.charts.billing.title')}
      loading={loading}
      failed={failed}
      onRetry={onRetry}
    >
      <Body>
        <Figures>
          {figures.map((figure) => (
            <Figure key={figure.labelKey}>
              <Label>{t(figure.labelKey)}</Label>
              <Value aria-label={full(figure.seconds)}>
                {compact(figure.seconds)}
              </Value>
            </Figure>
          ))}
        </Figures>
        <Bar
          role="img"
          aria-label={t('time.charts.billing.barLabel', {
            paid: full(billing.parts.paid),
            awaiting: full(billing.parts.awaiting),
            open: full(billing.parts.open),
          })}
        >
          {PARTS.map((part) =>
            billing.parts[part.key] > 0 ? (
              <Part
                key={part.key}
                data-part={part.key}
                style={{ flexGrow: billing.parts[part.key] }}
              />
            ) : null,
          )}
        </Bar>
        <Legend>
          {PARTS.map((part) => (
            <Key key={part.key}>
              <Swatch data-part={part.key} aria-hidden />
              <KeyLabel>{t(part.labelKey)}</KeyLabel>
              <KeyValue aria-label={full(billing.parts[part.key])}>
                {compact(billing.parts[part.key])}
              </KeyValue>
            </Key>
          ))}
        </Legend>
      </Body>
    </WorkspacePanel>
  )
}

const Body = styled.div`
  display: grid;
  gap: var(--ui-space-4);
`

const Figures = styled.dl`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--ui-space-3);
  margin: 0;
`

const Figure = styled.div`
  display: grid;
  gap: var(--ui-space-1);
  min-width: 0;
`

const Label = styled.dt`
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
`

const Value = styled.dd`
  margin: 0;
  color: var(--ui-ink);
  font-size: var(--ui-figure-size);
  line-height: var(--ui-figure-line-height);
  font-weight: var(--ui-weight-semibold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

/* Flex, not grid: the segments' widths are their share of the time, which
   flex-grow expresses directly and a grid track list cannot take from data
   without restating the template inline. */
const Bar = styled.div`
  display: flex;
  gap: var(--ui-border-width);
  block-size: var(--ui-space-3);
  border-radius: var(--ui-pill-radius);
  background: var(--ui-inset);
  overflow: hidden;
`

const partColor = `
  &[data-part='paid'] {
    background: var(--ui-chart-1);
  }

  &[data-part='awaiting'] {
    background: var(--ui-chart-3);
  }

  &[data-part='open'] {
    background: var(--ui-line);
  }
`

const Part = styled.span`
  flex-basis: 0;
  min-inline-size: var(--ui-space-1);
  ${partColor}
`

const Legend = styled.ul`
  display: grid;
  gap: var(--ui-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
`

const Key = styled.li`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--ui-space-2);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
`

const Swatch = styled.span`
  inline-size: var(--ui-space-2);
  block-size: var(--ui-space-2);
  border-radius: var(--ui-pill-radius);
  ${partColor}
`

const KeyLabel = styled.span`
  color: var(--ui-muted);
`

const KeyValue = styled.span`
  color: var(--ui-ink);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`
