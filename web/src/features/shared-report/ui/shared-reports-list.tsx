import {
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  TrashIcon,
} from '@radix-ui/react-icons'
import { useUnit } from 'effector-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import {
  getReportDays,
  getReportProjectsLabel,
  getReportUrl,
  invoiceReportRequested,
  reportLinkCopyRequested,
  sharedReportDeleteRequested,
} from '../model'

import {
  invoiceSharedReportMutation,
  type SharedReport,
} from '@/entities/shared-report'
import { routes } from '@/routes'
import { Button, fromDay, IconButton, Tooltip } from '@/shared'

const ICON_SIZE = 14

type Props = {
  reports: SharedReport[]
  projectTitles: Map<string, string>
}

/**
 * The reader's shared reports, newest first: what each covers, its link, the
 * invoice made from it, and the way to end the link.
 */
export const SharedReportsList = ({ reports, projectTitles }: Props) => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language

  const { copy, remove, invoice, invoicing } = useUnit({
    copy: reportLinkCopyRequested,
    remove: sharedReportDeleteRequested,
    invoice: invoiceReportRequested,
    invoicing: invoiceSharedReportMutation.$pending,
  })

  const dayRange = new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const created = new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
  })

  return (
    <List>
      {reports.map((report) => {
        const days = getReportDays(report)
        const projects = getReportProjectsLabel(
          report.projectIds,
          projectTitles,
          (count) => t('reports.moreProjects', { count }),
          t('reports.untitled'),
        )

        return (
          <Row key={report.id}>
            <About>
              <Title>{report.title || projects}</Title>
              <Meta>
                <span>
                  {dayRange.formatRange(fromDay(days.from), fromDay(days.to))}
                </span>
                {report.title ? <span>{projects}</span> : null}
                <span>
                  {t('reports.sharedOn', {
                    date: created.format(new Date(report.createdAt)),
                  })}
                </span>
                {report.showAmounts ? (
                  <Tag>{t('reports.amountsShown')}</Tag>
                ) : null}
              </Meta>
            </About>
            <Actions>
              {report.invoiceId ? (
                <InvoiceLink
                  to={routes.invoice.build({ id: report.invoiceId })}
                >
                  <FileTextIcon width={ICON_SIZE} height={ICON_SIZE} />
                  {t('reports.invoice')}
                </InvoiceLink>
              ) : report.canInvoice ? (
                <Button
                  size="s"
                  variant="soft"
                  loading={invoicing}
                  iconLeft={
                    <FileTextIcon width={ICON_SIZE} height={ICON_SIZE} />
                  }
                  onClick={() =>
                    invoice({
                      report,
                      summary: t('reports.invoiceConfirm.description', {
                        project: projects,
                        period: dayRange.formatRange(
                          fromDay(days.from),
                          fromDay(days.to),
                        ),
                      }),
                    })
                  }
                >
                  {t('reports.createInvoice')}
                </Button>
              ) : null}
              <Button
                size="s"
                variant="soft"
                color="neutral"
                iconLeft={<CopyIcon width={ICON_SIZE} height={ICON_SIZE} />}
                onClick={() => copy(report.token)}
              >
                {t('reports.copyLink')}
              </Button>
              <Tooltip content={t('reports.open')}>
                <OpenLink
                  href={getReportUrl(window.location.origin, report.token)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('reports.open')}
                >
                  <ExternalLinkIcon width={ICON_SIZE} height={ICON_SIZE} />
                </OpenLink>
              </Tooltip>
              <Tooltip content={t('reports.delete.action')}>
                <IconButton
                  variant="ghost"
                  color="gray"
                  aria-label={t('reports.delete.action')}
                  onClick={() => remove(report)}
                >
                  <TrashIcon width={ICON_SIZE} height={ICON_SIZE} />
                </IconButton>
              </Tooltip>
            </Actions>
          </Row>
        )
      })}
    </List>
  )
}

const List = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Row = styled.li`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--ui-space-3) var(--ui-space-4);
  padding: var(--ui-space-4) 0;
  border-block-start: var(--ui-border-width) solid var(--ui-line);

  &:first-child {
    padding-block-start: 0;
    border-block-start: 0;
  }

  &:last-child {
    padding-block-end: 0;
  }

  ${(p) => p.theme.breakpoints.down('md')} {
    grid-template-columns: minmax(0, 1fr);
  }
`

const About = styled.div`
  display: grid;
  gap: var(--ui-space-1);
  min-width: 0;
`

const Title = styled.span`
  overflow: hidden;
  color: var(--ui-ink);
  font-weight: var(--ui-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
`

/* Wraps: the meta is a run of short facts of unknown number and width, which
   a grid would need a column count for. */
const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ui-space-1) var(--ui-space-3);
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
`

const Tag = styled.span`
  padding: 0 var(--ui-space-2);
  border-radius: var(--ui-pill-radius);
  background: var(--ui-glow);
  color: var(--ui-blue);
`

/* Wraps on a phone, where four actions do not fit one row. */
const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ui-space-2);
`

const InvoiceLink = styled(Link)`
  display: inline-grid;
  grid-auto-flow: column;
  align-items: center;
  gap: var(--ui-space-1);
  color: var(--ui-blue);
  font-size: var(--ui-meta-size);
  font-weight: var(--ui-weight-medium);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`

const OpenLink = styled.a`
  display: grid;
  place-items: center;
  inline-size: var(--ui-space-7);
  block-size: var(--ui-space-7);
  border-radius: var(--ui-control-radius);
  color: var(--ui-muted);

  &:hover {
    background: var(--ui-inset);
    color: var(--ui-ink);
  }

  &:focus-visible {
    outline: var(--ui-focus-width) solid var(--ui-blue);
    outline-offset: var(--ui-focus-offset);
  }
`
