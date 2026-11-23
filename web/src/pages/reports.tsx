import { useUnit } from 'effector-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { $projects, fetchProjects } from '@/entities/projects'
import { sharedReportsQuery } from '@/entities/shared-report'
import {
  SharedReportsList,
  sharedReportsRequested,
} from '@/features/shared-report'
import {
  PageHelmet,
  WorkspaceCount,
  WorkspacePage,
  WorkspacePageHeader,
  WorkspacePanel,
} from '@/shared'

/**
 * Every report the reader has shared: what each covers, its link, the
 * invoice made from it, and the way to end the link. A report is made from
 * the Dashboard or the Time page, with the filters set there.
 */
export default function ReportsPage() {
  const { t } = useTranslation()

  const { reports, pending, failed, request, projects, loadProjects } = useUnit(
    {
      reports: sharedReportsQuery.$data,
      pending: sharedReportsQuery.$pending,
      failed: sharedReportsQuery.$failed,
      request: sharedReportsRequested,
      projects: $projects,
      loadProjects: fetchProjects,
    },
  )

  useEffect(() => {
    request()
    loadProjects()
  }, [request, loadProjects])

  const projectTitles = useMemo(
    () =>
      new Map(
        projects
          .filter((project) => project.id)
          .map((project) => [project.id as string, project.title]),
      ),
    [projects],
  )

  return (
    <Root>
      <PageHelmet
        title={t('reports.page.title')}
        description={t('reports.page.meta')}
      />
      <WorkspacePageHeader
        eyebrow={t('reports.page.eyebrow')}
        title={t('reports.page.title')}
        description={t('reports.page.description')}
      />
      <WorkspacePanel
        title={t('reports.list.title')}
        aside={
          reports?.length ? (
            <WorkspaceCount>
              {t('reports.list.count', { count: reports.length })}
            </WorkspaceCount>
          ) : undefined
        }
        loading={pending && reports === null}
        failed={failed && reports === null}
        onRetry={() => request()}
        empty={
          reports && reports.length === 0
            ? {
                title: t('reports.list.empty.title'),
                description: t('reports.list.empty.description'),
              }
            : undefined
        }
      >
        <SharedReportsList
          reports={reports ?? []}
          projectTitles={projectTitles}
        />
      </WorkspacePanel>
    </Root>
  )
}

const Root = styled(WorkspacePage)`
  display: grid;
  align-content: start;
  gap: var(--ui-section-gap);
`
