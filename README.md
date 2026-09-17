# 注塑车间模具台账系统

面向注塑车间的模具全生命周期台账：模具档案、试模排程与判定、改模委外与回厂验收、模次累计与寿命预警、超寿命排产管控、月底按模具的试模/改模统计。车间电脑用浏览器打开即可使用。

- 前端：React 18 + Vite 6（前后分离）
- 后端：Express 4 + better-sqlite3（单文件数据库，无需装数据库服务）
- 四个业务规则各自独立成模块：`lifeCounter`（模次累计）、`lifeAlert`（寿命预警/超寿命卡口）、`repairRounds`（改模轮次/验收流转）、`scheduleConflict`（时段占用）

---

## 一、快速开始（首次使用）

要求 Node.js ≥ 18（推荐 20/22）。在项目根目录执行：

```bash
npm install          # 安装前后端全部依赖
npm run seed         # 初始化数据库并写入种子数据（8副模具 + 一个月记录）
npm run dev          # 同时启动前后端（开发模式）
```

然后浏览器打开：

- 车间电脑本机： **http://localhost:5173**
- 局域网其他电脑：把 `localhost` 换成本机 IP（如 `http://192.168.1.50:5173`），Vite 已开启局域网监听

> `npm run seed` 会**清空重建**数据库（只影响 `server/data/` 下的 sqlite 文件）。正式使用后请勿随意执行。

### 车间单机部署（推荐：只开一个端口）

开发调试是两个端口（前端 5173 + 后端 3001）。车间长期使用建议构建后只跑后端一个端口，后端会直接托管前端页面：

```bash
npm install
npm run seed         # 仅首次
npm run build        # 构建前端到 web/dist
npm start            # 启动后端，默认 3001 端口，页面和 API 同源
```

浏览器打开 **http://localhost:3001** 即可，车间电脑只需保留这一个服务（可以用 `npm install -g pm2` 后 `pm2 start server/src/index.js --name mold-ledger` 做开机常驻）。

改端口：`PORT=8080 npm start`。

---

## 二、业务规则

| 场景 | 规则 | 实现位置 |
|---|---|---|
| 模具档案 | 编号、对应产品、型腔数、额定模次寿命、当前模次 | `routes/molds.js` |
| 试模排程 | 选模具、试模机台、时段，次数自动按模具递增 | `routes/trials.js` |
| 试模判定 | 合格 / 让步接收 / 不合格 + 问题描述；**判不合格同事务自动开出改模单** | `trials.js` → `repairRounds.createRepair` |
| 改模单 | 类型 厂内/委外；委外填厂家、送修/回厂日期 | `modules/repairRounds.js` |
| 回厂验收 | 委外回厂先登记（待回厂→待验收），**必须验收**：合格才关单，不合格退回重改，每重改一轮 `round_no +1` | 同上 |
| 模次累计 | 每次实际生产记一笔流水，事务内整数累加到模具当前模次；拒绝小数/负数 | `modules/lifeCounter.js` |
| 寿命预警 | 当前模次 ≥ 额定 80% 出「预警」；≥100% 为「超寿命」 | `modules/lifeAlert.js` |
| 超寿命排产 | 超寿命模具排产必须勾选主管确认**并填写主管姓名**，否则 409 拒绝；确认留痕在排产单上 | `lifeAlert.assertCanSchedule` |
| 时段冲突 | 同一机台同一时段只能一件事；**一副模具同一时段不能挂在两个产品上**；试模与排产跨表互查；首尾相接不算冲突 | `modules/scheduleConflict.js` |
| 月度统计 | 按模具统计当月试模次数、不合格次数、新开改模单与改模轮次（含退回重改）、当月生产模次 | `routes/reports.js` |

改模单未关闭期间（委外未回厂、回厂未验收、验收不合格未重改），该模具**试模和排产都会被拦下**。

### 改模单状态流转

