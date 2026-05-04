export function formatDate(date: Date): string {
  return date.toISOString();
}

export function parseDate(dateStr: string): Date {
  return new Date(dateStr);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const logger = {
  info: (message: string, ...args: unknown[]) =>
    console.log(`[INFO] ${message}`, ...args),
  warn: (message: string, ...args: unknown[]) =>
    console.warn(`[WARN] ${message}`, ...args),
  error: (message: string, ...args: unknown[]) =>
    console.error(`[ERROR] ${message}`, ...args),
  debug: (message: string, ...args: unknown[]) =>
    console.debug(`[DEBUG] ${message}`, ...args),
};
