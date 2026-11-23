import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import styled from 'styled-components'

import { RouteSkeleton } from '@/shared'

/**
 * A page with no app around it: no sidebar and no session. A shared report
 * opens here, for a reader who may never have an account.
 */
export const BareLayout = () => (
  <Root>
    <Suspense fallback={<RouteSkeleton variant="document" />}>
      <Outlet />
    </Suspense>
  </Root>
)

const Root = styled.main`
  min-height: 100dvh;
  background: var(--page-canvas);

  @media print {
    min-height: 0;
    background: none;
  }
`
