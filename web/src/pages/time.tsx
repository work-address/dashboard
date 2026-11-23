import { useStoreMap, useUnit } from 'effector-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { $projects, fetchProjects } from '@/entities/projects'
import { statisticsPeriodOverviewQuery } from '@/entities/statistics'
import { $timeFilters } from '@/entities/time'
import { ShareReport, toReportDraft } from '@/features/shared-report'
import {
  $timeChartsRange,
  TimeWorklogs,
  useTimeSearchSync,
} from '@/features/time'
import { PageHelmet, WorkspacePage } from '@/shared'

export default function TimePage() {
  const { t } = useTranslation()
  const { fetchProjectsEvent, projects, range, overview } = useUnit({
    fetchProjectsEvent: fetchProjects,
    projects: $projects,
    range: $timeChartsRange,
    overview: statisticsPeriodOverviewQuery.$data,
  })
  const projectId = useStoreMap($timeFilters, (filters) => filters.activityId)

  useTimeSearchSync()

  // The project filter and the entries' rates both come from the projects.
  useEffect(() => {
    fetchProjectsEvent()
  }, [fetchProjectsEvent])

  // What "Share report" would share: the period the charts show, and the
  // project the page is narrowed to.
  const reportDraft = useMemo(
    () =>
      range
        ? toReportDraft({
            range,
            projectIds: projectId ? [projectId] : [],
            visibleProjectIds: projects
              .map((project) => project.id)
              .filter((id): id is string => Boolean(id)),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          })
        : null,
    [range, projectId, projects],
  )
  // Money is in the period's figures only for a reader who may see it.
  const canShowAmounts = (overview?.totals ?? []).some(
    (row) => row.earnedCents !== undefined,
  )

  return (
    <Root>
      <PageHelmet
        title={t('time.page.title')}
        description={t('time.page.meta')}
      />
      <TimeWorklogs
        headerAction={
          <ShareReport draft={reportDraft} canShowAmounts={canShowAmounts} />
        }
      />
    </Root>
  )
}

const Root = styled(WorkspacePage)`
  display: grid;
  align-content: start;
  gap: var(--ui-section-gap);
`
