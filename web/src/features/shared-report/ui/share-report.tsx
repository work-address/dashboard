import { CopyIcon, ExternalLinkIcon, Share1Icon } from '@radix-ui/react-icons'
import { useUnit } from 'effector-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  $shareAmountsDropped,
  $shareReportDraft,
  $shareReportError,
  $shareReportPending,
  $sharedReport,
  getReportDays,
  getReportUrl,
  reportLinkCopyRequested,
  shareReportClosed,
  shareReportOpened,
  shareReportSubmitted,
  toReportDraft,
} from '../model'

import type { StatisticsQuery } from '@/entities/statistics'

import { $projects } from '@/entities/projects'
import {
  Button,
  Checkbox,
  DIALOG_WIDTH_STANDARD,
  fromDay,
  Input,
  Modal,
} from '@/shared'

const ICON_SIZE = 14

type Props = {
  /**
   * The statistics query the page shows; `null` until it has one. That query
   * is what is shared, so a report always matches the page it came from.
   */
  query: StatisticsQuery | null
  className?: string
}

/**
 * "Share report" on a page with a period: it turns the page's own query into
 * a link anyone can open. The dialog asks only for what the query does not
 * say - a title and whether amounts show - then hands over the link, and
 * says what the server decided: which projects, and whether amounts show.
 */
export const ShareReport = ({ query, className }: Props) => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language
  const amountsId = useId()
  const [title, setTitle] = useState('')
  const [showAmounts, setShowAmounts] = useState(false)

  const {
    opened,
    shared,
    pending,
    error,
    amountsDropped,
    projects,
    open,
    close,
    submit,
    copy,
  } = useUnit({
    opened: $shareReportDraft,
    shared: $sharedReport,
    pending: $shareReportPending,
    error: $shareReportError,
    amountsDropped: $shareAmountsDropped,
    projects: $projects,
    open: shareReportOpened,
    close: shareReportClosed,
    submit: shareReportSubmitted,
    copy: reportLinkCopyRequested,
  })

  // Each report starts from a clean form.
  useEffect(() => {
    if (opened) {
      setTitle('')
      setShowAmounts(false)
    }
  }, [opened])

  // Leaving the page closes its dialog, so the next page does not open it.
  useEffect(() => close, [close])

  const draft = toReportDraft(query)
  // A viewer never sees money, so one who views everything they have is not
  // offered it. Anyone else may ask; the server decides for the projects the
  // report ends up with.
  const offersAmounts = projects.some((project) => project.role !== 'viewer')
  const days = opened ? getReportDays(opened) : null
  const period = days
    ? new Intl.DateTimeFormat(language, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).formatRange(fromDay(days.from), fromDay(days.to))
    : ''
  const url = shared ? getReportUrl(window.location.origin, shared.token) : ''

  return (
    <>
      <Button
        className={className}
        variant="outline"
        color="neutral"
        iconLeft={<Share1Icon width={ICON_SIZE} height={ICON_SIZE} />}
        disabled={!draft}
        onClick={() => draft && open(draft)}
      >
        {t('reports.share.action')}
      </Button>
      <Modal
        open={opened !== null}
        onOpenChange={(next) => !next && close()}
        title={t(shared ? 'reports.share.readyTitle' : 'reports.share.title')}
        showClose
        width={DIALOG_WIDTH_STANDARD}
        footer={
          shared ? (
            <Button onClick={() => close()}>{t('reports.share.done')}</Button>
          ) : (
            <>
              <Button variant="soft" color="neutral" onClick={() => close()}>
                {t('common.cancel')}
              </Button>
              <Button
                loading={pending}
                onClick={() => submit({ title, showAmounts })}
              >
                {t('reports.share.create')}
              </Button>
            </>
          )
        }
      >
        {shared ? (
          <Body>
            <Summary>
              <SummaryPeriod>{period}</SummaryPeriod>
              <span>
                {t('reports.share.projects', {
                  count: shared.projectIds.length,
                })}
              </span>
            </Summary>
            {amountsDropped ? (
              <Note role="status">{t('reports.share.amountsDropped')}</Note>
            ) : null}
            <Note>{t('reports.share.readyNote')}</Note>
            <Input
              label={t('reports.share.link')}
              rows="1"
              value={url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <Actions>
              <Button
                variant="soft"
                iconLeft={<CopyIcon width={ICON_SIZE} height={ICON_SIZE} />}
                onClick={() => copy(shared.token)}
              >
                {t('reports.copyLink')}
              </Button>
              <OpenLink href={url} target="_blank" rel="noopener noreferrer">
                <Button
                  variant="soft"
                  color="neutral"
                  iconLeft={
                    <ExternalLinkIcon width={ICON_SIZE} height={ICON_SIZE} />
                  }
                >
                  {t('reports.open')}
                </Button>
              </OpenLink>
            </Actions>
          </Body>
        ) : (
          <Body>
            <Summary>
              <SummaryPeriod>{period}</SummaryPeriod>
              <span>
                {opened?.projectIds?.length
                  ? t('reports.share.projects', {
                      count: opened.projectIds.length,
                    })
                  : t('reports.share.allProjects')}
                {' · '}
                {opened?.userIds?.length
                  ? t('reports.share.people', { count: opened.userIds.length })
                  : t('reports.share.everyone')}
              </span>
            </Summary>
            <Input
              label={t('reports.share.titleLabel')}
              rows="1"
              placeholder={t('reports.share.titlePlaceholder')}
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            {offersAmounts ? (
              <Option htmlFor={amountsId}>
                <Checkbox
                  id={amountsId}
                  checked={showAmounts}
                  onCheckedChange={(checked) =>
                    setShowAmounts(checked === true)
                  }
                />
                <OptionCopy>
                  <OptionTitle>{t('reports.share.amounts')}</OptionTitle>
                  <OptionHint>{t('reports.share.amountsHint')}</OptionHint>
                </OptionCopy>
              </Option>
            ) : null}
            <Note>{t('reports.share.note')}</Note>
            {error ? <Failure role="alert">{error}</Failure> : null}
          </Body>
        )}
      </Modal>
    </>
  )
}

const Body = styled.div`
  display: grid;
  gap: var(--ui-space-4);
`

const Summary = styled.div`
  display: grid;
  gap: var(--ui-space-1);
  padding: var(--ui-space-3) var(--ui-space-4);
  border-radius: var(--ui-control-radius);
  background: var(--ui-inset);
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
`

const SummaryPeriod = styled.span`
  color: var(--ui-ink);
  font-size: var(--ui-small-size);
  font-weight: var(--ui-weight-medium);
`

const Option = styled.label`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: var(--ui-space-3);
  cursor: pointer;
`

const OptionCopy = styled.span`
  display: grid;
  gap: var(--ui-space-1);
`

const OptionTitle = styled.span`
  color: var(--ui-ink);
  font-size: var(--ui-small-size);
  font-weight: var(--ui-weight-medium);
`

const OptionHint = styled.span`
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
`

const Note = styled.p`
  margin: 0;
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
`

const Failure = styled.p`
  margin: 0;
  color: var(--red-11);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
`

const Actions = styled.div`
  display: grid;
  grid-auto-flow: column;
  justify-content: start;
  gap: var(--ui-space-2);
`

const OpenLink = styled.a`
  text-decoration: none;
`
