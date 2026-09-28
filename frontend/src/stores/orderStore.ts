import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { Delivery, Liability, OrderType, RepairOrder } from '../types/order';
import {
  DEFAULT_PAID_WARRANTY_MONTHS,
  DEFAULT_WARRANTY_MONTHS,
  extendWarranty,
  isWithinWarranty,
  warrantyEndOf,
} from '../utils/warranty';

interface OrderState {
  items: RepairOrder[];
  deliveries: Delivery[];
  loaded: boolean;
}

export interface CreateOrderInput {
  clockId: string;
  type: OrderType;
  faultDesc: string;
  liability: Liability;
  liabilityNote: string;
  createdBy: string;
}

export interface FirstDeliveryInput {
  clockId: string;
  deliveredAt: number;
  receiverName: string;
  receiverPhone: string;
  warrantyMonths: number;
  operator: string;
  note: string;
}

export interface RedeliveryInput {
  orderId: string;
  deliveredAt: number;
  receiverName: string;
  receiverPhone: string;
  /** 普通维修单：再次交付后的新保修月数；保修返修单忽略此项（顺延原保修） */
  warrantyMonths: number;
  operator: string;
  note: string;
}

function todayCode(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${m}${day}`;
}

export const useOrderStore = defineStore('order', {
  state: (): OrderState => ({ items: [], deliveries: [], loaded: false }),
  getters: {
    /** 钟表最近一次交付（按交付时间倒序） */
    latestDelivery: (state) => (clockId: string) =>
      state.deliveries
        .filter((d) => d.clockId === clockId)
        .sort((a, b) => b.deliveredAt - a.deliveredAt)[0],
    deliveriesByClock: (state) => (clockId: string) =>
      state.deliveries
        .filter((d) => d.clockId === clockId)
        .sort((a, b) => b.deliveredAt - a.deliveredAt),
    byClock: (state) => (clockId: string) =>
      state.items
        .filter((o) => o.clockId === clockId)
        .sort((a, b) => b.createdAt - a.createdAt),
    byId: (state) => (id: string) => state.items.find((o) => o.id === id),
    openOrderByClock: (state) => (clockId: string) =>
      state.items.find((o) => o.clockId === clockId && !o.closedAt),
    hasDelivery: (state) => (clockId: string) => state.deliveries.some((d) => d.clockId === clockId),
    /** 台账状态：有未结案单据的钟表及其单据类型 */
    openOrdersMap: (state) => {
      const map = new Map<string, RepairOrder>();
      state.items
        .filter((o) => !o.closedAt)
        .sort((a, b) => b.createdAt - a.createdAt)
        .forEach((o) => {
          if (!map.has(o.clockId)) map.set(o.clockId, o);
        });
      return map;
    },
  },
  actions: {
    async load() {
      this.items = await db.orders.orderBy('createdAt').reverse().toArray();
      this.deliveries = await db.deliveries.orderBy('deliveredAt').reverse().toArray();
      this.loaded = true;
    },

    /** 建返修/维修单；保修期校验与唯一性约束在此强制 */
    async createOrder(input: CreateOrderInput): Promise<RepairOrder> {
      if (!input.faultDesc.trim()) throw new Error('请填写故障复现情况');
      if (!input.createdBy.trim()) throw new Error('请填写接修人');

      const existing = await db.orders
        .where('clockId')
        .equals(input.clockId)
        .filter((o) => !o.closedAt)
        .first();
      if (existing) {
        throw new Error(`该钟表存在未结案单据 ${existing.orderNo}，请先结案交付`);
      }

      const deliveries = await db.deliveries
        .where('clockId')
        .equals(input.clockId)
        .sortBy('deliveredAt');
      const latest = deliveries[deliveries.length - 1];

      if (input.type === 'warranty') {
        if (!latest) throw new Error('该钟表尚未交付，没有保修期；请直接在原档案上维修');
        if (!isWithinWarranty(latest)) {
          throw new Error('已超过保修截止日，不能按保修返修建档，只能建普通维修单');
        }
      }
      if (input.type === 'paid' && !latest) {
        throw new Error('该钟表尚未交付，首次维修请直接在原档案登记工序');
      }

      const prefix = input.type === 'warranty' ? 'FX' : 'WX';
      const seqNo = String(
        this.items.filter((o) => o.orderNo.startsWith(`${prefix}-${todayCode()}`)).length + 1,
      ).padStart(2, '0');
      const record: RepairOrder = {
        id: newId('ord'),
        orderNo: `${prefix}-${todayCode()}-${seqNo}`,
        clockId: input.clockId,
        type: input.type,
        faultDesc: input.faultDesc.trim(),
        liability: input.liability,
        liabilityNote: input.liabilityNote.trim(),
        prevDeliveryId: latest?.id ?? '',
        createdBy: input.createdBy.trim(),
        createdAt: Date.now(),
      };
      await db.orders.put(toPlain(record));
      this.items = [record, ...this.items];
      return record;
    },

    /** 首次交付：登记领取人与保修截止日；交付后原档案只读 */
    async registerDelivery(input: FirstDeliveryInput): Promise<Delivery> {
      if (!input.receiverName.trim()) throw new Error('请填写领取人');
      if (!input.operator.trim()) throw new Error('请填写交付经办人');
      if (input.warrantyMonths <= 0) throw new Error('保修月数必须大于 0');
      if (await this.hasDelivery(input.clockId)) {
        throw new Error('该钟表已有交付记录，不能重复首次交付');
      }
      const openOrder = await db.orders
        .where('clockId')
        .equals(input.clockId)
        .filter((o) => !o.closedAt)
        .first();
      if (openOrder) throw new Error('该钟表有未结案返修单，应在返修单上再次交付');

      const record: Delivery = {
        id: newId('dlv'),
        clockId: input.clockId,
        kind: '首次交付',
        deliveredAt: input.deliveredAt,
        receiverName: input.receiverName.trim(),
        receiverPhone: input.receiverPhone.trim(),
        warrantyMonths: input.warrantyMonths,
        warrantyEndAt: warrantyEndOf(input.deliveredAt, input.warrantyMonths),
        operator: input.operator.trim(),
        note: input.note.trim(),
      };
      await db.deliveries.put(toPlain(record));
      this.deliveries = [record, ...this.deliveries];
      return record;
    },

    /** 返修单结案再次交付：保修返修顺延保修，普通维修重新计算保修 */
    async redeliver(input: RedeliveryInput): Promise<Delivery> {
      if (!input.receiverName.trim()) throw new Error('请填写领取人');
      if (!input.operator.trim()) throw new Error('请填写交付经办人');

      const order = await db.orders.get(input.orderId);
      if (!order) throw new Error('返修单不存在');
      if (order.closedAt) throw new Error('该单据已结案');

      const undone = await db.steps
        .where('orderId')
        .equals(order.id)
        .filter((s) => s.state !== 'done')
        .count();
      if (undone > 0) throw new Error(`还有 ${undone} 道返修工序未完成，不能再次交付`);

      const prev = await db.deliveries.get(order.prevDeliveryId);
      const months = order.type === 'paid' ? input.warrantyMonths : 0;
      if (order.type === 'paid' && months <= 0) {
        throw new Error('普通维修交付的保修月数必须大于 0');
      }

      const delivery: Delivery = {
        id: newId('dlv'),
        clockId: order.clockId,
        orderId: order.id,
        kind: '返修交付',
        deliveredAt: input.deliveredAt,
        receiverName: input.receiverName.trim(),
        receiverPhone: input.receiverPhone.trim(),
        warrantyMonths: order.type === 'warranty' ? prev?.warrantyMonths ?? 0 : months,
        warrantyEndAt:
          order.type === 'warranty' && prev
            ? extendWarranty(prev.warrantyEndAt, order.createdAt, input.deliveredAt)
            : warrantyEndOf(input.deliveredAt, months),
        operator: input.operator.trim(),
        note: input.note.trim(),
      };

      const closedAt = input.deliveredAt;
      await db.transaction('rw', db.deliveries, db.orders, async () => {
        await db.deliveries.put(toPlain(delivery));
        await db.orders.update(order.id, { closedAt, redeliveryId: delivery.id });
      });
      this.deliveries = [delivery, ...this.deliveries];
      this.items = this.items.map((o) =>
        o.id === order.id ? { ...o, closedAt, redeliveryId: delivery.id } : o,
      );
      return delivery;
    },
  },
});

export { DEFAULT_WARRANTY_MONTHS, DEFAULT_PAID_WARRANTY_MONTHS };
