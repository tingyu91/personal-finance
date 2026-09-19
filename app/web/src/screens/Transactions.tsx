import { Empty, Page } from './Page';

export function Transactions() {
  return (
    <Page title="Transactions">
      <Empty heading="No transactions yet">
        <p>Every row from your statements appears here once they are imported.</p>
      </Empty>
    </Page>
  );
}
