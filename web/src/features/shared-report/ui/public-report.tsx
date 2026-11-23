import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { getPublicReportTotals, getReportDays } from '../model'

import { PublicReportTables } from './public-report-tables'

import type { PublicReport as Report } from '@/entities/shared-report'

import {
  BucketBarChart,
  Button,
  formatCompactDurationFromMinutes,
  formatCurrency,
  formatDurationFromMinutes,
  fromDay,
  periodBars,
  ranked,
  ShareList,
  WorkspacePanel,
  workspaceDesign,
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
    const shared = { period: getReportDays(report), language }
    // A report's rows always come by day, however short its period.
    const byProject = periodBars({
      ...shared,
      sources: [
        {
          rows: report.daily,
          grain: 'day',
          values: (row) => ({ [row.projectId]: row.trackedSeconds / 3600 }),
        },
      ],
      series: ranked(
        report.projects.map((project) => ({
          id: project.id,
          title: project.title,
        })),
        t('dashboard.charts.other'),
      ),
    })
    const byKind = periodBars({
      ...shared,
      sources: [
        {
          rows: report.daily,
          grain: 'day',
          values: (row) => ({ people: row.trackedSeconds / 3600 }),
        },
        {
          rows: report.agentsDaily,
          grain: 'day',
          values: (row) => ({ agents: row.workedSeconds / 3600 }),
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
    })

    return { totals, byProject, byKind }
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
              buckets={view.byProject.buckets}
              series={view.byProject.series}
              totalLabel={t('dashboard.charts.total')}
            />
          </ChartPanel>
          <Pair data-single={!hasAgents || undefined}>
            <WorkspacePanel title={t('time.charts.share.title')}>
              <ShareList
                rows={view.byProject.shares}
                formatValue={(hours) => compact(hours * 3600)}
                describeValue={(hours) => full(hours * 3600)}
              />
            </WorkspacePanel>
            {hasAgents ? (
              <ChartPanel title={t('report.kinds.title')}>
                <BucketBarChart
                  {...chart}
                  stacked={false}
                  height={workspaceDesign.chart.minHeight}
                  buckets={view.byKind.buckets}
                  series={view.byKind.series}
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
