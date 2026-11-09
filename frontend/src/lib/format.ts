// اعداد و تاریخ: ارقام لاتین (هم‌خوان با مقادیر API)، تقویم جلالی برای تاریخ‌ها.

const numberFormat = new Intl.NumberFormat('en-US');
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
const timeFormat = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { timeStyle: 'medium' });
const dayLabelFormat = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayLongFormat = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { dateStyle: 'full', timeZone: 'UTC' });
const relativeFormat = new Intl.RelativeTimeFormat('fa-u-nu-latn', { numeric: 'auto' });

export const formatNumber = (value: number | null | undefined): string => numberFormat.format(value ?? 0);
export const formatCompact = (value: number): string => compactFormat.format(value);

export const formatUsd = (value: number, digits = 2): string => `$${value.toFixed(digits)}`;

export const formatPercent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

export const formatDate = (unix: number): string => dateFormat.format(new Date(unix * 1000));
export const formatDateTime = (unix: number): string => dateTimeFormat.format(new Date(unix * 1000));
export const formatClock = (unix: number): string => timeFormat.format(new Date(unix * 1000));

export const formatRelative = (unix: number, now = Date.now()): string => {
  const seconds = Math.round(unix - now / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'همین الان';
  if (abs < 3600) return relativeFormat.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relativeFormat.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 30) return relativeFormat.format(Math.round(seconds / 86400), 'day');
  return formatDate(unix);
};

// کلیدهای روزانه‌ی سرور به‌صورت YYYY-MM-DD و به وقت UTC هستند.
export const lastDayKeys = (count: number, now = Date.now()): string[] =>
  Array.from({ length: count }, (_, index) =>
    new Date(now - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );

export const dayLabel = (key: string): string => dayLabelFormat.format(new Date(`${key}T00:00:00Z`));
export const dayLongLabel = (key: string): string => dayLongFormat.format(new Date(`${key}T00:00:00Z`));

export const safeRatio = (part: number, whole: number): number => (whole > 0 ? Math.min(part / whole, 1) : 0);
