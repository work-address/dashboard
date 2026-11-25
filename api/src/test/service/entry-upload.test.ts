import { suite, test } from '@testdeck/mocha'
import { expect } from 'chai'
import { BadRequestError } from 'routing-controllers'

import { Project } from '@/entity/project'
import { Time } from '@/entity/time'
import { User } from '@/entity/user'
import { TimeCreateDto } from '@/model/dto/time'
import { EntryUpload, EntryUploadOutcome } from '@/service/entry-upload'

const FROM = new Date('2026-11-25T08:00:00Z')
const TO = new Date('2026-11-25T08:10:00Z')
/** Ten minutes after the slice: inside the default 24-hour review window. */
const NOW = new Date('2026-11-25T08:20:00Z')

const author = Object.assign(new User(), { id: 'author' })

const project = (): Project =>
  Object.assign(new Project(), {
    id: 'project',
    trackScreenshots: true,
    trackProcesses: true,
    trackLocation: true,
    allowMobileTime: true,
    reviewWindowHours: null,
  })

type Source = 'desktop' | 'mobile'

/** What a retry sends: the same slice, with every piece of detail changed. */
const upload = (source: Source, fields: Partial<TimeCreateDto> = {}) =>
  ({
    fromIndex: 1,
    toIndex: 2,
    projectId: 'project',
    fromAt: FROM.toISOString(),
    toAt: TO.toISOString(),
    source,
    note: 'sent again',
    minutesActive: 10,
    keyboardKeys: 99,
    mouseKeys: 98,
    mouseDistance: 97,
    screenshot: 'new-image',
    processes: [{ name: 'Other', timeMin: 5 }],
    appsStatus: 'ok',
    apps: [{ name: 'Other', seconds: 600 }],
    locationStatus: 'ok',
    locations: [
      {
        at: '2026-11-25T08:05:00Z',
        latitude: 1,
        longitude: 2,
        accuracy: 5,
        mock: false,
      },
    ],
    ...fields,
  }) as TimeCreateDto

/** What is stored for the slice already, as its author last left it. */
const stored = (source: Source, fields: Partial<Time> = {}): Time =>
  Object.assign(new Time(), {
    id: 'stored',
    project: project(),
    user: author,
    fromAt: FROM,
    toAt: TO,
    source,
    note: 'corrected',
    minutesActive: 10,
    keyboardKeys: source === 'mobile' ? 0 : 7,
    mouseKeys: source === 'mobile' ? 0 : 3,
    mouseDistance: source === 'mobile' ? 0 : 10,
    screenshot: source === 'mobile' ? null : 'stored-image',
    processes: source === 'mobile' ? null : [{ name: 'Editor', timeMin: 5 }],
    appsStatus: source === 'mobile' ? 'unsupported' : 'ok',
    appsReason: source === 'mobile' ? 'mobile' : null,
    appsTruncated: false,
    locationStatus: source === 'mobile' ? 'ok' : null,
    publishedAt: null,
    isPaid: false,
    ...fields,
  })

const decide = (
  item: TimeCreateDto,
  existing: Time | undefined,
  now = NOW,
  policy = project(),
): EntryUploadOutcome =>
  EntryUpload.decide(EntryUpload.read(item, policy), existing, {
    project: policy,
    author,
    now,
  })

const stores = (outcome: EntryUploadOutcome) => {
  if ('refused' in outcome) throw outcome.refused
  return outcome
}

/** The detail columns the freeze is about, as the stored Entry would hold them. */
const detail = (entry: Time) => ({
  source: entry.source,
  note: entry.note,
  keyboardKeys: entry.keyboardKeys,
  mouseKeys: entry.mouseKeys,
  mouseDistance: entry.mouseDistance,
  screenshot: entry.screenshot,
  processes: entry.processes,
  appsStatus: entry.appsStatus,
  appsReason: entry.appsReason,
  locationStatus: entry.locationStatus,
})

interface Cell {
  published: boolean
  source: Source
  locationRemoved: boolean
}

const CELLS: Cell[] = [false, true].flatMap((published) =>
  (['desktop', 'mobile'] as const).flatMap((source) =>
    [false, true].map((locationRemoved) => ({
      published,
      source,
      locationRemoved,
    })),
  ),
)

const named = ({ published, source, locationRemoved }: Cell) =>
  [
    published ? 'published' : 'unpublished',
    source,
    locationRemoved ? 'location removed' : '',
  ].join(' ')

/** What an unpublished Entry holds after the retry: what was sent, as read. */
const replaced = ({ source, locationRemoved }: Cell) => {
  const phone = source === 'mobile'
  const removed = locationRemoved ? 'removed' : null

  return {
    detail: {
      source,
      note: 'sent again',
      // A phone captures no input, screenshots or apps.
      keyboardKeys: phone ? 0 : 99,
      mouseKeys: phone ? 0 : 98,
      mouseDistance: phone ? 0 : 97,
      screenshot: phone ? null : 'new-image',
      processes: phone ? null : [{ name: 'Other', timeMin: 5 }],
      appsStatus: phone ? 'unsupported' : 'ok',
      appsReason: phone ? 'mobile' : null,
      locationStatus: removed ?? (phone ? 'ok' : null),
    },
    apps: phone ? [] : ['Other'],
    latitudes: locationRemoved ? null : phone ? [1] : [],
  }
}

