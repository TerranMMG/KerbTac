# KerbTac 数据说明

<p align="center">
  <strong>简体中文</strong> &nbsp;·&nbsp; <a href="#english">English</a>
</p>

## 中文

> 本文说明 `.kerbtac` 录像里的数据从哪里来、哪些是直接测量、哪些是推导或推断、
> 缺测如何表示，以及已知限制。字段级 schema 见 [`format-v1.md`](format-v1.md)
> 及增量文档 [`format-v1.1.md`](format-v1.1.md)、[`format-v1.2.md`](format-v1.2.md)、
> [`format-v1.3.md`](format-v1.3.md)。本文不重复全部字段表。

## 1. 数据边界与隐私

KerbTac 的录制端只在 KSP 的 Flight 场景内运行，把数据写到本地 ZIP 文件：

- 录像保存在 `GameData/KerbTac/Recordings/<存档名>/`，扩展名为 `.kerbtac`。
  录像位于模组目录内；删除或覆盖 `GameData/KerbTac` 会连同录像一起删除，卸载前请先备份。
- 录制端不上传录像，播放器运行时也不发起网络请求；回放完全离线。
- 录像可能包含存档名、任务名、载具名、坐标、阵营/队伍和战斗事件。分享录像前请自行检查这些内容。
- 录像不包含账号 token、SSH/网络凭据、KSP 程序集、Squad 二进制或 BDArmory DLL。
- 卸载前请把 `Recordings/` 复制到模组目录之外。

## 2. 文件与数据来源

| 文件 | 内容 | 主要来源 | 数据性质 |
| --- | --- | --- | --- |
| `manifest.json` | 格式版本、任务/会话、载具索引、录制模式 | 录制端会话状态 | 直接 |
| `bodies.json` | 天体半径、自转、轨道、样式 | KSP `CelestialBody` | 直接 |
| `vessels/<id>.json` | 载具元数据、逻辑航段、分块样本 | KSP `Vessel`、`Orbit`、动作组 | 直接 + 推导 |
| `events.json` | 飞行、分级、战斗、任务断点等事件 | KSP 状态变化；BDA 反射；录制端归因 | 混合 |
| `actors.json` | 导弹、炮弹、炸弹等短命轨迹 | BDA 反射 + 位置采样 | 混合 |
| `effects.json` | 干扰弹、烟雾、爆炸等效果生成事件 | BDA 反射；录制端状态 | 尽力而为 |
| `locks.json` | 雷达/IRST 锁定区间 | BDA 反射 | 尽力而为 |
| `summary.json` | 会话与逐载具统计 | 录制端对事件和样本的汇总 | 推导 |
| `README.txt` | 人类可读摘要 | 录制端生成 | 展示用，不是权威数据 |
| `models.json` / `models/*` | 用户导入的 OBJ/STL 模型 | 用户在播放器中导入 | 用户输入，可选 |

`README.txt` 与 `summary.json` 都是辅助材料。播放器不依赖它们才能回放；统计口径以
`events.json` 和 `vessels/*.json` 为准。

## 3. 时间、坐标与单位

- **时间**：所有时间点是 KSP UT（Universal Time），单位秒。墙钟时间只用于文件命名和展示。
- **位置**：`lat` / `lon` / `alt` 是星球固定系（body-fixed）的纬度、经度和海平面以上高度。
- **姿态**：`q` 是 `[x, y, z, w]` 顺序的单位四元数；轨迹里可写成扁平 `4N` 数组。
- **速度**：`vx` / `vy` / `vz` 是星球固定系分量，单位 m/s。
- **播放器镜像**：Three.js 渲染时对位置应用 `S = diag(1, 1, -1)`，对四元数应用
  `(-qx, -qy, qz, qw)`；这是渲染坐标转换，不改变文件里的数据。

常用单位：

| 量 | 单位 |
| --- | --- |
| 距离、高度、半径 | m |
| 速度 | m/s |
| 质量 | kg |
| 角度 | 度 |
| 过载 | g（KSP `geeForce`，1.0 = 1 g） |
| 油门 | 0–1 |
| 资源量 | KSP 游戏单位 |

