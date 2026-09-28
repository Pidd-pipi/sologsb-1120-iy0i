<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useClockStore } from '../stores/clockStore';
import { usePartStore } from '../stores/partStore';
import { useStepStore } from '../stores/stepStore';
import { useReworkStore } from '../stores/reworkStore';
import { useRepairProgress } from '../hooks/useRepairProgress';
import { useReworkGuard } from '../hooks/useReworkGuard';
import StepSequence from '../components/common/StepSequence.vue';
import RateChart from '../components/common/RateChart.vue';
import StateBadge from '../components/common/StateBadge.vue';
import { CONDITION_GRADES, type ConditionGrade } from '../types/clock';
import { judgeTest } from '../types/test';
import { REWORK_RESPONSIBILITIES, type ReworkResponsibility } from '../types/rework';

const DAY = 24 * 3600 * 1000;
/** 日期选择器返回当日 0 点，保修截止按当日 23:59:59 计 */
const endOfDay = (ts: number) => ts + DAY - 1;
const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleString('zh-CN') : '—');
const fmtDate = (ts?: number) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—');

const route = useRoute();
const router = useRouter();
const clockStore = useClockStore();
const partStore = usePartStore();
const stepStore = useStepStore();
const reworkStore = useReworkStore();

const clockId = computed(() => String(route.params.id ?? ''));
const clock = computed(() => clockStore.byId(clockId.value));
const { progress, steps, done, total, percent, current, gaps } = useRepairProgress(clockId);
const parts = computed(() => partStore.byClock(clockId.value));
const tests = computed(() => stepStore.testsByClock(clockId.value));
const activeTab = ref('steps');

const { deliveries, latestDelivery, delivered, inWarranty, openRework, reworks, stepLocked, lockReason } =
  useReworkGuard(clockId);

/** 原工序（及历史返修工序）在交付后保修期内/返修中只读 */
const lockedStepIds = computed(() => steps.value.filter((s) => stepLocked(s)).map((s) => s.id));

const reworkSteps = computed(() =>
  openRework.value ? steps.value.filter((s) => s.reworkId === openRework.value!.id) : [],
);
const reworkStepsDone = computed(() => reworkSteps.value.filter((s) => s.state === 'done').length);
const reworkTests = computed(() =>
  openRework.value ? tests.value.filter((t) => t.reworkId === openRework.value!.id) : [],
);

/** 全部工序完工且有走时测试后才允许登记交付 */
const canDeliver = computed(
  () => !delivered.value && total.value > 0 && done.value === total.value && tests.value.length > 0,
);

const warrantyDaysLeft = computed(() =>
  latestDelivery.value ? Math.max(0, Math.ceil((latestDelivery.value.warrantyUntil - Date.now()) / DAY)) : 0,
);

function reworkNoOf(id?: string): string {
  if (!id) return '';
  return reworks.value.find((r) => r.id === id)?.reworkNo ?? '';
}

/* ---------- 登记交付 ---------- */
const deliveryDialog = ref(false);
const deliveryError = ref('');
const deliveryForm = reactive({ receiver: '', deliveredAt: Date.now(), warrantyUntil: Date.now() + 365 * DAY, note: '' });

function openDeliveryDialog() {
  deliveryForm.receiver = '';
  deliveryForm.deliveredAt = Date.now();
  deliveryForm.warrantyUntil = Date.now() + 365 * DAY;
  deliveryForm.note = '';
  deliveryError.value = '';
  deliveryDialog.value = true;
}

async function submitDelivery() {
  if (!deliveryForm.receiver.trim()) {
    deliveryError.value = '领取人必填';
    return;
  }
  const deliveredAt = Number(deliveryForm.deliveredAt);
  const warrantyUntil = endOfDay(Number(deliveryForm.warrantyUntil));
  if (warrantyUntil <= deliveredAt) {
    deliveryError.value = '保修截止日必须晚于交付时间';
    return;
  }
  await reworkStore.addDelivery({
    clockId: clockId.value,
    receiver: deliveryForm.receiver.trim(),
    deliveredAt,
    warrantyUntil,
    note: deliveryForm.note.trim(),
  });
  deliveryDialog.value = false;
  ElMessage.success(`已登记交付，保修至 ${fmtDate(warrantyUntil)}`);
}

