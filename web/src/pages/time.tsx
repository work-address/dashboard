import { useUnit } from 'effector-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { fetchProjects } from '@/entities/projects'
import { ShareReport } from '@/features/shared-report'
import {
  $timeChartsQuery,
  TimeWorklogs,
  useTimeSearchSync,
} from '@/features/time'
import { PageHelmet, WorkspacePage } from '@/shared'

export default function TimePage() {
  const { t } = useTranslation()
  const { fetchProjectsEvent, chartsQuery } = useUnit({
    fetchProjectsEvent: fetchProjects,
    chartsQuery: $timeChartsQuery,
  })

  useTimeSearchSync()

  // The project filter and the entries' rates both come from the projects.
  useEffect(() => {
    fetchProjectsEvent()
  }, [fetchProjectsEvent])

  return (
    <Root>
      <PageHelmet
        title={t('time.page.title')}
        description={t('time.page.meta')}
      />
      {/* What is shared is what the page's charts show. */}
      <TimeWorklogs headerAction={<ShareReport query={chartsQuery} />} />
    </Root>
  )
}

const Root = styled(WorkspacePage)`
  display: grid;
  align-content: start;
  gap: var(--ui-section-gap);
`
