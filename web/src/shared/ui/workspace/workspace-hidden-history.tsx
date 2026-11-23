import { StarFilledIcon } from '@radix-ui/react-icons'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { billingUrl } from '../../constants/billing'
import { FREE_RETENTION_DAYS } from '../../constants/retention'
import { Button } from '../button'

const ICON_SIZE = 14

type Props = {
  /** The instant before which the plan hides history. */
  before: string
  /** Whether the reader owns a project that hides it, and so can lift it. */
  canUpgrade: boolean
  className?: string
}

/**
 * Says that part of a period is missing because of the free plan, so a chart
 * that starts later than its period is not read as days with no work. Only
 * the owner is offered the upgrade: nobody else can buy it for the project.
 */
export const WorkspaceHiddenHistory = ({
  before,
  canUpgrade,
  className,
}: Props) => {
  const { t, i18n } = useTranslation()
  const date = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(before))

  return (
    <Root role="note" className={className}>
      <Mark aria-hidden>
        <StarFilledIcon width={ICON_SIZE} height={ICON_SIZE} />
      </Mark>
      <Copy>
        <Title>{t('charts.hidden.title', { date })}</Title>
        <Description>
          {t(canUpgrade ? 'charts.hidden.owner' : 'charts.hidden.contributor', {
            days: FREE_RETENTION_DAYS,
          })}
        </Description>
      </Copy>
      {canUpgrade ? (
        /* Billing lives on the marketing site, so this leaves the app. */
        <Upgrade
          href={billingUrl(i18n.language)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button size="s">{t('dashboard.premiumBanner.cta')}</Button>
        </Upgrade>
      ) : null}
    </Root>
  )
}

const Root = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--ui-space-3);
  padding: var(--ui-space-3) var(--ui-space-4);
  border: var(--ui-border-width) solid var(--ui-line);
  border-radius: var(--ui-control-radius);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow);

  ${(p) => p.theme.breakpoints.down('md')} {
    grid-template-columns: auto minmax(0, 1fr);
  }
`

const Mark = styled.span`
  display: grid;
  color: var(--ui-blue);
`

const Copy = styled.div`
  display: grid;
  gap: var(--ui-space-1);
  min-width: 0;
`

const Title = styled.p`
  margin: 0;
  color: var(--ui-ink);
  font-size: var(--ui-small-size);
  font-weight: var(--ui-weight-medium);
`

const Description = styled.p`
  margin: 0;
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
`

const Upgrade = styled.a`
  text-decoration: none;

  ${(p) => p.theme.breakpoints.down('md')} {
    grid-column: 2;
    justify-self: start;
  }
`
