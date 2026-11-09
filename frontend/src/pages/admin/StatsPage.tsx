import { useState } from 'react';
import { ShareList } from '../../components/Charts';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState, ErrorState, Skeleton } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { StatCard } from '../../components/StatCard';
import { formatNumber, formatPercent, formatUsd } from '../../lib/format';
import { useAdminSession } from '../../lib/sessions';
import type { StatRow } from '../../lib/types';
import { useResource } from '../../lib/useResource';
import styles from './StatsPage.module.css';

const RANGES = [
  { value: 1, label: 'یک ساعت' },
  { value: 24, label: '24 ساعت' },
  { value: 168, label: '7 روز' },
  { value: 720, label: '30 روز' },
];

const RANGE_TEXT: Record<number, string> = { 1: 'یک ساعت اخیر', 24: '24 ساعت اخیر', 168: 'هفت روز اخیر', 720: 'سی روز اخیر' };

const sumOf = (rows: StatRow[], pick: (row: StatRow) => number): number => rows.reduce((total, row) => total + pick(row), 0);

export const StatsPage = () => {
  const { api } = useAdminSession();
  const [hours, setHours] = useState(24);
  const { data, error, refreshing, reload } = useResource((signal) => api<StatRow[]>(`/admin/stats?hours=${hours}`, { signal }), [api, hours], { interval: 60_000 });

  const range = <Segmented label="بازه‌ی زمانی" options={RANGES} value={hours} onChange={setHours} />;

  if (error && !data) return (<><PageHeader title="آمار و درآمد" actions={range} /><ErrorState message={error} onRetry={reload} /></>);
  if (!data) {
    return (
      <>
        <PageHeader title="آمار و درآمد" actions={range} />
        <div className={styles.stats}>{[0, 1, 2, 3].map((index) => <Skeleton key={index} height={108} radius={16} />)}</div>
        <Skeleton height={280} radius={16} />
      </>
    );
  }

  const rows = [...data].sort((a, b) => b.requests - a.requests);
  const requests = sumOf(rows, (row) => row.requests);
  const errors = sumOf(rows, (row) => row.errors);
  const revenue = sumOf(rows, (row) => row.revenue);
  const promptTokens = sumOf(rows, (row) => row.prompt_tokens);
  const completionTokens = sumOf(rows, (row) => row.completion_tokens);
  const cacheHits = sumOf(rows, (row) => row.cache_hits);
  const errorRate = requests ? errors / requests : 0;

  const columns: Column<StatRow>[] = [
    { id: 'model', header: 'مدل', cell: (row) => <span className="ltr">{row.model}</span>, footer: 'جمع' },
    { id: 'requests', header: 'درخواست', align: 'end', cell: (row) => formatNumber(row.requests), footer: formatNumber(requests) },
    { id: 'in', header: 'توکن ورودی', align: 'end', cell: (row) => formatNumber(row.prompt_tokens), footer: formatNumber(promptTokens) },
    { id: 'out', header: 'توکن خروجی', align: 'end', cell: (row) => formatNumber(row.completion_tokens), footer: formatNumber(completionTokens) },
    { id: 'latency', header: 'میانگین تأخیر', align: 'end', cell: (row) => <span className="num">{formatNumber(row.avg_latency_ms)} ms</span>, footer: '' },
    {
      id: 'errors',
      header: 'خطا',
      align: 'end',
      cell: (row) => <span className={row.errors > 0 ? styles.bad : undefined}>{formatNumber(row.errors)}</span>,
      footer: formatNumber(errors),
    },
    { id: 'cache', header: 'از کش', align: 'end', cell: (row) => formatNumber(row.cache_hits), footer: formatNumber(cacheHits) },
    { id: 'revenue', header: 'درآمد', align: 'end', cell: (row) => <span className="num">{formatUsd(row.revenue, 4)}</span>, footer: <span className="num">{formatUsd(revenue, 4)}</span> },
  ];

  return (
    <>
      <PageHeader title="آمار و درآمد" description={`عملکرد مدل‌ها در ${RANGE_TEXT[hours] ?? ''}`} actions={range} />

      <div className={`${styles.stats} ${refreshing ? styles.dim : ''}`}>
        <StatCard label="درخواست" icon="activity" value={formatNumber(requests)} hint={`${formatNumber(cacheHits)} مورد از کش پاسخ داده شد`} />
        <StatCard label="درآمد" icon="coins" tone="success" value={<span className="num">{formatUsd(revenue, 4)}</span>} hint="مجموع هزینه‌ی کسرشده از کاربران" />
        <StatCard label="توکن" icon="layers" tone="neutral" value={formatNumber(promptTokens + completionTokens)} hint={`${formatNumber(promptTokens)} ورودی · ${formatNumber(completionTokens)} خروجی`} />
        <StatCard
          label="نرخ خطا"
          icon="alert"
          tone={errorRate > 0.1 ? 'danger' : errorRate > 0.02 ? 'warning' : 'success'}
          value={requests ? formatPercent(errorRate) : '—'}
          hint={`${formatNumber(errors)} درخواست ناموفق`}
        />
      </div>

      {rows.length === 0 ? (
        <Card><EmptyState icon="chart" title="در این بازه درخواستی ثبت نشده" description="بازه‌ی بزرگ‌تری را انتخاب کن." /></Card>
      ) : (
        <>
          <div className={styles.split}>
            <Card title="درخواست‌ها به تفکیک مدل" description="سهم هر مدل از ترافیک">
              <ShareList items={rows.map((row) => ({ key: row.model, label: row.model, value: row.requests, display: formatNumber(row.requests) }))} />
            </Card>
            <Card title="درآمد به تفکیک مدل" description="دلار">
              <ShareList
                items={[...rows].sort((a, b) => b.revenue - a.revenue).map((row) => ({ key: row.model, label: row.model, value: row.revenue, display: formatUsd(row.revenue, 4) }))}
              />
            </Card>
          </div>
          <Card flush title="جزئیات مدل‌ها" className={styles.table}>
            <DataTable caption="آمار مدل‌ها" columns={columns} rows={rows} rowKey={(row) => row.model} footerRow />
          </Card>
        </>
      )}
    </>
  );
};
