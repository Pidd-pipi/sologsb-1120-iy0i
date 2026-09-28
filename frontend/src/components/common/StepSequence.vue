<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RepairStep } from '../../types/step';
import { findSeqGaps } from '../../utils/id';
import StateBadge from './StateBadge.vue';

const props = defineProps<{
  items: RepairStep[];
  /** 是否展示上下移动/拖拽排序 */
  sortable?: boolean;
  /** 只读工序 id（交付/返修档案保护，禁止完成、回退与排序） */
  lockedIds?: string[];
}>();

const emit = defineEmits<{
  (e: 'finish', id: string): void;
  (e: 'rollback', id: string): void;
  (e: 'move', payload: { id: string; direction: 'up' | 'down' }): void;
  (e: 'reorder', payload: { fromId: string; toId: string }): void;
}>();

const dragId = ref<string>('');

const locked = computed(() => new Set(props.lockedIds ?? []));

const gaps = computed(() => findSeqGaps(props.items.map((it) => it.seq)));
const conflict = computed(() => gaps.value.length > 0);

function isLocked(id: string): boolean {
  return locked.value.has(id);
}

/** 相邻行被锁定时禁止朝该方向移动（避免交换到只读工序的顺序号） */
function moveDisabled(index: number, direction: 'up' | 'down'): boolean {
  const neighbor = direction === 'up' ? props.items[index - 1] : props.items[index + 1];
  if (!neighbor) return true;
  return isLocked(props.items[index].id) || isLocked(neighbor.id);
}

function onDragStart(id: string) {
  if (isLocked(id)) return;
  dragId.value = id;
}
function onDrop(toId: string) {
  if (isLocked(toId)) {
    dragId.value = '';
    return;
  }
  if (dragId.value && dragId.value !== toId) {
    emit('reorder', { fromId: dragId.value, toId });
  }
  dragId.value = '';
}
</script>

<template>
  <div class="seq-wrap" data-testid="step-sequence">
    <el-alert
      v-if="conflict"
      type="error"
      :closable="false"
      show-icon
      :title="`顺序号存在缺口：${gaps.join('、')}（不得跳号，请用上下移动补齐）`"
      style="margin-bottom: 10px"
    />
    <el-table :data="items" size="small" border>
      <el-table-column label="顺序" width="80">
        <template #default="{ row }">
          <span :class="{ gap: conflict && gaps.includes(row.seq) }">#{{ row.seq }}</span>
        </template>
      </el-table-column>
      <el-table-column label="步骤" width="120">
        <template #default="{ row }">
          {{ row.stepType }}
          <el-tag v-if="row.reworkId" size="small" type="warning" effect="plain">返修</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <StateBadge :state="row.state" />
        </template>
      </el-table-column>
      <el-table-column label="清洗/润滑" min-width="200">
        <template #default="{ row }">
          <div v-if="row.cleanSolvent">清洗液：{{ row.cleanSolvent }}（{{ row.cleanMethod }}）</div>
          <div v-if="row.oilType">油脂：{{ row.oilType }} · 点位 {{ row.oilPoints }}</div>
          <div v-if="row.torque">力矩：{{ row.torque }} N·m</div>
          <div v-if="!row.cleanSolvent && !row.oilType && !row.torque">—</div>
        </template>
      </el-table-column>
      <el-table-column label="异常说明" min-width="160">
        <template #default="{ row }">{{ row.troubleNote || '—' }}</template>
      </el-table-column>
      <el-table-column label="责任人" width="100">
        <template #default="{ row }">{{ row.operator }}</template>
      </el-table-column>
      <el-table-column label="操作" width="250">
        <template #default="{ row, $index }">
          <el-tag v-if="isLocked(row.id)" size="small" type="info" effect="plain">只读存档</el-tag>
          <template v-else>
            <el-button v-if="row.state !== 'done'" size="small" type="primary" @click="emit('finish', row.id)">
              完成
            </el-button>
            <el-button v-else size="small" type="warning" @click="emit('rollback', row.id)">回退</el-button>
            <template v-if="sortable">
              <el-button
                size="small"
                :disabled="moveDisabled($index, 'up')"
                @click="emit('move', { id: row.id, direction: 'up' })"
              >
                上移
              </el-button>
              <el-button
                size="small"
                :disabled="moveDisabled($index, 'down')"
                @click="emit('move', { id: row.id, direction: 'down' })"
              >
                下移
              </el-button>
            </template>
            <span
              class="drag-handle"
              draggable="true"
              title="拖拽到目标行可交换顺序"
              @dragstart="onDragStart(row.id)"
              @dragover.prevent
              @drop="onDrop(row.id)"
              >⣿</span
            >
          </template>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="items.length === 0" description="暂无工序，请到「新建维修工序」登记" />
  </div>
</template>

<style scoped>
.gap {
  color: #d93025;
  font-weight: 700;
}
.drag-handle {
  margin-left: 8px;
  cursor: grab;
  color: #97a0ad;
  user-select: none;
}
</style>
