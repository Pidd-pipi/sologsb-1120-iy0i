import type { Delivery } from '../types/order';

/** 默认保修月数：首次交付 6 个月，普通维修后 3 个月 */
export const DEFAULT_WARRANTY_MONTHS = 6;
export const DEFAULT_PAID_WARRANTY_MONTHS = 3;

const DAY_MS = 24 * 3600 * 1000;

/** 取某天 00:00:00 */
export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 取某天 23:59:59.999 */
export function endOfDay(t: number): number {
  return startOfDay(t) + DAY_MS - 1;
}

/** 加 n 个月（按自然月，日期溢出则落到当月最后一天，如 1/31 + 1 月 = 2/28） */
export function addMonths(t: number, months: number): number {
  const d = new Date(t);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  // 回到目标日；若该月没有这一天（溢出到下个月），则取当月最后一天
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return d.getTime();
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** 由交付日与保修月数计算保修截止日（含当日，按 23:59:59 计） */
export function warrantyEndOf(deliveredAt: number, months: number): number {
  return endOfDay(addMonths(startOfDay(deliveredAt), months));
}

/** 保修顺延：返修占用的天数加回原保修截止日 */
export function extendWarranty(prevWarrantyEndAt: number, orderCreatedAt: number, redeliveredAt: number): number {
  const start = startOfDay(orderCreatedAt);
  const end = startOfDay(redeliveredAt);
  const usedDays = Math.max(0, Math.round((end - start) / DAY_MS) + 1);
  return endOfDay(prevWarrantyEndAt) + usedDays * DAY_MS;
}

/** 某时间点是否在保修期内（含截止日当天） */
export function isWithinWarranty(delivery: Delivery | undefined, at: number = Date.now()): boolean {
  return !!delivery && startOfDay(at) <= endOfDay(delivery.warrantyEndAt);
}

/** 距保修截止还剩多少天（已过保为负数，截止当天为 0） */
export function warrantyDaysLeft(delivery: Delivery, at: number = Date.now()): number {
  return Math.round((startOfDay(delivery.warrantyEndAt) - startOfDay(at)) / DAY_MS);
}

/** yyyy-MM-dd */
export function formatDate(t: number): string {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
