<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useOrderStore } from '../stores/orderStore';
import { useRepairProgress } from '../hooks/useRepairProgress';
import StepSequence from '../components/common/StepSequence.vue';
import RateChart from '../components/common/RateChart.vue';
import StateBadge from '../components/common/StateBadge.vue';
import { CONDITION_GRADES, type ConditionGrade } from '../types/clock';
import {
  LIABILITIES,
  ORDER_TYPE_LABEL,
  type Liability,
  type OrderType,
} from '../types/order';
import { judgeTest } from '../types/test';
import {
  DEFAULT_WARRANTY_MONTHS,
  formatDate,
  isWithinWarranty,
  warrantyDaysLeft,
  warrantyEndOf,
} from '../utils/warranty';

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();
const orderStore = useOrderStore();

const clockId = computed(() => String(route.params.id ?? ''));
const clock = computed(() => clockStore.byId(clockId.value));
const { progress, steps, done, total, percent, current, gaps } = useRepairProgress(clockId);
const parts = computed(() => partStore.byClock(clockId.value));
const tests = computed(() => stepStore.testsByClock(clockId.value));
const activeTab = ref('steps');

const deliveries = computed(() => orderStore.deliveriesByClock(clockId.value));
const latestDelivery = computed(() =>
  deliveries.value.length ? deliveries.value[0] : undefined,
);
const orders = computed(() => orderStore.byClock(clockId.value));
const openOrder = computed(() => orderStore.openOrderByClock(clockId.value));
const sealed = computed(() => !!latestDelivery.value);
const inWarranty = computed(() =>
  latestDelivery.value ? isWithinWarranty(latestDelivery.value) : false,
);
const daysLeft = computed(() =>
  latestDelivery.value ? warrantyDaysLeft(latestDelivery.value) : 0,
);

