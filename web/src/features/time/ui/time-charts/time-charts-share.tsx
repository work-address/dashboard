import { useTranslation } from 'react-i18next'

import {
  formatCompactDurationFromMinutes,
  formatDurationFromMinutes,
  ShareList,
  WorkspacePanel,
  type ShareRow,
} from '@/shared'

type Props = {
  /** Each project's hours and share of the period. */
  rows: ShareRow[]
  loading: boolean
  failed: boolean
  onRetry: () => void
}

/** Each project's part of the period, most time first. */
export const TimeChartsShare = ({ rows, loading, failed, onRetry }: Props) => {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language

  return (
    <WorkspacePanel
      title={t('time.charts.share.title')}
      loading={loading}
      failed={failed}
      onRetry={onRetry}
    >
      <ShareList
        rows={rows}
        formatValue={(hours) =>
          formatCompactDurationFromMinutes(hours * 60, language)
        }
        describeValue={(hours) =>
          formatDurationFromMinutes(Math.round(hours * 60), t)
        }
      />
    </WorkspacePanel>
  )
}
