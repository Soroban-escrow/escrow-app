'use client';
import { useEffect, useState } from 'react';

/** Renders an ISO deadline in the viewer's own time zone, with the UTC value in a tooltip. */
export function Deadline({ iso }: { iso: string }) {
  const date = new Date(iso);
  const utc = date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  // Start with a deterministic UTC value so server and client markup match, then
  // switch to the browser's local time zone once mounted.
  const [label, setLabel] = useState(() => format(date, 'UTC'));
  useEffect(() => setLabel(format(date)), [date]);

  return <time dateTime={iso} title={`UTC: ${utc}`}>{label}</time>;
}

function format(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}
