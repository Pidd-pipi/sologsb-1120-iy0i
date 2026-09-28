/** 维修单类型：保修期内返修 / 超保普通维修 */
export type OrderType = 'warranty' | 'paid';

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  warranty: '保修期内返修',
  paid: '普通维修',
};

/** 返修责任判定 */
export type Liability = '店方责任' | '零件质量' | '客人使用不当' | '待定';

export const LIABILITIES: Liability[] = ['店方责任', '零件质量', '客人使用不当', '待定'];

/**
 * 返修 / 维修单。
 * 期内同一故障回来：建 warranty 单，继承原钟表，原工序 / 测试 / 交付记录只读；
 * 超过保修期回来：只能建 paid 单（普通维修建档）。
 */
export interface RepairOrder {
  id: string;
  /** 单据编号，如 FX-20260928-01 / WX-20260928-01 */
  orderNo: string;
  clockId: string;
  type: OrderType;
  /** 故障复现：现象与复现条件 */
  faultDesc: string;
  /** 责任判定 */
  liability: Liability;
  /** 判定说明 */
  liabilityNote: string;
  /** 建单依据的交付记录（保修核验用） */
  prevDeliveryId: string;
  createdBy: string;
  createdAt: number;
  /** 结案（再次交付）时间；未结案为空 */
  closedAt?: number;
  /** 再次交付产生的交付记录 id */
  redeliveryId?: string;
}

/** 交付种类 */
export type DeliveryKind = '首次交付' | '返修交付';

/** 交付记录：交付时登记领取人与保修截止日 */
export interface Delivery {
  id: string;
  clockId: string;
  /** 返修 / 维修单 id；首次交付为空 */
  orderId?: string;
  kind: DeliveryKind;
  /** 交付时间 */
  deliveredAt: number;
  /** 领取人 */
  receiverName: string;
  /** 领取人联系方式（选填） */
  receiverPhone: string;
  /** 本次交付保修月数 */
  warrantyMonths: number;
  /** 保修截止日（含当日） */
  warrantyEndAt: number;
  /** 交付经办人 */
  operator: string;
  note: string;
}
