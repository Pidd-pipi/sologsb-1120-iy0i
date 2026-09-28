/** 交付记录（每次交付/再次交付各一条，追加式只增不改） */
export interface Delivery {
  id: string;
  clockId: string;
  /** 领取人 */
  receiver: string;
  /** 交付时间 */
  deliveredAt: number;
  /** 保修截止日 */
  warrantyUntil: number;
  /** 关联返修单（再次交付时回填，首次交付为空） */
  reworkId?: string;
  note: string;
}

export type DeliveryDraft = Omit<Delivery, 'id'>;
