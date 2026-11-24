# KerbTac format v1.3 (formatRevision = 4)

> 基于 `format-v1.2.md`。v1.3 只新增可选字段与约定，不改变 v1/v1.1/v1.2 的必填字段；
> 读取方应忽略未知键；旧版播放器不一定能处理第 6、8 节的轨道及缺测列。

## 1. 容器与版本

- `manifest.json` 的 `formatVersion = 1`，`formatRevision = 4`。
- 其余文件布局不变。
- 未识别的 `recordingMode`、`role`、`modelRole`、`threat` 键必须忽略而不是报错。

## 2. manifest.json

### 2.1 `session.recordingMode`

| 值 | 含义 |
|---|---|
| `combat` | 战斗模式：M4A 行为，Debris/EVA/Flag 过滤、BDA 战斗采集 |
| `space` | 航天模式：在战斗能力之上增加分级对象、血缘、角色分类与轨道段 |

缺省（v1.3 之前的录像）视为 `combat`。

### 2.2 `vessels[]` 可选字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `role` | string | 对象角色，见 §3 |
| `parentId` | string | 分离前所属载具的录制 id |
| `stageIndex` | number | 分离时的 KSP `currentStage` 快照，>= 0 |
| `separatedUt` | number | 分离时刻（UT） |
| `modelRole` | string | 播放端模型角色，见 §4 |
| `threat` | object | 冻结的防空射程，见 §5 |

全部可选；缺省时播放端按 `null` / `-1` 处理，并回退到 `type`/`kind` 的旧逻辑。

## 3. 对象角色 `role`

| 值 | 含义 |
|---|---|
| `stage.booster` | 助推器/一级等被分离的级段 |
| `stage.upper` | 上面级 |
| `stage.et` | 航天飞机外储箱 |
| `fairing` | 整流罩（两片各一个对象） |
| `payload` | 有效载荷/目标飞行器 |
| `debris` | 其余残骸 |

`parentId` 指向分离前的载具；被分离对象在 `ut >= separatedUt` 后独立存在。播放端据此
把级段挂在母箭下面，而不是当成陌生残骸。

## 4. 模型角色 `modelRole`

| 值 | 判定依据（录制时） |
|---|---|
| `air.fighter` | 含 BDA `ModuleWeapon` / `MissileLauncher` 或武器零件 |
| `air.support` | 无武器、`VesselType = Plane` |
| `ground.radar` | 含雷达模块，无发射器 |
| `ground.launcher` | 含发射器，无雷达 |
| `ground.sam` | 同时含雷达与发射器 |
| `ground.vehicle` | 其它地面载具 |
| `sea.ship` | `VesselType = Ship`，或录制起点 `SPLASHED` |
| `space.rocket` | 当前载具含分级/火箭特征 |
| `space.stage` | 被收录的分级件 |
| `space.fairing` | 整流罩 |
| `debris` | 其余残骸 |

播放端优先按 `modelRole` 选模型；缺省时回退到 `type` + `kind` 的 M4A 规则。

## 5. `threat` 对象

```json
"threat": { "missileRangeM": 12000, "radarRangeM": 40000, "threatRadiusM": 12000 }
```

- 在录制开始瞬间冻结，不随后续状态变化。
- 纯发射车（无雷达）不写该对象；纯雷达单位可写雷达覆盖圈：`missileRangeM = 0`、
  `threatRadiusM = radarRangeM`。三个值全为 0 时也省略。
- 播放端绘制固定半径半透明半球，按阵营着色；缺省时不画。

## 6. 轨道段

`vessels/<id>.json` 的 `segments` 允许出现 `kind = "orbit"` 的段：

```json
{
  "index": 7,
  "logicalIndex": -8,
  "chunkIndex": 0,
  "kind": "orbit",
  "body": "Kerbin",
  "startUt": 1234.5,
  "endUt": 1300.0,
  "orbit": {
    "epoch": 1234.5,
    "semiMajorAxis": 700000,
    "eccentricity": 0.01,
    "inclinationDeg": 28.5,
    "lanDeg": 120.0,
    "argPeDeg": 30.0,
    "meanAnomalyDeg": 10.0,
    "bfRotation": {
      "kind": "ksp-zup-spin-v1",
      "epochUt": 1234.5,
      "angleDeg": 110.0,
      "rateDegPerSec": 0.016705782
    }
  }
}
```

