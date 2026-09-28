<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { useStepStore } from '../stores/stepStore';
import { useOrderStore } from '../stores/orderStore';
import { useRepairProgress } from '../hooks/useRepairProgress';
import StepSequence from '../components/common/StepSequence.vue';
import RateChart from '../components/common/RateChart.vue';
import { ORDER_TYPE_LABEL } from '../types/order';
import { judgeTest } from '../types/test';
import {
  DEFAULT_PAID_WARRANTY_MONTHS,
  extendWarranty,
  formatDate,
} from '../utils/warranty';

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const stepStore = useStepStore();
const orderStore = useOrderStore();

const orderId = computed(() => String(route.params.id ?? ''));
const order = computed(() => orderStore.byId(orderId.value));
const clock = computed(() => (order.value ? clockStore.byId(order.value.clockId) : undefined));

const { steps, done, total, percent, current, gaps } = useRepairProgress(
  computed(() => order.value?.clockId ?? ''),
  orderId,
);
const orderTests = computed(() =>
  order.value ? stepStore.testsByOrder(order.value.id) : [],
);
const originalSteps = computed(() =>
  order.value ? stepStore.byClock(order.value.clockId) : [],
);
const originalTests = computed(() =>
  order.value ? stepStore.testsByClock(order.value.clockId) : [],
);
const prevDelivery = computed(() =>
  order.value
    ? orderStore.deliveries.find((d) => d.id === order.value!.prevDeliveryId)
    : undefined,
);
const redelivery = computed(() =>
  order.value?.redeliveryId
    ? orderStore.deliveries.find((d) => d.id === order.value!.redeliveryId)
    : undefined,
);

/* ---------------- 再次交付 ---------------- */
const closeVisible = ref(false);
const closeForm = reactive({
  deliveredDate: Date.now(),
  receiverName: '',
  receiverPhone: '',
  warrantyMonths: DEFAULT_PAID_WARRANTY_MONTHS,
  operator: '',
  note: '',
});

function openClose() {
  closeForm.deliveredDate = Date.now();
  closeForm.receiverName = prevDelivery.value?.receiverName ?? '';
  closeForm.receiverPhone = prevDelivery.value?.receiverPhone ?? '';
  closeForm.warrantyMonths = DEFAULT_PAID_WARRANTY_MONTHS;
  closeForm.operator = order.value?.createdBy ?? '';
  closeForm.note = '';
  closeVisible.value = true;
}

/** 保修顺延预览 */
const extendedEnd = computed(() => {
  if (!order.value || order.value.type !== 'warranty' || !prevDelivery.value) return 0;
  return extendWarranty(
    prevDelivery.value.warrantyEndAt,
    order.value.createdAt,
    closeForm.deliveredDate,
  );
});

