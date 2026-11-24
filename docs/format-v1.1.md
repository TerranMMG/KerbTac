# KerbTac 文件格式 v1.1（`.kerbtac`）

> 状态：**M2 已验收，v1.1 实现契约**（v1 的增量修订）
> 版本：`formatVersion = 1`，`formatRevision = 2`
> 更新：2026-11-05
>
> 本文档扩展 [`format-v1.md`](format-v1.md)。v1 的容器、坐标、姿态、天体、
> 校验与兼容规则**继续有效**；本文档只声明 v1.1 新增的可选字段、可选条目和
> 行为。两者冲突时，以本文档为准；本文档未提到的内容仍以 v1 为准。
>
> 设计原则：**只加可选字段，不改变已有字段语义**。`formatVersion` 仍为 `1`，
> 旧回放端会忽略不认识的字段；新回放端必须能打开没有这些字段的 v1 文件。

---

## 1. 概述

v1.1 面向 M2 的“多载具 + BDA 战斗 + 可恢复分块”：

- 持久载具（飞机、车、船）仍在 `vessels/<id>.json`，采样 10 Hz；其他已加载
  载具 2–5 Hz。
- 导弹、炮弹、炸弹等短命飞行物进入单个 `actors.json`，只保留位置、姿态、
  速度和身份字段。
- chaff / flare / shrapnel / smoke / explosion 只写 `effects.json` 的生成
  事件，由回放端按 `seed` 复现粒子，不逐对象采样。
- BDA 雷达锁定写 `locks.json` 的区间，不逐帧写布尔值。
- 事件补充来源、目标、武器、结果、距离、进入角、伤害与零件身份。
- `session` 补充 `ut0`、时间轴空洞 `gaps` 和任务章节 `chapters`。
- `summary.json` 与 `README.txt` 提供人类可读和外部工具可读的统计。

## 2. 容器

### 2.1 目录结构

```text
manifest.json            必须
bodies.json              必须
events.json              必须
vessels/<vesselId>.json  每个 manifest.vessels[] 一项，必须
actors.json              可选
effects.json             可选
locks.json               可选
summary.json             可选
README.txt               必须（v1.1 写入方；读取方不得强制要求）
preview.png              可选（本版本不生成）
```

其余 ZIP 规则、路径规则、条目顺序、大小限制（64 MB/entry、512 MB 总量、
10 000 条目）与 v1 §2 相同。

### 2.2 顶层条目

| 文件 | 必需 | 说明 |
|---|---|---|
| `manifest.json` | 是 | 格式版本、任务、会话、载具索引 |
| `bodies.json` | 是 | 天体参数，v1 §6 |
| `events.json` | 是 | 事件数组；可为空数组 |
| `vessels/<id>.json` | 是（每个持久载具） | 分段样本 |
| `actors.json` | 否 | 导弹/炮弹等短命轨迹 |
| `effects.json` | 否 | chaff/flare/shrapnel 生成事件 |
| `locks.json` | 否 | 雷达锁定区间 |
| `summary.json` | 否 | 统计摘要 |
| `README.txt` | 是（写入方） | 人类可读摘要 |
| `preview.png` | 否 | 缩略图，回放端忽略 |

## 3. 通用约定

### 3.1 版本

- `formatVersion` 固定为 `1`。
- `formatRevision` 为新增修订号；v1 文件缺省视为 `1`，本版本写 `2`。
- `formatRevision` 只随**向后兼容**的增量变化递增；破坏性变化必须提升
  `formatVersion`。

### 3.2 时间

- `t`、`startUt`、`endUt`、`ut` 仍是 KSP UT 绝对时间（秒），不是相对时间。
- `session.ut0` 是本次会话的参考 UT；缺省等于 `startUt`。回放端显示
  `T+` 时用 `t - ut0`，但**存储与插值仍用绝对 UT**。
- 墙钟时间用 ISO 8601 UTC 字符串；只用于展示和文件命名。

### 3.3 标识符

| 标识 | 形式 | 说明 |
|---|---|---|
| `vesselId` | KSP `vessel.id` 的 Guid 字符串 | 会话内唯一 |
| `actorId` | 稳定字符串，建议 `actor-0001` | 不得与 vesselId 冲突 |
| `side` | `blue` / `red` / `neutral` | 展示阵营 |
| `team` | BDA 原始队伍名，或 `null` | 不做枚举约束 |
| `kind` | 稳定小写分类字符串 | 见 §4.3 |
| `sensor` | `radar` / `irst` / `tws` / `rwr` | 锁定传感器 |
| `mode` | `scan` / `tws` / `stt` / `track` | 锁定模式 |
| `outcome` | `launched` / `hit` / `miss` / `detonated` / `expired` / `unknown` | 事件结果 |

