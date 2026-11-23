import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { getPublicReportTotals, getReportDays } from '../model'

import { PublicReportTables } from './public-report-tables'

import type { PublicReport as Report } from '@/entities/shared-report'

import {
  BucketBarChart,
  bucketKeyOf,
  bucketLabels,
  Button,
  formatCompactDurationFromMinutes,
  formatCurrency,
  formatDurationFromMinutes,
  fromDay,
  OTHER_SERIES_KEY,
  periodBuckets,
  projectSeries,
  ShareList,
  weekStartsOnFor,
  WorkspacePanel,
  workspaceDesign,
  type Bucket,
  type ShareListRow,
} from '@/shared'

type Props = { report: Report }

/**
 * A shared report as anyone with its link reads it: the period's hours by
 * day and project, people beside their agents, and who did what. Amounts
 * show only when the sharer switched them on. It prints as one document.
 */
export const PublicReport = ({ report }: Props) => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language

  const view = useMemo(() => {
    const totals = getPublicReportTotals(report, t('agents.charts.unnamed'))
    const weekStartsOn = weekStartsOnFor(language)
    const periods = periodBuckets(getReportDays(report), weekStartsOn)
    const size = periods[0]?.size ?? 'day'
    const { keyOf, series } = projectSeries(
      report.projects,
      new Map(totals.projects.map((row) => [row.id, row.seconds])),
      t('dashboard.charts.other'),
    )
    const byProject = new Map<string, Record<string, number>>()
    const byKind = new Map<string, Record<string, number>>()
    const add = (
      bars: Map<string, Record<string, number>>,
      day: string,
      key: string,
      seconds: number,
    ) => {
      const barKey = bucketKeyOf(day, size, weekStartsOn)
      const bar = bars.get(barKey) ?? {}

      bar[key] = (bar[key] ?? 0) + seconds / 3600
      bars.set(barKey, bar)
    }

    for (const row of report.daily) {
      add(byProject, row.day, keyOf(row.projectId), row.trackedSeconds)
      add(byKind, row.day, 'people', row.trackedSeconds)
    }

    for (const row of report.agentsDaily) {
      add(byKind, row.day, 'agents', row.workedSeconds)
    }

    const toBuckets = (bars: Map<string, Record<string, number>>): Bucket[] =>
      periods.map((period) => ({
        key: period.key,
        ...bucketLabels(period, language),
        values: bars.get(period.key) ?? {},
      }))
    const colors = new Map(series.map((item) => [item.key, item.color]))
    const shares = new Map<string, ShareListRow>()

    // Projects past the named colours share one "Other" row, as in the bars.
    for (const row of totals.projects) {
      const key = keyOf(row.id)
      const share = shares.get(key)

      shares.set(key, {
        key,
        title:
          key === OTHER_SERIES_KEY ? t('dashboard.charts.other') : row.name,
        color: colors.get(key) ?? 'var(--ui-chart-other)',
        seconds: (share?.seconds ?? 0) + row.seconds,
        share:
          (share?.share ?? 0) +
          (totals.peopleSeconds > 0 ? row.seconds / totals.peopleSeconds : 0),
      })
    }

    return {
      totals,
      series,
      byProject: toBuckets(byProject),
      byKind: toBuckets(byKind),
      shares: [...shares.values()],
    }
  }, [language, report, t])

  const days = getReportDays(report)
  const period = new Intl.DateTimeFormat(language, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).formatRange(fromDay(days.from), fromDay(days.to))
  const compact = (seconds: number) =>
    formatCompactDurationFromMinutes(seconds / 60, language)
  const full = (seconds: number) =>
    formatDurationFromMinutes(Math.round(seconds / 60), t)
  const hoursValue = (hours: number) =>
    formatDurationFromMinutes(Math.round(hours * 60), t)
  const hoursTick = (hours: number) =>
    t('dashboard.charts.hoursTick', { value: hours })
  const hasAgents = view.totals.agentSeconds > 0
  const empty = view.totals.peopleSeconds === 0 && !hasAgents
  const { amounts } = report
  const chart = {
    maxBarSize: workspaceDesign.chart.barMaxWidth,
    barRadius: workspaceDesign.chart.barRadius,
    gridDasharray: '0',
    formatValue: hoursValue,
    formatTick: hoursTick,
    emptyLabel: t('dashboard.timeDaily.tooltipEmpty'),
  }

  return (
    <Root>
      <Header>
        <Heading>
          <Eyebrow>{t('report.eyebrow')}</Eyebrow>
          <Title>
            {report.title ||
              view.totals.projects[0]?.name ||
              report.projects[0]?.title ||
              t('reports.untitled')}
          </Title>
          <Lead>
            {period}
            {' · '}
            {t('report.sharedBy', { name: report.sharedBy })}
          </Lead>
        </Heading>
        <Print variant="outline" color="neutral" onClick={() => window.print()}>
          {t('report.print')}
        </Print>
      </Header>
      <Figures>
        <Figure>
          <FigureLabel>{t('report.peopleTime')}</FigureLabel>
          <FigureValue aria-label={full(view.totals.peopleSeconds)}>
            {compact(view.totals.peopleSeconds)}
          </FigureValue>
        </Figure>
        {hasAgents ? (
          <Figure>
            <FigureLabel>{t('report.agentTime')}</FigureLabel>
            <FigureValue aria-label={full(view.totals.agentSeconds)}>
              {compact(view.totals.agentSeconds)}
            </FigureValue>
          </Figure>
        ) : null}
        {amounts ? (
          <Figure>
            <FigureLabel>{t('report.amount')}</FigureLabel>
            <FigureValue>
              {formatCurrency(
                (amounts.peopleCents + amounts.agentsCents) / 100,
              )}
            </FigureValue>
            {amounts.agentsCents > 0 ? (
              <FigureHint>
                {t('report.amountSplit', {
                  people: formatCurrency(amounts.peopleCents / 100),
                  agents: formatCurrency(amounts.agentsCents / 100),
                })}
              </FigureHint>
            ) : null}
          </Figure>
        ) : null}
      </Figures>
      {empty ? (
        <WorkspacePanel
          title={t('report.daily.title')}
          empty={{ title: t('dashboard.timeDaily.empty.title') }}
        >
          {null}
        </WorkspacePanel>
      ) : (
        <>
          <ChartPanel title={t('report.daily.title')}>
            <BucketBarChart
              {...chart}
              height={workspaceDesign.chart.height}
              buckets={view.byProject}
              series={view.series}
              totalLabel={t('dashboard.charts.total')}
            />
          </ChartPanel>
          <Pair data-single={!hasAgents || undefined}>
            <WorkspacePanel title={t('time.charts.share.title')}>
              <ShareList rows={view.shares} />
            </WorkspacePanel>
            {hasAgents ? (
              <ChartPanel title={t('report.kinds.title')}>
                <BucketBarChart
                  {...chart}
                  stacked={false}
                  height={workspaceDesign.chart.minHeight}
                  buckets={view.byKind}
                  series={[
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
                  ]}
                />
              </ChartPanel>
            ) : null}
          </Pair>
          <PublicReportTables totals={view.totals} />
        </>
      )}
      <Footer>
        <span>{t('report.live')}</span>
        <Made href="https://address.work" target="_blank" rel="noopener">
          {t('report.madeWith')}
        </Made>
      </Footer>
    </Root>
  )
}

