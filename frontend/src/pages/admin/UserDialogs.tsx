import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button';
import { CopyButton } from '../../components/CopyButton';
import { Field, Input, Select } from '../../components/Field';
import { Alert } from '../../components/Feedback';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { errorMessage } from '../../lib/api';
import { formatNumber, formatUsd } from '../../lib/format';
import { useAdminSession } from '../../lib/sessions';
import type { AdminUser, CreatedKey, NewUserBody, UserPatchBody } from '../../lib/types';
import styles from './UserDialogs.module.css';

const parseIps = (raw: string): string[] => raw.split(/[\s,،]+/).map((item) => item.trim()).filter(Boolean);
const parseOptionalInt = (raw: string): number | null => {
  const value = Number(raw);
  return raw.trim() === '' || !Number.isFinite(value) || value <= 0 ? null : Math.floor(value);
};

/** منطق مشترک ارسال فرم: وضعیت در حال ارسال و پیام خطا. */
const useSubmit = (action: () => Promise<void>) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };
  return { busy, error, submit };
};

type UserFormProps =
  | { mode: 'create'; user?: undefined; onClose: () => void; onSaved: (created: { name: string; apiKey: string } | null) => void }
  | { mode: 'edit'; user: AdminUser; onClose: () => void; onSaved: (created: null) => void };

export const UserFormDialog = ({ mode, user, onClose, onSaved }: UserFormProps) => {
  const { api, info } = useAdminSession();
  const [name, setName] = useState(user?.name ?? '');
  const [plan, setPlan] = useState(user?.plan ?? info.default_plan);
  const [rpm, setRpm] = useState(user?.rpm ? String(user.rpm) : '');
  const [dailyTokens, setDailyTokens] = useState(user?.daily_tokens ? String(user.daily_tokens) : '');
  const [ips, setIps] = useState(user?.ip_allow.join(', ') ?? '');
  const [active, setActive] = useState(user?.active ?? true);

  const selectedPlan = info.plans[plan];

  const { busy, error, submit } = useSubmit(async () => {
    if (mode === 'create') {
      const body: NewUserBody = {
        name: name.trim(),
        plan,
        rpm: parseOptionalInt(rpm),
        daily_tokens: parseOptionalInt(dailyTokens),
        ip_allow: parseIps(ips),
      };
      const result = await api<CreatedKey & { name: string }>('/admin/users', { method: 'POST', body });
      onSaved({ name: result.name, apiKey: result.api_key });
    } else {
      const body: UserPatchBody = {
        plan,
        rpm: parseOptionalInt(rpm) ?? 0,
        daily_tokens: parseOptionalInt(dailyTokens) ?? 0,
        active,
        ip_allow: parseIps(ips),
      };
      await api(`/admin/users/${user.id}`, { method: 'PATCH', body });
      onSaved(null);
    }
  });

  return (
    <Modal
      title={mode === 'create' ? 'کاربر جدید' : `ویرایش ${user.name}`}
      description={mode === 'create' ? 'بعد از ساخت، کلید اولیه‌ی کاربر فقط یک بار نمایش داده می‌شود.' : undefined}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>انصراف</Button>
          <Button type="submit" variant="primary" loading={busy}>{mode === 'create' ? 'ساخت کاربر' : 'ذخیره‌ی تغییرات'}</Button>
        </>
      }
    >
      {mode === 'create' && (
        <Field label="نام">
          <Input value={name} required maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} />
        </Field>
      )}
      <Field
        label="پلن"
        hint={selectedPlan && (
          <>
            {formatNumber(selectedPlan.rpm)} درخواست در دقیقه · {formatNumber(selectedPlan.daily_tokens)} توکن در روز · {selectedPlan.billing ? 'با اعتبار پیش‌پرداخت' : 'رایگان'}
          </>
        )}
      >
        <Select value={plan} onChange={(event) => setPlan(event.target.value)}>
          {Object.keys(info.plans).map((key) => <option key={key} value={key}>{key}</option>)}
        </Select>
      </Field>
      <div className={styles.pair}>
        <Field label="سقف درخواست در دقیقه" optional>
          <Input type="number" inputMode="numeric" min={1} value={rpm} placeholder="طبق پلن" onChange={(event) => setRpm(event.target.value)} />
        </Field>
        <Field label="سهمیه‌ی توکن روزانه" optional>
          <Input type="number" inputMode="numeric" min={1} value={dailyTokens} placeholder="طبق پلن" onChange={(event) => setDailyTokens(event.target.value)} />
        </Field>
      </div>
      <Field label="آی‌پی‌های مجاز" optional hint="با کاما جدا کن. خالی یعنی از همه‌ی آی‌پی‌ها مجاز است.">
        <Input mono value={ips} placeholder="1.2.3.4, 5.6.7.8" onChange={(event) => setIps(event.target.value)} />
      </Field>
      {mode === 'edit' && (
        <Field label="وضعیت حساب">
          <Select value={active ? '1' : '0'} onChange={(event) => setActive(event.target.value === '1')}>
            <option value="1">فعال</option>
            <option value="0">غیرفعال (درخواست‌ها رد می‌شوند)</option>
          </Select>
        </Field>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  );
};

