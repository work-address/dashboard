import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { ShareRow } from './period-bars'

type Props = {
  rows: ShareRow[]
  /** A row's value as the list shows it, such as "12h 30m". */
  formatValue: (value: number) => string
  /** The same value in full, for assistive technology. */
  describeValue: (value: number) => string
  className?: string
}

/** A share reads as whole percent; anything worked is at least one. */
const percent = (share: number) => Math.max(1, Math.round(share * 100))

/**
 * Parts of a whole, most first: a ranked list rather than a ring, so a dozen
 * rows stay readable and each carries its own figures.
 */
export const ShareList = ({
  rows,
  formatValue,
  describeValue,
  className,
}: Props) => {
  const { t } = useTranslation()

  return (
    <List className={className}>
      {rows.map((row) => (
        <Row
          key={row.key}
          aria-label={t('charts.share.row', {
            name: row.title,
            share: percent(row.share),
            time: describeValue(row.value),
          })}
        >
          <Name title={row.title}>{row.title}</Name>
          <Figures aria-hidden>
            <Share>{percent(row.share)}%</Share>
            {formatValue(row.value)}
          </Figures>
          <Track aria-hidden>
            <Fill
              style={{
                inlineSize: `${row.share * 100}%`,
                background: row.color,
              }}
            />
          </Track>
        </Row>
      ))}
    </List>
  )
}

const List = styled.ol`
  display: grid;
  gap: var(--ui-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
`

const Row = styled.li`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--ui-space-2) var(--ui-space-3);
`

const Name = styled.span`
  overflow: hidden;
  color: var(--ui-ink);
  font-size: var(--ui-small-size);
  font-weight: var(--ui-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Figures = styled.span`
  display: inline-grid;
  grid-auto-flow: column;
  gap: var(--ui-space-2);
  color: var(--ui-muted);
  font-size: var(--ui-meta-size);
  line-height: var(--ui-meta-line-height);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const Share = styled.span`
  color: var(--ui-ink);
  font-weight: var(--ui-weight-medium);
`

const Track = styled.span`
  grid-column: 1 / -1;
  display: grid;
  block-size: var(--ui-space-2);
  border-radius: var(--ui-pill-radius);
  background: var(--ui-inset);
  overflow: hidden;
`

const Fill = styled.span`
  min-inline-size: var(--ui-space-1);
  border-radius: var(--ui-pill-radius);
`