约定：

- 轨道段**不带 `samples`**；基础元素与 `bodies.json` 的 `orbit` 使用同一 schema。
  `bfRotation` 是仅用于**载具轨道段**的可选扩展，不改变 `formatRevision`。
- `index` 是此载具中的存储段编号；录制端的独立轨道段使用 `logicalIndex = -1 - index`、
  `chunkIndex = 0`，以免与同时覆盖该区间的实测航段被拼为一段。排序这些编号不能代替
  按 UT 寻找覆盖区间。旧文件缺少分块索引时回退为 `logicalIndex = index`、`chunkIndex = 0`。
- 只对 **Space 模式 + 当前载具** 写入；覆盖 `packed` 或 warp > 1 的区间。
- `body` 必须存在且与当前主天体一致；跨 SOI 不处理。
- 播放端在同一天体相邻样本间存在可信覆盖轨道时，可以在两个实测点**之间**
  用 Kepler 方程推算位置；端点仍是实测位置。不可靠的历史根数不用于改写实测点。
- `bfRotation.kind = "ksp-zup-spin-v1"` 声明根数为 KSP 标准 Z-up 惯性系：
  `inclinationDeg`、`lanDeg`、`argPeDeg` 为 KSP 原始度数，`meanAnomalyDeg` 由弧度转换为度。
  三个旋转字段必须是有限数：`epochUt` 为相位采集 UT（秒），不同于根数的 `epoch`；
  `angleDeg` 为该 UT 下从惯性 +X 沿 +Y 量到本初子午线的绝对相位；`rateDegPerSec` 为带符号的角速度，正值表示相位沿同一方向增加。
  推算时先在惯性 XY 平面旋转 `−(angleDeg + rateDegPerSec × (UT − epochUt))`，
  再把 `(x, y, z)` 重排为体固 `(x, z, y)`。这不使用 `bodies.json` 用于场景摆放的 `q0`。
- 播放器独立检查两个实录锚点的三维误差（当前各不超过 250 米），不会用它们拟合相位。
  当前只对超过 2 秒的采样间隔、且偏心率在 `0..0.999` 的椭圆轨道尝试推算。
  标记存在但未知或无效时退回样本；没有标记时保留旧推算路径，但也必须通过同一双锚检查，
  不按 revision 猜测旧档角度或参考相位。旧播放器可以忽略此扩展。
- 未加载的非当前载具不推算，仍使用 10 s 位置关键帧。

## 7. 兼容性

- 新播放器必须继续读取早期 `formatRevision = 1`、`2`、`3`、`4` 的录像。
  旧播放器可能拒绝无样本的轨道段、`null` 单元格，或丢弃邻接缺列的已知数据。
- Combat 同样写 revision 4，可带 `recordingMode = "combat"`、`modelRole`、
  `threat` 等扩展；Space 在此基础上还采集分级血缘及当前载具的轨道段。

## 8. 可选列的缺测语义

- 每个分块独立决定列覆盖范围。可选列完全没采到时不写该列；部分采到时，
  保持与 `t` 等长，用 JSON `null` 占缺测行。例如两行 `gear: [0, null]` 表示第一行
  采到关闭状态，第二行未知。`stage` 仍是整数，`situation` 仍是字符串，可缺测。
- `0` 是有效数值，包括中立操纵输入、脱开的动作组、空容器及已测得的零健康。
  资源逐种独立记录：已采到空容器写 `0`，没有该资源容器则缺测；无可靠 BDA
  数据不写健康值，不能用 manifest 健康摘要冒充该行的遥测。
- 拼接分块时只给缺列分块的行标记缺测，不能丢弃其他分块中的值。
  重叠时间仍按后一个分块优先；可选连续遥测不跨缺测行插值。
- 旧 writer 有时因为整块数值都是零而省略列；无法从空缺判断它是实测零还是
  未采集。按未知处理，不按 revision、载具类型或相邻分块推填。
