import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '../../components/AppShell';
import { Button } from '../../components/Button';
import { ErrorState, Skeleton } from '../../components/Feedback';
import { Icon, type IconName } from '../../components/Icon';
import { request } from '../../lib/api';
import { formatClock, formatPercent } from '../../lib/format';
import type { PublicStatus, ServiceHealth } from '../../lib/types';
import { useResource } from '../../lib/useResource';
import styles from './StatusPage.module.css';

const HEADLINE: Record<ServiceHealth, { title: string; text: string; icon: IconName }> = {
  operational: { title: 'همه‌ی مدل‌ها کار می‌کنند', text: 'سرویس بدون مشکل در دسترس است.', icon: 'check' },
  degraded: { title: 'بعضی مدل‌ها ناپایدارند', text: 'درخواست‌ها ممکن است کندتر جواب بگیرند.', icon: 'alert' },
  down: { title: 'سرویس فعلاً در دسترس نیست', text: 'مشکل را می‌دانیم و دوباره تلاش می‌کنیم.', icon: 'x' },
};

const MODEL_TEXT: Record<ServiceHealth, string> = { operational: 'کار می‌کند', degraded: 'کند یا ناپایدار', down: 'در دسترس نیست' };

const REFRESH_MS = 30_000;

export const StatusPage = () => {
  const { data, error, refreshing, reload } = useResource((signal) => request<PublicStatus>('/api/status', null, { signal }), [], { interval: REFRESH_MS });
  const site = data?.site;

  useEffect(() => {
    document.title = `وضعیت سرویس${site ? ` | ${site}` : ''}`;
  }, [site]);

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <span className={styles.brand}>
          <span className={styles.logo} aria-hidden="true"><Icon name="zap" size={17} strokeWidth={2.2} /></span>
          {site ?? 'وضعیت سرویس'}
        </span>
        <nav className={styles.nav}>
          <Link to="/panel">پنل کاربر</Link>
          <a href="/docs">مستندات API</a>
          <ThemeToggle />
        </nav>
      </header>

      <main className={styles.main}>
        {error && !data ? (
          <ErrorState message="وضعیت دریافت نشد. اتصال اینترنت را بررسی کن." onRetry={reload} />
        ) : !data ? (
          <>
            <Skeleton height={168} radius={20} />
            <Skeleton height={260} radius={16} />
          </>
        ) : (
          <StatusBody data={data} refreshing={refreshing} onRefresh={reload} />
        )}
      </main>
      <footer className={styles.footer}>صفحه هر 30 ثانیه خودکار به‌روز می‌شود.</footer>
    </div>
  );
};

const StatusBody = ({ data, refreshing, onRefresh }: { data: PublicStatus; refreshing: boolean; onRefresh: () => Promise<void> }) => {
  const headline = HEADLINE[data.status];
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsAgo = Math.max(0, Math.round(now / 1000 - data.updated));

  return (
    <>
      <section className={`${styles.hero} ${styles[data.status]}`} aria-live="polite">
        <span className={styles.heroIcon}><Icon name={headline.icon} size={28} strokeWidth={2.4} /></span>
        <div className={styles.heroText}>
          <h1>{headline.title}</h1>
          <p>{headline.text}</p>
        </div>
        <Button variant="secondary" icon="refresh" loading={refreshing} onClick={() => void onRefresh()} className={styles.refresh}>تازه‌سازی</Button>
      </section>

      <dl className={styles.meta}>
        <div>
          <dt>نرخ موفقیت 15 دقیقه‌ی اخیر</dt>
          <dd className="num">{data.success_rate_15m == null ? '—' : formatPercent(data.success_rate_15m)}</dd>
          {data.success_rate_15m == null && <small>در این بازه درخواستی ثبت نشده</small>}
        </div>
        <div>
          <dt>آخرین به‌روزرسانی</dt>
          <dd className="num">{formatClock(data.updated)}</dd>
          <small>{secondsAgo < 5 ? 'همین الان' : `${secondsAgo} ثانیه پیش`}</small>
        </div>
        <div>
          <dt>مدل‌های فعال</dt>
          <dd className="num">{data.models.filter((model) => model.status !== 'down').length} / {data.models.length}</dd>
        </div>
      </dl>

      <section className={styles.models}>
        <h2>مدل‌ها</h2>
        <ul>
          {data.models.map((model) => (
            <li key={model.id}>
              <span className={`${styles.dot} ${styles[model.status]}`} aria-hidden="true" />
              <span className={`ltr ${styles.modelId}`}>{model.id}</span>
              <span className={`${styles.modelStatus} ${styles[model.status]}`}>
                <Icon name={model.status === 'operational' ? 'check' : model.status === 'degraded' ? 'alert' : 'x'} size={14} strokeWidth={2.6} />
                {MODEL_TEXT[model.status]}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
};
