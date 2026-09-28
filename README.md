# sologsb-1120 古钟表维修工序档案（gbclockrepair）

面向钟表修复师的工序档案台：为一台古董钟表建档，记录机芯型号、零件缺失与配换、拆解顺序、清洗润滑点位，以及修复后的走时测试数据。交付时登记领取人与保修截止日；保修期内同一故障回来另建返修单（原工序/测试/交付记录只读封存、不覆盖首次完工与师傅记录），记录故障复现、责任判定与再次交付时间，台账标「返修中」，再次交付顺延保修；超过保修期只能按普通维修建档。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：**http://localhost:21820**

停止服务：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| UI | Element Plus 2 |
| 构建 | Vite 5 |
| 状态管理 | Pinia |
| 路由 | Vue Router 4（history 模式） |
| 本地存储 | IndexedDB（Dexie 4），含结构版本号与升级迁移 |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # vue-tsc 类型检查 + vite 构建
```

> 生产环境由 nginx 托管 `dist`，`nginx.conf` 已启用 `try_files $uri $uri/ /index.html;` 与 gzip。

## 目录结构

```
sologsb-1120/
├── docker-compose.yml
├── .env.example
├── .env
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── main.ts
        ├── App.vue
        ├── router/index.ts
        ├── types/{clock,part,step,test,order}.ts
        ├── stores/{clock,part,step,order}Store.ts
        ├── components/common/{StepSequence,RateChart,ClockCard,StateBadge}.vue
        ├── hooks/{useClockSearch,useRepairProgress}.ts
        ├── pages/{ClockList,ClockDetail,OrderDetail,StepForm,PartList,TestView}.vue
        └── utils/{db,timeCalc,warranty,id}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/clocks` | 钟表台账：按种类/机芯/品相/年代区间筛选，按修复状态分栏（含「返修中」） | Clock、RepairOrder、Delivery |
| `/clocks/:id` | 钟表详情：机芯信息、原工序流与走时测试，交付登记与保修时间线，返修/普通维修建单入口 | Clock、RepairStep、TimekeepingTest、MovementPart、Delivery、RepairOrder |
| `/orders/:id` | 返修档案：故障复现、责任判定、保修依据、原档案只读区、返修工序/测试、再次交付登记 | RepairOrder、Delivery、RepairStep、TimekeepingTest |
| `/steps/new` | 新建工序：支持 `?clockId=`（原档案）与 `?orderId=`（返修单）两种归属 | RepairStep、MovementPart、RepairOrder |
| `/parts` | 零件与配换清单：按磨损状态分组，标出待修配条目与来源批号 | MovementPart |
| `/tests/:clockId` | 走时测试录入与多方位均值计算，支持 `?orderId=` 返修测试，生成走时单文本 | TimekeepingTest、RepairOrder |

`/` 重定向到 `/clocks`，未匹配路由同样兜底到 `/clocks`。

## 数据存储说明

- 数据库名 `gbclockrepair`，当前结构版本 **v3**（`localStorage['gbclockrepair:db-version']` 记录）。
- 六张表：`clocks`（钟表）、`parts`（机芯零件）、`steps`（维修工序）、`tests`（走时测试）、`deliveries`（交付记录）、`orders`（返修/维修单）。
- v1 → v2 迁移：补齐老记录的 `state`、`partIds`、`torque`、`positions` 字段并新增索引。
- v2 → v3 迁移：新增 `deliveries`、`orders` 两张表，`steps`/`tests` 增加 `orderId` 索引；老记录 `orderId` 为空，自动归入只读原档案，无需改写数据。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 台示范钟表：一台已交付且在保修期内、有一张未结案的保修返修单（台账落「返修中」栏），另一台尚未开工。

## 返修档案规则

- **交付登记**：首次交付时登记领取人（联系方式选填）、保修月数、交付经办人，系统按自然月算出保修截止日（含当日）；交付后原始工序与走时测试**封存只读**——完成/回退/排序/追加工序与测试在 store 层统一拦截，UI 同步显示「已封存」，首次完工时间与师傅记录不会被覆盖。
- **保修期内返修**：期内（含截止日当天）回来可建「保修期内返修」单（单号 `FX-yyyyMMdd-NN`），继承原钟表，登记**故障复现**与**责任判定**（店方责任/零件质量/客人使用不当/待定）；返修工序与走时测试挂在返修单名下，与原档案分开编号。
- **台账状态**：存在未结案单据期间，台账该钟表固定标「返修中」（保修返修与普通维修共用），不再按工序推导。
- **再次交付与顺延**：返修单全部工序完成后才能再次交付；保修返修按返修占用天数（建单日至再次交付日，含首尾）**顺延**原保修截止日，普通维修则按新保修月数重新起算；再次交付时间写入单据结案时间与交付时间线。
- **超过保修期**：保修截止次日起，建单弹窗中「保修期内返修」不可选，只能建「普通维修」单（单号 `WX-yyyyMMdd-NN`）。
- **唯一性约束**：同一钟表同时只允许一张未结案单据；未交付的钟表直接在原档案维修，不能建单；已结案单据及其工序、测试同样只读。

## 功能要点

- **顺序号不跳号**：新建工序时若顺序号大于「当前最大顺序号 + 1」直接报错并给出建议值；`<StepSequence>` 对缺口行标红。
- **工序排序**：支持「上移 / 下移」按钮与原生拖拽交换顺序，交换的是 `seq`。
- **工序完成 / 回退**：完成后写 `finishedAt`，回退后计入待办与回退计数。
- **双轴走时图**：`<RateChart>` 左轴日差 s/d、右轴摆幅 °，标注四方位读数与均值。
- **走时单导出**：按方位均值生成文本，可复制或下载 txt。
- **返修档案**：交付起保 → 期内返修建单（原档案只读）→ 故障复现/责任判定 → 返修工序与测试 → 再次交付顺延保修；超保只能建普通维修单，规则同时在 UI 与 IndexedDB 写入层强制。
