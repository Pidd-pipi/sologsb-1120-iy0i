# sologsb-1120 古钟表维修工序档案（gbclockrepair）

面向钟表修复师的工序档案台：为一台古董钟表建档，记录机芯型号、零件缺失与配换、拆解顺序、清洗润滑点位，以及修复后的走时测试数据。纯前端单页应用，数据全部保存在浏览器本地。

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
        ├── types/{clock,part,step,test,delivery,rework}.ts
        ├── stores/{clock,part,step,rework}Store.ts
        ├── components/common/{StepSequence,RateChart,ClockCard,StateBadge}.vue
        ├── hooks/{useClockSearch,useRepairProgress,useReworkGuard}.ts
        ├── pages/{ClockList,ClockDetail,StepForm,PartList,TestView,ReworkList}.vue
        └── utils/{db,timeCalc,id}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/clocks` | 钟表台账：按种类/机芯/品相/年代区间筛选，按修复状态分栏（含「返修中」栏） | Clock、ReworkOrder、Delivery |
| `/clocks/:id` | 钟表详情：左侧机芯信息与交付保修卡，右侧工序流、走时测试与返修记录，可切零件清单 | Clock、RepairStep、TimekeepingTest、MovementPart、Delivery、ReworkOrder |
| `/steps/new` | 新建维修工序：选步骤类型后动态出清洗液/油脂/力矩字段，顺序号冲突即报错；返修中自动归入返修单 | RepairStep、MovementPart、ReworkOrder |
| `/parts` | 零件与配换清单：按磨损状态分组，标出待修配条目与来源批号 | MovementPart |
| `/tests/:clockId` | 走时测试录入与多方位均值计算，生成走时单文本；返修中录入归入返修单 | TimekeepingTest、ReworkOrder |
| `/reworks` | 返修档案台账：全部返修单按状态筛选，含故障复现、责任判定、再次交付与顺延保修 | ReworkOrder、Delivery、Clock |

`/` 重定向到 `/clocks`，未匹配路由同样兜底到 `/clocks`。

## 数据存储说明

- 数据库名 `gbclockrepair`，当前结构版本 **v3**（`localStorage['gbclockrepair:db-version']` 记录）。
- 六张表：`clocks`（钟表）、`parts`（机芯零件）、`steps`（维修工序）、`tests`（走时测试）、`deliveries`（交付记录）、`reworks`（返修单）。
- v1 → v2 迁移：补齐老记录的 `state`、`partIds`、`torque`、`positions` 字段并新增索引。
- v2 → v3 迁移：新增 `deliveries`、`reworks` 两表，`steps`/`tests` 增加 `reworkId` 索引（返修归属，空为原始档案）。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 台示范钟表、3 项零件、6 道工序、2 次走时测试与 1 条交付记录（怀表 CLK-1890-011 处于保修期内，可直接演示返修流程）。

## 功能要点

- **顺序号不跳号**：新建工序时若顺序号大于「当前最大顺序号 + 1」直接报错并给出建议值；`<StepSequence>` 对缺口行标红。
- **工序排序**：支持「上移 / 下移」按钮与原生拖拽交换顺序，交换的是 `seq`。
- **工序完成 / 回退**：完成后写 `finishedAt`，回退后计入待办与回退计数。
- **双轴走时图**：`<RateChart>` 左轴日差 s/d、右轴摆幅 °，标注四方位读数与均值。
- **走时单导出**：按方位均值生成文本，可复制或下载 txt。
- **交付登记**：全部工序完工且有走时测试后可登记交付，记录领取人与保修截止日；交付记录追加式保存，只增不改。
- **返修档案**：保修期内同一故障回来时新建返修单（单号 `RW-年份-序号`），继承原钟表；原工序、测试与交付记录随即只读，新工序/测试自动打上返修归属。返修单记录故障复现、责任判定（结案前可修正）与再次交付时间。
- **台账「返修中」**：返修单未结案时，台账将该钟表归入「返修中」栏，卡片标注单号。
- **再次交付顺延保修**：结案时登记再次交付（领取人 + 保修截止），默认按原保修时长自再次交付起顺延，生成新的交付记录。
- **过保只能普通维修**：超过保修期后「新建返修单」禁用，只能按普通维修直接追加工序。
