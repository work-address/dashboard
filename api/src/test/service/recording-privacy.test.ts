import { expect } from 'chai'
import { RecordingPrivacy } from '@/service/recording-privacy'

describe('RecordingPrivacy', () => {
  it('excludes recording payloads, settings and credentials from error telemetry', () => {
    for (const path of [
      '/api/time',
      '/api/time/id',
      '/api/statistics/apps/titles',
      '/api/agents',
      '/api/agent-tracking/events',
      '/api/agent-tracking/credentials',
      '/api/user/settings',
      '/api/report/public/a-links-secret',
    ]) {
      for (const spelling of [
        path,
        path.toUpperCase(),
        `${path.toUpperCase()}/`,
      ]) {
        expect(RecordingPrivacy.sensitive(spelling), spelling).to.equal(true)
        expect(
          RecordingPrivacy.sensitive(
            `https://example.test${spelling}?ignored=1`,
          ),
          spelling,
        ).to.equal(true)
      }
    }
    expect(RecordingPrivacy.sensitive('/api/project')).to.equal(false)
    expect(RecordingPrivacy.sensitive(undefined)).to.equal(false)
    expect(
      RecordingPrivacy.ingest(
        'https://example.test/API/AGENT-TRACKING/EVENTS/?ignored=1',
      ),
    ).to.equal(true)
    expect(RecordingPrivacy.ingest('/api/agent-tracking/credentials')).to.equal(
      false,
    )
  })

  it('keeps the secret of a shared report link out of a logged URL', () => {
    const secret = 'Zm9vYmFyLWZvb2Jhci1mb29iYXItZm9vYmFyLWZvb2Jhcg'

    expect(RecordingPrivacy.loggedUrl(`/api/report/public/${secret}`)).to.equal(
      '/api/report/public/[REDACTED]',
    )
    expect(
      RecordingPrivacy.loggedUrl(`/API/Report/Public/${secret}?utm=mail#top`),
    ).to.equal('/API/Report/Public/[REDACTED]?utm=mail#top')
    expect(
      RecordingPrivacy.loggedUrl(
        `https://example.test/api/report/public/${secret}/`,
      ),
    ).to.equal('https://example.test/api/report/public/[REDACTED]/')
    // Nothing else is a secret: the sharer's own routes name ids, not links.
    for (const url of [
      '/api/report',
      '/api/report/public',
      '/api/report/4d7e6b0e-6a59-4c50-9a7c-3a3f0a6f6f10/invoice',
      '/api/project/search?public=1',
    ])
      expect(RecordingPrivacy.loggedUrl(url)).to.equal(url)
    // The sharer's routes carry no secret in their URL and stay in telemetry.
    expect(RecordingPrivacy.sensitive('/api/report')).to.equal(false)
    expect(
      RecordingPrivacy.sensitive(
        '/api/report/4d7e6b0e-6a59-4c50-9a7c-3a3f0a6f6f10/invoice',
      ),
    ).to.equal(false)
  })
})
