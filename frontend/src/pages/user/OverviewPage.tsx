import { Link } from 'react-router-dom';
import { Alert, EmptyState, ErrorState, Skeleton } from '../../components/Feedback';
import { BarChart, Ring, ShareList } from '../../components/Charts';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CodeBlock } from '../../components/CodeBlock';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { formatNumber, formatPercent, formatUsd, safeRatio } from '../../lib/format';
import { useUserSession } from '../../lib/sessions';
import type { Me, Usage } from '../../lib/types';
import { useResource } from '../../lib/useResource';
import { buildDailyChart, formatTokens, tokenSeries, totals } from './usageChart';
import styles from './OverviewPage.module.css';

const quotaTone = (ratio: number) => (ratio >= 1 ? 'full' : ratio >= 0.8 ? 'warn' : 'ok');

const nextQuotaReset = (): string => {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return new Intl.DateTimeFormat('fa-IR-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false }).format(next);
};

export const OverviewPage = () => {
  const { api } = useUserSession();
  const { data, error, reload } = useResource(
    async (signal) => {
      const [me, usage] = await Promise.all([
        api<Me>('/account/me', { signal }),
        api<Usage>('/account/usage?days=7', { signal }),
      ]);
      return { me, usage };
    },
    [api],
    { interval: 30_000 },
  );

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <OverviewSkeleton />;

  const { me, usage } = data;
  const week = totals(usage.daily);
  const ratio = safeRatio(me.tokens_today, me.limits.daily_tokens);
  const tone = quotaTone(ratio);
  const noBalance = me.billing && me.balance <= 0;
  const topModels = [...usage.models].sort((a, b) => b.prompt_tokens + b.completion_tokens - (a.prompt_tokens + a.completion_tokens)).slice(0, 5);
  const model = me.models[0]?.id ?? 'my-ai';
  const curl = `curl ${location.origin}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${model}", "messages": [{"role": "user", "content": "سلام!"}]}'`;

  return (
    <>
      <PageHeader title={`سلام، ${me.name}`} description={`پلن ${me.plan} · وضعیت حساب و مصرف 7 روز اخیر`} />

      <div className={styles.alerts}>
        {noBalance && (
          <Alert tone="danger" title="اعتبارت تمام شده است">
            تا شارژ نشود درخواست‌ها رد می‌شوند. برای شارژ با مدیر سرویس تماس بگیر.
          </Alert>
        )}
        {ratio >= 1 ? (
          <Alert tone="danger" title="سهمیه‌ی امروزت تمام شد">
            درخواست‌های بیشتر تا بازنشانی سهمیه (ساعت {nextQuotaReset()}) رد می‌شوند.
          </Alert>
        ) : ratio >= 0.8 ? (
          <Alert tone="warning" title={`${formatPercent(ratio)} از سهمیه‌ی امروز مصرف شده است`}>
            سهمیه ساعت {nextQuotaReset()} بازنشانی می‌شود.
          </Alert>
        ) : null}
      </div>

      <div className={styles.stats}>
        {me.billing ? (
          <StatCard
            label="اعتبار باقی‌مانده"
            icon="wallet"
            tone={noBalance ? 'danger' : 'success'}
            value={<span className="num">{formatUsd(me.balance)}</span>}
            hint="پیش‌پرداخت، کم‌شونده با هر درخواست"
          />
        ) : (
          <StatCard label="نوع پلن" icon="wallet" tone="success" value="رایگان" hint="بدون هزینه، با سهمیه‌ی روزانه" />
        )}
        <StatCard label="درخواست موفق (7 روز)" icon="activity" value={formatNumber(week.requests)} hint="درخواست‌های با پاسخ موفق" />
        <StatCard
          label="توکن مصرفی (7 روز)"
          icon="layers"
          tone="neutral"
          value={formatNumber(week.promptTokens + week.completionTokens)}
          hint={`${formatNumber(week.promptTokens)} ورودی · ${formatNumber(week.completionTokens)} خروجی`}
        />
        {me.billing ? (
          <StatCard label="هزینه‌ی 7 روز اخیر" icon="coins" tone="warning" value={<span className="num">{formatUsd(week.cost, 4)}</span>} hint="از اعتبار کم شده است" />
        ) : (
          <StatCard label="سقف درخواست" icon="gauge" tone="warning" value={formatNumber(me.limits.rpm)} hint="درخواست در دقیقه" />
        )}
      </div>

      <div className={styles.main}>
        <Card title="مصرف 7 روز اخیر" description="توکن ورودی و خروجی به تفکیک روز (به وقت UTC)">
          {week.requests === 0 ? (
            <EmptyState
              icon="terminal"
              title="هنوز درخواستی ثبت نشده"
              description="با نمونه‌ی شروع سریع اولین درخواستت را بفرست؛ مصرف همین‌جا نمایش داده می‌شود."
              action={<Link to="/panel/quickstart"><Button variant="primary" icon="terminal">شروع سریع</Button></Link>}
            />
          ) : (
            <BarChart
              data={buildDailyChart(usage.daily, 7)}
              series={tokenSeries}
              formatValue={formatTokens}
              formatAxis={(value) => formatNumber(value)}
              summary={`نمودار مصرف توکن در 7 روز اخیر؛ مجموع ${formatNumber(week.promptTokens + week.completionTokens)} توکن`}
            />
          )}
        </Card>

        <Card title="سهمیه‌ی امروز" description={`بازنشانی ساعت ${nextQuotaReset()}`}>
          <div className={styles.quota}>
            <Ring ratio={ratio} tone={tone} label={`${formatPercent(ratio)} از سهمیه‌ی امروز مصرف شده`}>
              <strong className={styles.ringValue}>{formatPercent(ratio)}</strong>
              <span className={styles.ringLabel}>مصرف‌شده</span>
            </Ring>
            <dl className={styles.facts}>
              <div><dt>مصرف امروز</dt><dd className="num">{formatNumber(me.tokens_today)}</dd></div>
              <div><dt>سهمیه‌ی روزانه</dt><dd className="num">{formatNumber(me.limits.daily_tokens)}</dd></div>
              <div><dt>درخواست در دقیقه</dt><dd className="num">{formatNumber(me.limits.rpm)}</dd></div>
              <div><dt>حداکثر توکن پاسخ</dt><dd className="num">{formatNumber(me.limits.max_tokens)}</dd></div>
            </dl>
          </div>
        </Card>
      </div>

      <div className={styles.bottom}>
        <Card title="پرمصرف‌ترین مدل‌ها" description="سهم هر مدل از توکن‌های 7 روز اخیر">
          {topModels.length === 0 ? (
            <p className={styles.muted}>بعد از اولین درخواست، مدل‌های مصرفی اینجا فهرست می‌شوند.</p>
          ) : (
            <ShareList
              items={topModels.map((row) => ({
                key: row.key,
                label: row.key,
                value: row.prompt_tokens + row.completion_tokens,
                display: formatNumber(row.prompt_tokens + row.completion_tokens),
                note: `${formatNumber(row.requests)} درخواست`,
              }))}
            />
          )}
        </Card>

        <Card
          title="اولین درخواست"
          description="با SDK رسمی OpenAI یا curl کار می‌کند"
          actions={<Link to="/panel/quickstart"><Button size="sm" variant="ghost">نمونه‌های بیشتر</Button></Link>}
        >
          <CodeBlock language="bash" code={curl} copyLabel="کپی دستور" />
        </Card>
      </div>
    </>
  );
};

const OverviewSkeleton = () => (
  <div role="status" aria-label="در حال بارگذاری">
    <div className={styles.skeletonHead}><Skeleton height={30} width={260} /><Skeleton height={16} width={340} /></div>
    <div className={styles.stats}>
      {[0, 1, 2, 3].map((index) => <Skeleton key={index} height={112} radius={16} />)}
    </div>
    <div className={styles.main}>
      <Skeleton height={320} radius={16} />
      <Skeleton height={320} radius={16} />
    </div>
  </div>
);
