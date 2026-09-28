import { computed, unref, type Ref } from 'vue';
import { useStepStore } from '../stores/stepStore';
import { findSeqGaps } from '../utils/id';
import type { RepairStep } from '../types/step';

export interface RepairProgress {
  steps: RepairStep[];
  total: number;
  done: number;
  rolledback: number;
  percent: number;
  /** 当前卡点步骤 */
  current: RepairStep | undefined;
  /** 顺序号缺口 */
  gaps: number[];
}

/**
 * 统计某台钟表的工序完成比例与当前卡点步骤。
 * 被钟表详情页与工序录入页消费。
 * 传 orderId 时只统计该返修/维修单名下的工序；否则只统计原始档案工序。
 */
export function useRepairProgress(
  clockId: string | Ref<string>,
  orderId?: string | Ref<string | undefined>,
) {
  const stepStore = useStepStore();
  const id = computed(() => unref(clockId));
  const scope = computed(() => (orderId === undefined ? undefined : unref(orderId)));

  const steps = computed(() =>
    stepStore.items
      .filter((it) => {
        if (it.clockId !== id.value) return false;
        return scope.value ? it.orderId === scope.value : !it.orderId;
      })
      .sort((a, b) => a.seq - b.seq),
  );
  const total = computed(() => steps.value.length);
  const done = computed(() => steps.value.filter((it) => it.state === 'done').length);
  const rolledback = computed(() => steps.value.filter((it) => it.state === 'rolledback').length);
  const percent = computed(() => (total.value === 0 ? 0 : Math.round((done.value / total.value) * 100)));
  const current = computed(() => steps.value.find((it) => it.state !== 'done'));
  const gaps = computed(() => findSeqGaps(steps.value.map((it) => it.seq)));

  const progress = computed<RepairProgress>(() => ({
    steps: steps.value,
    total: total.value,
    done: done.value,
    rolledback: rolledback.value,
    percent: percent.value,
    current: current.value,
    gaps: gaps.value,
  }));

  return { progress, steps, total, done, rolledback, percent, current, gaps };
}
