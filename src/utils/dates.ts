/**
 * Date helpers that respect the user's local timezone.
 *
 * `new Date('2026-03-04')` parses as UTC midnight, which is the previous day in
 * the Americas. These helpers treat date-only strings as local dates instead.
 *
 * @module utils/dates
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a Date, timestamp or string. Date-only strings are parsed as local midnight. */
export function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(value);
  const m = DATE_ONLY.exec(str);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

const pad = (n: number, len = 2): string => String(n).padStart(len, '0');

/** `YYYY-MM-DD` in local time (for `<input type="date">`). */
export function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DDTHH:mm` in local time (for `<input type="datetime-local">`). */
export function toDateTimeInputValue(date: Date): string {
  return `${toDateInputValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Start of the local day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const TOKEN_RE = /YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|ss|A/g;

/**
 * Format a date with a pattern. Tokens: `YYYY YY MM M DD D HH H hh h mm ss A`.
 * Every occurrence of a token is replaced. Text in `[brackets]` is kept as-is.
 */
export function formatDatePattern(date: Date, pattern: string): string {
  const hours12 = date.getHours() % 12 || 12;
  const values: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    HH: pad(date.getHours()),
    H: String(date.getHours()),
    hh: pad(hours12),
    h: String(hours12),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    A: date.getHours() < 12 ? 'AM' : 'PM',
  };
  return pattern
    .split(/(\[[^\]]*\])/)
    .map(part => (part.startsWith('[') && part.endsWith(']')
      ? part.slice(1, -1)
      : part.replace(TOKEN_RE, t => values[t])))
    .join('');
}
