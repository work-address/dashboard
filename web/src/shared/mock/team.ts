/**
 * The Team page, as `TeamManager` answers it. The demo has no agent list, so an
 * agent here is a product a person's runs used: its id is `userId:product`.
 */
import {
  accessOn,
  agentIdOf,
  isOwner,
  projectOf,
  userOf,
  visibleProjects,
} from './shape'

import type { Db, MockProject } from './db'

/**
 * The agents attached on a project, as `Project.agentAttachments` holds them:
 * every agent its people's runs imply, at the rate set for it or none, and
 * the agents set up by hand where they have a rate. Billing reads these too.
 */
export const attachmentsOn = (
  rows: Pick<Db, 'runs' | 'agents'>,
  project: MockProject,
) => [
  ...[
    ...new Map(
      rows.runs
        .filter((run) => run.projectId === project.id)
        .map((run) => [agentIdOf(run), run] as const),
    ).values(),
  ].map((run) => ({
    agentId: agentIdOf(run),
    workerId: run.userId,
    name: run.product,
    product: run.product,
    rateHourCents: project.agentRates?.[agentIdOf(run)] ?? 0,
    attachedAt: project.createdAt,
    rateChanges: [],
  })),
  ...rows.agents
    .filter(
      (agent) =>
        !agent.removedAt && project.agentRates?.[agent.id] !== undefined,
    )
    .map((agent) => ({
      agentId: agent.id,
      workerId: agent.userId,
      name: agent.name,
      product: agent.product,
      rateHourCents: project.agentRates![agent.id],
      attachedAt: agent.createdAt,
      rateChanges: [],
    })),
]

const agentsOn = (db: Db, project: MockProject, userId: string) =>
  attachmentsOn(db, project)
    .filter((attachment) => attachment.workerId === userId)
    .map((attachment) => ({
      id: attachment.agentId,
      name: attachment.name,
      product: attachment.product,
      rateHourCents: attachment.rateHourCents,
      attachedAt: attachment.attachedAt,
      lastRateChange: null,
    }))

export function teamOf(db: Db, meId: string) {
  const visible = visibleProjects(db, meId)
  const worked = visible.filter((project) => accessOn(db, project, meId).works)

  const person = (
    project: MockProject,
    userId: string,
    role: 'owner' | 'worker' | 'viewer',
  ) => {
    const user = userOf(db, userId)

    return {
      address: user?.address ?? userId,
      // `idsForAddresses` makes a nameless user for an address nobody has signed
      // in with, where the API has no account at all.
      userId: user?.name ? userId : null,
      name: user?.name || null,
      role,
      agents:
        role !== 'viewer' && (isOwner(project, meId) || userId === meId)
          ? agentsOn(db, project, userId)
          : [],
    }
  }

  return {
    viewerOnly: worked.length === 0 && visible.length > 0,
    projects: worked.map((project) => ({
      id: project.id,
      title: project.title,
      state: project.state,
      role: isOwner(project, meId) ? 'owner' : 'worker',
      trackAgents: project.trackAgents,
      people: [
        person(project, project.ownerId, 'owner'),
        ...project.workerIds.map((id) => person(project, id, 'worker')),
        ...project.viewerIds.map((id) => person(project, id, 'viewer')),
      ],
    })),
  }
}

export const ownAgents = (db: Db, meId: string) => {
  const products = new Set(
    db.runs
      .filter((run) => run.userId === meId && projectOf(db, run.projectId))
      .map((run) => run.product),
  )

  return [
    ...[...products].map((product) => ({
      id: `${meId}:${product}`,
      name: product,
      slug: product,
      product,
      removedAt: null,
    })),
    ...db.agents
      .filter((agent) => agent.userId === meId)
      .map(({ id, name, slug, product, removedAt }) => ({
        id,
        name,
        slug,
        product,
        removedAt,
      })),
  ]
}
