import type { ReactNode } from 'react';
import styles from './Charts.module.css';

/** بالاترین مقدار محور را به عددی «گرد» می‌رساند: 1، 2، 2.5، 5 یا 10 ضرب در توان ده. */
export const niceMax = (value: number): number => {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return step * base;
};

export type Series = { name: string; tone: 'primary' | 'secondary' };

export type ChartDatum = {
  key: string;
  label: string;
  title: string;
  values: number[];
};

type BarChartProps = {
  data: ChartDatum[];
  series: Series[];
  formatValue: (value: number) => string;
  formatAxis?: (value: number) => string;
  height?: number;
  summary: string;
};

/** نمودار ستونی (انباشته) با HTML/CSS: سبک، واکنش‌گرا و قابل‌دسترس. */
export const BarChart = ({ data, series, formatValue, formatAxis = formatValue, height = 220, summary }: BarChartProps) => {
  const max = niceMax(Math.max(...data.map((datum) => datum.values.reduce((a, b) => a + b, 0)), 0));
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => ratio * max);
  const rtl = document.documentElement.dir === 'rtl';

  return (
    <figure className={styles.figure}>
      <figcaption className="sr-only">{summary}</figcaption>
      <div className={styles.chart} style={{ height }} role="img" aria-label={summary}>
        <div className={styles.axis} aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className="num">{formatAxis(tick)}</span>
          ))}
        </div>
        <div className={styles.plot}>
          <div className={styles.grid} aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick} />
            ))}
          </div>
          <div className={styles.columns} style={{ ['--count' as string]: data.length }}>
            {data.map((datum, index) => {
              const total = datum.values.reduce((a, b) => a + b, 0);
              const physicalIndex = rtl ? data.length - 1 - index : index;
              const edge = physicalIndex === 0 ? styles.edgeLeft : physicalIndex === data.length - 1 ? styles.edgeRight : '';
              return (
                <div key={datum.key} className={styles.column} tabIndex={0} aria-label={`${datum.title}: ${formatValue(total)}`}>
                  <div className={styles.stack} style={{ height: `${(total / max) * 100}%` }}>
                    {datum.values.map((value, seriesIndex) =>
                      value > 0 ? (
                        <span
                          key={seriesIndex}
                          className={`${styles.segment} ${styles[series[seriesIndex]?.tone ?? 'primary']}`}
                          style={{ flexGrow: value }}
                        />
                      ) : null,
                    )}
                    {total === 0 && <span className={styles.stub} />}
                  </div>
                  <div className={`${styles.tooltip} ${edge}`} role="presentation">
                    <strong>{datum.title}</strong>
                    {series.map((item, seriesIndex) => (
                      <span key={item.name} className={styles.tipRow}>
                        <i className={`${styles.swatch} ${styles[item.tone]}`} />
                        {item.name}
                        <b className="num">{formatValue(datum.values[seriesIndex] ?? 0)}</b>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className={styles.labels} aria-hidden="true">
        <span className={styles.axisSpacer} />
        <div className={styles.labelRow} style={{ ['--count' as string]: data.length }}>
          {data.map((datum, index) => (
            <span key={datum.key} className={data.length > 14 && index % Math.ceil(data.length / 10) !== 0 ? styles.hidden : undefined}>
              {datum.label}
            </span>
          ))}
        </div>
      </div>
      {series.length > 1 && (
        <figcaption className={styles.legend}>
          {series.map((item) => (
            <span key={item.name}>
              <i className={`${styles.swatch} ${styles[item.tone]}`} />
              {item.name}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
};

type RingProps = { ratio: number; tone: 'ok' | 'warn' | 'full'; size?: number; children?: ReactNode; label: string };

/** حلقه‌ی درصد مصرف. رنگ + عدد وسط، پس فقط به رنگ متکی نیست. */
export const Ring = ({ ratio, tone, size = 132, children, label }: RingProps) => {
  const stroke = 11;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className={styles.ring} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className={styles.ringTrack} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={`${styles.ringValue} ${styles[tone]}`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(Math.max(ratio, 0), 1))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className={styles.ringCenter}>{children}</div>
    </div>
  );
};

type MeterProps = { ratio: number; tone?: 'ok' | 'warn' | 'full'; label: string };

export const Meter = ({ ratio, tone = 'ok', label }: MeterProps) => (
  <div className={styles.meter} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
    <span className={`${styles.meterFill} ${styles[tone]}`} style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 2 : 0)}%` }} />
  </div>
);

type ShareItem = { key: string; label: string; value: number; display: string; note?: string };

/** فهرست افقی با سهم هر مورد از کل، برای «مصرف به تفکیک مدل». */
export const ShareList = ({ items, mono = true }: { items: ShareItem[]; mono?: boolean }) => {
  const max = Math.max(...items.map((item) => item.value), 0);
  return (
    <ul className={styles.share}>
      {items.map((item) => (
        <li key={item.key}>
          <div className={styles.shareHead}>
            <span className={mono ? 'ltr' : undefined}>{item.label}</span>
            <span className="num">
              <b>{item.display}</b>
              {item.note && <small>{item.note}</small>}
            </span>
          </div>
          <Meter ratio={max > 0 ? item.value / max : 0} label={`${item.label}: ${item.display}`} />
        </li>
      ))}
    </ul>
  );
};