async function finish(id: string) {
  try {
    await stepStore.finish(id);
    ElMessage.success('步骤已完成');
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
async function changeGrade(value: unknown) {
  const grade = String(value) as ConditionGrade;
  await clockStore.setGrade(clockId.value, grade);
  ElMessage.success(`品相等级已更新为「${grade}」`);
}

/* ---------------- 首次交付登记 ---------------- */
const deliveryVisible = ref(false);
const deliveryForm = reactive({
  deliveredDate: Date.now(),
  receiverName: '',
  receiverPhone: '',
  warrantyMonths: DEFAULT_WARRANTY_MONTHS,
  operator: '',
  note: '',
});

function openDelivery() {
  deliveryVisible.value = true;
  deliveryForm.deliveredDate = Date.now();
  deliveryForm.receiverName = '';
  deliveryForm.receiverPhone = '';
  deliveryForm.warrantyMonths = DEFAULT_WARRANTY_MONTHS;
  deliveryForm.operator = '';
  deliveryForm.note = '';
}

async function submitDelivery() {
  try {
    const record = await orderStore.registerDelivery({
      clockId: clockId.value,
      deliveredAt: deliveryForm.deliveredDate,
      receiverName: deliveryForm.receiverName,
      receiverPhone: deliveryForm.receiverPhone,
      warrantyMonths: deliveryForm.warrantyMonths,
      operator: deliveryForm.operator,
      note: deliveryForm.note,
    });
    deliveryVisible.value = false;
    ElMessage.success(`已登记交付，保修截止 ${formatDate(record.warrantyEndAt)}`);
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

/* ---------------- 返修 / 普通维修建单 ---------------- */
const orderVisible = ref(false);
const orderType = ref<OrderType>('warranty');
const orderForm = reactive({
  faultDesc: '',
  liability: '店方责任' as Liability,
  liabilityNote: '',
  createdBy: '',
});

function openOrderDialog() {
  orderType.value = inWarranty.value ? 'warranty' : 'paid';
  orderForm.faultDesc = '';
  orderForm.liability = '店方责任';
  orderForm.liabilityNote = '';
  orderForm.createdBy = '';
  orderVisible.value = true;
}

async function submitOrder() {
  try {
    const record = await orderStore.createOrder({
      clockId: clockId.value,
      type: orderType.value,
      faultDesc: orderForm.faultDesc,
      liability: orderType.value === 'warranty' ? orderForm.liability : '客人使用不当',
      liabilityNote: orderForm.liabilityNote,
      createdBy: orderForm.createdBy,
    });
    orderVisible.value = false;
    ElMessage.success(`已建单 ${record.orderNo}`);
    await router.push(`/orders/${record.id}`);
  } catch (e) {
    ElMessage.error((e as Error).message);
  }
}

async function notifyAddStep() {
  if (sealed.value) {
    await ElMessageBox.alert(
      '该钟表已交付，原始工序已封存只读，不能再追加。保修期内请建返修单，超过保修期只能建普通维修单。',
      '原档案已封存',
      { type: 'warning' },
    );
    return;
  }
  await router.push(`/steps/new?clockId=${clockId.value}`);
}

/** 首次交付表单：保修截止日预览 */
function warrantyEndPreview(): number {
  return warrantyEndOf(deliveryForm.deliveredDate, deliveryForm.warrantyMonths);
}

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await stepStore.load();
  await orderStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>钟表详情 · {{ clock?.clockNo ?? '未找到' }}</h2>
      <StateBadge v-if="clock" :grade="clock.conditionGrade" />
      <el-tag v-if="openOrder" type="danger">
        {{ openOrder.type === 'warranty' ? '保修返修中' : '普通维修中' }}
      </el-tag>
      <el-tag v-else-if="inWarranty" type="success">保修期内（剩 {{ daysLeft }} 天）</el-tag>
      <el-tag v-else-if="sealed" type="info">已过保修期</el-tag>
      <el-tag v-if="gaps.length" type="danger">顺序号缺口：{{ gaps.join('、') }}</el-tag>
      <el-tag v-else type="success" effect="plain">顺序号连续</el-tag>
      <div class="spacer" />
      <el-button v-if="!sealed" type="success" @click="openDelivery">登记交付</el-button>
      <el-button
        v-else-if="!openOrder"
        :type="inWarranty ? 'warning' : 'primary'"
        @click="openOrderDialog"
      >
        {{ inWarranty ? '保修期内返修建单' : '普通维修建单（已过保）' }}
      </el-button>
      <el-button v-else type="warning" @click="router.push(`/orders/${openOrder.id}`)">
        查看在修单据 {{ openOrder.orderNo }}
      </el-button>
      <el-button @click="router.push(`/tests/${clockId}`)">走时测试录入</el-button>
      <el-button @click="router.push('/clocks')">返回台账</el-button>
    </div>

    <el-alert v-if="!clock" type="warning" :closable="false" title="未找到该钟表（可能已被删除）" show-icon />

    <el-alert
      v-if="clock && sealed"
      :type="openOrder ? 'warning' : 'info'"
      :closable="false"
      show-icon
      :title="
        openOrder
          ? `单据 ${openOrder.orderNo}（${ORDER_TYPE_LABEL[openOrder.type]}）未结案，台账标记为返修中；下方原始工序、走时测试与交付记录只读封存`
          : '该钟表已交付，原始工序、走时测试与交付记录已封存只读；期内返修或超保维修均另建单据，不覆盖首次完工与师傅记录'
      "
    />

    <div v-if="clock" class="grid">
      <div class="left">
        <el-card shadow="never">
          <template #header><strong>机芯信息</strong></template>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="藏品号">{{ clock.clockNo }}</el-descriptions-item>
            <el-descriptions-item label="种类">{{ clock.kind }}</el-descriptions-item>
            <el-descriptions-item label="机芯型号">{{ clock.caliber }}</el-descriptions-item>
            <el-descriptions-item label="国别 / 制作者">{{ clock.origin }} / {{ clock.maker }}</el-descriptions-item>
            <el-descriptions-item label="年代">{{ clock.yearMade }}</el-descriptions-item>
            <el-descriptions-item label="钟壳材质">{{ clock.caseMaterial }}</el-descriptions-item>
            <el-descriptions-item label="尺寸 mm">{{ clock.size }}</el-descriptions-item>
            <el-descriptions-item label="盘面标识">{{ clock.dialMark }}</el-descriptions-item>
            <el-descriptions-item label="来源">{{ clock.acquireFrom }}</el-descriptions-item>
            <el-descriptions-item label="存放位置">{{ clock.storagePos }}</el-descriptions-item>
            <el-descriptions-item label="零件条目">{{ parts.length }} 项</el-descriptions-item>
          </el-descriptions>
          <div class="grade-row">
            <span>品相等级：</span>
            <el-radio-group :model-value="clock.conditionGrade" size="small" @change="changeGrade">
              <el-radio-button v-for="g in CONDITION_GRADES" :key="g" :value="g">{{ g }}</el-radio-button>
            </el-radio-group>
          </div>
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>交付与保修</strong>
              <el-tag size="small" type="info">{{ deliveries.length }} 次交付</el-tag>
            </div>
          </template>
          <el-timeline v-if="deliveries.length">
            <el-timeline-item
              v-for="d in deliveries"
              :key="d.id"
              :timestamp="new Date(d.deliveredAt).toLocaleString('zh-CN')"
              :type="d.kind === '首次交付' ? 'primary' : 'warning'"
            >
              <div class="card-head">
                <strong>{{ d.kind }}</strong>
                <el-tag size="small" :type="isWithinWarranty(d) ? 'success' : 'info'">
                  保修至 {{ formatDate(d.warrantyEndAt) }}
                </el-tag>
                <span v-if="d === latestDelivery" class="muted">
                  {{ isWithinWarranty(d) ? `剩 ${warrantyDaysLeft(d)} 天` : '已过保' }}
                </span>
              </div>
              <div class="muted">领取人：{{ d.receiverName }}<template v-if="d.receiverPhone"> · {{ d.receiverPhone }}</template></div>
              <div class="muted">保修 {{ d.warrantyMonths }} 个月 · 经办人 {{ d.operator }}</div>
              <div v-if="d.note" class="muted">备注：{{ d.note }}</div>
            </el-timeline-item>
          </el-timeline>
          <el-empty v-else description="尚未交付" :image-size="60" />

          <template v-if="orders.length">
            <el-divider content-position="left">返修 / 维修单据</el-divider>
            <div v-for="o in orders" :key="o.id" class="order-row" @click="router.push(`/orders/${o.id}`)">
              <el-tag size="small" :type="o.type === 'warranty' ? 'warning' : 'info'">
                {{ ORDER_TYPE_LABEL[o.type] }}
              </el-tag>
              <span class="order-no">{{ o.orderNo }}</span>
              <el-tag size="small" :type="o.closedAt ? 'success' : 'danger'">
                {{ o.closedAt ? '已再次交付' : '返修中' }}
              </el-tag>
              <span class="muted">{{ o.liability }}</span>
            </div>
          </template>
        </el-card>
      </div>

      <div class="right">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>修复进度{{ sealed ? '（原始档案 · 只读）' : '' }}</strong>
              <el-tag size="small">{{ done }}/{{ total }} · {{ percent }}%</el-tag>
              <span v-if="current && !sealed" class="muted">
                当前卡点：#{{ current.seq }} {{ current.stepType }}（{{ current.operator }}）
              </span>
              <span v-else-if="sealed" class="muted">已交付封存</span>
              <span v-else class="muted">全部步骤已完成</span>
              <div class="spacer" />
              <el-button size="small" type="primary" @click="notifyAddStep">追加维修工序</el-button>
            </div>
          </template>
          <el-progress :percentage="percent" :stroke-width="12" />
          <el-tabs v-model="activeTab" style="margin-top: 12px">
            <el-tab-pane label="工序顺序" name="steps">
              <StepSequence
                :items="steps"
                :sortable="!sealed"
                :readonly="sealed"
                @finish="finish"
                @rollback="rollback"
                @move="move"
                @reorder="reorder"
              />
            </el-tab-pane>
            <el-tab-pane :label="`零件清单（${parts.length}）`" name="parts">
              <el-table :data="parts" size="small" border>
                <el-table-column prop="name" label="零件" width="110" />
                <el-table-column prop="position" label="装配位置" min-width="150" />
                <el-table-column prop="wearState" label="磨损" width="90" />
                <el-table-column prop="decision" label="处理" width="90" />
                <el-table-column prop="sourceLot" label="来源批号" width="120" />
                <el-table-column prop="dimension" label="尺寸 mm" width="100" />
              </el-table>
              <el-empty v-if="parts.length === 0" description="暂无零件登记" :image-size="60" />
            </el-tab-pane>
            <el-tab-pane :label="`走时测试（${tests.length}）`" name="tests">
              <div v-for="t in tests" :key="t.id" class="test-block">
                <div class="card-head">
                  <strong>{{ new Date(t.testedAt).toLocaleString('zh-CN') }}</strong>
                  <el-tag size="small" type="success">{{ t.conclusion || judgeTest(t.rate, t.beatError, t.amplitude) }}</el-tag>
                  <span class="muted">日差 {{ t.rate }} s/d · 摆幅 {{ t.amplitude }}° · 偏振 {{ t.beatError }} ms</span>
                </div>
                <RateChart :readings="t.positions" />
              </div>
              <el-empty v-if="tests.length === 0" description="暂无走时测试记录" :image-size="60" />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>

    <!-- 首次交付登记 -->
    <el-dialog v-model="deliveryVisible" title="交付登记（首次交付）" width="560px">
      <el-alert
        title="交付后原始工序、走时测试将封存只读；保修期内返修另建返修单，不覆盖首次完工与师傅记录"
        type="info"
        :closable="false"
        style="margin-bottom: 12px"
      />
      <el-form :model="deliveryForm" label-width="110px">
        <el-form-item label="交付日期" required>
          <el-date-picker
            v-model="deliveryForm.deliveredDate"
            type="date"
            value-format="x"
            format="YYYY-MM-DD"
            :disabled-date="(d: Date) => d.getTime() > Date.now()"
          />
        </el-form-item>
        <el-form-item label="领取人" required>
          <el-input v-model="deliveryForm.receiverName" placeholder="客人或代领人姓名" />
        </el-form-item>
        <el-form-item label="联系方式">
          <el-input v-model="deliveryForm.receiverPhone" placeholder="选填" />
        </el-form-item>
        <el-form-item label="保修月数" required>
          <el-input-number v-model="deliveryForm.warrantyMonths" :min="1" :max="60" />
          <span class="hint">个月，保修截止 {{ formatDate(warrantyEndPreview()) }}</span>
        </el-form-item>
        <el-form-item label="交付经办人" required>
          <el-input v-model="deliveryForm.operator" />
        </el-form-item>
        <el-form-item label="交付备注">
          <el-input v-model="deliveryForm.note" type="textarea" :rows="2" placeholder="签收情况、随附物品等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deliveryVisible = false">取消</el-button>
        <el-button type="success" @click="submitDelivery">确认交付并起保</el-button>
      </template>
    </el-dialog>

    <!-- 返修 / 普通维修建单 -->
    <el-dialog v-model="orderVisible" title="返修 / 维修建单" width="600px">
      <el-alert
        v-if="inWarranty"
        :title="`在保修期内（截止 ${formatDate(latestDelivery?.warrantyEndAt ?? 0)}），可建保修返修单，再次交付后保修顺延`"
        type="success"
        :closable="false"
        style="margin-bottom: 10px"
      />
      <el-alert
        v-else
        title="已超过保修截止日，只能按普通维修建档；再次交付按新维修保修重新计算"
        type="warning"
        :closable="false"
        style="margin-bottom: 10px"
      />
      <el-form :model="orderForm" label-width="110px">
        <el-form-item label="单据类型">
          <el-radio-group v-model="orderType">
            <el-radio-button value="warranty" :disabled="!inWarranty">保修期内返修</el-radio-button>
            <el-radio-button value="paid">普通维修</el-radio-button>
          </el-radio-group>
          <div v-if="!inWarranty" class="hint">保修返修不可选：该钟表已过保</div>
        </el-form-item>
        <el-form-item label="故障复现" required>
          <el-input
            v-model="orderForm.faultDesc"
            type="textarea"
            :rows="4"
            placeholder="故障现象、复现条件、初步检查"
          />
        </el-form-item>
        <template v-if="orderType === 'warranty'">
          <el-form-item label="责任判定">
            <el-select v-model="orderForm.liability" style="width: 100%">
              <el-option v-for="l in LIABILITIES" :key="l" :label="l" :value="l" />
            </el-select>
          </el-form-item>
        </template>
        <el-form-item label="判定说明">
          <el-input
            v-model="orderForm.liabilityNote"
            type="textarea"
            :rows="2"
            :placeholder="orderType === 'warranty' ? '判定依据、是否免费返修' : '收费项目与报价说明'"
          />
        </el-form-item>
        <el-form-item label="接修人" required>
          <el-input v-model="orderForm.createdBy" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="orderVisible = false">取消</el-button>
        <el-button type="primary" @click="submitOrder">建单并进入返修档案</el-button>
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
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.right {
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
.grade-row {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.test-block {
  margin-bottom: 16px;
}
.hint {
  margin-left: 10px;
  color: #7b8592;
  font-size: 13px;
}
.order-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  cursor: pointer;
  border-bottom: 1px dashed #e4e7ed;
}
.order-row:hover {
  background: #f5f7fa;
}
.order-no {
  font-weight: 600;
}
</style>
