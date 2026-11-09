export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const KNOWN_MESSAGES: Record<string, string> = {
  'Invalid API key': 'این کلید معتبر نیست یا غیرفعال شده است.',
  'Request from this IP is not allowed': 'این آی‌پی اجازه‌ی دسترسی ندارد.',
  "You can't revoke your only key. Create another one first.":
    'کلید آخرت را نمی‌شود حذف کرد. اول یک کلید جدید بساز.',
  'You can have at most 10 active keys': 'حداکثر 10 کلید فعال می‌توانی داشته باشی.',
  Forbidden: 'توکن ادمین درست نیست.',
  'User not found': 'کاربر پیدا نشد.',
  'Unknown plan': 'پلن انتخاب‌شده وجود ندارد.',
};

const STATUS_MESSAGES: Record<number, string> = {
  401: 'دسترسی مجاز نیست. دوباره وارد شو.',
  403: 'اجازه‌ی این کار را نداری.',
  404: 'موردی پیدا نشد.',
  422: 'اطلاعات واردشده معتبر نیست.',
  429: 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کن.',
};

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };

export const request = async <T>(path: string, token: string | null, options: RequestOptions = {}): Promise<T> => {
  // هدر HTTP فقط ASCII می‌پذیرد؛ توکن با نویسه‌ی فارسی قطعاً نامعتبر است.
  if (token && /[^\x21-\x7E]/.test(token)) throw new ApiError(401, KNOWN_MESSAGES['Invalid API key'] ?? '');
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'اتصال به سرور برقرار نشد. اینترنت را بررسی کن و دوباره تلاش کن.');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const raw = extractMessage(payload);
    const message =
      KNOWN_MESSAGES[raw] ?? (raw || STATUS_MESSAGES[response.status] || `خطای سرور (${response.status})`);
    throw new ApiError(response.status, message);
  }
  return payload as T;
};

const extractMessage = (payload: unknown): string => {
  if (typeof payload !== 'object' || payload === null) return '';
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' ? error.message : '';
};

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'خطای ناشناخته رخ داد.';
