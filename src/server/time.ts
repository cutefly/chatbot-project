export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format();
    return true;
  } catch {
    return false;
  }
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find(p => p.type === type)?.value ?? '';
}

// Intl emits "GMT+09:00", "GMT-04:00", or "GMT" (UTC). Normalize to "+09:00" / "+00:00".
function normalizeOffset(longOffset: string): string {
  const match = /GMT(?<sign>[+-])(?<hours>\d{1,2}):?(?<minutes>\d{2})?/.exec(longOffset);
  if (!match?.groups) return '+00:00';
  const sign = match.groups.sign;
  const hours = match.groups.hours.padStart(2, '0');
  const minutes = (match.groups.minutes ?? '00').padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

export function buildZonedIso(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(instant);

  const year = partValue(parts, 'year');
  const month = partValue(parts, 'month');
  const day = partValue(parts, 'day');
  const hour = partValue(parts, 'hour');
  const minute = partValue(parts, 'minute');
  const second = partValue(parts, 'second');
  const offset = normalizeOffset(partValue(parts, 'timeZoneName'));

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}
