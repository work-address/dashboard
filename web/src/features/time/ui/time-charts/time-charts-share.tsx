import { useTranslation } from 'react-i18next'

import { ShareList, WorkspacePanel, type ShareListRow } from '@/shared'

type Props = {
  rows: ShareListRow[]
  loading: boolean
  failed: boolean
  onRetry: () => void
}

/** Each project's part of the period, most time first. */
export const TimeChartsShare = ({ rows, loading, failed, onRetry }: Props) => {
  const { t } = useTranslation()

  return (
    <WorkspacePanel
      title={t('time.charts.share.title')}
      loading={loading}
      failed={failed}
      onRetry={onRetry}
    >
      <ShareList rows={rows} />
    </WorkspacePanel>
  )
}