## 4. manifest.json

v1 字段全部保留；新增字段全部可选。

### 4.1 顶层新增

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `formatRevision` | number | `1` | 本版本为 `2` |
| `mission` | object/null | `null` | 任务元数据 |
| `actors` | string | `"actors.json"` | 可选条目路径；无则省略 |
| `effects` | string | `"effects.json"` | 可选条目路径；无则省略 |
| `locks` | string | `"locks.json"` | 可选条目路径；无则省略 |
| `summary` | string | `"summary.json"` | 可选条目路径；无则省略 |

### 4.2 `mission`

```json
{
  "title": "BVR 2v2 — Kerbin",
  "category": "BVR",
  "briefing": "Blue flight vs Red flight, 40 km setup.",
  "debriefing": null,
  "theater": "Kerbin",
  "author": "MNCS",
  "tags": ["BVR", "2v2"],
  "notes": null
}
```

- 所有字段可选；缺省为 `null` 或空数组。
- `briefing` / `debriefing` 可包含换行；JSON 字符串内用 `\n`。
- `theater` 通常是主天体名，不强制。

### 4.3 `vessels[]` 新增

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `kind` | string | `"unknown"` | 稳定展示分类，不依赖 KSP `VesselType` |
| `side` | string | `"neutral"` | `blue` / `red` / `neutral` |
| `team` | string/null | `null` | BDA 原始队伍名 |
| `callsign` | string/null | `null` | 呼号 |
| `health` | number | `1.0` | 0–1；无 BDA 时为 1 |
| `loadout` | string[] | `[]` | 武器名数组 |

`kind` 建议值（可扩展，读取方不得拒绝未知值）：

```text
air/fixedwing      air/rotary       air/glider
ground/vehicle     ground/structure sea/ship
space/vessel       weapon/missile   weapon/bomb
weapon/shell       debris            eva
unknown
```

### 4.4 `session` 新增

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `ut0` | number | `startUt` | 会话参考 UT |
| `gaps` | array | `[]` | 时间轴空洞 |
| `chapters` | array | `[]` | 任务章节/重开分段 |

`gaps[]`：

```json
{ "startUt": 2592600.0, "endUt": 2592612.0, "reason": "pause" }
```

- `reason`：`pause` / `warp` / `scene_change` / `lag` / `revert` /
  `quickload` / `unknown`。
- 只记录没有样本的**时间空洞**；零长度暂停用 `events.json` 的
  `note` 事件表示。
- `startUt < endUt`；同一 session 内不得重叠。

`chapters[]`：

```json
{ "id": "run-1", "name": "Run 1", "startUt": 2592483.41,
  "endUt": 2593023.67, "reason": "manual" }
```

- `reason`：`manual` / `revert` / `quickload` / `scene_change` / `crash`。
- 章节按 `startUt` 排序，不重叠；一个 chapter 内可以包含多个 chunk。
- 没有 `chapters` 时，回放端把整个 session 当作一个 chapter。

## 5. vessels/<id>.json

v1 的 `id`、`name`、`type`、`body`、`segments` 保留；新增以下内容。

### 5.1 逻辑航段与存储分块

```json
{
  "segments": [
    {
      "index": 0,
      "logicalIndex": 0,
      "chunkIndex": 0,
      "kind": "flight",
      "body": "Kerbin",
      "startUt": 2592483.53,
      "endUt": 2592543.53,
      "source": "active",
      "boundary": false,
      "samples": { "t": [], "lat": [] }
    },
    {
      "index": 1,
      "logicalIndex": 0,
      "chunkIndex": 1,
      "kind": "flight",
      "body": "Kerbin",
      "startUt": 2592543.63,
      "endUt": 2592603.63,
      "source": "active",
      "boundary": false,
      "samples": { "t": [], "lat": [] }
    }
  ]
}
```

- 同一 `logicalIndex` 的多个 segment 属于同一个逻辑航段；`chunkIndex`
  从 0 递增。
