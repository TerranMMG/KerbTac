# KerbTac format v1.2 (formatRevision = 3)

> 基于 `format-v1.1.md`。v1.2 只新增可选字段与约定，不改变 v1/v1.1 的必填字段；旧播放器遇到 `formatRevision = 3` 应继续按 v1.1 读取并忽略未知键。

## 1. 容器与版本

- `manifest.json` 的 `formatVersion = 1`，`formatRevision = 3`。
- 其余文件（`bodies.json`、`events.json`、`vessels/*.json`、`actors.json`、`effects.json`、`locks.json`、`summary.json`）布局不变。
- 未识别的事件 `type`、effect `kind`、`data` 键必须忽略而不是报错。

## 2. events.json

`vessel` 仍是事件主体，`source` 是造成者，`target` 是目标；三者可为 `null`。

### 2.1 事件类型

v1.2 在 v1.1 基础上新增可选类型 `team_change`、`engine_mode_change`；旧播放器遇到未知
类型应忽略。M4A 主要使用：

| 类型 | 含义 |
|---|---|
| `gunfire` | 一段机炮连射（不是单发） |
| `countermeasure` / `chaff` / `flare` | 干扰弹释放 |
| `weapon_release` | 导弹/炸弹/火箭离架；火箭连射同样使用此类型，`weaponClass = weapon/rocket` 并在播放器显示为“火箭发射” |
| `impact` | 炸弹/火箭/零件撞击或爆炸 |
| `proximity_detonation` | 导弹近炸 |
| `hit` | 目标健康值下降 |
| `kill` | 可归因的击毁 |
| `miss` | 导弹/炸弹未命中或超时 |
| `target_lock` | 雷达/IRST 锁定区间开始 |
| `team_change` | BDA 队伍/阵营变化 |
| `engine_mode_change` | 同一载具多个引擎在 2 s 内同时启停，合并为加力/引擎模式切换 |

### 2.1.1 `vessel` / `source` / `target` 的主体约定

不同事件的历史字段语义并不完全一致，播放器必须按类型解释：

| 事件 | `vessel` | `source` | `target` |
|---|---|---|---|
| `gunfire` | 发射方 | 空 | 被射击目标 |
| `weapon_release` | 发射方 | 空 | 发射时锁定的目标 |
| `miss` | 被瞄准的目标 | 发射方 | 被瞄准的目标 |
| `hit` | 受击方 | 攻击方 | 可空 |
| `kill` / `destroyed` | 被摧毁方 | 攻击方（可归因时） | 可空 |
| `countermeasure` / `chaff` / `flare` | 释放方 | 空 | 可空 |
| `team_change` | 换队的载具 | 空 | 空 |

因此播放器事件列表不能简单地把 `vessel`、`source`、`target` 都当成“当前载具的事件”：
`gunfire`/`weapon_release` 只归发射方，`miss` 归 `source`，`hit`/`kill` 可同时归双方。

### 2.2 `data` 键

所有键均为可选；缺省时播放器按 `null`/`0` 处理。

#### gunfire

| 键 | 类型 | 说明 |
|---|---|---|
| `rounds` | number | 本段估算发数，>=1 |
| `rpm` | number | 武器标称射速 |
| `caliber` | number | 口径（mm） |
| `speed` | number | 炮口初速（m/s） |
| `weaponType` | string | `ballistic` / `laser` |
| `ammo` | string | 弹药名 |
| `dirX/dirY/dirZ` | number | 起始枪口方向，body-fixed 单位向量 |
| `endDirX/endDirY/endDirZ` | number | 结束枪口方向 |
| `endUt` | number | burst 结束 UT |
| `tracerColor` | string | 可选 `#RRGGBB` |
| `partId` | string | `part.flightID` |
| `moduleIndex` | number | 零件内模块序号 |

`gunfire` 的 `ut` 是 burst 开始时间；`endUt` 是结束时间。播放器按 `rounds` 在 `[ut, endUt]` 内均匀撒曳光弹。

#### countermeasure / chaff / flare

| 键 | 类型 | 说明 |
|---|---|---|
| `cmType` | string | `chaff` / `flare` / `smoke` / `decoy` / `bubble` |
| `count` | number | 本次释放数量 |
| `endUt` | number | 一轮干扰弹的结束 UT |
| `ejectVelocity` | number | 弹射初速（m/s） |
| `dirX/dirY/dirZ` | number | 弹射方向，body-fixed |
| `partId` | string | |
| `moduleIndex` | number | |

#### weapon_release