字段级定义见 [`format-v1.md` §3](format-v1.md#3-通用约定) 与
[`format-v1.md` §4](format-v1.md#4-坐标系与姿态规范性)。

## 4. 采样、分段与分块

录制端按对象状态选择采样方式：

- **主动载具**：默认 10 Hz。
- **附近已加载载具**：按距离采样，距离越近越密。
- **范围内未加载载具**：按 10 秒位置关键帧记录；高时间加速下同样使用关键帧。
- **导弹/炸弹 actor**：约 20 Hz；只在需要位置轨迹时进入 `actors.json`。
- **录制范围**：0–100,000 km，带 10% 迟滞，避免边界来回切换。

轨迹段（`segments[]`）有四种 `kind`：

| kind | 用途 | 位置来源 |
| --- | --- | --- |
| `flight` | 大气内飞行 / 物理加载 | `lat/lon/alt` 采样 |
| `surface` | 地面或水面静止/低速 | `lat/lon/alt` 采样 |
| `orbit` | on-rails / 未加载 | 轨道根数 |
| `static` | 只记录一次的位置 | 单个样本 |

同一逻辑航段可以分成多个存储块（`logicalIndex` / `chunkIndex`），用于录制期间分块落盘。
读取方按 `logicalIndex` 分组、按 `chunkIndex` 排序后拼接；重叠时间保留后一个分块并给出警告。
可选遥测列可以只出现在部分分块中，不能因为某个分块缺列就丢掉其它分块的值。

`source` 标记采样来源：`active` / `loaded` / `unloaded` / `checkpoint`。它描述“这个样本是怎么来的”，
不是数据质量评级。

## 5. 身份、分类与血缘

- **`vesselId`**：KSP `vessel.id` 的 Guid 字符串，会话内唯一；文件名和 `manifest.vessels[]` 必须一致。
- **`name` / `type` / `situation`**：来自 KSP 的载具名、`VesselType` 和 `Vessel.Situations`。
- **`role`**：Combat/Space 模式下的对象角色（`stage.booster`、`stage.upper`、`fairing`、`payload`、`debris` 等）。
- **`parentId` / `stageIndex` / `separatedUt`**：分级血缘。分离后的级段可以挂在母箭下面，而不是当成陌生残骸。
- **`modelRole`**：播放端选择程序化模型的角色（`air.fighter`、`ground.sam`、`sea.ship`、`space.rocket` 等）。
  缺省时回退到 `type` + `kind`。
- **`threat`**：录制开始瞬间冻结的导弹/雷达射程；不会随后续状态变化。

模式差异：

- **Combat**：过滤 Debris/EVA/Flag，记录战斗数据。
- **Space**：在 Combat 基础上记录分级对象、血缘、角色分类，以及当前载具在 packed/warp > 1 区间的轨道段。

导弹 actor 的判定是：载具含 `MissileBase` 或 `MissileLauncher`，且不含 `MissileFire` 或
`BDModulePilotAI`。这是一条录制端规则，不是 KSP 的正式分类；自定义武器可能落在规则之外。

## 6. 战斗数据与归因

BDArmory Plus 是**可选依赖**。录制端不硬引用 `BDArmory.dll`，而是在运行时反射读取：

- `MissileFire` / `VesselRadarData`：队伍、雷达锁定、发射关系。
- `HitpointTracker`：health。
- `ModuleWeapon` / `CMDropper` / `MissileBase` / `MissileLauncher`：机炮、干扰弹、导弹/炸弹。

字段缺失、类型改名或成员抛异常时，录制端降级并只记录一次警告；录制继续，不会因为 BDA
不可用而中止。未安装 BDA 时，原版飞行仍可正常录制。

主要事件：

| 事件 | 含义 | 主体约定 |
| --- | --- | --- |
| `gunfire` | 一段机炮连射 | `vessel` 是发射方 |
| `countermeasure` / `chaff` / `flare` | 干扰弹释放 | `vessel` 是释放方 |
| `weapon_release` | 导弹/炸弹/火箭离架 | `vessel` 是发射方 |
| `impact` / `proximity_detonation` | 撞击/爆炸/近炸 | 按事件字段解释 |
| `hit` | 目标健康值下降 | `vessel` 是受击方，`source` 是攻击方 |
| `kill` / `destroyed` | 击毁 | `vessel` 是被摧毁方，`source` 可归因时是攻击方 |
| `miss` | 未命中/超时 | `vessel` 是被瞄准方，`source` 是发射方 |
| `target_lock` | 雷达/IRST 锁定区间开始 | 按 `locks.json` 与事件字段解释 |
| `team_change` | BDA 队伍/阵营变化 | `vessel` 是换队载具 |
| `engine_mode_change` | 多个引擎在 2 秒内同时启停，合并为模式切换 | `vessel` 是载具 |

命中/击毁采用严格归因：只有 health 汇总、明确目标、200 m 内 impact 或 30 秒内 health 下降等
证据足够时才写入 `source`。归因不足的事件可以保留在 `events.json`，但不会计给任何载具或阵营。
`summary.json` 的 `hits` / `kills` 计给 `source` 指向的载具，而不是事件里作为受害者的 `vessel`；
`sides` 只统计来源载具阵营明确的条目。

`locks.json` 的区间来自雷达锁定状态；同一 `(source, target)` 的区间不重叠。`effects.json`
只记录效果生成事件和确定性种子，不记录每个粒子的逐帧位置；播放器用 `seed + count` 重建粒子。

## 7. 缺测、推导与置信度

本文用四档描述数据来源，**这不是格式字段，也不改变文件内容**：

| 档 | 含义 | 例子 |
| --- | --- | --- |
| **A 直接** | KSP API 直接给出，或由明确几何关系得到 | UT、经纬度、高度、四元数、`VesselType` |
| **B 推导** | 由多个直接量计算，规则写在文档里 | 航向、垂直速度、AOA/AOS、`summary.json` |
| **C 尽力而为** | 反射读取或规则归因，BDA 版本变化可能失效 | health、队伍、雷达锁定、命中/击毁来源 |
| **D 不记录** | 当前格式没有该数据，或播放器不绘制 | BDA 扩展零件模型、激光类型、CM 烟雾、旧录像爆炸/破片 |

缺测语义：

- **必需列**必须存在且为有限数值；否则该文件不合法。
- **可选列完全没采到**：不写该键。
- **可选列部分采到**：数组与 `t` 等长，缺测行写 JSON `null`。
- **`0` 是有效值**：中立操纵、脱开的动作组、空容器、已测得的零 health 都可能是 `0`。
- **缺测不是 0**：读取方不得把 `null` 或缺失列补成 `0`，也不得跨缺测行插值。
- **可选文件缺失**：`actors.json` / `effects.json` / `locks.json` / `summary.json` 缺失时按空处理，不报错。
- **未知字段/事件/类型**：读取方忽略并继续；未知事件类型可以保留并警告。
- **旧文件**：不按 `formatRevision`、载具类型或相邻分块猜测缺失值的含义；按未知处理。

历史录像里的“某个分块缺列”可能同时代表“没采集”和“整块恰好为零”。这两种情况在旧 writer 里
无法区分，因此当前播放器一律按未知处理，不填零。

## 8. 模型与资产

- 内置载具和弹药外形是**原创程序化模型**，不加载 BDA `.mu` 网格，也不加载 MTL、纹理或外部文件。
- 用户可以给单艘载具导入 OBJ/STL；模型以 SHA-256 命名，写入 `models.json` 与 `models/<sha256>.<obj|stl>`。
- 导入模型只读取网格，按包围盒居中并把最长轴适配到 120 场景单位；缩放、旋转、偏移由 `models.json` 控制。
- 单模型最多 50 MiB，每个归档唯一模型合计最多 300 MiB；超出时该模型回退到内置外形。
- Kerbin 底图 `kerbin-16k-tacview.webp` 是基于 KSP/Smooney 地图重绘的衍生图，来源与限制见
  [`NOTICE.md`](../NOTICE.md)。仓库不分发 KSP 程序集、Squad 二进制或 BDArmory DLL。

## 9. 校验与排错

一个合法的 `.kerbtac` 至少要通过：

1. 文件头是 `PK\x03\x04`（或空 ZIP 的 `PK\x05\x06`）。
2. ZIP 可解压、未加密、条目路径安全；解压后不超过 64 MB/entry、512 MB 总量、10,000 条目。
3. `manifest.json` 存在、是对象，`format === "kerbtac"`，`formatVersion` 在支持范围内。
4. `bodies.json`、`events.json`、每个 `manifest.vessels[].track` 存在且合法。
5. 每个样本对象的各列长度等于 `t.length`，扁平 `q` 长度为 `4 × t.length`，`t` 严格递增。
6. 数值是有限数；`lat` / `lon` / `alt` 在允许范围内。

完整规则见 [`format-v1.md` §10](format-v1.md#10-校验规则读取方必须执行) 与
[`format-v1.1.md` §11](format-v1.1.md#11-校验规则)。播放器对未知字段、未知事件类型、
缺失可选列和轻微乱序只警告，不拒绝整份文件；对必需字段损坏、路径不安全或超过大小限制则拒绝并给出原因。

常见现象：

| 现象 | 可能原因 |
| --- | --- |
| 文件打不开，提示没有可回放的载具 | 必需文件/轨迹缺失，或所有段都没有样本 |
| 遥测显示未知而不是 0 | 该列没有采集；这是预期行为，不是解析失败 |
| 没有战斗事件 | 未安装 BDA、BDA 大版本字段变化，或该场没有发生对应事件 |
| 旧播放器拒绝新录像 | 新录像含旧播放器不认识的列/轨道段；升级播放器 |
| 模型显示为内置外形 | `models.json` 无效、模型缺失/超限，或该载具没有绑定 |

公开仓库不要求专用检查工具；任何 ZIP/JSON 工具都可以读取容器和 JSON。项目内部的
Inspector 只用于开发验收，不随发布导出。

## 10. 兼容性

- 当前格式是 `formatVersion = 1`，`formatRevision = 1–4`；每个 revision 只增加可选字段，不改变旧字段。
- 当前播放器读取 revision 1–4；旧播放器可能拒绝更新的可选列、`null` 单元格或无样本的轨道段。
- `recordingMode` 为 `combat` 或 `space`；缺省视为 `combat`。
- 轨道段只对 Space 模式的当前载具写入；跨 SOI 不处理，未加载的非当前载具仍使用 10 秒位置关键帧。
- 播放器把星球固定在录制起点的姿态，不模拟播放期间的自转；这是显示约定，不是数据缺失。

## 11. 已知限制

- BDA 数据是反射读取的 best-effort；BDA 大版本升级后字段可能改名或消失。
- 激光武器按普通曳光弹绘制；Hydra70 火箭归入机炮事件；干扰弹烟雾以及旧录像的爆炸/破片特效不绘制。
- `INFINITE_COUNTERMEASURES = true` 时 `cmCount` 不递减，无法检测干扰弹释放。
- BDArmoryExtended 的零件和模型未包含；兼容的 BDA 弹药名称映射到原创程序化回放模型。
- 轨迹底层是 10 Hz 采样；高时间加速和未加载载具使用关键帧或稀疏轨道段，播放端的平滑是插值，不是重新模拟。
- 星球底图为 16K 单张纹理；32K/64K 局部瓦片 LOD 尚未实现。
- 录像不包含完整零件树、`ConfigNode` 或 Unity 原始世界坐标；需要这些数据的工具应另行采集。

## 12. 相关文档

- [格式总览](format-v1.md)
- [v1.1：分块、actor/effect/lock、summary](format-v1.1.md)
- [v1.2：战斗事件与 data 键](format-v1.2.md)
- [v1.3：录制模式、角色、轨道段、缺测语义](format-v1.3.md)
- [文档索引](README.md)
- [许可证与第三方说明](../NOTICE.md)

---

## English

<p align="center">
  <a href="#中文">简体中文</a> &nbsp;·&nbsp; <strong>English</strong>
</p>

> This document explains where the data in a `.kerbtac` recording comes from, which values are
> measured directly, which are derived or inferred, how missing measurements are represented,
> and the known limitations. Field-level schemas are in [`format-v1.md`](format-v1.md#english)
> and the incremental documents [`format-v1.1.md`](format-v1.1.md), [`format-v1.2.md`](format-v1.2.md),
> and [`format-v1.3.md`](format-v1.3.md). This document does not repeat the full field tables.

### 1. Data boundaries and privacy

The KerbTac recorder runs only in the KSP Flight scene and writes data to a local ZIP file:

- Recordings are stored under `GameData/KerbTac/Recordings/<save name>/` with the `.kerbtac`
  extension. Recordings live inside the mod directory, so deleting or overwriting
  `GameData/KerbTac` deletes them along with it; back them up before uninstalling.
- The recorder does not upload recordings, and the player makes no network requests at runtime;
  replay is fully offline.
- A recording may contain save names, mission names, vessel names, coordinates, sides/teams,
  and combat events. Check this content yourself before sharing a recording.
- Recordings do not contain account tokens, SSH/network credentials, KSP assemblies, Squad
  binaries, or BDArmory DLLs.
- Before uninstalling, copy `Recordings/` outside the mod directory.

### 2. Files and data sources

| File | Contents | Primary source | Data nature |
| --- | --- | --- | --- |
| `manifest.json` | Format version, mission/session, vessel index, recording mode | Recorder session state | Direct |
| `bodies.json` | Body radius, rotation, orbit, style | KSP `CelestialBody` | Direct |
| `vessels/<id>.json` | Vessel metadata, logical flight segments, chunked samples | KSP `Vessel`, `Orbit`, action groups | Direct + derived |
| `events.json` | Events such as flight, staging, combat, and mission breaks | KSP state changes; BDA reflection; recorder attribution | Mixed |
| `actors.json` | Short-lived trajectories such as missiles, shells, and bombs | BDA reflection + position sampling | Mixed |
| `effects.json` | Effect-spawn events such as countermeasures, smoke, and explosions | BDA reflection; recorder state | Best-effort |
| `locks.json` | Radar/IRST lock intervals | BDA reflection | Best-effort |
| `summary.json` | Session and per-vessel statistics | Recorder aggregation of events and samples | Derived |
| `README.txt` | Human-readable summary | Generated by the recorder | For display; not authoritative data |
| `models.json` / `models/*` | User-imported OBJ/STL models | Imported by the user in the player | User input, optional |

`README.txt` and `summary.json` are both auxiliary material. The player does not depend on them
to replay; the authoritative statistics come from `events.json` and `vessels/*.json`.

### 3. Time, coordinates, and units

- **Time**: all timestamps are KSP UT (Universal Time) in seconds. Wall-clock time is used only
  for file naming and display.
- **Position**: `lat` / `lon` / `alt` are body-fixed latitude, longitude, and altitude above sea
  level.
- **Attitude**: `q` is a unit quaternion in `[x, y, z, w]` order; in trajectories it may be
  written as a flat `4N` array.
- **Velocity**: `vx` / `vy` / `vz` are body-fixed components in m/s.
- **Player mirror**: Three.js applies `S = diag(1, 1, -1)` to positions and
  `(-qx, -qy, qz, qw)` to quaternions when rendering; this is a render-space conversion and does
  not change the data in the file.

Common units:

| Quantity | Unit |
| --- | --- |
| Distance, altitude, radius | m |
| Velocity | m/s |
| Mass | kg |
| Angle | degrees |
| G-force | g (KSP `geeForce`, 1.0 = 1 g) |
| Throttle | 0–1 |
| Resource amounts | KSP game units |

Field-level definitions are in [`format-v1.md` §3](format-v1.md#3-common-conventions) and
[`format-v1.md` §4](format-v1.md#4-coordinate-systems-and-attitude-normative).

### 4. Sampling, segments, and chunks

The recorder chooses a sampling method from object state:

- **Active vessel**: 10 Hz by default.
- **Nearby loaded vessels**: sampled by distance; the closer the vessel, the denser the samples.
- **Unloaded vessels in range**: recorded as position keyframes every 10 seconds; keyframes are
  also used under high time warp.
- **Missile/bomb actors**: about 20 Hz; they enter `actors.json` only when a position trajectory
  is needed.
- **Recording range**: 0–100,000 km with 10% hysteresis to avoid flip-flopping at the boundary.

Trajectory segments (`segments[]`) have four `kind` values:

| kind | Purpose | Position source |
| --- | --- | --- |
| `flight` | Atmospheric flight / physics-loaded | `lat/lon/alt` samples |
| `surface` | Stationary or slow on the ground or water | `lat/lon/alt` samples |
| `orbit` | On-rails / unloaded | Orbital elements |
| `static` | Position recorded only once | A single sample |

One logical flight segment can be split into several storage chunks (`logicalIndex` /
`chunkIndex`) so data is spilled to disk during recording. Readers group by `logicalIndex`, sort
by `chunkIndex`, and then concatenate; for overlapping times the later chunk is kept and a
warning is emitted. Optional telemetry columns may appear in only some chunks; a column missing
from one chunk must not cause values from other chunks to be discarded.

`source` marks the sampling origin: `active` / `loaded` / `unloaded` / `checkpoint`. It describes
how the sample was obtained, not a data-quality rating.

### 5. Identity, classification, and lineage

- **`vesselId`**: the Guid string of KSP `vessel.id`, unique within the session; the file name and
  `manifest.vessels[]` must agree.
- **`name` / `type` / `situation`**: the vessel name, `VesselType`, and `Vessel.Situations` from
  KSP.
- **`role`**: the object role in Combat/Space mode (`stage.booster`, `stage.upper`, `fairing`,
  `payload`, `debris`, etc.).
- **`parentId` / `stageIndex` / `separatedUt`**: staging lineage. A separated stage can hang under
  its parent stack instead of being treated as an unfamiliar piece of debris.
- **`modelRole`**: the role the player uses to pick a procedural model (`air.fighter`,
  `ground.sam`, `sea.ship`, `space.rocket`, etc.). When absent, it falls back to `type` + `kind`.
- **`threat`**: missile/radar ranges frozen at the instant recording starts; they do not follow
  later state changes.

Mode differences:

- **Combat**: filters out Debris/EVA/Flag and records combat data.
- **Space**: on top of Combat, records staging objects, lineage, role classification, and orbit
  segments for the current vessel during packed / warp > 1 periods.

A missile actor is identified as: a vessel that has `MissileBase` or `MissileLauncher` and does
not have `MissileFire` or `BDModulePilotAI`. This is a recorder-side rule, not an official KSP
classification; custom weapons may fall outside it.

### 6. Combat data and attribution

BDArmory Plus is an **optional dependency**. The recorder does not hard-reference
`BDArmory.dll`; it reads values through reflection at runtime:

- `MissileFire` / `VesselRadarData`: teams, radar locks, launch relationships.
- `HitpointTracker`: health.
- `ModuleWeapon` / `CMDropper` / `MissileBase` / `MissileLauncher`: guns, countermeasures,
  missiles/bombs.

When a field is missing, a type is renamed, or a member throws, the recorder degrades and logs a
single warning; recording continues and is never aborted because BDA is unavailable. Stock
flights still record normally without BDA installed.

Main events:

| Event | Meaning | Subject convention |
| --- | --- | --- |
| `gunfire` | A burst of gunfire | `vessel` is the shooter |
| `countermeasure` / `chaff` / `flare` | Countermeasure release | `vessel` is the releaser |
| `weapon_release` | A missile/bomb/rocket leaves the rail | `vessel` is the launcher |
| `impact` / `proximity_detonation` | Impact/explosion/proximity burst | Interpreted from the event fields |
| `hit` | Target health decreases | `vessel` is the one hit, `source` is the attacker |
| `kill` / `destroyed` | Destruction | `vessel` is the destroyed one; `source` is the attacker when it can be attributed |
| `miss` | Miss/timeout | `vessel` is the targeted one, `source` is the launcher |
| `target_lock` | Start of a radar/IRST lock interval | Interpreted with `locks.json` and the event fields |
| `team_change` | BDA team/side change | `vessel` is the vessel that changed team |
| `engine_mode_change` | Several engines starting or stopping within 2 seconds, merged into a mode change | `vessel` is the vessel |

Hits and kills use strict attribution: `source` is written only when the evidence is sufficient —
a health summary, an explicit target, an `impact` within 200 m, or a health drop within
30 seconds. Events with insufficient attribution may remain in `events.json`, but they are not
credited to any vessel or side. In `summary.json`, `hits` / `kills` are credited to the vessel
referenced by `source`, not to the `vessel` that appears as the victim in the event; `sides`
counts only entries whose source vessel has an explicit side.

Intervals in `locks.json` come from radar lock state; intervals for the same `(source, target)`
do not overlap. `effects.json` records only effect-spawn events and deterministic seeds, not the
per-frame position of every particle; the player rebuilds particles from `seed + count`.

### 7. Missing data, derivation, and confidence

This document uses four tiers to describe provenance; **these are not format fields and do not
change the file contents**:

| Tier | Meaning | Examples |
| --- | --- | --- |
| **A Direct** | Given directly by the KSP API, or obtained from an explicit geometric relationship | UT, latitude/longitude, altitude, quaternion, `VesselType` |
| **B Derived** | Computed from several direct quantities, with the rules documented | heading, vertical speed, AOA/AOS, `summary.json` |
| **C Best-effort** | Reflection reads or rule-based attribution; may break when the BDA version changes | health, team, radar lock, hit/kill source |
| **D Not recorded** | The current format does not carry this data, or the player does not draw it | BDA extended part models, laser types, CM smoke, explosions/shrapnel in legacy recordings |

Missing-value semantics:

- **Required columns** must exist and be finite; otherwise the file is invalid.
- **Optional column with no samples at all**: the key is omitted.
- **Optional column with partial samples**: the array has the same length as `t`, and missing rows
  are JSON `null`.
- **`0` is a valid value**: neutral steering, a disengaged action group, an empty container, and a
  measured health of zero can all be `0`.
- **Missing is not 0**: readers must not fill `null` or missing columns with `0`, and must not
  interpolate across missing rows.
- **Optional file missing**: when `actors.json` / `effects.json` / `locks.json` / `summary.json`
  are absent, treat them as empty, without an error.
- **Unknown fields/events/types**: readers ignore them and continue; unknown event types may be
  preserved with a warning.
- **Legacy files**: do not guess the meaning of missing values from `formatRevision`, vessel type,
  or neighboring chunks; treat them as unknown.

In legacy recordings, "a column missing from a chunk" can mean both "never sampled" and "the
whole chunk happened to be zero". Older writers could not distinguish the two, so the current
player always treats them as unknown and does not fill in zeros.

### 8. Models and assets

- Built-in vessel and munition shapes are **original procedural models**; they load no BDA `.mu`
  meshes and no MTL, textures, or external files.
- Users can import OBJ/STL for an individual vessel; models are named by SHA-256 and written to
  `models.json` and `models/<sha256>.<obj|stl>`.
- An imported model contributes only its mesh: it is centered on its bounding box and its longest
  axis is fitted to 120 scene units; scale, rotation, and offset are controlled by `models.json`.
- A single model is limited to 50 MiB, and the unique models in one archive to 300 MiB in total;
  beyond that, the model falls back to the built-in shape.
- The Kerbin basemap `kerbin-16k-tacview.webp` is a derivative redrawn from the KSP/Smooney map;
  sources and restrictions are in [`NOTICE.md`](../NOTICE.md). The repository does not
  redistribute KSP assemblies, Squad binaries, or BDArmory DLLs.

### 9. Validation and troubleshooting

A valid `.kerbtac` must at least pass:

1. The file header is `PK\x03\x04` (or `PK\x05\x06` for an empty ZIP).
2. The ZIP opens, is unencrypted, and has safe entry paths; after extraction it must not exceed
   64 MB per entry, 512 MB in total, or 10,000 entries.
3. `manifest.json` exists and is an object, `format === "kerbtac"`, and `formatVersion` is within
   the supported range.
4. `bodies.json`, `events.json`, and each `manifest.vessels[].track` exist and are valid.
5. For every sample object, each column length equals `t.length`, the flat `q` length is
   `4 × t.length`, and `t` is strictly increasing.
6. Values are finite; `lat` / `lon` / `alt` are within the allowed ranges.

The full rules are in [`format-v1.md` §10](format-v1.md#10-validation-rules-readers-must-enforce) and
[`format-v1.1.md` §11](format-v1.1.md#11-校验规则). For unknown fields, unknown event types,
missing optional columns, and minor out-of-order samples, the player only warns and does not
reject the whole file; for corrupt required fields, unsafe paths, or size-limit violations it
rejects the file and gives the reason.

Common symptoms:

| Symptom | Possible cause |
| --- | --- |
| The file will not open and reports no replayable vessels | Required files/track missing, or all segments have no samples |
| Telemetry shows unknown instead of 0 | The column was not sampled; this is expected behavior, not a parse failure |
| No combat events | BDA not installed, fields changed in a major BDA version, or none of these events occurred in that session |
| An older player rejects a newer recording | The newer recording contains columns/orbit segments the older player does not understand; upgrade the player |
| A model shows as the built-in shape | `models.json` is invalid, the model is missing or over the limit, or the vessel has no binding |

The public repository requires no dedicated inspection tool; any ZIP/JSON tool can read the
container and the JSON. The project's internal Inspector is only for development acceptance and
is not part of the release export.

### 10. Compatibility

- The current format is `formatVersion = 1`, `formatRevision = 1–4`; each revision only adds
  optional fields and does not change older fields.
- The current player reads revisions 1–4; older players may reject newer optional columns,
  `null` cells, or orbit segments with no samples.
- `recordingMode` is `combat` or `space`; absent means `combat`.
- Orbit segments are written only for the current vessel in Space mode; SOI changes are not
  handled, and unloaded non-current vessels still use 10-second position keyframes.
- The player fixes each planet at its attitude at the recording start and does not simulate
  rotation during playback; this is a display convention, not missing data.

### 11. Known limitations

- BDA data is read by reflection on a best-effort basis; fields may be renamed or disappear after
  a major BDA upgrade.
- Laser weapons are drawn as ordinary tracers; Hydra70 rockets are grouped into gunfire events;
  countermeasure smoke and the explosion/shrapnel effects of legacy recordings are not drawn.
- With `INFINITE_COUNTERMEASURES = true`, `cmCount` does not decrease, so countermeasure releases
  cannot be detected.
- Parts and models from BDArmoryExtended are not included; compatible BDA munition names map to
  original procedural replay models.
- Trails are based on 10 Hz samples; high time warp and unloaded vessels use keyframes or sparse
  orbit segments, and smoothing in the player is interpolation, not re-simulation.
- The planet basemap is a single 16K texture; 32K/64K tiled LOD is not implemented yet.
- Recordings do not contain the full part tree, `ConfigNode`, or raw Unity world coordinates;
  tools that need this data must collect it separately.

### 12. Related documents

- [Format overview](format-v1.md#english)
- [v1.1: chunks, actor/effect/lock, summary](format-v1.1.md)
- [v1.2: combat events and data keys](format-v1.2.md)
- [v1.3: recording modes, roles, orbit segments, missing-value semantics](format-v1.3.md)
- [Documentation index](README.md)
- [License and third-party notices](../NOTICE.md)
