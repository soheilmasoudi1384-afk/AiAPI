import { dayLabel, dayLongLabel, formatNumber, lastDayKeys } from '../../lib/format';
import type { ChartDatum } from '../../components/Charts';
import type { UsageRow } from '../../lib/types';

/** روزهای بدون مصرف هم در نمودار می‌آیند تا محور زمان پیوسته بماند. */
export const buildDailyChart = (daily: UsageRow[], days: number): ChartDatum[] => {
  const byDay = new Map(daily.map((row) => [row.key, row]));
  return lastDayKeys(days).map((key) => {
    const row = byDay.get(key);
    return {
      key,
      label: dayLabel(key),
      title: dayLongLabel(key),
      values: [row?.prompt_tokens ?? 0, row?.completion_tokens ?? 0],
    };
  });
};

export const totals = (rows: UsageRow[]) =>
  rows.reduce(
    (sum, row) => ({
      requests: sum.requests + row.requests,
      promptTokens: sum.promptTokens + row.prompt_tokens,
      completionTokens: sum.completionTokens + row.completion_tokens,
      cost: sum.cost + row.cost,
    }),
    { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 },
  );

export const tokenSeries = [
  { name: 'توکن ورودی', tone: 'primary' as const },
  { name: 'توکن خروجی', tone: 'secondary' as const },
];

export const formatTokens = (value: number): string => `${formatNumber(value)} توکن`;
