import { useMemo, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button, IconButton } from '../../components/Button';
import { Meter } from '../../components/Charts';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { SearchInput } from '../../components/Field';
import { EmptyState, ErrorState, Skeleton } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import { errorMessage } from '../../lib/api';
import { formatNumber, formatUsd, safeRatio } from '../../lib/format';
import { useAdminSession } from '../../lib/sessions';
import type { AdminUser, CreatedKey } from '../../lib/types';
import { useResource } from '../../lib/useResource';
import { CreditDialog, DeleteUserDialog, KeyRevealDialog, UserFormDialog } from './UserDialogs';
import styles from './UsersPage.module.css';

type StatusFilter = 'all' | 'active' | 'inactive';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; user: AdminUser }
  | { kind: 'credit'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser }
  | { kind: 'key'; apiKey: string; who: string };

export const UsersPage = () => {
  const { api, info } = useAdminSession();
  const toast = useToast();
  const { data: users, error, refreshing, reload } = useResource((signal) => api<AdminUser[]>('/admin/users', { signal }), [api], { interval: 30_000 });

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (users ?? []).filter((user) => {
      if (status === 'active' && !user.active) return false;
      if (status === 'inactive' && user.active) return false;
      return !needle || user.name.toLowerCase().includes(needle) || String(user.id) === needle || user.plan.toLowerCase().includes(needle);
    });
  }, [users, query, status]);

  if (error && !users) return <ErrorState message={error} onRetry={reload} />;

  const close = () => setDialog(null);

  const createKey = async (user: AdminUser) => {
    setActionError(null);
    try {
      const result = await api<CreatedKey>(`/admin/users/${user.id}/keys`, { method: 'POST', body: { label: 'admin' } });
      void reload();
      setDialog({ kind: 'key', apiKey: result.api_key, who: user.name });
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  };

  const columns: Column<AdminUser>[] = [
    {
      id: 'user',
      header: 'کاربر',
      cell: (user) => (
        <span className={styles.userCell}>
          <span className={styles.avatar} aria-hidden="true">{user.name.trim().charAt(0).toUpperCase() || '؟'}</span>
          <span className={styles.userText}>
            <strong>{user.name}</strong>
            <small className="ltr">#{user.id}</small>
          </span>
        </span>
      ),
    },
    { id: 'plan', header: 'پلن', cell: (user) => <Badge tone={info.plans[user.plan]?.billing ? 'accent' : 'neutral'}>{user.plan}</Badge> },
    { id: 'status', header: 'وضعیت', cell: (user) => (user.active ? <Badge tone="success" dot>فعال</Badge> : <Badge tone="danger" dot>غیرفعال</Badge>) },
    {
      id: 'usage',
      header: 'مصرف امروز',
      label: 'مصرف امروز',
      width: '200px',
      cell: (user) => {
        const limit = user.daily_tokens || info.plans[user.plan]?.daily_tokens || 0;
        const ratio = safeRatio(user.tokens_today, limit);
        return (
          <span className={styles.usage}>
            <span className="num">{formatNumber(user.tokens_today)}</span>
            {limit > 0 && <Meter ratio={ratio} tone={ratio >= 1 ? 'full' : ratio >= 0.8 ? 'warn' : 'ok'} label={`${Math.round(ratio * 100)} درصد سهمیه`} />}
          </span>
        );
      },
    },
    {
      id: 'balance',
      header: 'اعتبار',
      align: 'end',
      cell: (user) =>
        info.plans[user.plan]?.billing ? (
          <span className={`num ${user.balance <= 0 ? styles.negative : ''}`}>{formatUsd(user.balance)}</span>
        ) : (
          <span className={styles.muted}>—</span>
        ),
    },
    { id: 'keys', header: 'کلیدها', align: 'end', cell: (user) => <span className="num">{user.keys}</span> },
    {
      id: 'actions',
      header: <span className="sr-only">عملیات</span>,
      align: 'end',
      bare: true,
      cell: (user) => (
        <span className={styles.actions}>
          <IconButton icon="wallet" label={`شارژ ${user.name}`} size="sm" onClick={() => setDialog({ kind: 'credit', user })} />
          <IconButton icon="key" label={`کلید جدید برای ${user.name}`} size="sm" onClick={() => void createKey(user)} />
          <IconButton icon="pencil" label={`ویرایش ${user.name}`} size="sm" onClick={() => setDialog({ kind: 'edit', user })} />
          <IconButton icon="trash" label={`حذف ${user.name}`} size="sm" variant="danger-ghost" onClick={() => setDialog({ kind: 'delete', user })} />
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="کاربران"
        description={users ? `${formatNumber(users.length)} کاربر · ${formatNumber(users.filter((user) => user.active).length)} فعال` : undefined}
        actions={<Button variant="primary" icon="plus" onClick={() => setDialog({ kind: 'create' })}>کاربر جدید</Button>}
      />

      <Card flush className={refreshing && users ? styles.refreshing : undefined}>
        <div className={styles.toolbar}>
          <SearchInput placeholder="جستجوی نام، شناسه یا پلن" aria-label="جستجوی کاربران" value={query} onChange={(event) => setQuery(event.target.value)} />
          <Segmented
            label="فیلتر وضعیت"
            value={status}
            onChange={setStatus}
            options={[{ value: 'all', label: 'همه' }, { value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیرفعال' }]}
          />
        </div>
        {actionError && <p className={styles.error} role="alert">{actionError}</p>}
        {!users ? (
          <div className={styles.loading}>{[0, 1, 2, 3].map((index) => <Skeleton key={index} height={52} />)}</div>
        ) : (
          <DataTable
            caption="فهرست کاربران"
            columns={columns}
            rows={visible}
            rowKey={(user) => user.id}
            empty={
              users.length === 0 ? (
                <EmptyState
                  icon="users"
                  title="هنوز کاربری نساخته‌ای"
                  description="با دکمه‌ی «کاربر جدید» اولین کاربر را بساز؛ کلید API او همان لحظه نمایش داده می‌شود."
                  action={<Button variant="primary" icon="plus" onClick={() => setDialog({ kind: 'create' })}>کاربر جدید</Button>}
                />
              ) : (
                <EmptyState icon="search" title="کاربری با این مشخصات پیدا نشد" description="عبارت جستجو یا فیلتر را تغییر بده." />
              )
            }
          />
        )}
      </Card>

      {dialog?.kind === 'create' && (
        <UserFormDialog
          mode="create"
          onClose={close}
          onSaved={(created) => {
            void reload();
            toast.show('کاربر ساخته شد');
            setDialog(created ? { kind: 'key', apiKey: created.apiKey, who: created.name } : null);
          }}
        />
      )}
      {dialog?.kind === 'edit' && (
        <UserFormDialog
          mode="edit"
          user={dialog.user}
          onClose={close}
          onSaved={() => {
            close();
            void reload();
            toast.show('تغییرات ذخیره شد');
          }}
        />
      )}
      {dialog?.kind === 'credit' && (
        <CreditDialog
          user={dialog.user}
          onClose={close}
          onSaved={(balance) => {
            close();
            void reload();
            toast.show(`اعتبار ثبت شد؛ موجودی جدید ${formatUsd(balance)}`);
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteUserDialog
          user={dialog.user}
          onClose={close}
          onDeleted={() => {
            close();
            void reload();
            toast.show('کاربر حذف شد');
          }}
        />
      )}
      {dialog?.kind === 'key' && <KeyRevealDialog apiKey={dialog.apiKey} who={dialog.who} onClose={close} />}
    </>
  );
};
