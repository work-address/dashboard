import { useUnit } from 'effector-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import styled from 'styled-components'

import { publicReportQuery } from '@/entities/shared-report'
import { PublicReport } from '@/features/shared-report'
import { LoadFailure, PageHelmet, RouteSkeleton, StateNotice } from '@/shared'

/**
 * A shared report, for anyone with its link. A link that was deleted and one
 * the free plan has hidden each say so plainly: the reader is usually a
 * client, who can only ask the sharer for a new one.
 */
export default function ReportPage() {
  const { t } = useTranslation()
  const { token = '' } = useParams()

  const { result, pending, failed, ask } = useUnit({
    result: publicReportQuery.$data,
    pending: publicReportQuery.$pending,
    failed: publicReportQuery.$failed,
    ask: publicReportQuery.start,
  })

  useEffect(() => {
    ask(token)
  }, [ask, token])

  const report = result && 'report' in result ? result.report : null
  const gone = result && 'gone' in result ? result.gone : null

  return (
    <>
      <PageHelmet
        title={report?.title || t('report.documentTitle')}
        description={t('report.meta')}
      />
      {report ? (
        <PublicReport report={report} />
      ) : gone ? (
        <Notice>
          <StateNotice
            size="page"
            title={t(`report.gone.${gone}.title`)}
            description={t(`report.gone.${gone}.description`)}
          />
        </Notice>
      ) : failed && !pending ? (
        <Notice>
          <LoadFailure
            size="panel"
            title={t('report.loadFailure')}
            onRetry={() => ask(token)}
          />
        </Notice>
      ) : (
        <RouteSkeleton variant="document" />
      )}
    </>
  )
}

const Notice = styled.div`
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: var(--ui-space-5);
`
