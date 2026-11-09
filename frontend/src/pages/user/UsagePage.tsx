import { useState } from 'react';
import { BarChart, ShareList } from '../../components/Charts';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState, ErrorState, Skeleton } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { StatCard } from '../../components/StatCard';
import { dayLongLabel, formatNumber, formatUsd } from '../../lib/format';
import { useUserSession } from '../../lib/sessions';
import type { Usage, UsageRow } from '../../lib/types';
import { useResource } from '../../lib/useResource';
import { buildDailyChart, formatTokens, tokenSeries, totals } from './usageChart';
import styles from './UsagePage.module.css';

const RANGES = [
  { value: 7, label: '7 روز' },
  { value: 30, label: '30 روز' },
  { value: 90, label: '90 روز' },
];

export const UsagePage = () => {
  const { api, info: me } = useUserSession();
  const [days, setDays] = useState(7);
  const { data, error, refreshing, reload } = useResource(
    (signal) => api<Usage>(`/account/usage?days=${days}`, { signal }),
    [api, days],
  );

  const range = <Segmented label="بازه‌ی زمانی" options={RANGES} value={days} onChange={setDays} />;

  if (error && !data) return (<><PageHeader title="مصرف" actions={range} /><ErrorState message={error} onRetry={reload} /></>);
  if (!data) return (
    <>
      <PageHeader title="مصرف" actions={range} />
      <div className={styles.stats}>{[0, 1, 2, 3].map((index) => <Skeleton key={index} height={104} radius={16} />)}</div>
      <Skeleton height={340} radius={16} />
    </>
  );

  const sum = totals(data.daily);
  const modelRows = [...data.models].sort((a, b) => b.prompt_tokens + b.completion_tokens - (a.prompt_tokens + a.completion_tokens));
  const dayRows = [...data.daily].reverse();

  const modelColumns: Column<UsageRow>[] = [
    { id: 'model', header: 'مدل', cell: (row) => <span className="ltr">{row.key}</span> },
    { id: 'requests', header: 'درخواست', align: 'end', cell: (row) => formatNumber(row.requests) },
    { id: 'in', header: 'توکن ورودی', align: 'end', cell: (row) => formatNumber(row.prompt_tokens) },
    { id: 'out', header: 'توکن خروجی', align: 'end', cell: (row) => formatNumber(row.completion_tokens) },
    ...(me.billing ? [{ id: 'cost', header: 'هزینه', align: 'end' as const, cell: (row: UsageRow) => formatUsd(row.cost, 4) }] : []),
  ];

  const dayColumns: Column<UsageRow>[] = [
    { id: 'day', header: 'روز', cell: (row) => dayLongLabel(row.key) },
    { id: 'requests', header: 'درخواست', align: 'end', cell: (row) => formatNumber(row.requests) },
    { id: 'tokens', header: 'کل توکن', align: 'end', cell: (row) => formatNumber(row.prompt_tokens + row.completion_tokens) },
    ...(me.billing ? [{ id: 'cost', header: 'هزینه', align: 'end' as const, cell: (row: UsageRow) => formatUsd(row.cost, 4) }] : []),
  ];

  return (
    <>
      <PageHeader title="مصرف" description="فقط درخواست‌های موفق شمرده می‌شوند. روزها به وقت UTC هستند." actions={range} />

      <div className={`${styles.stats} ${refreshing ? styles.dim : ''}`}>
        <StatCard label="درخواست" icon="activity" value={formatNumber(sum.requests)} hint={`در ${days} روز اخیر`} />
        <StatCard label="توکن ورودی" icon="layers" tone="neutral" value={formatNumber(sum.promptTokens)} hint="پرامپت‌های ارسالی" />
        <StatCard label="توکن خروجی" icon="layers" tone="neutral" value={formatNumber(sum.completionTokens)} hint="پاسخ‌های دریافتی" />
        {me.billing ? (
          <StatCard label="هزینه" icon="coins" tone="warning" value={<span className="num">{formatUsd(sum.cost, 4)}</span>} hint="کسرشده از اعتبار" />
        ) : (
          <StatCard label="میانگین روزانه" icon="chart" tone="success" value={formatNumber(Math.round((sum.promptTokens + sum.completionTokens) / days))} hint="توکن در روز" />
        )}
      </div>

      <Card title="روند مصرف توکن" description="ورودی و خروجی به تفکیک روز" className={refreshing ? styles.dim : undefined}>
        {sum.requests === 0 ? (
          <EmptyState icon="chart" title="در این بازه مصرفی ثبت نشده" description="بازه‌ی بزرگ‌تری را انتخاب کن یا اولین درخواستت را بفرست." />
        ) : (
          <BarChart
            data={buildDailyChart(data.daily, days)}
            series={tokenSeries}
            height={260}
            formatValue={formatTokens}
            formatAxis={(value) => formatNumber(value)}
            summary={`نمودار مصرف توکن در ${days} روز اخیر؛ مجموع ${formatNumber(sum.promptTokens + sum.completionTokens)} توکن`}
          />
        )}
      </Card>

      {sum.requests > 0 && (
        <div className={styles.split}>
          <Card title="سهم مدل‌ها" description="بر اساس مجموع توکن">
            <ShareList
              items={modelRows.map((row) => ({
                key: row.key,
                label: row.key,
                value: row.prompt_tokens + row.completion_tokens,
                display: formatNumber(row.prompt_tokens + row.completion_tokens),
              }))}
            />
          </Card>
          <Card flush title="جزئیات به تفکیک مدل">
            <DataTable caption="مصرف به تفکیک مدل" columns={modelColumns} rows={modelRows} rowKey={(row) => row.key} />
          </Card>
        </div>
      )}

      {sum.requests > 0 && (
        <Card flush title="جزئیات روزانه" className={styles.daily}>
          <DataTable caption="مصرف روزانه" columns={dayColumns} rows={dayRows} rowKey={(row) => row.key} />
        </Card>
      )}
    </>
  );
};
