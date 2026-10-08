import { describe, it, expect } from 'vitest';
import { getTodayIST, computeExtendedDueDate } from './dates.js';

describe('Date Utilities in Asia/Kolkata (utils/dates.js)', () => {
  it('correctly handles IST midnight rollover when UTC is still the previous day', () => {
    // 2026-10-07 at 18:45 UTC = 2026-10-08 at 00:15 AM IST (next day in India)
    const lateUtcDate = new Date('2026-10-07T18:45:00.000Z');
    const todayIST = getTodayIST(lateUtcDate);

    expect(todayIST).toBe('2026-10-08');
  });

  it('computes extension from today for an already-overdue invoice', () => {
    // Today in IST: 2026-10-08
    const mockNow = new Date('2026-10-08T06:00:00.000Z');
    // Invoice was due on 2026-09-15 (23 days overdue)
    const overdueDueDate = '2026-09-15';

    // 7-day extension from today (2026-10-08 + 7 days = 2026-10-15)
    const newDueDate = computeExtendedDueDate(overdueDueDate, 7, mockNow);
    expect(newDueDate).toBe('2026-10-15');
  });

  it('computes extension from future due date when invoice is not yet due', () => {
    // Today in IST: 2026-10-08
    const mockNow = new Date('2026-10-08T06:00:00.000Z');
    // Invoice due in the future on 2026-10-20
    const futureDueDate = '2026-10-20';

    // 7-day extension from future due date (2026-10-20 + 7 days = 2026-10-27)
    const newDueDate = computeExtendedDueDate(futureDueDate, 7, mockNow);
    expect(newDueDate).toBe('2026-10-27');
  });
});
