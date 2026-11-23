import { injectable } from 'inversify'
import { HttpError } from 'routing-controllers'

import { ClientIp } from '@/service/auth/client-ip'

/** How many links one address may open at once, and how fast that comes back. */
const BURST = 60
const REFILL_MS = 1000
/** Addresses remembered before the idle ones are let go. */
const MAX_ADDRESSES = 10000

/**
 * How often one address may open shared report links. The route answers
 * anyone, signed in or not, and each opening reads the figures again, so it is
 * the one route that limits its callers. Kept in this process: the limit is a
 * brake on one address, not a count that has to agree between instances.
 */
@injectable()
export class SharedReportLimit {
  private readonly buckets = new Map<string, { tokens: number; at: number }>()

  /** Takes one opening from the address's allowance, or refuses with 429. */
  public take(ip: string | undefined, now = Date.now()): void {
    const address = ClientIp.normalize(ip ?? '')
    const bucket = this.buckets.get(address)
    const tokens = bucket
      ? Math.min(BURST, bucket.tokens + (now - bucket.at) / REFILL_MS)
      : BURST

    if (tokens < 1) {
      this.buckets.set(address, { tokens, at: now })
      throw new HttpError(429, 'RATE_LIMITED')
    }

    this.buckets.set(address, { tokens: tokens - 1, at: now })
    if (this.buckets.size > MAX_ADDRESSES) this.forgetIdle(now)
  }

  /** Seconds until an address that was refused may open a link again. */
  public retryAfterSeconds(): number {
    return Math.ceil(REFILL_MS / 1000)
  }

  /** Drops the addresses whose allowance is whole again; all of them in a flood. */
  private forgetIdle(now: number): void {
    for (const [address, bucket] of this.buckets)
      if (bucket.tokens + (now - bucket.at) / REFILL_MS >= BURST)
        this.buckets.delete(address)
    if (this.buckets.size > MAX_ADDRESSES) this.buckets.clear()
  }
}
