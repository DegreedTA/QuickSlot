import { groupByDay, rangeLabel, summaryText } from '../lib/time';
import { CopyButton } from './CopyButton';

interface Props {
  starts: number[];
  tz: string;
  title: string;
  emptyText?: string;
}

/** Availability grouped by day (weekdays), ready to copy into an email with its time zone named. */
export function Summary({ starts, tz, title, emptyText }: Props) {
  const groups = groupByDay(starts, tz);
  return (
    <section className="summary" aria-label={title}>
      <div className="summary-head">
        <h2>{title}</h2>
        <CopyButton text={() => summaryText(starts, tz)} disabled={!groups.length} className="btn btn-sm">
          Copy
        </CopyButton>
      </div>
      {groups.length === 0 ? (
        emptyText ? <p className="muted">{emptyText}</p> : null
      ) : (
        <dl>
          {groups.map((g) => (
            <div className="row" key={g.key}>
              <dt>{g.label}</dt>
              <dd>
                {g.ranges.map((r) => (
                  <span key={r.start}>{rangeLabel(r.start, r.end, tz)}</span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
