/** 责任判定 */
export type ReworkResponsibility = '待定' | '修复责任' | '使用不当' | '自然老化';

export const REWORK_RESPONSIBILITIES: ReworkResponsibility[] = [
  '待定',
  '修复责任',
  '使用不当',
  '自然老化',
];

/** 返修单状态 */
export type ReworkState = 'open' | 'closed';

/** 返修单：保修期内同一故障回来时建档，继承原钟表，原工序/测试/交付记录保持只读 */
export interface ReworkOrder {
  id: string;
  /** 返修单号，如 RW-2026-001 */
  reworkNo: string;
  clockId: string;
  /** 基于的交付记录 */
  deliveryId: string;
  /** 故障复现 */
  faultNote: string;
  /** 责任判定 */
  responsibility: ReworkResponsibility;
  /** 登记时间 */
  openedAt: number;
  state: ReworkState;
  /** 再次交付时间（结案时间） */
  redeliveredAt?: number;
}

export type ReworkDraft = Omit<ReworkOrder, 'id'>;
