export const currency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);

export const parseDateValue = (value: unknown) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const directDate = new Date(value);
    return Number.isNaN(directDate.getTime()) ? null : directDate;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      const milliseconds = trimmed.length <= 10 ? numeric * 1000 : numeric;
      const numericDate = new Date(milliseconds);
      return Number.isNaN(numericDate.getTime()) ? null : numericDate;
    }

    const parsedDate = new Date(trimmed);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }

  return null;
};

export const getTimestamp = (value: unknown) => parseDateValue(value)?.getTime() ?? 0;

export const formatDate = (
  value: unknown,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
) => {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return 'Time unavailable';
  }

  return new Intl.DateTimeFormat('en-US', options).format(parsed);
};

export const formatReadableDateTime = (value: unknown) =>
  formatDate(value, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const isDateLikeKey = (key: string) =>
  /(^|_)(created|updated|occurred|expires|locked)_at$/i.test(key) ||
  /(Created|Updated|Occurred|Expires|Locked)At$/.test(key);
