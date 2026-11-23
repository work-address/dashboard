// The insight rules live in a package the web demo shares, so the dashboard
// and its demo can never count focus or assisted time differently.
export {
  FOCUS_GAP_MS,
  FOCUS_MIN_MS,
  StatisticsInsights,
  type AgentDailyRow,
  type AgentRunInput,
  type AgentRunsDailyRow,
  type AgentWorkedRow,
  type HourlyRow,
  type InsightEntry,
  type PersonDailyRow,
} from '@work-address/statistics-core'
