import { useState, type FormEvent } from 'react';
import { Alert, ErrorState, Skeleton } from '../../components/Feedback';
import { Badge } from '../../components/Badge';
import { Button, IconButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { CopyButton } from '../../components/CopyButton';
import { DataTable, type Column } from '../../components/DataTable';
import { Field, Input } from '../../components/Field';
import { EmptyState } from '../../components/Feedback';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import { errorMessage } from '../../lib/api';
import { formatDate, formatRelative } from '../../lib/format';
import { useUserSession } from '../../lib/sessions';
import type { ApiKeyRow, CreatedKey } from '../../lib/types';
import { useResource } from '../../lib/useResource';
import styles from './KeysPage.module.css';

const MAX_KEYS = 10;

export const KeysPage = () => {
  const { api } = useUserSession();
  const toast = useToast();
  const { data: keys, error, reload } = useResource((signal) => api<ApiKeyRow[]>('/account/keys', { signal }), [api]);

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);

  if (error && !keys) return <ErrorState message={error} onRetry={reload} />;

  const count = keys?.length ?? 0;
  const full = count >= MAX_KEYS;

  const columns: Column<ApiKeyRow>[] = [
    {
      id: 'label',
      header: 'برچسب',
      cell: (key) => (
        <span className={styles.labelCell}>
          <span>{key.label || 'بدون برچسب'}</span>
          {key.current && <Badge tone="accent" dot>کلید فعلی</Badge>}
        </span>
      ),
    },
    { id: 'prefix', header: 'کلید', cell: (key) => <span className="ltr">{key.prefix}…</span> },
    { id: 'created', header: 'ساخته‌شده', cell: (key) => formatDate(key.created) },
    {
      id: 'used',
      header: 'آخرین استفاده',
      cell: (key) => (key.last_used ? formatRelative(key.last_used) : <span className={styles.never}>هنوز استفاده نشده</span>),
    },
    {
      id: 'actions',
      header: <span className="sr-only">عملیات</span>,
      align: 'end',
      bare: true,
      cell: (key) => (
        <IconButton
          icon="trash"
          variant="danger-ghost"
          label={key.current ? 'کلید فعلی را نمی‌توان حذف کرد' : count <= 1 ? 'کلید آخر را نمی‌توان حذف کرد' : `حذف کلید ${key.label || key.prefix}`}
          disabled={count <= 1 || key.current}
          onClick={() => setRevoking(key)}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="کلیدهای API"
        description="برای هر برنامه یا سرور یک کلید جدا بساز تا هر کدام را جداگانه بتوانی حذف کنی."
        actions={
          <Button variant="primary" icon="plus" disabled={full || !keys} onClick={() => setCreating(true)}>
            ساخت کلید جدید
          </Button>
        }
      />

      {created && <NewKeyBanner apiKey={created} onDismiss={() => setCreated(null)} />}

      <Card
        flush
        title="کلیدهای فعال"
        description={keys ? `${count} از ${MAX_KEYS} کلید` : undefined}
      >
        {!keys ? (
          <div className={styles.loading}>
            {[0, 1, 2].map((index) => <Skeleton key={index} height={44} />)}
          </div>
        ) : (
          <DataTable
            caption="فهرست کلیدهای API"
            columns={columns}
            rows={keys}
            rowKey={(key) => key.id}
            empty={<EmptyState icon="key" title="کلیدی وجود ندارد" description="یک کلید بساز و با آن درخواست بفرست." />}
          />
        )}
        {full && (
          <div className={styles.note}>
            <Alert tone="info">به سقف 10 کلید فعال رسیده‌ای. برای ساخت کلید جدید، یکی از کلیدهای بلااستفاده را حذف کن.</Alert>
          </div>
        )}
      </Card>

      {creating && (
        <CreateKeyDialog
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            setCreated(key);
            void reload();
          }}
        />
      )}

      {revoking && (
        <RevokeDialog
          target={revoking}
          onClose={() => setRevoking(null)}
          onDone={() => {
            setRevoking(null);
            toast.show('کلید حذف شد');
            void reload();
          }}
        />
      )}
    </>
  );
};

const NewKeyBanner = ({ apiKey, onDismiss }: { apiKey: string; onDismiss: () => void }) => (
  <div className={styles.banner} role="status">
    <div className={styles.bannerHead}>
      <strong>کلید جدیدت آماده است</strong>
      <IconButton icon="x" label="بستن" size="sm" onClick={onDismiss} />
    </div>
    <p>همین حالا کپی‌اش کن و جای امنی نگه دار؛ بعداً دوباره نمایش داده نمی‌شود.</p>
    <div className={styles.keyRow}>
      <code className={`ltr ${styles.keyValue}`}>{apiKey}</code>
      <CopyButton text={apiKey} label="کپی کلید" variant="primary" />
    </div>
  </div>
);

const CreateKeyDialog = ({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) => {
  const { api } = useUserSession();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<CreatedKey>('/account/keys', { method: 'POST', body: { label: label.trim() } });
      onCreated(result.api_key);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="ساخت کلید جدید"
      description="برچسب فقط برای شناسایی خودت است."
      onClose={onClose}
      onSubmit={submit}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>انصراف</Button>
          <Button type="submit" variant="primary" loading={busy}>ساخت کلید</Button>
        </>
      }
    >
      <Field label="برچسب" optional hint="مثلاً «سرور تست» یا «اپ موبایل»">
        <Input value={label} maxLength={60} autoFocus onChange={(event) => setLabel(event.target.value)} />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  );
};

const RevokeDialog = ({ target, onClose, onDone }: { target: ApiKeyRow; onClose: () => void; onDone: () => void }) => {
  const { api } = useUserSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/account/keys/${target.id}`, { method: 'DELETE' });
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title="حذف کلید؟"
      danger
      busy={busy}
      error={error}
      confirmLabel="حذف کلید"
      onClose={onClose}
      onConfirm={revoke}
      message={
        <>
          کلید <strong>{target.label || target.prefix}</strong> برای همیشه حذف می‌شود و برنامه‌هایی که از آن استفاده می‌کنند از کار می‌افتند.
        </>
      }
    />
  );
};