async function submitClose() {
  try {
    const delivery = await orderStore.redeliver({
      orderId: orderId.value,
      deliveredAt: closeForm.deliveredDate,
      receiverName: closeForm.receiverName,
      receiverPhone: closeForm.receiverPhone,
      warrantyMonths: closeForm.warrantyMonths,
      operator: closeForm.operator,
      note: closeForm.note,
    });
    closeVisible.value = false;
    ElMessage.success(
      order.value?.type === 'warranty'
        ? `已再次交付，保修顺延至 ${formatDate(delivery.warrantyEndAt)}`
        : `已再次交付，新保修至 ${formatDate(delivery.warrantyEndAt)}`,
    );
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

async function finish(id: string) {
  try {
    await stepStore.finish(id);
    ElMessage.success('返修工序已完成');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
async function rollback(id: string) {
  try {
    await stepStore.rollback(id);
    ElMessage.warning('步骤已回退');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
async function move(payload: { id: string; direction: 'up' | 'down' }) {
  const list = steps.value;
  const index = list.findIndex((it) => it.id === payload.id);
  const target = payload.direction === 'up' ? list[index - 1] : list[index + 1];
  if (!target) return;
  try {
    await stepStore.swapSeq(payload.id, target.id);
    ElMessage.success('顺序已调整');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}
async function reorder(payload: { fromId: string; toId: string }) {
  try {
    await stepStore.swapSeq(payload.fromId, payload.toId);
    ElMessage.success('已按拖拽交换顺序');
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

onMounted(async () => {
  await clockStore.load();
  await stepStore.load();
  await orderStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>返修档案 · {{ order?.orderNo ?? '未找到' }}</h2>
      <el-tag v-if="order" :type="order.type === 'warranty' ? 'warning' : 'info'">
        {{ ORDER_TYPE_LABEL[order.type] }}
      </el-tag>
      <el-tag v-if="order?.closedAt" type="success">已结案 · 再次交付</el-tag>
      <el-tag v-else type="danger">返修中（台账标记）</el-tag>
      <div class="spacer" />
      <el-button @click="clock && router.push(`/clocks/${clock.id}`)">返回钟表详情</el-button>
    </div>

    <el-alert
      v-if="!order"
      type="warning"
      :closable="false"
      title="未找到该返修单（可能已被删除）"
      show-icon
    />

    <template v-if="order && clock">
      <el-alert
        title="本单据继承原钟表；原工序、走时测试与历次交付记录保持只读，返修工序与测试单独登记，不覆盖首次完工与师傅记录"
        type="info"
        :closable="false"
        show-icon
      />

      <div class="grid">
        <!-- 左列：单据信息 + 原档案只读 -->
        <div class="left">
          <el-card shadow="never">
            <template #header><strong>单据信息</strong></template>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="单据编号">{{ order.orderNo }}</el-descriptions-item>
              <el-descriptions-item label="继承钟表">
                {{ clock.clockNo }} · {{ clock.caliber }}
              </el-descriptions-item>
              <el-descriptions-item label="建单时间">
                {{ new Date(order.createdAt).toLocaleString('zh-CN') }}
              </el-descriptions-item>
              <el-descriptions-item label="接修人">{{ order.createdBy }}</el-descriptions-item>
              <el-descriptions-item label="责任判定">
                <el-tag size="small" :type="order.liability === '店方责任' ? 'danger' : 'info'">
                  {{ order.liability }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="判定说明">{{ order.liabilityNote || '—' }}</el-descriptions-item>
              <el-descriptions-item label="再次交付时间">
                {{ order.closedAt ? new Date(order.closedAt).toLocaleString('zh-CN') : '未结案' }}
              </el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <strong>故障复现</strong>
                <el-tag size="small" type="info">建单登记</el-tag>
              </div>
            </template>
            <div class="fault">{{ order.faultDesc }}</div>
          </el-card>

          <el-card v-if="prevDelivery" shadow="never">
            <template #header>
              <div class="card-head">
                <strong>保修依据 · {{ prevDelivery.kind }}</strong>
                <el-tag size="small" type="info">只读</el-tag>
              </div>
            </template>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="交付时间">
                {{ new Date(prevDelivery.deliveredAt).toLocaleString('zh-CN') }}
              </el-descriptions-item>
              <el-descriptions-item label="领取人">
                {{ prevDelivery.receiverName }}<template v-if="prevDelivery.receiverPhone">
                  · {{ prevDelivery.receiverPhone }}
                </template>
              </el-descriptions-item>
              <el-descriptions-item label="原保修截止">
                {{ formatDate(prevDelivery.warrantyEndAt) }}（{{ prevDelivery.warrantyMonths }} 个月）
              </el-descriptions-item>
              <el-descriptions-item label="交付经办人">{{ prevDelivery.operator }}</el-descriptions-item>
            </el-descriptions>
            <el-alert
              v-if="redelivery"
              :title="
                order.type === 'warranty'
                  ? `已再次交付，保修按返修占用天数顺延至 ${formatDate(redelivery.warrantyEndAt)}`
                  : `已再次交付，普通维修新保修至 ${formatDate(redelivery.warrantyEndAt)}`
              "
              :type="order.type === 'warranty' ? 'warning' : 'success'"
              :closable="false"
              show-icon
              style="margin-top: 10px"
            />
          </el-card>

          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <strong>原始档案（只读封存）</strong>
                <el-tag size="small">工序 {{ originalSteps.length }} · 测试 {{ originalTests.length }}</el-tag>
              </div>
            </template>
            <div class="sub-title">原工序 · 首次完工与师傅记录</div>
            <StepSequence :items="originalSteps" readonly />
            <el-divider content-position="left">原走时测试</el-divider>
            <div v-for="t in originalTests" :key="t.id" class="test-block">
              <div class="card-head">
                <strong>{{ new Date(t.testedAt).toLocaleString('zh-CN') }}</strong>
                <el-tag size="small" type="success">
                  {{ t.conclusion || judgeTest(t.rate, t.beatError, t.amplitude) }}
                </el-tag>
                <span class="muted">日差 {{ t.rate }} s/d · 摆幅 {{ t.amplitude }}°</span>
              </div>
              <RateChart :readings="t.positions" />
            </div>
            <el-empty v-if="originalTests.length === 0" description="原档案无走时测试" :image-size="50" />
          </el-card>
        </div>

        <!-- 右列：返修工序与返修测试 -->
        <div class="right">
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <strong>返修工序</strong>
                <el-tag size="small">{{ done }}/{{ total }} · {{ percent }}%</el-tag>
                <el-tag v-if="gaps.length" size="small" type="danger">跳号 {{ gaps.join('、') }}</el-tag>
                <span v-if="current && !order.closedAt" class="muted">
                  当前卡点：#{{ current.seq }} {{ current.stepType }}
                </span>
                <span v-else-if="order.closedAt" class="muted">已结案封存</span>
                <div class="spacer" />
                <el-button
                  v-if="!order.closedAt"
                  size="small"
                  type="primary"
                  @click="router.push(`/steps/new?orderId=${order.id}`)"
                >
                  追加返修工序
                </el-button>
              </div>
            </template>
            <el-progress :percentage="percent" :stroke-width="12" />
            <div style="margin-top: 12px">
              <StepSequence
                :items="steps"
                :sortable="!order.closedAt"
                :readonly="!!order.closedAt"
                @finish="finish"
                @rollback="rollback"
                @move="move"
                @reorder="reorder"
              />
            </div>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <strong>返修走时测试（{{ orderTests.length }}）</strong>
                <div class="spacer" />
                <el-button
                  v-if="!order.closedAt"
                  size="small"
                  @click="router.push(`/tests/${clock.id}?orderId=${order.id}`)"
                >
                  返修测试录入
                </el-button>
              </div>
            </template>
            <el-table :data="orderTests" size="small" border>
              <el-table-column label="时间" width="170">
                <template #default="{ row }">{{ new Date(row.testedAt).toLocaleString('zh-CN') }}</template>
              </el-table-column>
              <el-table-column prop="rate" label="日差" width="80" />
              <el-table-column prop="amplitude" label="摆幅" width="80" />
              <el-table-column prop="beatError" label="偏振" width="80" />
              <el-table-column prop="powerReserve" label="动储 h" width="90" />
              <el-table-column prop="conclusion" label="结论" min-width="120" />
            </el-table>
            <el-empty v-if="orderTests.length === 0" description="暂无返修测试" :image-size="60" />
          </el-card>

          <el-card v-if="!order.closedAt" shadow="never" class="close-card">
            <template #header><strong>结案与再次交付</strong></template>
            <p class="muted">
              全部返修工序完成后方可再次交付。
              <template v-if="order.type === 'warranty'">
                保修返修：再次交付后保修按返修占用天数顺延。
              </template>
              <template v-else>
                普通维修：再次交付后重新计算维修保修期。
              </template>
            </p>
            <el-button type="success" :disabled="total === 0 || done < total" @click="openClose">
              登记再次交付
            </el-button>
            <span v-if="total === 0 || done < total" class="hint">
              还有 {{ total - done }} 道返修工序未完成
            </span>
          </el-card>
        </div>
      </div>
    </template>

    <!-- 再次交付 -->
    <el-dialog v-model="closeVisible" title="再次交付登记" width="560px">
      <el-alert
        v-if="order?.type === 'warranty'"
        :title="`保修顺延：原截止 ${formatDate(prevDelivery?.warrantyEndAt ?? 0)} → 顺延至 ${formatDate(extendedEnd)}`"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
      />
      <el-form :model="closeForm" label-width="110px">
        <el-form-item label="交付日期" required>
          <el-date-picker
            v-model="closeForm.deliveredDate"
            type="date"
            value-format="x"
            format="YYYY-MM-DD"
            :disabled-date="(d: Date) => d.getTime() < (order?.createdAt ?? 0) - 86400000 || d.getTime() > Date.now()"
          />
        </el-form-item>
        <el-form-item label="领取人" required>
          <el-input v-model="closeForm.receiverName" />
        </el-form-item>
        <el-form-item label="联系方式">
          <el-input v-model="closeForm.receiverPhone" placeholder="选填" />
        </el-form-item>
        <el-form-item v-if="order?.type === 'paid'" label="维修保修月数" required>
          <el-input-number v-model="closeForm.warrantyMonths" :min="1" :max="60" />
          <span class="hint">个月，从再次交付日重新起算</span>
        </el-form-item>
        <el-form-item label="交付经办人" required>
          <el-input v-model="closeForm.operator" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="closeForm.note" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeVisible = false">取消</el-button>
        <el-button type="success" @click="submitClose">确认再次交付并结案</el-button>
      </template>
    </el-dialog>
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
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 420px) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.left,
.right {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 13px;
}
.hint {
  margin-left: 10px;
  color: #7b8592;
  font-size: 13px;
}
.fault {
  white-space: pre-wrap;
  line-height: 1.8;
  font-size: 14px;
}
.sub-title {
  font-size: 13px;
  color: #7b8592;
  margin-bottom: 8px;
}
.test-block {
  margin-bottom: 12px;
}
.close-card :deep(.el-card__body p) {
  margin: 0 0 12px;
}
</style>
