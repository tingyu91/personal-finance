import { href } from '../router';
import { Empty, Page } from './Page';

export function Overview() {
  return (
    <Page title="Overview">
      <Empty heading="No statements yet">
        <p>Import your bank and card PDFs to see where the money went each month.</p>
        <p>
          <a className="ty-link" href={href('statements')}>
            Go to Statements
          </a>
        </p>
      </Empty>
    </Page>
  );
}
