import { useState } from 'react';
import { Badge, type BadgeTone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { Alert, EmptyState, ErrorState, Skeleton } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { StatCard } from '../../components/StatCard';
import { useToast } from '../../components/Toast';
import { errorMessage } from '../../lib/api';
import { formatClock, formatNumber, formatPercent } from '../../lib/format';
import { useAdminSession } from '../../lib/sessions';
import type { AdminOverview, KeyState, Pool, PoolKey } from '../../lib/types';
import { useResource } from '../../lib/useResource';
import styles from './PoolPage.module.css';

const STATE_TEXT: Record<KeyState, string> = { ready: 'آماده', cooldown: 'در انتظار (cooldown)', disabled: 'غیرفعال' };
const STATE_TONE: Record<KeyState, BadgeTone> = { ready: 'success', cooldown: 'warning', disabled: 'danger' };
const STATE_ICON = { ready: 'check', cooldown: 'clock', disabled: 'x' } as const;
const TIER_TEXT = { free: 'رایگان', paid: 'پولی' } as const;

type Filter = 'all' | 'issues';

export const PoolPage = () => {
  const { api } = useAdminSession();
  const toast = useToast();
  const { data, error, refreshing, updatedAt, reload } = useResource(
    async (signal) => {
      const [pool, overview] = await Promise.all([api<Pool>('/admin/pool', { signal }), api<AdminOverview>('/admin/overview', { signal })]);
      return { pool, overview };
    },
    [api],
    { interval: 10_000 },
  );

  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<PoolKey | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) {
    return (
      <>
        <PageHeader title="زیرساخت" />
        <div className={styles.stats}>{[0, 1, 2, 3].map((index) => <Skeleton key={index} height={108} radius={16} />)}</div>
        <Skeleton height={260} radius={16} />
      </>
    );
  }

  const { pool, overview } = data;
  const ready = pool.keys.filter((key) => key.state === 'ready').length;
  const providers = [...new Set(pool.keys.map((key) => key.provider))];
  const cacheTotal = overview.cache.hit + overview.cache.miss;
  const hitRate = cacheTotal ? overview.cache.hit / cacheTotal : null;
  const openBreakers = pool.breakers.filter((breaker) => breaker.open);
  const rows = filter === 'issues' ? pool.keys.filter((key) => key.state !== 'ready' || Object.keys(key.limited_models).length > 0) : pool.keys;

  const reset = async () => {
    setResetBusy(true);
    setResetError(null);
    try {
      await api('/admin/pool/reset', { method: 'POST' });
      setConfirmReset(false);
      toast.show('همه‌ی cooldownها و مسیرهای قطع‌شده بازنشانی شد');
      await reload();
    } catch (caught) {
      setResetError(errorMessage(caught));
    } finally {
      setResetBusy(false);
    }
  };

  const columns: Column<PoolKey>[] = [
    { id: 'provider', header: 'ارائه‌دهنده', cell: (key) => <span className="ltr">{key.provider}</span> },
    { id: 'tier', header: 'سطح', cell: (key) => <Badge tone={key.tier === 'paid' ? 'accent' : 'neutral'}>{TIER_TEXT[key.tier]}</Badge> },
    { id: 'key', header: 'کلید', cell: (key) => <span className="ltr">{key.key}</span> },
    { id: 'state', header: 'وضعیت', cell: (key) => <Badge tone={STATE_TONE[key.state]} dot>{STATE_TEXT[key.state]}</Badge> },
    {
      id: 'limited',
      header: 'مدل‌های محدودشده',
      cell: (key) => {
        const entries = Object.entries(key.limited_models);
        return entries.length ? (
          <span className={styles.limited}>{entries.map(([model, seconds]) => <span key={model} className="ltr">{model} · {seconds}s</span>)}</span>
        ) : (
          <span className={styles.muted}>—</span>
        );
      },
    },
    { id: 'count', header: 'موفق / ناموفق', align: 'end', cell: (key) => <span className="num">{formatNumber(key.ok)} / {formatNumber(key.fail)}</span> },
    {
      id: 'detail',
      header: <span className="sr-only">جزئیات</span>,
      align: 'end',
      bare: true,
      cell: (key) => <Button size="sm" variant="ghost" onClick={() => setSelected(key)} aria-label={`جزئیات کلید ${key.provider} ${key.key}`}>جزئیات</Button>,
    },
  ];

  return (
    <>
      <PageHeader
        title="زیرساخت"
        description="وضعیت زنده‌ی کلیدهای upstream، کش و مسیرهای قطع‌شده"
        actions={
          <>
            <span className={styles.live} aria-live="off">
              <span className={`${styles.pulse} ${refreshing ? styles.pulsing : ''}`} aria-hidden="true" />
              {updatedAt ? `به‌روزرسانی ${formatClock(updatedAt)}` : '…'}
            </span>
            <Button icon="refresh" onClick={() => void reload()} loading={refreshing && !!data}>تازه‌سازی</Button>
            <Button variant="secondary" onClick={() => setConfirmReset(true)}>بازنشانی cooldownها</Button>
          </>
        }
      />

      {overview.backend.degraded && (
        <div className={styles.alert}>
          <Alert tone="warning" title="Redis قطع است">سرویس با حافظه‌ی محلی ادامه می‌دهد؛ rate limit و کش بین workerها مشترک نیست تا Redis وصل شود.</Alert>
        </div>
      )}
      {openBreakers.length > 0 && (
        <div className={styles.alert}>
          <Alert tone="danger" title={`${formatNumber(openBreakers.length)} مسیر قطع است`}>circuit breaker این مسیرها را موقتاً از چرخه خارج کرده؛ جزئیات پایین صفحه است.</Alert>
        </div>
      )}

      <div className={styles.stats}>
        <StatCard
          label="کلیدهای آماده"
          icon="key"
          tone={pool.keys.length === 0 ? 'neutral' : ready === 0 ? 'danger' : ready < pool.keys.length ? 'warning' : 'success'}
          value={<span className="num">{ready} / {pool.keys.length}</span>}
          hint={pool.keys.length - ready > 0 ? `${pool.keys.length - ready} کلید در cooldown یا غیرفعال` : 'همه‌ی کلیدها آماده‌اند'}
        />
        <StatCard label="صف انتظار" icon="clock" tone={overview.queued > 0 ? 'warning' : 'neutral'} value={formatNumber(overview.queued)} hint="درخواست منتظر کلید آزاد" />
        <StatCard
          label="برخورد کش"
          icon="zap"
          value={hitRate === null ? '—' : formatPercent(hitRate)}
          hint={overview.cache_entries != null ? `${formatNumber(overview.cache_entries)} ورودی در کش` : 'کش فعال نیست'}
        />
        <StatCard
          label="ذخیره‌سازی"
          icon="database"
          tone={overview.backend.degraded ? 'warning' : 'neutral'}
          value={<span className={styles.backend}>{overview.backend.db}</span>}
          hint={`حافظه‌ی داغ: ${overview.backend.state === 'redis' ? 'Redis' : 'محلی'}${overview.backend.degraded ? ' (قطع)' : ''}`}
        />
      </div>

      <h2 className={styles.sectionTitle}>ارائه‌دهنده‌ها</h2>
      {providers.length === 0 ? (
        <Card>
          <EmptyState
            icon="server"
            title="هیچ کلید upstreamای تنظیم نشده"
            description={<>کلیدها را در فایل <span className="ltr">.env</span> بگذار و سرویس را دوباره اجرا کن.</>}
          />
        </Card>
      ) : (
        <div className={styles.providers}>
          {providers.map((provider) => {
            const keys = pool.keys.filter((key) => key.provider === provider);
            const readyCount = keys.filter((key) => key.state === 'ready').length;
            return (
              <section key={provider} className={styles.provider}>
                <header className={styles.providerHead}>
                  <h3 className="ltr">{provider}</h3>
                  <Badge tone={readyCount === 0 ? 'danger' : readyCount < keys.length ? 'warning' : 'success'} dot>
                    {readyCount} از {keys.length} آماده
                  </Badge>
                </header>
                {(['paid', 'free'] as const).map((tier) => {
                  const tierKeys = keys.filter((key) => key.tier === tier);
                  return (
                    <div key={tier} className={styles.tier}>
                      <span className={styles.tierLabel}>{TIER_TEXT[tier]}</span>
                      {tierKeys.length === 0 ? (
                        <span className={styles.muted}>کلیدی تنظیم نشده</span>
                      ) : (
                        <div className={styles.chips}>
                          {tierKeys.map((key) => (
                            <button
                              key={key.key}
                              type="button"
                              className={`${styles.chip} ${styles[key.state]}`}
                              onClick={() => setSelected(key)}
                              aria-label={`${key.provider} ${key.key}: ${STATE_TEXT[key.state]}`}
                              title={STATE_TEXT[key.state]}
                            >
                              <Icon name={STATE_ICON[key.state]} size={13} strokeWidth={2.6} />
                              <span className="ltr">{key.key}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      {pool.keys.length > 0 && (
        <Card
          flush
          className={styles.tableCard}
          title="جزئیات کلیدها"
          actions={
            <Segmented
              label="فیلتر کلیدها"
              value={filter}
              onChange={setFilter}
              options={[{ value: 'all', label: 'همه' }, { value: 'issues', label: 'مشکل‌دار' }]}
            />
          }
        >
          <DataTable
            caption="کلیدهای upstream"
            columns={columns}
            rows={rows}
            rowKey={(key) => `${key.provider}|${key.key}`}
            empty={<EmptyState icon="check" title="هیچ کلید مشکل‌داری نیست" description="همه‌ی کلیدها آماده‌ی کارند و محدودیتی روی مدلی نیست." />}
          />
        </Card>
      )}

      <Card title="مسیرهای قطع‌شده (circuit breaker)" description="بعد از چند خطای پشت‌سرهم، مسیر موقتاً قطع می‌شود" className={styles.tableCard}>
        {pool.breakers.length === 0 ? (
          <p className={styles.allGood}><Icon name="check" size={17} />همه‌ی مسیرها وصل هستند.</p>
        ) : (
          <ul className={styles.breakers}>
            {pool.breakers.map((breaker) => (
              <li key={breaker.route}>
                <span className="ltr">{breaker.route}</span>
                <Badge tone={breaker.open ? 'danger' : 'warning'} dot>{breaker.open ? 'قطع' : 'در حال بررسی'}</Badge>
                <span className={styles.muted}>{formatNumber(breaker.fails)} خطای پشت‌سرهم</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected && <KeyDetail keyInfo={selected} onClose={() => setSelected(null)} />}

      {confirmReset && (
        <ConfirmDialog
          title="بازنشانی همه‌ی cooldownها؟"
          message="cooldown و غیرفعال‌سازی همه‌ی کلیدها و مسیرهای قطع‌شده پاک می‌شود. اگر کلیدی واقعاً خراب باشد، دوباره خطا می‌دهد و مسدود می‌شود."
          confirmLabel="بازنشانی"
          busy={resetBusy}
          error={resetError}
          onConfirm={reset}
          onClose={() => setConfirmReset(false)}
        />
      )}
    </>
  );
};

const KeyDetail = ({ keyInfo, onClose }: { keyInfo: PoolKey; onClose: () => void }) => {
  const limited = Object.entries(keyInfo.limited_models);
  return (
    <Modal title="جزئیات کلید" description={<span className="ltr">{keyInfo.provider} · {keyInfo.key}</span>} onClose={onClose} footer={<Button onClick={onClose}>بستن</Button>}>
      <dl className={styles.detail}>
        <div><dt>وضعیت</dt><dd><Badge tone={STATE_TONE[keyInfo.state]} dot>{STATE_TEXT[keyInfo.state]}</Badge></dd></div>
        <div><dt>سطح</dt><dd>{TIER_TEXT[keyInfo.tier]}</dd></div>
        <div><dt>درخواست‌های در جریان</dt><dd className="num">{formatNumber(keyInfo.inflight)}</dd></div>
        <div><dt>موفق / ناموفق</dt><dd className="num">{formatNumber(keyInfo.ok)} / {formatNumber(keyInfo.fail)}</dd></div>
        <div>
          <dt>مدل‌های محدودشده</dt>
          <dd>{limited.length ? limited.map(([model, seconds]) => <div key={model} className="ltr">{model} · {seconds}s</div>) : '—'}</dd>
        </div>
        <div>
          <dt>آخرین خطا</dt>
          <dd>{keyInfo.last_error ? <code className={`ltr ${styles.errorBox}`}>{keyInfo.last_error}</code> : '—'}</dd>
        </div>
      </dl>
    </Modal>
  );
};