const Root = styled.article`
  display: grid;
  gap: var(--ui-section-gap);
  inline-size: 100%;
  max-inline-size: 1080px;
  margin-inline: auto;
  padding: var(--ui-space-7) var(--ui-space-5);

  ${(p) => p.theme.breakpoints.down('md')} {
    padding: var(--ui-space-5) var(--ui-space-4);
  }

  @media print {
    padding: 0;
  }
`

const Header = styled.header`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--ui-space-4);

  /* A phone gives the title the full width and puts the button under it. */
  ${(p) => p.theme.breakpoints.down('md')} {
    grid-template-columns: minmax(0, 1fr);
    justify-items: start;
  }
`

const Heading = styled.div`
  display: grid;
  gap: var(--ui-space-2);
  min-width: 0;
`

const Eyebrow = styled.span`
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  font-weight: var(--ui-weight-medium);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`

const Title = styled.h1`
  margin: 0;
  color: var(--ui-ink);
  font-size: var(--ui-title-size);
  line-height: var(--ui-title-line-height);
  font-weight: var(--ui-weight-semibold);
  overflow-wrap: anywhere;
`

const Lead = styled.p`
  margin: 0;
  color: var(--ui-muted);
`

const Print = styled(Button)`
  @media print {
    display: none;
  }
`

const Figures = styled.dl`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--ui-space-5);
  margin: 0;
  padding: var(--ui-card-inset);
  border: var(--ui-border-width) solid var(--ui-edge);
  border-radius: var(--ui-radius);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow);
`

const Figure = styled.div`
  display: grid;
  align-content: start;
  gap: var(--ui-space-1);
`

const FigureLabel = styled.dt`
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
`

const FigureValue = styled.dd`
  margin: 0;
  color: var(--ui-ink);
  font-size: var(--ui-title-size);
  line-height: var(--ui-title-line-height);
  font-weight: var(--ui-weight-semibold);
  font-variant-numeric: tabular-nums;
`

const FigureHint = styled.dd`
  margin: 0;
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
`

const ChartPanel = styled(WorkspacePanel)`
  --chart-label-size: var(--ui-meta-size);

  min-width: 0;
  break-inside: avoid;
`

const Pair = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: var(--ui-section-gap);

  ${(p) => p.theme.breakpoints.up('lg')} {
    grid-template-columns: repeat(2, minmax(0, 1fr));

    &[data-single] {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`

const Footer = styled.footer`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--ui-space-3);
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);

  ${(p) => p.theme.breakpoints.down('md')} {
    grid-template-columns: minmax(0, 1fr);
  }
`

const Made = styled.a`
  color: var(--ui-blue);
  font-weight: var(--ui-weight-medium);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`