export const CreditDialog = ({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: (balance: number) => void }) => {
  const { api } = useAdminSession();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [validation, setValidation] = useState<string | null>(null);

  const value = Number(amount);
  const nextBalance = Number.isFinite(value) && amount !== '' ? user.balance + value : null;

  const { busy, error, submit } = useSubmit(async () => {
    const result = await api<{ balance: number }>(`/admin/users/${user.id}/credit`, { method: 'POST', body: { amount: value, note: note.trim() } });
    onSaved(result.balance);
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!Number.isFinite(value) || value === 0) {
      setValidation('مبلغ باید عددی غیر از صفر باشد.');
      return;
    }
    setValidation(null);
    void submit();
  };

  return (
    <Modal
      title={`شارژ اعتبار ${user.name}`}
      description={<>اعتبار فعلی: <strong className="num">{formatUsd(user.balance)}</strong>. برای کم کردن، عدد منفی وارد کن.</>}
      onClose={onClose}
      onSubmit={onSubmit}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>انصراف</Button>
          <Button type="submit" variant="primary" loading={busy}>ثبت</Button>
        </>
      }
    >
      <Field label="مبلغ (دلار)" hint={nextBalance !== null ? <>موجودی بعد از ثبت: <strong className="num">{formatUsd(nextBalance)}</strong></> : undefined}>
        <Input type="number" step="0.01" inputMode="decimal" mono autoFocus required value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <Field label="یادداشت" optional>
        <Input value={note} maxLength={120} placeholder="مثلاً «پرداخت کارت‌به‌کارت»" onChange={(event) => setNote(event.target.value)} />
      </Field>
      {(validation || error) && <Alert tone="danger">{validation ?? error}</Alert>}
    </Modal>
  );
};

export const KeyRevealDialog = ({ apiKey, who, onClose }: { apiKey: string; who: string; onClose: () => void }) => (
  <Modal
    title={`کلید ${who}`}
    description="این کلید فقط همین یک بار نمایش داده می‌شود. همین حالا کپی‌اش کن."
    onClose={onClose}
    footer={<Button variant="primary" onClick={onClose}>کپی کردم، بستن</Button>}
  >
    <div className={styles.reveal}>
      <code className={`ltr ${styles.key}`}>{apiKey}</code>
      <CopyButton text={apiKey} label="کپی کلید" variant="primary" />
    </div>
  </Modal>
);

export const DeleteUserDialog = ({ user, onClose, onDeleted }: { user: AdminUser; onClose: () => void; onDeleted: () => void }) => {
  const { api } = useAdminSession();
  const { busy, error, submit } = useSubmit(async () => {
    await api(`/admin/users/${user.id}`, { method: 'DELETE' });
    onDeleted();
  });
  return (
    <ConfirmDialog
      title="حذف کاربر؟"
      danger
      confirmLabel="حذف کاربر"
      busy={busy}
      error={error}
      onClose={onClose}
      onConfirm={() => void submit()}
      message={<>کاربر <strong>{user.name}</strong> و همه‌ی کلیدهایش حذف می‌شود. این کار برگشت‌پذیر نیست.</>}
    />
  );
};
