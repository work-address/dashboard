/** Recording requests never belong in telemetry payloads or exception attachments. */
export class RecordingPrivacy {
  public static ingest(value: string | undefined): boolean {
    if (!value) return false
    try {
      return /^\/api\/agent-tracking\/events\/?$/i.test(
        new URL(value, 'http://localhost').pathname,
      )
    } catch {
      return false
    }
  }
  public static sensitive(value: string | undefined): boolean {
    if (!value) return false
    try {
      return /^\/api\/(time(?:\/|$)|statistics(?:\/|$)|agents?(?:-|\/|$)|user\/settings(?:\/|$)|report\/public(?:\/|$))/i.test(
        new URL(value, 'http://localhost').pathname,
      )
    } catch {
      return false
    }
  }
  /**
   * A request's URL as a log may hold it. A shared report's link is its only
   * secret and travels in the path, so that part is left out.
   */
  public static loggedUrl(value: string): string {
    return value.replace(
      /^((?:[a-z][a-z0-9+.-]*:\/\/[^/]*)?\/api\/report\/public\/)[^/?#]+/i,
      '$1[REDACTED]',
    )
  }
}
