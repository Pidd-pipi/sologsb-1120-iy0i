import { computed, unref, type Ref } from 'vue';
import { useReworkStore } from '../stores/reworkStore';
import type { RepairStep } from '../types/step';

/**
 * 交付/返修对工序档案的只读约束：
 * - 未交付：正常维修流程，工序可编辑；
 * - 已交付且保修期内、无未结案返修单：原工序只读，须先建返修单；
 * - 返修单未结案：原工序、测试与交付记录只读，仅返修单名下工序可编辑；
 * - 已过保修期：只能按普通维修建档（工序可编辑，但不能再建返修单）。
 */
export function useReworkGuard(clockId: string | Ref<string>) {
  const reworkStore = useReworkStore();
  const id = computed(() => unref(clockId));

  const deliveries = computed(() => reworkStore.deliveriesByClock(id.value));
  const latestDelivery = computed(() => reworkStore.latestDelivery(id.value));
  const delivered = computed(() => !!latestDelivery.value);
  const inWarranty = computed(() => reworkStore.inWarranty(id.value));
  const openRework = computed(() => reworkStore.openRework(id.value));
  const reworks = computed(() => reworkStore.reworksByClock(id.value));

  /** 某道工序是否只读 */
  function stepLocked(step: RepairStep): boolean {
    if (openRework.value) return step.reworkId !== openRework.value.id;
    return delivered.value && inWarranty.value;
  }

  /** 只读原因（空串表示不锁定） */
  const lockReason = computed(() => {
    if (openRework.value) return `返修单 ${openRework.value.reworkNo} 未结案，原工序、测试与交付记录只读`;
    if (delivered.value && inWarranty.value) return '已交付且仍在保修期内：如需施工请先建返修单，原工序保持只读';
    return '';
  });

  /** 当前是否允许直接追加普通工序（不走返修单） */
  const canAppendNormalStep = computed(() => !delivered.value || !inWarranty.value);

  return {
    deliveries,
    latestDelivery,
    delivered,
    inWarranty,
    openRework,
    reworks,
    stepLocked,
    lockReason,
    canAppendNormalStep,
  };
}
