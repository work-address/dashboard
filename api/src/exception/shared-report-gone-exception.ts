import { HttpError } from 'routing-controllers'

/**
 * A shared report whose span reaches past what a project owner's plan keeps
 * (SPEC.md, "What premium governs"). 410, not 404: the link is a real one,
 * and an upgrade brings the report back. `reason` is for the page that says so.
 */
class SharedReportGoneException extends HttpError {
  public static NAME = 'SharedReportGoneException'

  public readonly reason = 'retention'

  constructor() {
    super(410, 'This report reaches past what the plan keeps')

    Object.setPrototypeOf(this, SharedReportGoneException.prototype)
    this.name = SharedReportGoneException.NAME
  }
}

export default SharedReportGoneException
