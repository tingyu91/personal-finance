import type { ReactNode } from 'react';

/** One page title per screen, with optional actions on the right. */
export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <h1 className="title">{title}</h1>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

/** An empty state says what to do next. */
export function Empty({ heading, children }: { heading: string; children?: ReactNode }) {
  return (
    <section className="ty-card empty">
      <h2 className="heading">{heading}</h2>
      {children}
    </section>
  );
}
