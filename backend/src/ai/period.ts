import { z } from 'zod';

export const PERIODS = ['today', 'last_7_days', 'this_week', 'last_week', 'this_month', 'last_month', 'last_30_days', 'last_90_days', 'all_time'] as const;
export const periodSchema = z.enum(PERIODS);
export type Period = z.infer<typeof periodSchema>;

export interface Range {
  from?: string;
  to?: string;
  label: string;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Resolves a named period to concrete ISO bounds (server local time). `now` is injectable for tests. */
export function resolvePeriod(period: Period | undefined, now = new Date()): Range {
  const today = startOfDay(now);
  const day = 86_400_000;
  switch (period) {
    case 'today':
      return { from: today.toISOString(), to: now.toISOString(), label: 'today' };
    case 'last_7_days':
      return { from: new Date(today.getTime() - 6 * day).toISOString(), to: now.toISOString(), label: 'the last 7 days' };
    case 'this_week': {
      const dow = (today.getDay() + 6) % 7; // Monday = 0
      return { from: new Date(today.getTime() - dow * day).toISOString(), to: now.toISOString(), label: 'this week (since Monday)' };
    }
    case 'last_week': {
      const dow = (today.getDay() + 6) % 7;
      const thisMonday = today.getTime() - dow * day;
      return { from: new Date(thisMonday - 7 * day).toISOString(), to: new Date(thisMonday - 1).toISOString(), label: 'last week' };
    }
    case 'this_month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: now.toISOString(), label: 'this month' };
    case 'last_month':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
        to: new Date(new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1).toISOString(),
        label: 'last month',
      };
    case 'last_30_days':
      return { from: new Date(today.getTime() - 29 * day).toISOString(), to: now.toISOString(), label: 'the last 30 days' };
    case 'last_90_days':
      return { from: new Date(today.getTime() - 89 * day).toISOString(), to: now.toISOString(), label: 'the last 90 days' };
    default:
      return { label: 'all time' };
  }
}
