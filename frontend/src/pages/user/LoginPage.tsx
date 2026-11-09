import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../../components/AuthLayout';
import { Button } from '../../components/Button';
import { Field, Input } from '../../components/Field';
import { Alert } from '../../components/Feedback';
import { errorMessage } from '../../lib/api';
import type { LoginControl } from '../../lib/createSession';
import styles from './LoginPage.module.css';

const POINTS = [
  { icon: 'zap', text: 'API سازگار با OpenAI؛ فقط آدرس و کلید را عوض کن' },
  { icon: 'chart', text: 'مصرف، اعتبار و سهمیه‌ی روزانه را لحظه‌ای ببین' },
  { icon: 'shield', text: 'چند کلید جدا برای هر برنامه، با حذف فوری' },
] as const;

export const LoginPage = ({ submit }: LoginControl) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submit(value);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      brand="پنل کاربری"
      headline="همه‌چیز درباره‌ی مصرف API تو، در یک نگاه."
      points={[...POINTS]}
      links={
        <>
          <Link to="/status">وضعیت سرویس</Link>
          <a href="/docs">مستندات API</a>
        </>
      }
    >
      <div className={styles.head}>
        <h1 className={styles.title}>ورود به پنل</h1>
        <p className={styles.subtitle}>کلید API که از مدیر سرویس گرفته‌ای را وارد کن.</p>
      </div>
      <form className={styles.form} onSubmit={onSubmit}>
        <Field label="کلید API" hint="کلید فقط در همین تب مرورگر نگه داشته می‌شود و با بستن تب پاک می‌شود.">
          <Input
            mono
            type="password"
            name="api-key"
            placeholder="sk-..."
            autoComplete="off"
            autoFocus
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>ورود</Button>
      </form>
    </AuthLayout>
  );
};
