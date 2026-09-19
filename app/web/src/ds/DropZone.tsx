import { useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';

/**
 * Ported from design-system/components (DropZone). Tally adds three receipt statuses to the
 * system's four: locked (needs its password), conflict (a different statement for that account
 * and month is already here) and error (nothing was stored). Each keeps its own word.
 */
export type ReceiptStatus = 'imported' | 'duplicate' | 'unrecognised' | 'failed' | 'locked' | 'conflict' | 'error';

export interface ReceiptItem {
  name: string;
  status: ReceiptStatus;
  detail?: string;
}

export const RECEIPT: Record<ReceiptStatus, [string, string]> = {
  imported: ['ty-pill-info', 'Imported'],
  duplicate: ['ty-pill-muted', 'Already here'],
  unrecognised: ['ty-pill-watch', 'Not recognised'],
  failed: ['ty-pill-critical', 'Totals don’t match'],
  locked: ['ty-pill-watch', 'Needs password'],
  conflict: ['ty-pill-watch', 'Clashes'],
  error: ['ty-pill-critical', 'Not imported'],
};

export interface DropZoneProps {
  state?: 'idle' | 'over' | 'done';
  onFiles?: (files: File[]) => void;
  hint?: string;
  summary?: string;
  items?: ReceiptItem[];
  /** Extra content under a receipt item (e.g. a password field for a locked file). */
  renderItemExtra?: (item: ReceiptItem, index: number) => ReactNode;
  busy?: boolean;
  className?: string;
}

export function DropZone({ state, onFiles, hint, summary, items, renderItemExtra, busy, className }: DropZoneProps) {
  const [hover, setHover] = useState(false);
  const over = state ? state === 'over' : hover;
  const input = useRef<HTMLInputElement>(null);
  const pick = () => input.current?.click();
  const take = (list: FileList | null | undefined) => {
    if (onFiles && list && list.length) onFiles(Array.from(list));
  };
  const done = state === 'done' && items;
  return (
    <div
      className={cx('ty-drop', over && 'ty-drop-over', className)}
      role="region"
      aria-label="Import statements"
      aria-busy={busy || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        take(e.dataTransfer?.files);
      }}
    >
      <h3 aria-live="polite">{busy ? 'Reading your statements…' : over ? 'Release to import' : done ? summary || 'Import finished' : 'Drop statements here'}</h3>
      <p>
        {over
          ? 'Tally reads each PDF, works out the bank, account and month, and skips anything it already has.'
          : done
            ? 'Anything not recognised stays in the list until you choose what it is.'
            : hint || 'PDF e-statements from DBS, POSB and UOB, as many as you like at once. Nothing leaves this computer.'}
      </p>
      {done ? (
        <ul className="ty-receipt">
          {items.map((it, i) => {
            const [cls, word] = RECEIPT[it.status] ?? RECEIPT.imported;
            return (
              <li key={`${it.name}-${i}`}>
                <span className={cx('ty-pill', cls)}>{word}</span>
                <span className="ty-raw" title={it.name}>
                  {it.name}
                </span>
                <span className="ty-note">{it.detail ?? ''}</span>
                {renderItemExtra ? <div className="ty-receipt-extra">{renderItemExtra(it, i)}</div> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <Button
        onClick={(e) => {
          e.stopPropagation();
          pick();
        }}
        disabled={busy}
      >
        {done ? 'Choose more files' : 'Choose files'}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