- 两个字段都可选。缺省时，每个 segment 视为独立逻辑航段（v1 行为）。
- 同一 vessel 内 `(logicalIndex, chunkIndex)` 必须唯一。
- 回放端按 `logicalIndex` 分组、按 `chunkIndex` 排序后拼接样本；若拼接处
  `t` 重叠，保留后一个 chunk 并加一条 warning。
- 录制端 `SpillHalf()` 只增加 `chunkIndex`；只有真正的新飞行段（起飞、
  场景切换、重新开始）才增加 `logicalIndex`。

### 5.2 新增样本列（全部可选）

| 列 | 单位 | 来源 | 说明 |
|---|---|---|---|
| `ias` | m/s | `vessel.indicatedAirSpeed` | 指示空速 |
| `mach` | — | `vessel.mach` | 马赫数 |
| `aoa` | deg | 录制端由速度计算 | 迎角 |
| `aos` | deg | 录制端由速度计算 | 侧滑角 |
| `agl` | m | `vessel.radarAltitude` | 离地高度 |
| `dynPress` | kPa | `vessel.dynamicPressurekPa` | 动压 |
| `pitch` | -1..1 | `vessel.ctrlState.pitch` | 俯仰输入 |
| `roll` | -1..1 | `vessel.ctrlState.roll` | 滚转输入 |
| `yaw` | -1..1 | `vessel.ctrlState.yaw` | 偏航输入 |
| `gear` | 0/1 | `ActionGroups[Gear]` | 起落架 |
| `flaps` | 0..1 | 由具备襟翼数据的采集器提供 | 当前 KSP recorder 不采集，省略 |
| `brakes` | 0/1 | `ActionGroups[Brakes]` | 刹车 |
| `health` | 0..1 | BDA `HitpointTracker`；无 BDA 时该列省略（不要用 1.0 冒充未知） | 伤害历史 |

