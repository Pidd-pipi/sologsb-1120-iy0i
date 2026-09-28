import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { Delivery, DeliveryDraft } from '../types/delivery';
import type { ReworkOrder, ReworkResponsibility } from '../types/rework';

interface ReworkState {
  deliveries: Delivery[];
  reworks: ReworkOrder[];
  loaded: boolean;
}

/** 生成返修单号：RW-年份-三位序号 */
function nextReworkNo(existing: ReworkOrder[]): string {
  const year = new Date().getFullYear();
  const count = existing.filter((it) => it.reworkNo.startsWith(`RW-${year}-`)).length;
  return `RW-${year}-${String(count + 1).padStart(3, '0')}`;
}

export const useReworkStore = defineStore('rework', {
  state: (): ReworkState => ({ deliveries: [], reworks: [], loaded: false }),
  getters: {
    deliveriesByClock: (state) => (clockId: string) =>
      state.deliveries.filter((it) => it.clockId === clockId).sort((a, b) => b.deliveredAt - a.deliveredAt),
    latestDelivery: (state) => (clockId: string) =>
      state.deliveries
        .filter((it) => it.clockId === clockId)
        .sort((a, b) => b.deliveredAt - a.deliveredAt)[0],
    /** 是否处于保修期内（以最近一次交付为准） */
    inWarranty(): (clockId: string) => boolean {
      return (clockId: string) => {
        const latest = this.latestDelivery(clockId);
        return !!latest && Date.now() <= latest.warrantyUntil;
      };
    },
    reworksByClock: (state) => (clockId: string) =>
      state.reworks.filter((it) => it.clockId === clockId).sort((a, b) => b.openedAt - a.openedAt),
    /** 未结案的返修单（每台钟表同时最多一张） */
    openRework: (state) => (clockId: string) =>
      state.reworks.find((it) => it.clockId === clockId && it.state === 'open'),
    openCount: (state) => state.reworks.filter((it) => it.state === 'open').length,
  },
  actions: {
    async load() {
      const deliveries = await db.deliveries.toArray();
      this.deliveries = deliveries.sort((a, b) => b.deliveredAt - a.deliveredAt);
      const reworks = await db.reworks.toArray();
      this.reworks = reworks.sort((a, b) => b.openedAt - a.openedAt);
      this.loaded = true;
    },
    /** 登记交付：记录领取人与保修截止日 */
    async addDelivery(draft: DeliveryDraft) {
      const record: Delivery = { ...toPlain(draft), id: newId('dlv') };
      await db.deliveries.put(toPlain(record));
      this.deliveries = [record, ...this.deliveries];
      return record;
    },
    /**
     * 新建返修单：仅保修期内可建，继承原钟表与最近一次交付；
     * 原工序、测试与交付记录自此只读。
     */
    async createRework(payload: { clockId: string; faultNote: string; responsibility: ReworkResponsibility }) {
      const latest = this.latestDelivery(payload.clockId);
      if (!latest) throw new Error('该钟表尚未登记交付，无法建返修单');
      if (Date.now() > latest.warrantyUntil) throw new Error('已过保修期，请按普通维修建档');
      if (this.openRework(payload.clockId)) throw new Error('存在未结案的返修单，请先再次交付结案');
      const record: ReworkOrder = {
        id: newId('rwk'),
        reworkNo: nextReworkNo(this.reworks),
        clockId: payload.clockId,
        deliveryId: latest.id,
        faultNote: payload.faultNote,
        responsibility: payload.responsibility,
        openedAt: Date.now(),
        state: 'open',
      };
      await db.reworks.put(toPlain(record));
      this.reworks = [record, ...this.reworks];
      return record;
    },
    /** 未结案前可补充故障复现与责任判定 */
    async updateRework(id: string, patch: Partial<Pick<ReworkOrder, 'faultNote' | 'responsibility'>>) {
      const target = this.reworks.find((it) => it.id === id);
      if (!target || target.state !== 'open') return;
      const plain = toPlain(patch);
      await db.reworks.update(id, plain);
      this.reworks = this.reworks.map((it) => (it.id === id ? { ...it, ...plain } : it));
    },
    /**
     * 再次交付结案：记录再次交付时间，生成新的交付记录并顺延保修。
     */
    async closeRework(payload: { id: string; receiver: string; warrantyUntil: number; note: string }) {
      const target = this.reworks.find((it) => it.id === payload.id);
      if (!target || target.state !== 'open') throw new Error('返修单不存在或已结案');
      const now = Date.now();
      const delivery: Delivery = {
        id: newId('dlv'),
        clockId: target.clockId,
        receiver: payload.receiver,
        deliveredAt: now,
        warrantyUntil: payload.warrantyUntil,
        reworkId: target.id,
        note: payload.note,
      };
      await db.transaction('rw', db.reworks, db.deliveries, async () => {
        await db.reworks.update(target.id, { state: 'closed', redeliveredAt: now });
        await db.deliveries.put(toPlain(delivery));
      });
      this.reworks = this.reworks.map((it) =>
        it.id === target.id ? { ...it, state: 'closed' as const, redeliveredAt: now } : it,
      );
      this.deliveries = [delivery, ...this.deliveries];
      return delivery;
    },
  },
});