const checkCell = (cell: Cell) => {
  const name = named(cell)
  const existing = stored(cell.source, {
    publishedAt: cell.published ? new Date('2026-11-25T08:15:00Z') : null,
    ...(cell.locationRemoved && { locationStatus: 'removed' }),
  })
  const outcome = stores(decide(upload(cell.source), existing))

  expect(outcome.entry.id, name).to.equal('stored')
  expect(outcome.entry.publishedAt, name).to.equal(existing.publishedAt)
  const expected = cell.published
    ? { detail: detail(existing), apps: null, latitudes: null }
    : replaced(cell)
  expect(
    {
      detail: detail(outcome.entry),
      apps: outcome.usage?.map((row) => row.app) ?? null,
      latitudes: outcome.locations?.map((row) => row.latitude) ?? null,
    },
    name,
  ).to.deep.equal(expected)
}

@suite()
export class EntryUploadTest {
  /**
   * SPEC: a re-upload never changes published detail, and location its author
   * removed stays removed, published or not. Every cell is a retry of the same
   * slice with all of its detail changed. Null rows mean the stored ones stay.
   */
  @test()
  freezeMatrix() {
    expect(CELLS).to.have.length(8)
    CELLS.forEach(checkCell)
  }

  /** Detail reaches the owner by release, by an invoice, or once review ends. */
  @test()
  anEntryIsPublishedThreeWays() {
    const ways: [string, Time, Date][] = [
      ['released', stored('desktop', { publishedAt: NOW }), NOW],
      ['invoiced', stored('desktop', { invoiceId: 'invoice' }), NOW],
      [
        'review over',
        stored('desktop'),
        new Date(TO.getTime() + 24 * 3600_000),
      ],
    ]
    for (const [way, existing, now] of ways) {
      const outcome = stores(decide(upload('desktop'), existing, now))
      expect(outcome.entry.note, way).to.equal('corrected')
    }

    const justBefore = new Date(TO.getTime() + 24 * 3600_000 - 1)
    expect(
      stores(decide(upload('desktop'), stored('desktop'), justBefore)).entry
        .note,
    ).to.equal('sent again')
  }

  @test()
  theProjectsReviewWindowDecidesWhenReviewEnds() {
    const policy = Object.assign(project(), { reviewWindowHours: 1 })
    const existing = stored('desktop', { project: policy })
    const outcome = stores(
      decide(
        upload('desktop'),
        existing,
        new Date(TO.getTime() + 3600_000),
        policy,
      ),
    )
    expect(outcome.entry.note).to.equal('corrected')
  }

  /** The time a published Entry accounts for is fixed: an upload can't move it. */
  @test()
  aPublishedEntrysTimeCannotChange() {
    const published = stored('desktop', { publishedAt: NOW })
    for (const changed of [
      upload('desktop', { minutesActive: 9 }),
      upload('desktop', { toAt: '2026-11-25T08:09:00Z' }),
    ]) {
      const outcome = decide(changed, published)
      expect(outcome).to.have.property('refused')
      expect((outcome as { refused: unknown }).refused).to.be.instanceOf(
        BadRequestError,
      )
    }

    const unpublished = stores(
      decide(
        upload('desktop', { minutesActive: 9, toAt: '2026-11-25T08:09:00Z' }),
        stored('desktop'),
      ),
    )
    expect(unpublished.entry.minutesActive).to.equal(9)
    expect(+unpublished.entry.toAt).to.equal(+new Date('2026-11-25T08:09:00Z'))
  }

  /** Which part of an invoice the time is billed in stays as published. */
  @test()
  aPublishedEntryKeepsItsSourceWhateverTheRetryNames() {
    const outcome = stores(
      decide(upload('mobile'), stored('desktop', { publishedAt: NOW })),
    )
    expect(outcome.entry).to.include({ source: 'desktop', keyboardKeys: 7 })
  }

  /** An upload never decides its own paid state, invoice or publication. */
  @test()
  aRetryKeepsWhatOnlyTheServerSets() {
    const existing = stored('desktop', { isPaid: true })
    const outcome = stores(
      decide(upload('desktop', { isPaid: false } as never), existing),
    )
    expect(outcome.entry).to.include({ isPaid: true, publishedAt: null })
  }

  @test()
  aNewSliceIsTheAuthorsAndUnpublished() {
    const outcome = stores(decide(upload('desktop'), undefined))
    expect(outcome.entry.id).to.equal(undefined)
    expect(outcome.entry.user).to.equal(author)
    expect(outcome.entry.project.id).to.equal('project')
    expect(outcome.entry.publishedAt ?? null).to.equal(null)
    expect(outcome.entry.note).to.equal('sent again')
  }

  /** What the project doesn't record isn't stored, whatever is sent. */
  @test()
  theProjectsSwitchesStripWhatTheyDontRecord() {
    const policy = Object.assign(project(), {
      trackScreenshots: false,
      trackProcesses: false,
      trackLocation: false,
    })
    const desktop = stores(decide(upload('desktop'), undefined, NOW, policy))
    expect(desktop.entry).to.include({
      screenshot: null,
      processes: null,
      appsStatus: 'off',
    })
    const phone = stores(decide(upload('mobile'), undefined, NOW, policy))
    expect(phone.entry.locationStatus).to.equal('off')
    expect(phone.locations).to.deep.equal([])
  }

  /** The tracker's row says what the stored Entry kept, not what was sent. */
  @test()
  theResultRowSaysWhatWasKept() {
    const fresh = stores(decide(upload('mobile'), undefined))
    expect(fresh.row).to.include({
      note: 'sent again',
      appsAccepted: true,
      locationsAccepted: true,
    })
    expect(fresh.row).to.include({
      apps: undefined,
      screenshot: undefined,
      processes: undefined,
      locations: undefined,
    })

    const removed = stores(
      decide(upload('mobile'), stored('mobile', { locationStatus: 'removed' })),
    )
    expect(removed.row.locationsAccepted).to.equal(false)

    const desktop = stores(decide(upload('desktop'), undefined))
    expect(desktop.row).to.not.have.property('locationsAccepted')
    expect(desktop.row.appsAccepted).to.equal(true)
  }
}
