import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { PublicReportTotals } from '../model'

import { formatDurationFromMinutes, WorkspacePanel } from '@/shared'

type Props = { totals: PublicReportTotals }

/**
 * Who did what, in full: every person and agent with their time, where the
 * sharer may see that split. Exact figures, since a chart only shows shape.
 */
export const PublicReportTables = ({ totals }: Props) => {
  const { t } = useTranslation()
  const time = (seconds: number) =>
    formatDurationFromMinutes(Math.round(seconds / 60), t)

  if (totals.people.length === 0 && totals.agents.length === 0) {
    return null
  }

  return (
    <Root
      data-single={
        totals.people.length === 0 || totals.agents.length === 0 || undefined
      }
    >
      {totals.people.length > 0 ? (
        <WorkspacePanel title={t('report.people.title')}>
          <Table>
            <thead>
              <tr>
                <Head scope="col">{t('report.people.name')}</Head>
                <Head scope="col" data-end>
                  {t('report.time')}
                </Head>
              </tr>
            </thead>
            <tbody>
              {totals.people.map((person) => (
                <tr key={person.id}>
                  <Cell>{person.name}</Cell>
                  <Cell data-end>{time(person.seconds)}</Cell>
                </tr>
              ))}
            </tbody>
          </Table>
        </WorkspacePanel>
      ) : null}
      {totals.agents.length > 0 ? (
        <WorkspacePanel title={t('report.agents.title')}>
          <Table>
            <thead>
              <tr>
                <Head scope="col">{t('report.agents.name')}</Head>
                <Head scope="col">{t('report.agents.owner')}</Head>
                <Head scope="col" data-end>
                  {t('report.time')}
                </Head>
              </tr>
            </thead>
            <tbody>
              {totals.agents.map((agent) => (
                <tr key={agent.id}>
                  <Cell>{agent.name}</Cell>
                  <Cell data-muted>{agent.owner ?? '-'}</Cell>
                  <Cell data-end>{time(agent.seconds)}</Cell>
                </tr>
              ))}
            </tbody>
          </Table>
        </WorkspacePanel>
      ) : null}
    </Root>
  )
}

const Root = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: var(--ui-section-gap);
  break-inside: avoid;

  ${(p) => p.theme.breakpoints.up('lg')} {
    grid-template-columns: repeat(2, minmax(0, 1fr));

    &[data-single] {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`

const Table = styled.table`
  inline-size: 100%;
  border-collapse: collapse;
  font-size: var(--ui-small-size);
`

const Head = styled.th`
  padding: 0 0 var(--ui-space-2);
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  font-weight: var(--ui-weight-medium);
  text-align: start;

  &[data-end] {
    text-align: end;
  }
`

const Cell = styled.td`
  padding: var(--ui-space-2) 0;
  border-block-start: var(--ui-border-width) solid var(--ui-line);
  color: var(--ui-ink);

  &[data-muted] {
    color: var(--ui-muted);
  }

  &[data-end] {
    font-variant-numeric: tabular-nums;
    text-align: end;
    white-space: nowrap;
  }
`
