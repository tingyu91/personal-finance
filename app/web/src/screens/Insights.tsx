import { Empty, Page } from './Page';

export function Insights() {
  return (
    <Page title="Insights">
      <Empty heading="No insights yet">
        <p>Findings about fees, bank conditions and unseen spending appear once statements are imported.</p>
      </Empty>
    </Page>
  );
}