/* ---------- 新建返修单 ---------- */
const reworkDialog = ref(false);
const reworkError = ref('');
const reworkForm = reactive({ faultNote: '', responsibility: '待定' as ReworkResponsibility });

function openReworkDialog() {
  reworkForm.faultNote = '';
  reworkForm.responsibility = '待定';
  reworkError.value = '';
  reworkDialog.value = true;
}

async function submitRework() {
  if (!reworkForm.faultNote.trim()) {
    reworkError.value = '请记录故障复现情况';
    return;
  }
  try {
    const created = await reworkStore.createRework({
      clockId: clockId.value,
      faultNote: reworkForm.faultNote.trim(),
      responsibility: reworkForm.responsibility,
    });
    reworkDialog.value = false;
    ElMessage.success(`返修单 ${created.reworkNo} 已建立，原工序与测试转入只读`);
  } catch (e) {
    reworkError.value = (e as Error).message;
  }
}

/* ---------- 返修单维护（未结案时可改） ---------- */
async function changeResponsibility(value: unknown) {
  if (!openRework.value) return;
  await reworkStore.updateRework(openRework.value.id, { responsibility: String(value) as ReworkResponsibility });
  ElMessage.success('责任判定已更新');
}

async function changeFaultNote(value: string) {
  if (!openRework.value || !value.trim()) return;
  await reworkStore.updateRework(openRework.value.id, { faultNote: value.trim() });
  ElMessage.success('故障复现已保存');
}

/* ---------- 再次交付（结案并顺延保修） ---------- */
const redeliverDialog = ref(false);
const redeliverError = ref('');
const redeliverForm = reactive({ receiver: '', warrantyUntil: 0, note: '' });

function openRedeliverDialog() {
  const latest = latestDelivery.value;
  const span = latest ? latest.warrantyUntil - latest.deliveredAt : 365 * DAY;
  redeliverForm.receiver = latest?.receiver ?? '';
  redeliverForm.warrantyUntil = Date.now() + Math.max(span, DAY);
  redeliverForm.note = '';
  redeliverError.value = '';
  redeliverDialog.value = true;
}

async function submitRedeliver() {
  if (!openRework.value) return;
  if (!redeliverForm.receiver.trim()) {
    redeliverError.value = '领取人必填';
    return;
  }
  const warrantyUntil = endOfDay(Number(redeliverForm.warrantyUntil));
  if (warrantyUntil <= Date.now()) {
    redeliverError.value = '顺延后的保修截止日必须晚于今天';
    return;
  }
  try {
    await reworkStore.closeRework({
      id: openRework.value.id,
      receiver: redeliverForm.receiver.trim(),
      warrantyUntil,
      note: redeliverForm.note.trim(),
    });
    redeliverDialog.value = false;
    ElMessage.success(`已再次交付，保修顺延至 ${fmtDate(warrantyUntil)}`);
  } catch (e) {
    redeliverError.value = (e as Error).message;
  }
}

/* ---------- 工序操作 ---------- */
async function finish(id: string) {
  await stepStore.finish(id);
  ElMessage.success('步骤已完成');
}
async function rollback(id: string) {
  await stepStore.rollback(id);
  ElMessage.warning('步骤已回退');
}
async function move(payload: { id: string; direction: 'up' | 'down' }) {
  const list = steps.value;
  const index = list.findIndex((it) => it.id === payload.id);
  const target = payload.direction === 'up' ? list[index - 1] : list[index + 1];
  if (!target) return;
  await stepStore.swapSeq(payload.id, target.id);
  ElMessage.success('顺序已调整');
}
async function reorder(payload: { fromId: string; toId: string }) {
  await stepStore.swapSeq(payload.fromId, payload.toId);
  ElMessage.success('已按拖拽交换顺序');
}
async function changeGrade(value: unknown) {
  const grade = String(value) as ConditionGrade;
  await clockStore.setGrade(clockId.value, grade);
  ElMessage.success(`品相等级已更新为「${grade}」`);
}

