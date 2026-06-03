import type { Tool } from './types.js';
import { config } from '../config/index.js';

const TIME_API_ENDPOINT = `http://localhost:${config.PORT}/api/get-time-by-region`;

interface TimeByRegionResponse {
  region: string;
  datetime: string; // ISO 8601 with offset, e.g. "2026-06-02T10:00:00+09:00"
  timezone: string; // IANA name, e.g. "Asia/Seoul"
}

// Matches the leading "YYYY-MM-DDTHH:mm:ss" of an RFC 3339 / ISO 8601 string.
// We slice these wall-clock fields directly from the string so the displayed
// local time is preserved exactly — never reinterpreted into the host timezone.
const ISO_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;

function formatDatetime(iso: string): string {
  const match = ISO_DATETIME_RE.exec(iso);
  if (!match) {
    throw new Error(`Unexpected datetime format from API: ${iso}`);
  }
  return `${match[1]} ${match[2]}`;
}

export const timeByRegionTool: Tool = {
  name: 'time_by_region',
  description:
    'Gets the current local time for a given region. The region MUST be an IANA timezone name such as "Asia/Seoul", "America/New_York", or "Europe/London". When the user names a place (e.g. "Seoul", "서울"), convert it to the matching IANA timezone before calling. Returns the region, its timezone, and the current datetime formatted as "YYYY-MM-DD HH:mm:ss".',
  parameters: {
    type: 'object',
    properties: {
      region: {
        type: 'string',
        description:
          'IANA timezone name for the region, e.g. "Asia/Seoul" for Seoul, "America/New_York" for New York.',
      },
    },
    required: ['region'],
  },
  responseGuidance:
    '시간 조회 결과를 사용자에게 전할 때는 반드시 한국어로 "현재 {지역}의 시간은 YYYY년 MM월 DD일 HH시 mm분 ss초 입니다." 형식으로 답하라. {지역}에는 사용자가 말한 표현(예: "서울", "뉴욕")을 그대로 쓰고, datetime 필드의 값을 연/월/일/시/분/초로 분해해 채워라.',
  async execute(args) {
    const { region } = args as { region: string };

    const params = new URLSearchParams({ region });
    const url = `${TIME_API_ENDPOINT}?${params}`;

    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Time API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as TimeByRegionResponse;

    return {
      region: data.region,
      datetime: formatDatetime(data.datetime),
      timezone: data.timezone,
    };
  },
};
