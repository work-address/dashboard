import moment from 'moment'
import { BadRequestError } from 'routing-controllers'

import { Project } from '@/entity/project'
import { Time } from '@/entity/time'
import { User } from '@/entity/user'
import { TimeCreateDto } from '@/model/dto/time'
import { ITimeInsertionResult } from '@/model/time'
import {
  AppUsagePolicy,
  UsageResult,
  UsageRow,
} from '@/service/app-usage-policy'
import {
  LocationPolicy,
  LocationResult,
  LocationRow,
  NO_LOCATION,
} from '@/service/location-policy'
import { ProjectAccess } from '@/service/project-access'

/**
 * What one upload asks to store for its slice, once the project's switches
 * and the phone's lack of input, screenshots and apps have been applied. The
 * screenshot is as sent: the caller resizes it before `decide`.
 */
export interface EntrySlice {
  item: TimeCreateDto
  source: 'desktop' | 'mobile'
  fromAt: Date
  toAt: Date
  note: string | null
  minutesActive: number
  keyboardKeys: number
  mouseKeys: number
  mouseDistance: number
  screenshot: string | null
  processes: Time['processes']
  usage: UsageResult
  location: LocationResult
}

/** The tracker's result row for the slice, before the stored Entry has an id. */
export type EntryUploadRow = Omit<ITimeInsertionResult, 'id' | 'error'>

/**
 * Either the Entry to store, or why the upload is refused. `usage` and
 * `locations` are the rows to put in place of the Entry's own, or null to
 * leave its stored rows as they are.
 */
export type EntryUploadOutcome =
  | { refused: Error }
  | {
      entry: Time
      usage: UsageRow[] | null
      locations: LocationRow[] | null
      row: EntryUploadRow
    }

export interface EntryUploadContext {
  project: Project
  author: User
  now: Date
}

/**
 * What an upload of one slice may change on its Entry (SPEC: "A re-upload
 * never changes published detail"), decided in one place and without a
 * database. The repository only locks the slice, loads what is stored for it
 * and saves what this returns.
 *
 * The rule used to be "copy everything, then copy some of it back": the
 * manager wrote every field and the repository restored the frozen ones under
 * its lock, so each new piece of detail (the note, the source, location) had
 * to be remembered in two modules, and several times was not.
 */
export class EntryUpload {
  /** Reads an upload as its project records it. */
  public static read(item: TimeCreateDto, project: Project): EntrySlice {
    const phone = item.source === 'mobile'

    return {
      item,
      source: phone ? 'mobile' : 'desktop',
      fromAt: moment(item.fromAt).toDate(),
      toAt: moment(item.toAt).toDate(),
      note: item.note,
      minutesActive: item.minutesActive,
      // A phone captures no input, screenshots or apps.
      keyboardKeys: phone ? 0 : item.keyboardKeys,
      mouseKeys: phone ? 0 : item.mouseKeys,
      mouseDistance: phone ? 0 : item.mouseDistance,
      screenshot:
        project.trackScreenshots && !phone ? (item.screenshot ?? null) : null,
      processes: project.trackProcesses && !phone ? item.processes : null,
      usage: phone
        ? AppUsagePolicy.fromPhone(project)
        : AppUsagePolicy.normalize(item, project),
      // Only a phone records location, and only where the owner asks.
      location: phone ? LocationPolicy.normalize(item, project) : NO_LOCATION,
    }
  }

  /**
   * The Entry to store for `slice`, given what is stored for it already.
   * `existing` must be the author's own Entry for the slice, read under the
   * slice's lock, with its project.
   */
  public static decide(
    slice: EntrySlice,
    existing: Time | undefined,
    { project, author, now }: EntryUploadContext,
  ): EntryUploadOutcome {
    const published = Boolean(
      existing && ProjectAccess.published(existing, now.getTime()),
    )

    if (
      existing &&
      published &&
      (+slice.toAt !== +existing.toAt ||
        slice.minutesActive !== existing.minutesActive)
    ) {
      return {
        refused: new BadRequestError(
          'Published time accounting cannot be changed by an upload',
        ),
      }
    }

    // What only the server sets - id, invoice, publication, paid state - comes
    // from the stored Entry and never from the upload.
    const entry = Object.assign(new Time(), existing ?? {}, {
      project,
      user: author,
      fromAt: slice.fromAt,
      toAt: slice.toAt,
      minutesActive: slice.minutesActive,
    })

    // Detail never changes once the owner can see it: a desktop retry must not
    // restore a removed screenshot, rewrite input counts, put back a note its
    // author has since corrected, or move the time between invoice parts.
    if (!published) {
      Object.assign(entry, {
        source: slice.source,
        note: slice.note,
        keyboardKeys: slice.keyboardKeys,
        mouseKeys: slice.mouseKeys,
        mouseDistance: slice.mouseDistance,
        screenshot: slice.screenshot,
        processes: slice.processes,
        appsStatus: slice.usage.status,
        appsReason: slice.usage.reason,
        appsTruncated: slice.usage.truncated,
      })
    }

    // Location its author removed stays removed, published or not: the phone
    // may send the same slice again until it hears back.
    const keepLocation = published || existing?.locationStatus === 'removed'

    if (!keepLocation) entry.locationStatus = slice.location.status

    return {
      entry,
      usage: published ? null : slice.usage.rows,
      locations: keepLocation ? null : slice.location.rows,
      row: {
        ...slice.item,
        appsAccepted:
          entry.appsStatus !== null && entry.appsStatus !== undefined,
        ...(slice.source === 'mobile' && {
          locationsAccepted: entry.locationStatus === 'ok',
        }),
        apps: undefined,
        screenshot: undefined,
        processes: undefined,
        locations: undefined,
      },
    }
  }
}
