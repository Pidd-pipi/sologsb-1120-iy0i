<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useClockStore } from '../stores/clockStore';
import { useReworkStore } from '../stores/reworkStore';
import type { ReworkOrder, ReworkState } from '../types/rework';

const router = useRouter();
const clockStore = useClockStore();
const reworkStore = useReworkStore();

const stateFilter = ref<'all' | ReworkState>('all');
const keyword = ref('');

const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleString('zh-CN') : '—');
const fmtDate = (ts?: number) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—');

const rows = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return reworkStore.reworks
    .map((rw) => {
      const clock = clockStore.byId(rw.clockId);
      const redelivery = reworkStore.deliveries.find((d) => d.reworkId === rw.id);
      return { rw, clock, redelivery };
    })
    .filter(({ rw, clock }) => {
      if (stateFilter.value !== 'all' && rw.state !== stateFilter.value) return false;
      if (kw) {
        const hit =
          rw.reworkNo.toLowerCase().includes(kw) ||
          rw.faultNote.toLowerCase().includes(kw) ||
          (clock?.clockNo.toLowerCase().includes(kw) ?? false) ||
          (clock?.caliber.toLowerCase().includes(kw) ?? false);
        if (!hit) return false;
      }
      return true;
    })
    .sort((a, b) => b.rw.openedAt - a.rw.openedAt);
});

function rowClass({ row }: { row: { rw: ReworkOrder } }) {
  return row.rw.state === 'open' ? 'row-open' : '';
}

onMounted(async () => {
  await clockStore.load();
  await reworkStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>返修档案</h2>
      <el-tag type="warning">返修中 {{ reworkStore.openCount }} 单</el-tag>
      <el-tag type="success" effect="plain">
        已结案 {{ reworkStore.reworks.filter((r) => r.state === 'closed').length }} 单
      </el-tag>
      <div class="spacer" />
      <el-button @click="router.push('/clocks')">返回钟表台账</el-button>
    </div>

    <el-card shadow="never" class="filters">
      <el-form :inline="true" @submit.prevent>
        <el-form-item label="单号/藏品号/机芯">
          <el-input v-model="keyword" placeholder="如 RW-2026 / CLK-1890" clearable style="width: 240px" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="stateFilter" style="width: 130px">
            <el-option label="全部" value="all" />
            <el-option label="返修中" value="open" />
            <el-option label="已结案" value="closed" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <el-table :data="rows" size="small" border :row-class-name="rowClass">
        <el-table-column prop="rw.reworkNo" label="返修单号" width="120" />
        <el-table-column label="钟表" min-width="180">
          <template #default="{ row }">
            <div><strong>{{ row.clock?.clockNo ?? '钟表已删除' }}</strong></div>
            <div class="muted">{{ row.clock?.caliber }} · {{ row.clock?.maker }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="rw.faultNote" label="故障复现" min-width="220" show-overflow-tooltip />
        <el-table-column label="责任判定" width="100">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.rw.responsibility === '修复责任' ? 'danger' : row.rw.responsibility === '待定' ? 'info' : 'warning'"
            >
              {{ row.rw.responsibility }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="登记时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.rw.openedAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.rw.state === 'open'" size="small" type="warning">返修中</el-tag>
            <el-tag v-else size="small" type="success">已结案</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="再次交付时间" width="160">
          <template #default="{ row }">{{ fmtTime(row.rw.redeliveredAt) }}</template>
        </el-table-column>
        <el-table-column label="顺延保修至" width="120">
          <template #default="{ row }">{{ fmtDate(row.redelivery?.warrantyUntil) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="router.push(`/clocks/${row.rw.clockId}`)">
              查看钟表
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="rows.length === 0" description="暂无返修单：保修期内同一故障回来时，在钟表详情页新建" />
    </el-card>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.filters :deep(.el-form-item) {
  margin-bottom: 0;
}
.muted {
  color: #7b8592;
  font-size: 12px;
}
:deep(.row-open) {
  background: #fdf6ec;
}
</style>
