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
  { icon: 'server', text: 'وضعیت کلیدهای upstream و مسیرهای قطع‌شده' },
  { icon: 'users', text: 'ساخت کاربر، شارژ اعتبار و مدیریت پلن' },
  { icon: 'coins', text: 'آمار مصرف و درآمد به تفکیک مدل' },
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
      brand="پنل مدیریت"
      headline="کنترل کامل گیت‌وی، از کلیدها تا درآمد."
      points={[...POINTS]}
      links={
        <>
          <Link to="/status">وضعیت عمومی</Link>
          <Link to="/panel">پنل کاربر</Link>
        </>
      }
    >
      <div className={styles.head}>
        <span className={styles.chip}>ناحیه‌ی مدیر</span>
        <h1 className={styles.title}>ورود مدیر</h1>
        <p className={styles.subtitle}>
          توکن ادمین همان مقدار <span className="ltr">ADMIN_TOKEN</span> در فایل <span className="ltr">.env</span> است.
        </p>
      </div>
      <form className={styles.form} onSubmit={onSubmit}>
        <Field label="توکن ادمین">
          <Input
            mono
            type="password"
            name="admin-token"
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