| 键 | 类型 | 说明 |
|---|---|---|
| `actorId` | string | 与 `actors.json` 的 `id` 对应 |
| `weaponClass` | string | `weapon/missile` / `weapon/bomb` / `weapon/rocket` |
| `count` | number | 本次释放数量，通常 1 |

#### impact / proximity_detonation

| 键 | 类型 | 说明 |
|---|---|---|
| `actorId` | string | |
| `weaponClass` | string | |
| `tntMass` | number | TNT 当量（kg） |
| `warhead` | string | BDA `WarheadTypes` 名称 |
| `sourceType` | string | `missile` / `bomb` / `rocket` / `other` |
| `reason` | string | `exploded` / `missed` / `lost` |

#### hit

| 键 | 类型 | 说明 |
|---|---|---|
| `healthBefore` | number | 0–1 |
| `healthAfter` | number | 0–1 |
| `actorId` | string | 可归因时填写 |

`damage` 字段（顶层）是 `healthBefore - healthAfter`。

#### kill / destroyed

| 键 | 类型 | 说明 |
|---|---|---|
| `reason` | string | 例如 `vessel_destroyed` |
| `actorId` | string | 可归因时填写 |

#### miss

| 键 | 类型 | 说明 |
|---|---|---|
| `actorId` | string | |
| `weaponClass` | string | |
| `reason` | string | `missed` / `lost` |

#### target_lock

`data.sensor`（`radar`/`irst`/`tws`/`rwr`）、`data.mode`（`scan`/`tws`/`stt`/`track`）、`range`、`aspect`。

#### team_change

| 键 | 类型 | 说明 |
|---|---|---|
| `side` | string | `blue` / `red` / `neutral` |
| `team` | string | BDA 原始队伍名，可为空 |

`vessel` 是发生换队的载具；`ut` 是换队生效时间。播放端据此实时改变 VESSELS 分组、
模型颜色、轨迹墙颜色与血条。

#### engine_mode_change

| 键 | 类型 | 说明 |
|---|---|---|
| `count` | number | 本次合并的 ignition + shutdown 总数 |
| `ignitions` | number | 启动模块数 |
| `shutdowns` | number | 关停模块数 |
| `part` / `partId` | string | 合并组中第一个引擎事件的零件 |
| `engineIndex` | number | 合并组中第一个引擎模块序号 |
| `throttle` | number | 合并组中第一个引擎事件的油门 |

录制结束时按**同一载具 + 2 s 窗口**合并所有引擎 ignition/shutdown。若同一组内同时有
启动和关停，写一条 `engine_mode_change`；若只有一种方向，则保留
`engine_ignition`/`engine_shutdown` 并写 `count`。这覆盖喷气机加力开关和
Rapiér 吸气/火箭模式切换。

## 3. effects.json

字段不变：`ut/kind/body/lat/lon/alt/count/seed/life/source/target/vx/vy/vz/spread`。

约定：

- `vx/vy/vz` 是 **body-fixed 初速**（m/s），与 `vessels` 样本的 `vx/vy/vz` 同一参考系。
- `spread` 是初速随机幅度（m/s）。
- 播放器负责重力、阻力、浮力、生命周期；录制端只给初始状态。
- `kind` 新增 `bubble`、`decoy`；`muzzle` 不单独存，由 `gunfire` 派生。
- 当前录制端写 `chaff`/`flare`/`smoke`/`decoy`/`bubble` 干扰弹 effect；播放器绘制
  `chaff`/`flare`/`decoy`/`bubble`，`smoke`/`explosion`/`shrapnel` 不绘制。
- `count` 1–512，`life` > 0。

## 4. actors.json

`kind` 明确为：

- `weapon/missile`
- `weapon/bomb`
- `weapon/rocket`
- `weapon/shell`（预留；当前 BDA 炮弹通常不是 Vessel）

其余字段不变。`parent` 是发射载具 id；`target` 是发射时锁定的目标 id。

## 5. locks.json

字段不变。`sensor` 增加 `irst`；`mode` 增加 `scan`、`track`。

## 6. summary.json

新增可选 `combat` 对象：

```json
"combat": {
  "shots": 0,
  "hits": 0,
  "kills": 0,
  "gunfireBursts": 0,
  "countermeasures": 0,
  "explosions": 0
}
```

播放器可以不依赖它，直接从 `events.json` 统计。

## 7. 兼容性

- `formatRevision = 3` 的录像可以被只认识 v1.1 的播放器读取；新增键被忽略。
- 新播放器必须继续读取 `formatRevision = 1` 和 `2` 的录像。
- 录制端只在对应 BDA 模块可用时写战斗事件；没有 BDA 的录像与 v1.1 完全一致。