```
试模判不合格
   │ 自动开单
   ▼
厂内：待验收                    委外：待回厂 ──回厂登记──▶ 待验收
                                   ▲                        │
                          不合格可再委外一轮                  ├─ 验收合格 ─▶ 已关闭（模具回在库）
                                                            └─ 验收不合格 ─▶ 退回重改（第2轮）─▶ 待回厂/待验收
```

---

## 三、五个试玩路径（对应验收场景）

种子数据已经把场景铺好：

| # | 操作 | 预期 |
|---|---|---|
| 1 | 「试模排程」→ 排试模：把 **MJ-1002** 和 **MJ-1003** 都排到 **IM-01**、完全相同的时段 | 第一张成功，第二张弹错「机台 IM-01 … 已被占用，时段冲突」 |
| 2 | 给任意一副在库模具排一次试模，「填判定」选**不合格**，选委外并填厂家 | 保存即提示已自动开出第 1 轮委外改模单，在「改模单」页可见 |
| 3 | 打开 **MJ-1004**（仪表板饰条，已回厂待验收）的改模单，不验收，直接去试模/排产 | 被拦：「已回厂但尚未验收，必须验收合格才能继续」；点验收合格关单后才放行 |
| 4 | 「模具台账」→ MJ-1007 → 记模次，输入一个整数把累计顶到额定的 80% 以上（如填 `100000`） | 寿命徽章变「预警」，台账页顶部出现黄色预警条；输入小数会被拒 |
| 5 | 「生产排产」→ 选 **MJ-1008**（标牌卡扣，已超寿命）排产 | 不勾主管确认 → 红色拦截；勾选但姓名为空 → 仍拦截；填主管姓名后放行，单据上留确认记录 |

补充：**MJ-1001**（前保险杠）是委外中「待回厂」状态；**MJ-1005**（出风口格栅）332000/400000 ≈ 83% 预警中。

后端这 5 个场景另有一份端到端断言脚本（30 项检查）随交付验证通过。

---

## 四、目录结构

```
.
├── package.json            # workspaces 根，npm run dev / build / start / seed
├── server/
│   └── src/
│       ├── index.js        # 启动入口（端口 3001）
│       ├── app.js          # Express 装配；生产模式托管 web/dist
│       ├── db.js           # SQLite 连接与建表
│       ├── seed.js         # 种子数据（npm run seed）
│       ├── modules/        # 四个独立业务模块
│       │   ├── lifeCounter.js
│       │   ├── lifeAlert.js
│       │   ├── repairRounds.js
│       │   └── scheduleConflict.js
│       ├── routes/         # molds / machines / trials / repairs / production / reports
│       └── util/dates.js   # 本地日期时间（存 YYYY-MM-DD HH:mm，可直接比较）
└── web/
    ├── vite.config.js      # /api 代理到 3001
    └── src/pages/          # 台账 / 试模排程 / 改模单 / 生产排产 / 月度统计
```

## 五、主要 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/molds` | 模具列表（含寿命状态）/ 登记 |
| POST | `/api/molds/:id/cycles` | 手动累计模次（正整数） |
| GET/POST | `/api/trials` | 试模列表 / 排试模（冲突与改模卡口） |
| POST | `/api/trials/:id/judge` | 试模判定；不合格带 `repair` 自动开改模单 |
| GET/POST | `/api/repairs`、`/api/repairs/open` | 改模单列表 / 手工开单 |
| POST | `/api/repairs/:id/return` | 委外回厂登记 |
| POST | `/api/repairs/:id/accept` | 验收 `{passed, acceptor}` |
| POST | `/api/repairs/:id/rework` | 验收不合格后退回重改（轮次+1） |
| GET/POST | `/api/production/schedules` | 排产（超寿命须 `overlife_confirmed`+`confirmer`） |
| POST | `/api/production/schedules/:id/cycles` | 按排产单记实际模次 |
| GET | `/api/reports/monthly?month=YYYY-MM` | 月度按模具统计 |
| GET | `/api/reports/alerts` | 寿命预警看板 |

所有业务拦截返回 `409 {error: "中文原因"}`，表单错误返回 `400`，前端直接弹出原因。