- 所有新列与 `t` 等长；缺列时回放端按“未知”处理，不得崩溃。
- 读取历史文件不得把某个分块缺失的列补成零。当前写入端的逐行 `null` 与
  实测 `0` 约定见 [v1.3 §8](format-v1.3.md#8-可选列的缺测语义)。
- `q` 仍是姿态四元数（扁平 `4N` 数组）；动态压强用 `dynPress`，不要复用
  `q`。
- v1 的 `vx/vy/vz/throttle/mass/g/stage/situation/hdg/vs/srfSpeed/lf/ox/ec/mp`
  继续有效。

## 6. events.json

v1 事件字段（`ut/type/vessel/target/body/lat/lon/alt/data`）保留；新增：

```json
{
  "ut": 2592523.63,
  "type": "weapon_release",
  "vessel": "shooter-id",
  "source": "shooter-id",
  "target": "target-id",
  "weapon": "AIM-120C",
  "outcome": "launched",
  "range": 28400.0,
  "aspect": 12.5,
  "damage": 0.0,
  "body": "Kerbin",
  "lat": -0.12,
  "lon": 74.3,
  "alt": 8100.0,
  "data": { "part": "missileController", "partId": "4294967295", "engineIndex": 0 }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `source` | string/null | 造成者 ID |
| `weapon` | string/null | 武器/系统名 |
| `outcome` | string/null | 见 §3.3 |
| `range` | number/null | 米；事件时刻 source→target 距离 |
| `aspect` | number/null | 度；目标纵轴与视线的夹角，0°=尾追，180°=迎头 |
| `damage` | number/null | 0–1 |
| `data.partId` | string/null | KSP `part.flightID`，用于区分同名零件 |
| `data.engineIndex` | number/null | 发动机模块索引 |

规则：

- `vessel` 是事件主体（谁身上发生了什么）；`source` 是造成者；`target`
  是目标。三者都可为 `null`。回放端按 `vessel` / `source` / `target`
  任一项匹配选中对象。
- 新增事件类型：`impact`、`weapon_release`、`hit`、`proximity_detonation`、
  `gunfire`、`countermeasure`、`target_lock`、`miss`、`kill`、`chaff`、
  `flare`、`shrapnel`。
- `impact` 是零件碰撞/擦地，不一定是坠毁；`crash` 只在载具真正损失时写；
  `destroyed` 可用于任何载具损失。
- `note` 的 `data.text` 仍保留 `game_paused` / `game_resumed`，并增加
  `data.wallDuration`（真实墙钟秒数）。
- 同一零件同一时刻的两个发动机是两条不同事件：`data.partId` 用
  `part.flightID`，`data.engineIndex` 用模块索引；不要按名字去重。
- 事件位置：v1.1 写入方应尽量写 `body/lat/lon/alt`；没有位置时省略这些
  字段，而不是写 `null`。

## 7. actors.json

```json
{
  "actors": [
    {
      "id": "actor-0001",
      "name": "AIM-120C",
      "kind": "weapon/missile",
      "side": "blue",
      "parent": "shooter-id",
      "target": "target-id",
      "weapon": "AIM-120C",
      "body": "Kerbin",
      "startUt": 2592523.63,
      "endUt": 2592546.03,
      "samples": {
        "t": [2592523.63, 2592523.73],
        "lat": [-0.12, -0.121],
        "lon": [74.3, 74.301],
        "alt": [8100, 8112],
        "q": [0, 0, 0, 1, 0, 0, 0, 1],
        "vx": [900, 905],
        "vy": [0, 1],
        "vz": [30, 31]
      }
    }
  ]
}
```

规则：

- 只放导弹、炮弹、炸弹等需要位置轨迹的短命对象；chaff/flare/shrapnel
  不放这里。
- `id` 必填且不得与 vesselId 冲突；`kind`、`name`、`side`、`parent`、
  `target`、`weapon`、`body` 可选。
- `samples` 至少包含 `t`、`lat`、`lon`、`alt`，且所有数组等长；`t` 严格
  递增。
- `q` 与 v1 一样是扁平 `4N` 数组；可省略，缺省用单位四元数。
- `vx/vy/vz` 可选；回放端缺失时用位置差分。
- 回放端把每个 actor 归一化成一个 `VesselTrack`（`transient: true`），
  复用采样、相机和标签逻辑。

## 8. effects.json

```json
{
  "effects": [
    {
      "ut": 2592530.12,
      "kind": "chaff",
      "body": "Kerbin",
      "lat": -0.13,
      "lon": 74.31,
      "alt": 7900,
      "count": 24,
      "seed": 123456,
      "vx": 850,
      "vy": -4,
      "vz": 30,
      "spread": 18,
      "life": 4.0,
      "source": "target-id",
      "target": null
    }
  ]
}
```

规则：

- `kind`：`chaff` / `flare` / `shrapnel` / `smoke` / `explosion`。
- 必需：`ut`、`kind`、`body`、`lat`、`lon`、`alt`、`count`、`seed`、`life`。
- `count` 1–512；`seed` 任意 int32；`life` > 0 秒。
- `vx/vy/vz` 为初速（m/s），缺省 0；`spread` 为初速随机幅度，缺省 0。
- `source` / `target` 可为 `null`。
- 回放端用 `seed + count` 生成确定性粒子；同一个文件每次播放的粒子位置
  一致。不要记录每个粒子的逐帧位置。

## 9. locks.json

```json
{
  "locks": [
    {
      "source": "blue-1",
      "target": "red-1",
      "sensor": "radar",
      "mode": "STT",
      "startUt": 2592520.0,
      "endUt": 2592538.5
    }
  ]
}
```

规则：

- `source`、`target`、`startUt`、`endUt` 必填；`sensor`、`mode` 可选。
- `startUt < endUt`；同一 `(source, target)` 的区间不得重叠。
- 一个锁定目标变化就关闭上一段、开新段。
- `source` / `target` 可以是 vesselId 或 actorId；回放端解析不到时忽略该段
  并加 warning。
- 回放端用半透明有厚度的线连接 source 与 target，颜色按 source 的 `side`；可开关。双方互相锁定时应错开显示，避免两条线完全重合。

## 10. summary.json 与 README.txt

`summary.json` 可选，录制结束时计算：

```json
{
  "session": {
    "duration": 540.26,
    "distanceKm": 312.4,
    "maxAltitude": 9800,
    "maxSpeed": 410,
    "maxMach": 1.21,
    "maxG": 7.4
  },
  "vessels": [
    {
      "id": "blue-1",
      "name": "Traveller 1",
      "shots": 4,
      "hits": 2,
      "kills": 1,
      "fuelUsed": 820,
      "distanceKm": 156.2
    }
  ],
  "sides": {
    "blue": { "shots": 4, "hits": 2, "kills": 1 },
    "red": { "shots": 3, "hits": 1, "kills": 0 }
  }
}
```

- 所有字段可选；回放端不得依赖 `summary.json` 才能播放。
- `vessels` 的 `hits` / `kills` 计给 `source` 指向的归档载具，而不是事件中作为受害者的 `vessel`；`sides` 只计入来源载具明确的 `side`（包括 `neutral`）。`source` 缺失或无法匹配载具的事件保留在 `events.json`，不计入任何载具或阵营的命中与击杀。统计整场事件总数时，可直接按 `events.json` 的 `type` 计数。
- `README.txt` 由 v1.1 写入方始终写入，内容包括：任务标题、录制时间、
  KSP 版本、章节与载具的数量及列表、各事件类型计数、统计摘要及格式约定。
  统计与 `summary.json` 共用数据；无摘要时明确标记统计不可用。它给人和外部工具读，
  不替代 JSON。

## 11. 校验规则

在 v1 §10 的基础上增加：

1. `formatVersion === 1`；`formatRevision` 缺省为 1，允许 1 或 2。
2. `session.duration ≈ endUt - startUt`，允许 0.01 s 误差。
3. `vessels[].track` 必须指向存在的条目。
4. 每个 `samples` 对象的各列长度必须等于 `t.length`，扁平 `q` 的长度为
   `4 × t.length`；`t` 严格递增。
5. `logicalIndex` / `chunkIndex` 必须为非负整数；同一 vessel 内
   `(logicalIndex, chunkIndex)` 唯一。已发布的 v1.3 文件例外：独立 `orbit`
   段可用负的 `logicalIndex`，见 [v1.3 §6](format-v1.3.md#6-轨道段)。
6. `actors[].samples.t` 严格递增；actor id 不得与 vessel id 冲突。
7. `locks[]` 的 `startUt < endUt`；同一 source/target 区间不重叠。
8. `effects[].count` 1–512；`seed` 任意 int32；`life` > 0。
9. 未知字段忽略；未知事件类型保留并加 warning，不拒绝整个文件。
10. 超过 64 MB/entry 或 512 MB 总大小拒绝。

回放端对 v1.1 可选条目的处理：

- 缺少 `actors.json` / `effects.json` / `locks.json` / `summary.json`：
  视为空数组，不报错。
- 缺少 `mission` / `gaps` / `chapters` / `ut0`：使用默认值。
- 缺少新样本列：对应遥测/标签项显示为未知，不用 0 冒充。
- 缺少 `agl`：高度墙底退回天体半径/海平面。

## 12. 版本与兼容

- v1.1 文件必须能被只支持 v1 的回放端打开；后者会忽略新字段/条目。
- v1 文件必须能被 v1.1 回放端打开；后者按默认值处理缺失字段。
- `formatRevision` 只用于向后兼容增量；破坏性变化提升 `formatVersion`。
- 事件类型、`kind`、`sensor`、`mode`、`outcome` 都是开放字符串集合；
  读取方遇到未知值必须保留并 warning，不得拒绝文件。

## 13. 最小示例

```json
{
  "format": "kerbtac",
  "formatVersion": 1,
  "formatRevision": 2,
  "generator": { "name": "KerbTac Recorder", "version": "0.2.0" },
  "game": {
    "kspVersion": "1.12.5.3190",
    "unityVersion": "2019.4.18f1",
    "saveName": "MNC 2026",
    "scene": "FLIGHT"
  },
  "mission": {
    "title": "BVR 2v2 — Kerbin",
    "category": "BVR",
    "theater": "Kerbin",
    "tags": ["BVR"]
  },
  "session": {
    "id": "20261104T120000Z-a1b2c3",
    "name": "BVR 2v2",
    "ut0": 2592483.41,
    "startUt": 2592483.41,
    "endUt": 2593023.67,
    "startWall": "2026-11-04T12:00:00Z",
    "endWall": "2026-11-04T12:09:00Z",
    "duration": 540.26,
    "gaps": [],
    "chapters": [
      { "id": "run-1", "name": "Run 1", "startUt": 2592483.41,
        "endUt": 2593023.67, "reason": "manual" }
    ]
  },
  "bodies": "bodies.json",
  "events": "events.json",
  "vessels": [
    {
      "id": "2992a474-25cf-453d-bb34-89bd9759afd2",
      "name": "FT-99/34B Traveller",
      "type": "Plane",
      "kind": "air/fixedwing",
      "side": "blue",
      "team": "Blue",
      "callsign": "Traveller 1",
      "body": "Kerbin",
      "color": "#4da3ff",
      "health": 1.0,
      "loadout": ["AIM-120C", "AIM-9X"],
      "rootPart": "MPR.Cockpit.5gen2seat",
      "partCount": 76,
      "crewCount": 2,
      "track": "vessels/2992a474-25cf-453d-bb34-89bd9759afd2.json"
    }
  ]
}
```

---

## 14. M2 实现状态与写入方约定

截至 2026-11-05，录制端与回放端均已通过 M2 验收：

- Core 测试 **98/98**；回放端测试 **128/128**；真实 KSP DLL Release 构建
  0 warnings / 0 errors。
- 录制端写 `formatRevision = 2`；回放端同时接受缺省 revision 1 的 v1 文件。
- 持久载具 `kind` 至少区分 `air/fixedwing`（带 `MissileFire`/`BDModulePilotAI`）
  与其他 `unknown`；短命 actor 写 `weapon/missile`。
- BDA 1.13.1.0 映射：`teamString` 的 `A`/`B` → blue/red；`CurrentMissile` 读当前
  武器；`VesselRadarData.locked` + `lockedTargetData.vessel` → `mode=stt`；
  `guardTarget/currentTarget/targetOverride` → `mode=track`；`firedMissiles`
  增加时写 `weapon_release`。
- 当前真实录制通常只产出 `weapon_release` 与 `locks.json` 区间；`hit`、`kill`、
  `target_lock` 事件类型由格式和回放端支持，但 BDA 反射适配器尚无可靠来源。
  `effects.json` 的 BDA chaff/flare 自动提取为空；夹具里的 synthetic 事件不代表
  真实 BDA 保证。
- `manifest.health` 无 BDA 时默认 1；逐样本 `health` 列无 BDA 时省略，避免把
  “未知”显示成满血。
- 回放端将没有 AGL 的旧文件按 ASL 放置；新文件优先用 AGL 将载具贴合渲染球面。
- M2 回放端把场景固定在 session `ut0` 的星球姿态，**不模拟星球自转**；所有 body-fixed 位置直接映射到该固定帧。这样既保留绝对 UT 的采样/事件语义，也避免播放时相机焦点随自转漂移和着陆点显示偏移。

---

## 15. M3 位置关键帧约定（2026-11-05）

M3 是 **Kerbin 单 SOI 多载具位置回放**，不引入 Kepler 轨道传播，也不提升
`formatVersion` / `formatRevision`。v1.1 的现有结构足以表达：

- 活跃载具：`kind: "flight"`、`source: "active"`，默认 10 Hz。
- 已加载非活跃载具：`kind: "flight"`、`source: "loaded"`，2–5 Hz。
- 未加载 / on-rails / packed 载具：`kind: "flight"`、`source: "unloaded"`，
  **10 s UT 位置关键帧**；样本仍包含 `t/lat/lon/alt/q`，播放端只做插值。
- 地面/着陆/发射前载具：`kind: "static"`，单样本；播放端从该样本起持续可见。
- `bodies.json` 只写当前主天体 Kerbin，作为根：`parent = null`、`orbit = null`；
  场景固定在 `manifest.session.ut0`，不模拟行星自转或 SOI 切换。
- 位置关键帧仍使用 `lat/lon/alt`，不写 Kepler 根数；`kind: "orbit"` 保留给后续
  里程碑，M3 不产生 orbit 段。
- 旧 v1 / v1.1 文件继续可读；未知 `source` 值不影响解析，回放端按普通 flight
  段插值。

M3 新增的录制端语义（距离滑杆、10% 迟滞、排除 debris/flag/asteroid/space
object/EVA）不改变文件结构，只影响哪些载具会出现在 `vessels.json` 中。

---

## 变更记录

| 版本 | 日期 | 内容 |
|---|---|---|
| 1.1 | 2026-11-04 | M2：mission/session gaps/chapters、vessel side/team/callsign/kind/health/loadout、logical/chunk 索引、新样本列、actors/effects/locks/summary、事件扩展 |
| 1.1-a | 2026-11-05 | M2 验收；补充 BDA 实际写入边界、health 缺省语义、锁定线渲染说明 |
| 1.1-b | 2026-11-05 | M3 位置关键帧约定：`flight` + `source`、10 s 未加载帧、静态单样本、仅 Kerbin 根；不升版本 |
