import { createEvent, createStore, sample } from 'effector'

import { type TimeChartsMode, type TimeChartsRange } from './time-charts'

import {
  statisticsPeriodAgentsQuery,
  statisticsPeriodDailyQuery,
  statisticsPeriodOverviewQuery,
  type StatisticsQuery,
} from '@/entities/statistics'
import { askGrain, toApiDateRange } from '@/shared'

type TimeChartsRequest = {
  range: TimeChartsRange
  /** The project filter, when one is set: the charts follow it. */
  projectId: string | null
}

/** The page asks for its charts: on arrival and when the period or project moves. */
export const timeChartsRequested = createEvent<TimeChartsRequest>()
export const timeChartsModeChanged = createEvent<TimeChartsMode>()

export const $timeChartsRange = createStore<TimeChartsRange | null>(null).on(
  timeChartsRequested,
  (_, { range }) => range,
)

export const $timeChartsMode = createStore<TimeChartsMode>('projects').on(
  timeChartsModeChanged,
  (_, mode) => mode,
)

const toStatisticsQuery = ({
  range,
  projectId,
}: TimeChartsRequest): StatisticsQuery => ({
  ...toApiDateRange(range),
  // Days are the reader's days, wherever the server is.
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  ...(projectId ? { projectIds: [projectId] } : {}),
  // A day or two is drawn by the hour, and the rows have to arrive that way.
  ...(askGrain(range) === 'hour' ? { bucket: 'hour' as const } : {}),
})

sample({
  clock: timeChartsRequested,
  fn: toStatisticsQuery,
  target: [
    statisticsPeriodOverviewQuery.start,
    statisticsPeriodDailyQuery.start,
    statisticsPeriodAgentsQuery.start,
  ],
})
