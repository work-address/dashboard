import type { PublicReport } from '@/entities/shared-report'

export type PublicReportRow = { id: string; name: string; seconds: number }

export type PublicReportTotals = {
  /** People's tracked time. */
  peopleSeconds: number
  /** Agents' working time; kept apart, never added to people's. */
  agentSeconds: number
  /** Most time first; idle ones left out. */
  projects: PublicReportRow[]
  people: PublicReportRow[]
  agents: (PublicReportRow & { owner: string | null })[]
}

const ranked = <Row extends PublicReportRow>(rows: Row[]): Row[] =>
  rows
    .filter((row) => row.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))

/**
 * The report's totals: by project, and by person and agent where the sharer
 * may see that split. A project counts people's time only, as every project
 * total in the product does.
 */
export const getPublicReportTotals = (
  report: PublicReport,
  unnamed: string,
): PublicReportTotals => {
  const add = (map: Map<string, number>, id: string, seconds: number) =>
    map.set(id, (map.get(id) ?? 0) + seconds)
  const byProject = new Map<string, number>()
  const byPerson = new Map<string, number>()
  const byAgent = new Map<string, number>()

  for (const row of report.daily) {
    add(byProject, row.projectId, row.trackedSeconds)
    if (row.userId) {
      add(byPerson, row.userId, row.trackedSeconds)
    }
  }

  for (const row of report.agentsDaily) {
    add(byAgent, row.agentId, row.workedSeconds)
  }

  const people = new Map(
    report.people.map((person) => [person.id, person.name]),
  )
  const sum = (map: Map<string, number>) =>
    [...map.values()].reduce((total, seconds) => total + seconds, 0)

  return {
    peopleSeconds: sum(byProject),
    agentSeconds: sum(byAgent),
    projects: ranked(
      report.projects.map((project) => ({
        id: project.id,
        name: project.title,
        seconds: byProject.get(project.id) ?? 0,
      })),
    ),
    people: ranked(
      report.people.map((person) => ({
        id: person.id,
        name: person.name,
        seconds: byPerson.get(person.id) ?? 0,
      })),
    ),
    agents: ranked(
      report.agents.map((agent) => ({
        id: agent.id,
        name: agent.name || unnamed,
        seconds: byAgent.get(agent.id) ?? 0,
        owner: people.get(agent.userId) ?? null,
      })),
    ),
  }
}
