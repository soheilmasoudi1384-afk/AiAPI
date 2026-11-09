import { useState } from 'react';
import { Card } from '../../components/Card';
import { CodeBlock } from '../../components/CodeBlock';
import { CopyButton } from '../../components/CopyButton';
import { DataTable, type Column } from '../../components/DataTable';
import { Field, Select } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { Segmented } from '../../components/Segmented';
import { useUserSession } from '../../lib/sessions';
import styles from './QuickstartPage.module.css';

type Lang = 'python' | 'node' | 'curl';

const LANGS: { value: Lang; label: string }[] = [
  { value: 'python', label: 'Python' },
  { value: 'node', label: 'Node.js' },
  { value: 'curl', label: 'curl' },
];

const snippet = (lang: Lang, base: string, model: string): { code: string; language: string } => {
  if (lang === 'python') {
    return {
      language: 'python',
      code: `# pip install openai
from openai import OpenAI

client = OpenAI(base_url="${base}", api_key="YOUR_API_KEY")

response = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "سلام!"}],
)
print(response.choices[0].message.content)`,
    };
  }
  if (lang === 'node') {
    return {
      language: 'javascript',
      code: `// npm install openai
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}", apiKey: "YOUR_API_KEY" });

const response = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "سلام!" }],
});
console.log(response.choices[0].message.content);`,
    };
  }
  return {
    language: 'bash',
    code: `curl ${base}/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${model}", "messages": [{"role": "user", "content": "سلام!"}]}'`,
  };
};

type ErrorRow = { code: string; meaning: string; action: string };

const ERRORS: ErrorRow[] = [
  { code: '401', meaning: 'کلید معتبر نیست یا غیرفعال شده', action: 'کلید را در همین پنل بررسی یا کلید جدید بساز.' },
  { code: '402', meaning: 'اعتبار کافی نیست', action: 'برای شارژ حساب با مدیر سرویس تماس بگیر.' },
  { code: '403', meaning: 'این آی‌پی مجاز نیست', action: 'آی‌پی سرورت باید در فهرست مجاز حساب باشد.' },
  { code: '429', meaning: 'سقف درخواست در دقیقه یا سهمیه‌ی روزانه', action: 'کمی صبر کن و دوباره بفرست (هدر Retry-After).' },
];

const ERROR_COLUMNS: Column<ErrorRow>[] = [
  { id: 'code', header: 'کد', width: '80px', cell: (row) => <span className={`ltr ${styles.code}`}>{row.code}</span> },
  { id: 'meaning', header: 'معنی', cell: (row) => row.meaning },
  { id: 'action', header: 'چه کنم؟', cell: (row) => row.action },
];

export const QuickstartPage = () => {
  const { info: me } = useUserSession();
  const [lang, setLang] = useState<Lang>('python');
  const [model, setModel] = useState(me.models[0]?.id ?? 'my-ai');
  const base = `${location.origin}/v1`;
  const { code, language } = snippet(lang, base, model);

  return (
    <>
      <PageHeader title="شروع سریع" description="با SDK رسمی OpenAI کار می‌کند؛ فقط آدرس پایه و کلید را عوض کن." />

      <div className={styles.layout}>
        <div className={styles.column}>
          <Card title="نمونه کد" actions={<Segmented label="زبان" options={LANGS} value={lang} onChange={setLang} />}>
            <div className={styles.stack}>
              {me.models.length > 1 && (
                <div className={styles.modelPick}>
                  <Field label="مدل">
                    <Select value={model} onChange={(event) => setModel(event.target.value)} className="ltr">
                      {me.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
                    </Select>
                  </Field>
                </div>
              )}
              <CodeBlock code={code} language={language} />
              <p className={styles.note}>
                به‌جای <span className="ltr">YOUR_API_KEY</span> یکی از کلیدهایت را بگذار. کلید را داخل کد فرانت‌اند نگذار.
              </p>
            </div>
          </Card>

          <Card flush title="کدهای خطا" description="اگر درخواست رد شد، این جدول معنی‌اش را می‌گوید">
            <DataTable caption="کدهای خطای رایج" columns={ERROR_COLUMNS} rows={ERRORS} rowKey={(row) => row.code} />
          </Card>
        </div>

        <aside className={styles.column}>
          <Card title="آدرس‌ها">
            <dl className={styles.endpoints}>
              <div>
                <dt>آدرس پایه (base_url)</dt>
                <dd><code className="ltr">{base}</code><CopyButton text={base} label="کپی آدرس پایه" variant="ghost" iconOnly /></dd>
              </div>
              <div>
                <dt>Chat Completions</dt>
                <dd><code className="ltr">POST /v1/chat/completions</code></dd>
              </div>
              <div>
                <dt>فهرست مدل‌ها</dt>
                <dd><code className="ltr">GET /v1/models</code></dd>
              </div>
            </dl>
          </Card>
          <Card title="نکته‌ها">
            <ul className={styles.tips}>
              <li><b>استریم:</b> با <span className="ltr">stream: true</span> پاسخ تکه‌تکه می‌رسد.</li>
              <li><b>سقف پاسخ:</b> حداکثر <span className="num">{me.limits.max_tokens.toLocaleString('en-US')}</span> توکن برای هر پاسخ.</li>
              <li><b>کش:</b> درخواست غیراستریم با <span className="ltr">temperature: 0</span> ممکن است از کش جواب بگیرد.</li>
              <li>مستندات کامل: <a href="/docs">Swagger / OpenAPI</a></li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
};
