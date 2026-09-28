import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { RepairStep, RepairStepDraft } from '../types/step';
import type { TimekeepingTest, TimekeepingTestDraft } from '../types/test';

interface StepState {
  items: RepairStep[];
  tests: TimekeepingTest[];
  loaded: boolean;
}

/** 该钟表是否已交付：交付后原始工序/测试只读封存 */
async function assertClockNotDelivered(clockId: string): Promise<void> {
  const count = await db.deliveries.where('clockId').equals(clockId).count();
  if (count > 0) {
    throw new Error('该钟表已交付，原始维修档案已封存只读；保修期内请建返修单，超保请建普通维修单');
  }
}

/** 返修单未结案时才可写其名下的工序/测试 */
async function assertOrderOpen(orderId: string): Promise<void> {
  const order = await db.orders.get(orderId);
  if (!order) throw new Error('返修单不存在');
  if (order.closedAt) throw new Error('返修单已结案交付，记录已封存只读');
}

async function assertWritable(step: { clockId: string; orderId?: string }): Promise<void> {
  if (step.orderId) {
    await assertOrderOpen(step.orderId);
  } else {
    await assertClockNotDelivered(step.clockId);
  }
}

export const useStepStore = defineStore('step', {
  state: (): StepState => ({ items: [], tests: [], loaded: false }),
  getters: {
    /** 原始档案工序（不属于任何返修/维修单） */
    byClock: (state) => (clockId: string) =>
      state.items
        .filter((it) => it.clockId === clockId && !it.orderId)
        .sort((a, b) => a.seq - b.seq),
    /** 指定返修/维修单名下的工序 */
    byOrder: (state) => (orderId: string) =>
      state.items.filter((it) => it.orderId === orderId).sort((a, b) => a.seq - b.seq),
    testsByClock: (state) => (clockId: string) =>
      state.tests
        .filter((it) => it.clockId === clockId && !it.orderId)
        .sort((a, b) => b.testedAt - a.testedAt),
    testsByOrder: (state) => (orderId: string) =>
      state.tests.filter((it) => it.orderId === orderId).sort((a, b) => b.testedAt - a.testedAt),
  },
  actions: {
    async load() {
      const steps = await db.steps.toArray();
      steps.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
      this.items = steps;
      const tests = await db.tests.toArray();
      this.tests = tests.sort((a, b) => b.testedAt - a.testedAt);
      this.loaded = true;
    },
    async add(draft: RepairStepDraft) {
      const orderId = draft.orderId;
      if (orderId) {
        await assertOrderOpen(orderId);
      } else {
        await assertClockNotDelivered(draft.clockId);
      }
      const record: RepairStep = { ...toPlain(draft), id: newId('stp') };
      await db.steps.put(toPlain(record));
      this.items = [...this.items, record];
      return record;
    },
    async finish(id: string) {
      const row = this.items.find((it) => it.id === id);
      if (row) await assertWritable(row);
      const patch: Partial<RepairStep> = { state: 'done', finishedAt: Date.now() };
      await db.steps.update(id, patch);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    async rollback(id: string) {
      const row = this.items.find((it) => it.id === id);
      if (row) await assertWritable(row);
      const patch: Partial<RepairStep> = { state: 'rolledback', finishedAt: undefined };
      await db.steps.update(id, patch);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    /** 上下移动排序：交换两个相邻步骤的 seq */
    async swapSeq(aId: string, bId: string) {
      const a = this.items.find((it) => it.id === aId);
      const b = this.items.find((it) => it.id === bId);
      if (!a || !b) return;
      await assertWritable(a);
      await assertWritable(b);
      const aSeq = a.seq;
      await db.steps.update(a.id, { seq: b.seq });
      await db.steps.update(b.id, { seq: aSeq });
      this.items = this.items.map((it) => {
        if (it.id === a.id) return { ...it, seq: b.seq };
        if (it.id === b.id) return { ...it, seq: aSeq };
        return it;
      });
    },
    async addTest(draft: TimekeepingTestDraft) {
      if (draft.orderId) {
        await assertOrderOpen(draft.orderId);
      } else {
        await assertClockNotDelivered(draft.clockId);
      }
      const record: TimekeepingTest = { ...toPlain(draft), id: newId('tst') };
      await db.tests.put(toPlain(record));
      this.tests = [record, ...this.tests];
      return record;
    },
    async removeTest(id: string) {
      const row = this.tests.find((it) => it.id === id);
      if (row) {
        if (row.orderId) await assertOrderOpen(row.orderId);
        else await assertClockNotDelivered(row.clockId);
      }
      await db.tests.delete(id);
      this.tests = this.tests.filter((it) => it.id !== id);
    },
  },
});
