interface TimeByRegionResponse {
  region: string;
  datetime: string;
  timezone: string;
}

const ISO_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;

function formatDatetime(iso: string): string {
  const match = ISO_DATETIME_RE.exec(iso);
  if (!match) {
    throw new Error(`Unexpected datetime format from API: ${iso}`);
  }
  return `${match[1]} ${match[2]}`;
}

export default function transform(data: unknown): unknown {
  const { region, datetime, timezone } = data as TimeByRegionResponse;
  return {
    region,
    datetime: formatDatetime(datetime),
    timezone,
  };
}