onMounted(async () => {
  await clockStore.load();
  await partStore.load();
  await stepStore.load();
  await reworkStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>钟表详情 · {{ clock?.clockNo ?? '未找到' }}</h2>
      <StateBadge v-if="clock" :grade="clock.conditionGrade" />
      <el-tag v-if="openRework" type="warning">返修中 · {{ openRework.reworkNo }}</el-tag>
      <el-tag v-else-if="delivered && inWarranty" type="success">
        保修期内 · 至 {{ fmtDate(latestDelivery?.warrantyUntil) }}
      </el-tag>
      <el-tag v-else-if="delivered" type="danger">已过保修期</el-tag>
      <el-tag v-if="gaps.length" type="danger">顺序号缺口：{{ gaps.join('、') }}</el-tag>
      <el-tag v-else type="success" effect="plain">顺序号连续</el-tag>
      <div class="spacer" />
      <el-tooltip
        :disabled="canDeliver"
        content="全部工序完成且有走时测试记录后才能登记交付"
        placement="top"
      >
        <span>
          <el-button v-if="!delivered" type="success" :disabled="!canDeliver" @click="openDeliveryDialog">
            登记交付
          </el-button>
        </span>
      </el-tooltip>
      <el-tooltip :disabled="inWarranty" content="已过保修期，只能按普通维修建档（直接追加工序）" placement="top">
        <span>
          <el-button
            v-if="delivered && !openRework"
            type="warning"
            :disabled="!inWarranty"
            @click="openReworkDialog"
          >
            新建返修单
          </el-button>
        </span>
      </el-tooltip>
      <el-button type="primary" @click="router.push(`/steps/new?clockId=${clockId}`)">追加维修工序</el-button>
      <el-button @click="router.push(`/tests/${clockId}`)">走时测试录入</el-button>
      <el-button @click="router.push('/clocks')">返回台账</el-button>
    </div>

    <el-alert v-if="!clock" type="warning" :closable="false" title="未找到该钟表（可能已被删除）" show-icon />

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
              <el-tag v-if="openRework" size="small" type="warning">返修中</el-tag>
              <el-tag v-else-if="delivered && inWarranty" size="small" type="success">
                保修期内 · 剩 {{ warrantyDaysLeft }} 天
              </el-tag>
              <el-tag v-else-if="delivered" size="small" type="danger">已过保</el-tag>
            </div>
          </template>
          <template v-if="latestDelivery">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="领取人">{{ latestDelivery.receiver }}</el-descriptions-item>
              <el-descriptions-item label="交付时间">{{ fmtTime(latestDelivery.deliveredAt) }}</el-descriptions-item>
              <el-descriptions-item label="保修截止">{{ fmtDate(latestDelivery.warrantyUntil) }}</el-descriptions-item>
              <el-descriptions-item v-if="latestDelivery.reworkId" label="关联返修单">
                {{ reworkNoOf(latestDelivery.reworkId) }}（再次交付）
              </el-descriptions-item>
              <el-descriptions-item v-if="latestDelivery.note" label="备注">{{ latestDelivery.note }}</el-descriptions-item>
            </el-descriptions>
            <el-table v-if="deliveries.length > 1" :data="deliveries" size="small" border style="margin-top: 10px">
              <el-table-column label="交付时间" width="150">
                <template #default="{ row }">{{ fmtTime(row.deliveredAt) }}</template>
              </el-table-column>
              <el-table-column prop="receiver" label="领取人" width="80" />
              <el-table-column label="保修至" width="105">
                <template #default="{ row }">{{ fmtDate(row.warrantyUntil) }}</template>
              </el-table-column>
              <el-table-column label="类型" min-width="90">
                <template #default="{ row }">
                  <el-tag v-if="row.reworkId" size="small" type="warning" effect="plain">
                    返修交付 {{ reworkNoOf(row.reworkId) }}
                  </el-tag>
                  <el-tag v-else size="small" type="info" effect="plain">首次交付</el-tag>
                </template>
              </el-table-column>
            </el-table>
          </template>
          <el-empty v-else description="尚未交付，交付时登记领取人与保修截止日" :image-size="60" />
        </el-card>
      </div>

      <div class="right">
        <el-alert
          v-if="lockReason"
          type="warning"
          :closable="false"
          show-icon
          :title="lockReason"
          style="margin-bottom: 14px"
        />

        <el-card v-if="openRework" shadow="never" class="rework-card">
          <template #header>
            <div class="card-head">
              <strong>返修单 {{ openRework.reworkNo }}</strong>
              <el-tag size="small" type="warning">返修中</el-tag>
              <span class="muted">登记于 {{ fmtTime(openRework.openedAt) }}</span>
              <div class="spacer" />
              <el-button size="small" @click="router.push(`/steps/new?clockId=${clockId}`)">录返修工序</el-button>
              <el-button size="small" @click="router.push(`/tests/${clockId}`)">录返修测试</el-button>
              <el-button size="small" type="success" @click="openRedeliverDialog">再次交付结案</el-button>
            </div>
          </template>
          <el-form label-width="90px">
            <el-form-item label="故障复现">
              <el-input
                :model-value="openRework.faultNote"
                type="textarea"
                :rows="2"
                placeholder="故障现象、复现条件（失焦自动保存）"
                @change="changeFaultNote"
              />
            </el-form-item>
            <el-form-item label="责任判定">
              <el-select
                :model-value="openRework.responsibility"
                style="width: 200px"
                @change="changeResponsibility"
              >
                <el-option v-for="r in REWORK_RESPONSIBILITIES" :key="r" :label="r" :value="r" />
              </el-select>
              <span class="muted" style="margin-left: 10px">
                返修工序 {{ reworkStepsDone }}/{{ reworkSteps.length }} · 返修测试 {{ reworkTests.length }} 次
              </span>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <strong>修复进度</strong>
              <el-tag size="small">{{ done }}/{{ total }} · {{ percent }}%</el-tag>
              <span v-if="current" class="muted">
                当前卡点：#{{ current.seq }} {{ current.stepType }}（{{ current.operator }}）
              </span>
              <span v-else class="muted">全部步骤已完成</span>
            </div>
          </template>
          <el-progress :percentage="percent" :stroke-width="12" />
          <el-tabs v-model="activeTab" style="margin-top: 12px">
            <el-tab-pane label="工序顺序" name="steps">
              <StepSequence
                :items="steps"
                :locked-ids="lockedStepIds"
                sortable
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
                  <strong>{{ fmtTime(t.testedAt) }}</strong>
                  <el-tag size="small" type="success">{{ t.conclusion || judgeTest(t.rate, t.beatError, t.amplitude) }}</el-tag>
                  <el-tag v-if="t.reworkId" size="small" type="warning" effect="plain">
                    返修 {{ reworkNoOf(t.reworkId) }}
                  </el-tag>
                  <span class="muted">日差 {{ t.rate }} s/d · 摆幅 {{ t.amplitude }}° · 偏振 {{ t.beatError }} ms</span>
                </div>
                <RateChart :readings="t.positions" />
              </div>
              <el-empty v-if="tests.length === 0" description="暂无走时测试记录" :image-size="60" />
            </el-tab-pane>
            <el-tab-pane :label="`返修记录（${reworks.length}）`" name="reworks">
              <el-table :data="reworks" size="small" border>
                <el-table-column prop="reworkNo" label="返修单号" width="120" />
                <el-table-column label="登记时间" width="160">
                  <template #default="{ row }">{{ fmtTime(row.openedAt) }}</template>
                </el-table-column>
                <el-table-column prop="faultNote" label="故障复现" min-width="180" show-overflow-tooltip />
                <el-table-column prop="responsibility" label="责任判定" width="100" />
                <el-table-column label="状态" width="90">
                  <template #default="{ row }">
                    <el-tag v-if="row.state === 'open'" size="small" type="warning">返修中</el-tag>
                    <el-tag v-else size="small" type="success">已结案</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="再次交付时间" width="160">
                  <template #default="{ row }">{{ fmtTime(row.redeliveredAt) }}</template>
                </el-table-column>
              </el-table>
              <el-empty v-if="reworks.length === 0" description="暂无返修记录" :image-size="60" />
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>

    <el-dialog v-model="deliveryDialog" title="登记交付" width="520px">
      <el-alert v-if="deliveryError" :title="deliveryError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form label-width="110px">
        <el-form-item label="领取人" required>
          <el-input v-model="deliveryForm.receiver" placeholder="领取人姓名" />
        </el-form-item>
        <el-form-item label="交付时间" required>
          <el-date-picker
            v-model="deliveryForm.deliveredAt"
            type="datetime"
            value-format="x"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="保修截止日" required>
          <el-date-picker v-model="deliveryForm.warrantyUntil" type="date" value-format="x" style="width: 100%" />
          <div class="muted">默认自交付起一年，可调整；当日 24 时前有效</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="deliveryForm.note" type="textarea" :rows="2" placeholder="验表情况、交接说明等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deliveryDialog = false">取消</el-button>
        <el-button type="primary" @click="submitDelivery">保存交付记录</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="reworkDialog" title="新建返修单" width="560px">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="返修单继承原钟表档案；建档后原工序、测试与交付记录保持只读，新工序与测试归入本返修单。"
        style="margin-bottom: 12px"
      />
      <el-alert v-if="reworkError" :title="reworkError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form label-width="90px">
        <el-form-item label="故障复现" required>
          <el-input
            v-model="reworkForm.faultNote"
            type="textarea"
            :rows="3"
            placeholder="故障现象、复现条件、与上次修复的关联"
          />
        </el-form-item>
        <el-form-item label="责任判定">
          <el-select v-model="reworkForm.responsibility" style="width: 200px">
            <el-option v-for="r in REWORK_RESPONSIBILITIES" :key="r" :label="r" :value="r" />
          </el-select>
          <span class="muted" style="margin-left: 10px">可在结案前随时修正</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reworkDialog = false">取消</el-button>
        <el-button type="warning" @click="submitRework">建立返修单</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="redeliverDialog" :title="`再次交付 · ${openRework?.reworkNo ?? ''}`" width="520px">
      <el-alert
        v-if="reworkSteps.length > reworkStepsDone"
        type="warning"
        :closable="false"
        show-icon
        :title="`尚有 ${reworkSteps.length - reworkStepsDone} 道返修工序未完成，结案后将转入只读存档`"
        style="margin-bottom: 10px"
      />
      <el-alert v-if="redeliverError" :title="redeliverError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form label-width="110px">
        <el-form-item label="领取人" required>
          <el-input v-model="redeliverForm.receiver" />
        </el-form-item>
        <el-form-item label="保修顺延至" required>
          <el-date-picker v-model="redeliverForm.warrantyUntil" type="date" value-format="x" style="width: 100%" />
          <div class="muted">已按原保修时长自再次交付起顺延，可调整</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="redeliverForm.note" type="textarea" :rows="2" placeholder="返修内容、验表情况等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="redeliverDialog = false">取消</el-button>
        <el-button type="success" @click="submitRedeliver">确认再次交付并结案</el-button>
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
}
.right {
  min-width: 0;
}
.rework-card {
  margin-bottom: 14px;
  border-color: #e6a23c;
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
</style>
