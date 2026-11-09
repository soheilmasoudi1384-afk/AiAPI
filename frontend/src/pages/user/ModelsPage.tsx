import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { CopyButton } from '../../components/CopyButton';
import { SearchInput } from '../../components/Field';
import { EmptyState } from '../../components/Feedback';
import { PageHeader } from '../../components/PageHeader';
import { useUserSession } from '../../lib/sessions';
import styles from './ModelsPage.module.css';

const formatPrice = (value: number): string => `$${value}`;

export const ModelsPage = () => {
  const { info: me } = useUserSession();
  const [query, setQuery] = useState('');

  const models = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? me.models.filter((model) => model.id.toLowerCase().includes(needle)) : me.models;
  }, [me.models, query]);

  return (
    <>
      <PageHeader
        title="مدل‌ها"
        description={
          me.billing
            ? 'قیمت‌ها به دلار برای هر یک میلیون توکن است و از اعتبارت کم می‌شود.'
            : 'همه‌ی این مدل‌ها در پلن رایگان تو، در حد سهمیه‌ی روزانه، قابل استفاده‌اند.'
        }
        actions={me.models.length > 6 ? <SearchInput placeholder="جستجوی مدل" aria-label="جستجوی مدل" value={query} onChange={(event) => setQuery(event.target.value)} /> : undefined}
      />

      {models.length === 0 ? (
        <EmptyState icon="layers" title={query ? 'مدلی با این نام پیدا نشد' : 'مدلی برای پلن تو فعال نیست'} description={query ? undefined : 'با مدیر سرویس تماس بگیر.'} />
      ) : (
        <ul className={styles.grid}>
          {models.map((model) => (
            <li key={model.id} className={styles.card}>
              <div className={styles.head}>
                <span className={styles.icon} aria-hidden="true">AI</span>
                <div className={styles.name}>
                  <code className="ltr">{model.id}</code>
                  <Badge tone={me.billing ? 'accent' : 'success'}>{me.billing ? 'پولی' : 'رایگان'}</Badge>
                </div>
                <CopyButton text={model.id} label={`کپی نام مدل ${model.id}`} variant="ghost" iconOnly />
              </div>
              {me.billing ? (
                <dl className={styles.prices}>
                  <div><dt>ورودی</dt><dd className="num">{formatPrice(model.price.in)}<small> / 1M</small></dd></div>
                  <div><dt>خروجی</dt><dd className="num">{formatPrice(model.price.out)}<small> / 1M</small></dd></div>
                </dl>
              ) : (
                <p className={styles.free}>بدون هزینه‌ی توکن، فقط با سهمیه‌ی روزانه محدود می‌شود.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.cta}>
        <span>آماده‌ای؟ نام مدل را در درخواستت بگذار.</span>
        <Link to="/panel/quickstart"><Button variant="secondary" icon="terminal">دیدن نمونه کد</Button></Link>
      </div>
    </>
  );
};
