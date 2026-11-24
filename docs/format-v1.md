# KerbTac 文件格式 v1（`.kerbtac`）

> 状态：**冻结草案**（M1 实现基准）
> 版本：`formatVersion = 1`
> 更新：2026-11-03
>
> 本文档是录制端（KSP C# 插件）与回放端（浏览器 Three.js）之间的**契约**。
> 任何一侧的实现都必须以本文档为准；早期计划草稿第 8 节是历史草稿，与本文档
> 冲突时以本文档为准。实现与文档必须同步修改。

---

## 1. 概述

`.kerbtac` 是一个 **ZIP 归档**，内部是若干 UTF-8 JSON 文件。它描述一次
KSP 会话（session）中若干载具的轨迹、姿态、遥测和事件，以及回放所需的
天体参数。

设计目标：

1. **开放**：ZIP + JSON，任何语言都能读写；不依赖 KSP、Unity 或私有二进制。
2. **自足**：文件包含回放所需的全部天体参数，回放端不需要 KSP 数据。
3. **可列式解析**：轨迹采样按列存储（columnar），便于一次性构建 typed array。
4. **面向未来**：多天体、轨道段、多载具在 v1 结构内即可表达；实现可以分阶段。

## 2. 容器

### 2.1 ZIP 要求

| 项目 | 规定 |
|---|---|
| 格式 | 标准 ZIP（PKZIP 2.0 及以上，支持 ZIP64） |
| 扩展名 | `.kerbtac`（推荐）；播放器同样接受 `.zip` |
| 识别方式 | 读文件头 `50 4B 03 04`，**不依赖扩展名** |
| 压缩方法 | 条目可用 `stored (0)` 或 `deflate (8)`；读取方必须同时支持 |
| 文件名编码 | UTF-8（ZIP 通用标志位 bit 11 = 1）；兼容 ASCII |
| 内部文本编码 | UTF-8，**无 BOM** |
| 加密 | 不支持；遇到加密条目必须报错 |
| 条目顺序 | 无要求 |

> 实现备注：录制端优先使用 Deflate；若运行环境缺少
> `System.IO.Compression.DeflateStream`，退化为 `stored`。两种情况都是合法
> v1 文件。10 分钟单机轨迹未压缩通常 < 2 MB，`stored` 不会破坏体积预算。

### 2.2 目录结构

```text
manifest.json            必须
bodies.json              必须
events.json              必须
vessels/<vesselId>.json  每个 manifest.vessels[] 一项，必须
README.txt               可选
preview.png              可选（v1 播放器忽略）
models.json              可选（M5 回放端模型扩展）
models/<sha256>.<obj|stl>  可选（模型网格）
```

- 路径分隔符一律 `/`。
- 条目路径不得为绝对路径，不得包含 `..`、驱动器号或反斜杠；读取方必须拒绝。
- 读取方必须忽略未知条目（向前兼容）。

### 2.3 大小限制（读取方建议值）

| 项目 | 建议上限 | 行为 |
|---|---|---|
| 单个条目解压后 | 64 MB | 拒绝并报错 |
| 全部条目解压后 | 512 MB | 拒绝并报错（zip bomb 防护） |
| 条目数 | 10 000 | 拒绝 |

### 2.4 `models.json`（可选）

回放端可在新归档中附加自定义载具模型；不修改 `manifest.json`，也不提高
`formatRevision`。模型扩展有独立的版本号，当前为 `1`。示例：

```json
{
  "version": 1,
  "models": [{
    "vesselId": "0f8fad5b-d9cb-469f-a165-70867728950e",
    "file": "models/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.obj",
    "scale": 1,
    "rotation": [0, 90, 0],
    "offset": [0, 0, 0]
  }]
}
```

- `vesselId` 是录制内的载具 ID，每艘载具最多一项；碎片与临时对象仍使用内置模型。
- `file` 必须匹配 `models/<sha256>.<obj|stl>`；散列为模型原始字节的 64 位小写十六进制 SHA-256 字符串。保存时相同格式、相同字节的模型共用一个条目。OBJ/STL 只读取网格，不加载 MTL、纹理或外部文件；回放端使用载具当前的显示色。
- 模型按原始网格包围盒居中，最长轴等比适配到 120 场景单位；默认不变换源轴，渲染器以 +Y 向上、−Z 朝前。之后依次施加正数 `scale`、`rotation`（三分量 XYZ 欧拉角，单位为度，Three.js `XYZ` 约定）以及 `offset`（渲染器模型局部轴，单位为场景米）。默认变换为 `1`、`[0,0,0]`、`[0,0,0]`；所有分量必须为有限数。
- 模型单文件最多 50 MiB；每个归档中引用的唯一模型合计最多 300 MiB（均按解压后字节计算）；§2.3 的容器上限仍适用。
- 没有扩展时不警告，照常使用内置模型。不支持的版本或损坏的元数据会警告并忽略；单项无效、模型缺失或无法解析时，只让受影响的载具回退。重复绑定保留首个通过元数据及条目检查的绑定。

## 3. 通用约定

### 3.1 JSON

- 数字：十进制，允许指数；**禁止** `NaN`、`Infinity`、`-Infinity`
  （不是合法 JSON，且会破坏回放端插值）。
- 整数列在语义上是整数（`stage`、`partCount`），JSON 里仍按 number 序列化。
- 未知字段：写入方可添加；读取方必须忽略，不得因未知字段报错。
- 缺失的可选字段：按“未知”处理，不得崩溃。
- 空数组与 `null` 不等价：可选列缺省用**不出现该键**表示，不用 `null`。

### 3.2 时间

- 所有时间点是 **KSP UT（Universal Time）**，单位秒，`double` 绝对时间。
- 墙钟时间用 ISO 8601 UTC 字符串，如 `2026-11-03T12:00:00Z`，仅用于展示与文件命名。
- 回放时间轴**只**使用 UT；帧率、墙钟时间不参与推进。

### 3.3 单位与角度

| 量 | 单位 | 说明 |
|---|---|---|
| 时间 | s | UT |
| 距离、高度、半径、SOI | m | 双精度 |
| 速度 | m/s | 星球固定系分量 |
| 质量 | kg | |
| 角度 | **度** | 纬度、经度、航向、轨道根数、自转速率 |
| 四元数 | 无量纲 | `[x, y, z, w]`，单位四元数 |
| 油门 | 0–1 | |
| 过载 | g | KSP `geeForce`，1.0 = 1 g |
| 资源量 | 游戏单位 | LiquidFuel / Oxidizer / ElectricCharge / MonoPropellant |

回放端内部把角度转弧度；写出端永远写度。

### 3.4 四元数

- 顺序固定为 **x, y, z, w**（与 Three.js `Quaternion.set` 一致，与 KSP
  `Quaternion` 字段顺序一致）。
- 轨迹列里可以写成扁平数组：`q: [x0,y0,z0,w0, x1,y1,z1,w1, ...]`，长度为 `4 × N`。
- 稀疏姿态（轨道段）用 `attitude: { "t": [...], "q": [...] }`，`q` 同样扁平。
- 写入方必须归一化；读取方对未归一化值做容错归一化（长度接近 0 时用单位四元数）。

### 3.5 标识符

| 标识 | 形式 | 说明 |
|---|---|---|
| `vesselId` | KSP `vessel.id` 的 Guid 字符串（小写，带连字符） | 会话内唯一 |
| `bodyName` | KSP 天体名（`Kerbin`、`Mun`、`Duna`…） | 与 KSP 一致，区分大小写 |
| `eventType` | 稳定小写 snake_case 字符串 | 见 §8.3 |
| `situation` | KSP `Vessel.Situations` 枚举名 | 大写，见 §7.5 |

## 4. 坐标系与姿态（规范性）

这一节是 v1 最容易出错的部分，录制端与回放端必须完全一致。

### 4.1 星球固定系（BF, Body-Fixed）

每个天体有独立的右手系 BF 坐标系：

- 原点在天体中心；
- **+Y 指向北极**；
- **经度 0° 在 +X**，**东经 90° 在 +Z**；
- 右手系：`X × Y = Z`。

经纬高到 BF 的转换（`R` = `body.radius`，`alt` 为海平面以上高度）：

```text
r  = R + alt
x  = r * cos(lat) * cos(lon)
y  = r * sin(lat)
z  = r * cos(lat) * sin(lon)
```

反解：

```text
lat = asin(y / r)
lon = atan2(z, x)
alt = r - R
```

- 纬度北正南负，范围 `[-90, 90]`；经度东正西负，范围 `[-180, 180)`。
- `alt` 是 KSP `vessel.altitude`（海平面以上），**不是**雷达高度，也**不是**
  相对地形高度。回放端不要把它当地形高度使用。
- 该公式与 KSP 自身 `FlightGlobals.GetLatitude/GetLongitude` 的数值约定一致，
  因此录制端可以直接使用 KSP 提供的 `vessel.latitude/longitude/altitude`。

### 4.1.1 回放端的镜像转换（规范性）

上述 BF 的坐标轴满足 `X × Y = Z`，但**地理方向**是镜像的：经度从 +X 向 +Z
增大时，从球外看是逆时针（标准地球仪上东向应为顺时针）。因此直接把 BF 坐标
当作 Three.js 世界坐标，会把地图和轨迹一起东西镜像。

回放端必须在**渲染层**做一次反射 `S = diag(1, 1, -1)`，录制文件本身不变：

```text
p_render = (x, y, -z)
q_render = (-qx, -qy, qz, qw)     // S R S，保持旋转为正当旋转
```

- 星球网格保持标准 `SphereGeometry` UV；贴图使用**未翻转**的标准等距圆柱图
  （左边缘 = 180°W）。
- 速度、事件位置、相机目标同样经过 `S`；不要把镜像写回 `.kerbtac`。
- 参考实现：`player/src/scene/renderFrame.ts`。

### 4.2 姿态四元数 `q`

`q` 把**载具模型坐标系**旋转到**当前主天体的 BF 坐标系**：

```text
v_bf = q * v_model
```

模型坐标系约定（回放端建模必须遵守）：

- **+Z = 机头前方（forward）**
- **+Y = 机背上方（up）**
- **+X = 右翼方向（right）**
- 右手系：`X × Y = Z`

也就是说，`q * (0,0,1)` 等于载具机头在 BF 中的方向，`q * (0,1,0)` 等于机背
向上的方向。回放端只需把模型按此约定建模，然后直接应用 `q`，**不需要**任何
Unity 左手系修正。

> **录制端实现要求（关键）**：不要直接写 `vessel.srfRelRotation`。KSP/Unity
> 的数值坐标是左手系，直接塞进 Three.js 会产生镜像。正确做法是在录制端
> 用向量构造基底：
>
> ```csharp
> Quaternion invBody = Quaternion.Inverse(vessel.mainBody.bodyTransform.rotation);
> Vector3 fwd = (invBody * vessel.transform.forward).normalized;   // model +Z
> Vector3 up  = (invBody * vessel.transform.up).normalized;        // model +Y
> Vector3 right = Vector3.Cross(up, fwd).normalized;               // model +X
> Vector3 up2 = Vector3.Cross(fwd, right).normalized;              // re-orthogonalize
> Quaternion q = Quaternion.LookRotation(fwd, up2);                // Unity: +Z forward, +Y up
> ```
>
> 这样得到的四个分量在 BF 数值坐标中就是“模型 → BF”的旋转，回放端可直接
> 使用。`LookRotation` 的语义（+Z 前、+Y 上）与本文档的模型约定一致。

- 若载具模型的实际外观与 `q` 不符（例如某些零件组装的机头方向反了），
  在**回放端**加一个固定的修正四元数，不改数据。
- 回放端世界姿态：`worldQuat = bodyWorldQuat(t) * q`。

### 4.3 天体自转

`bodies.json` 为每个天体给出：

```json
"rotation": {
  "epochUt": 123456.789,
  "q0": [0, 0, 0, 1],
  "axis": [0, 1, 0],
  "rateDegPerSec": 0.0167083333
}
```

- `q0`：在 `epochUt` 时刻，天体 BF 系到**父级坐标系**的旋转四元数
  （根天体固定在原点，其父级即会话世界系，`q0 = identity`）。
- `axis`：**BF 系中**的自转轴单位向量（M1 固定 `[0,1,0]`，即天体北极）。
  自转发生在天体自身坐标系里，所以增量旋转要右乘 `q0`；这样有轴倾角的天体
  （未来 RSS 等）也不会把倾角一起转掉。
- `rateDegPerSec`：自转角速度（度/秒），逆行用负值。
- 任意时刻：

```text
angle = rateDegPerSec * (t - epochUt)          // 度
bodyWorldQuat(t) = q0 * quatFromAxisAngle(axis, angle)
```

- BF → 世界：`worldPos = bodyWorldPos(t) + bodyWorldQuat(t) * bfPos`。
- 根天体 `parent = null`，其 `bodyWorldPos = (0,0,0)`。
- M1 只要求根天体（Kerbin）。有多天体时按 `parent` 递归。

### 4.4 速度

`samples.vx/vy/vz` 是载具速度在**当前主天体 BF 系**中的分量（m/s），即
`Quaternion.Inverse(body.bodyTransform.rotation) * vessel.srf_velocity`。

- 回放端显示的速度大小 `sqrt(vx²+vy²+vz²)` 是**地速**（相对星球表面）。
- 垂直速度用位置差分计算；若文件带可选列 `vs`，优先使用 `vs`。
- 轨道段不要求速度列。

### 4.5 航向

可选列 `hdg`：载具机头方向的真航向，度，0 = 北，90 = 东，顺时针。
若缺失，回放端可从 `q * (0,0,1)` 反算。

## 5. `manifest.json`

顶层对象，描述会话与载具清单。

```json
{
  "format": "kerbtac",
  "formatVersion": 1,
  "generator": { "name": "KerbTac Recorder", "version": "0.1.0" },
  "game": {
    "kspVersion": "1.12.5.3190",
    "unityVersion": "2019.4.18f1",
    "saveName": "MNCS",
    "scene": "FLIGHT"
  },
  "session": {
    "id": "20261103T120000Z-abc123",
    "name": "Fighter Test",
    "startUt": 123456.789,
    "endUt": 123789.012,
    "startWall": "2026-11-03T12:00:00Z",
    "endWall": "2026-11-03T12:05:32Z",
    "duration": 332.223
  },
  "bodies": "bodies.json",
  "events": "events.json",
  "vessels": [
    {
      "id": "0f8fad5b-d9cb-469f-a165-70867728950e",
      "name": "F-16 Test",
      "type": "Plane",
      "body": "Kerbin",
      "color": "#4fc3f7",
      "team": null,
      "rootPart": "mk2Cockpit_Standard",
      "partCount": 42,
      "crewCount": 1,
      "track": "vessels/0f8fad5b-d9cb-469f-a165-70867728950e.json"
    }
  ]
}
```

### 5.1 字段

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `format` | string | ✅ | 固定 `"kerbtac"` |
| `formatVersion` | int | ✅ | v1 = `1` |
| `generator.name` | string | ✅ | 录制器名称 |
| `generator.version` | string | ✅ | 录制器版本，语义化 |
| `game.kspVersion` | string | ✅ | KSP 版本，如 `1.12.5.3190` |
| `game.unityVersion` | string | ❌ | Unity 版本，仅诊断 |
| `game.saveName` | string | ❌ | 存档名；未知时 `null` 或缺省 |
| `game.scene` | string | ❌ | 通常 `"FLIGHT"` |
| `session.id` | string | ✅ | 会话唯一 ID，建议 `YYYYMMDDTHHMMSSZ-<6 hex>` |
| `session.name` | string | ❌ | 人类可读名称；缺省用文件名 |
| `session.startUt` | number | ✅ | 首个样本时间（UT 秒） |
| `session.endUt` | number | ✅ | 最后样本时间；进行中可等于 `startUt` |
| `session.startWall` | string | ❌ | ISO 8601 UTC |
| `session.endWall` | string | ❌ | ISO 8601 UTC |
| `session.duration` | number | ❌ | `endUt - startUt`，秒 |
| `bodies` | string | ✅ | 固定 `"bodies.json"` |
| `events` | string | ✅ | 固定 `"events.json"` |
| `vessels` | array | ✅ | 可为空数组（空录制） |
| `vessels[].id` | string | ✅ | KSP vessel Guid，小写 |
| `vessels[].name` | string | ✅ | 载具名（可含空格/中文） |
| `vessels[].type` | string | ✅ | KSP `VesselType` 名，见 §7.6 |
| `vessels[].body` | string | ✅ | 主要天体名 |
| `vessels[].color` | string | ❌ | `#rrggbb`；缺省由回放端按顺序分配 |
| `vessels[].team` | string/null | ❌ | BDA 团队（M2）；M1 为 `null` |
| `vessels[].rootPart` | string | ❌ | 根零件内部名 |
| `vessels[].partCount` | int | ❌ | 零件数 |
| `vessels[].crewCount` | int | ❌ | 乘员数 |
| `vessels[].track` | string | ✅ | 轨迹文件路径，必须在归档内 |

### 5.2 约束

- `vessels[].id` 在数组内唯一；`track` 唯一。
- `session.startUt <= session.endUt`；所有轨迹样本的 `t` 必须落在
  `[startUt - 1, endUt + 1]` 内（允许 1 s 浮点余量）。
- `vessels[].body` 必须存在于 `bodies.json`。

## 6. `bodies.json`

顶层对象，键为天体名。必须包含所有被载具段引用到的天体，以及它们的
祖先链（用于计算世界位置）。

```json
{
  "Kerbin": {
    "name": "Kerbin",
    "parent": null,
    "radius": 600000.0,
    "gravParameter": 3531600000000.0,
    "atmosphereDepth": 70000.0,
    "sphereOfInfluence": 84159286.0,
    "rotation": {
      "epochUt": 123456.789,
      "q0": [0.0, 0.0, 0.0, 1.0],
      "axis": [0.0, 1.0, 0.0],
      "rateDegPerSec": 0.0167083333
    },
    "orbit": null,
    "style": "kerbin"
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 与键相同；冗余便于遍历 |
| `parent` | string/null | ✅ | 父天体名；根天体为 `null` |
| `radius` | number | ✅ | 赤道半径，米，> 0 |
| `gravParameter` | number | ✅ | `mu`，m³/s²，> 0 |
| `atmosphereDepth` | number | ❌ | 大气高度，米；无大气为 `0` 或省略 |
| `sphereOfInfluence` | number | ❌ | SOI 半径，米 |
| `rotation.epochUt` | number | ✅ | 自转参数参考时刻 |
| `rotation.q0` | [x,y,z,w] | ✅ | 相对父级的姿态 |
| `rotation.axis` | [x,y,z] | ✅ | BF 系中的自转轴（通常 `[0,1,0]`） |
| `rotation.rateDegPerSec` | number | ✅ | 度/秒，逆行负值 |
| `orbit` | object/null | ❌ | 相对父级的二体轨道根数；根天体为 `null` |
| `style` | string | ❌ | 回放端样式键，如 `kerbin`、`mun`、`duna` |

### 6.1 `orbit`（相对父级）

```json
{
  "epoch": 123456.789,
  "semiMajorAxis": 13599840256.0,
  "eccentricity": 0.0,
  "inclinationDeg": 0.0,
  "lanDeg": 0.0,
  "argPeDeg": 0.0,
  "meanAnomalyDeg": 0.0
}
```

- 角度全部为度；`epoch` 为 UT。
- M1 不要求实现多天体轨道传播；读取方遇到 `parent != null` 且自身未实现时，
  可以退化为“把该天体画在其父级原点”，并在 UI 提示。
- 根天体（`parent = null`）的 `orbit` 必须为 `null` 或省略。

### 6.2 `style`

建议值（回放端对未知值使用默认材质）：

`kerbin`、`mun`、`minmus`、`duna`、`ike`、`eve`、`gilly`、`moho`、`jool`、
`laythe`、`vall`、`tylo`、`bop`、`pol`、`eeloo`、`kerbol`、`default`。

## 7. `vessels/<vesselId>.json`

单个载具的元数据与轨迹段。

```json
{
  "id": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "name": "F-16 Test",
  "type": "Plane",
  "body": "Kerbin",
  "segments": [
    {
      "index": 0,
      "kind": "flight",
      "body": "Kerbin",
      "startUt": 123456.789,
      "endUt": 123789.012,
      "source": "active",
      "samples": {
        "t":   [123456.789, 123456.889],
        "lat": [-0.0972, -0.0971],
        "lon": [-74.5577, -74.5576],
        "alt": [67.0, 68.2],
        "q":   [0,0,0,1, 0,0.001,0,0.999999],
        "vx":  [0.0, 1.2],
        "vy":  [0.0, 0.1],
        "vz":  [0.0, 0.0],
        "throttle": [0.0, 0.35],
        "mass": [12000.0, 11998.0],
        "g": [1.0, 1.0],
        "stage": [3, 3],
        "situation": ["LANDED", "FLYING"],
        "hdg": [90.0, 91.2],
        "vs": [0.0, 0.4],
        "lf": [800.0, 799.9],
        "ox": [0.0, 0.0],
        "ec": [500.0, 499.9]
      }
    }
  ]
}
```

### 7.1 载具对象字段

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 必须与文件名和 manifest 一致 |
| `name` | string | ✅ | |
| `type` | string | ✅ | `VesselType` |
| `body` | string | ✅ | 会话结束时的主天体 |
| `segments` | array | ✅ | 至少 1 段；空轨迹载具不应出现在 manifest |

### 7.2 段（segment）字段

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `index` | int | ✅ | 从 0 递增，同一载具内唯一 |
| `kind` | string | ✅ | `flight` / `surface` / `orbit` / `static` |
| `body` | string | ✅ | 该段的主天体，必须存在于 `bodies.json` |
| `startUt` | number | ✅ | 段首样本时间 |
| `endUt` | number | ✅ | 段尾样本时间；`startUt <= endUt` |
| `samples` | object | ⚠️ | `kind != orbit` 时必需 |
| `orbit` | object | ⚠️ | `kind == orbit` 时必需 |
| `attitude` | object | ❌ | 仅 `kind == orbit`：`{t:[], q:[]}` 稀疏姿态 |
| `boundary` | bool | ❌ | `true` 表示与上一段之间存在位置跳变 |
| `source` | string | ❌ | `active` / `loaded` / `unloaded` / `checkpoint` |

段顺序：数组顺序即时间顺序；`segments[i].endUt <= segments[i+1].startUt`
（允许相等；小重叠也允许，回放端按后段优先）。

### 7.3 `kind` 语义

| kind | 用途 | 采样 | 位置来源 |
|---|---|---|---|
| `flight` | 大气内飞行 / 物理加载 | 5–20 Hz | `lat/lon/alt` |
| `surface` | 地面/水面静止或低速 | 0.2–5 Hz | `lat/lon/alt` |
| `orbit` | on-rails / 未加载 | 关键帧 | `orbit` 根数 |
| `static` | 只记录一次的位置（如初始停靠） | 1 个样本 | `lat/lon/alt` |

M1 只产生 `flight`（可能附带一个 `static` 起始段）。回放端必须能处理四种。

### 7.4 `samples` 列

所有列的数组长度必须等于 `t` 的长度；`q` 长度为 `4 × N`。

| 列 | 必需 | 类型 | 说明 |
|---|---|---|---|
| `t` | ✅ | number[] | UT 秒；段内**严格递增** |
| `lat` | ✅ | number[] | 度 |
| `lon` | ✅ | number[] | 度 |
| `alt` | ✅ | number[] | 米，海平面以上 |
| `q` | ✅ | number[] | 扁平四元数，4×N |
| `vx` | ❌ | number[] | BF 速度分量，m/s |
| `vy` | ❌ | number[] | |
| `vz` | ❌ | number[] | |
| `throttle` | ❌ | number[] | 0–1 |
| `mass` | ❌ | number[] | kg |
| `g` | ❌ | number[] | 过载，g |
| `stage` | ❌ | int[] | 当前分级 |
| `situation` | ❌ | string[] | 见 §7.5 |
| `hdg` | ❌ | number[] | 真航向，度 |
| `vs` | ❌ | number[] | 垂直速度，m/s |
| `lf` | ❌ | number[] | LiquidFuel |
| `ox` | ❌ | number[] | Oxidizer |
| `ec` | ❌ | number[] | ElectricCharge |
| `mp` | ❌ | number[] | MonoPropellant |
| `srfSpeed` | ❌ | number[] | 地速，m/s（冗余，便于校验） |

约束：

- `t` 段内严格递增（`t[i] < t[i+1]`）。相同时间戳的样本必须丢弃或合并。
- `lat ∈ [-90, 90]`，`lon ∈ [-180, 180]`（允许 `180`）。
- `alt >= -2000`（允许低于海平面，如海洋深处）。
- `q` 的每个四元数长度应在 `[0.99, 1.01]`；读取方归一化。
- 可选列缺失时，回放端按“未知”显示（不要用 0 冒充真实值）。当前写入端支持
  [按行缺测](format-v1.3.md#8-可选列的缺测语义)；必需列仍只能包含有限数值。

### 7.5 `situation` 取值

KSP `Vessel.Situations` 的 `ToString()`：

`PRELAUNCH`、`LANDED`、`SPLASHED`、`FLYING`、`SUB_ORBITAL`、`ORBITING`、
`ESCAPING`、`DOCKED`。

未知值按 `FLYING` 处理并保留原字符串。

### 7.6 `type` 取值

KSP `VesselType` 的 `ToString()`：

`Debris`、`Probe`、`Rover`、`Lander`、`Ship`、`Plane`、`Station`、`Relay`、
`Base`、`EVA`、`Flag`、`SpaceObject`、`Unknown`。

回放端对未知类型使用 `Unknown` 的图标。

### 7.7 `orbit`（轨道段）

```json
{
  "epoch": 123800.0,
  "semiMajorAxis": 700000.0,
  "eccentricity": 0.001,
  "inclinationDeg": 28.5,
  "lanDeg": 120.0,
  "argPeDeg": 0.0,
  "meanAnomalyDeg": 10.0
}
```

- `epoch` 时刻的平近点角为 `meanAnomalyDeg`。
- `semiMajorAxis` 为米；对双曲轨道仍为负值（按二体约定）。
- 位置在**惯性系**中计算，再转换到 BF；v1 回放端可先按“轨道段暂不支持”
  降级为 `static`（M1 不产生轨道段）。

## 8. `events.json`

顶层是事件数组，按 `ut` 升序（读取方应容忍乱序并排序）。

```json
[
  {
    "ut": 123457.0,
    "type": "takeoff",
    "vessel": "0f8fad5b-d9cb-469f-a165-70867728950e",
    "target": null,
    "body": "Kerbin",
    "lat": -0.0972,
    "lon": -74.5577,
    "alt": 70.0,
    "data": {}
  }
]
```

### 8.1 事件字段

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `ut` | number | ✅ | 事件时间 |
| `type` | string | ✅ | 稳定事件类型，见 §8.3 |
| `vessel` | string/null | ✅ | 关联载具 id；全局事件为 `null` |
| `target` | string/null | ❌ | 关联的第二载具（命中/对接） |
| `body` | string/null | ❌ | 事件发生天体 |
| `lat` | number | ❌ | 事件位置纬度 |
| `lon` | number | ❌ | 事件位置经度 |
| `alt` | number | ❌ | 事件位置高度，米 |
| `data` | object | ❌ | 类型相关附加字段；缺省 `{}` |

### 8.2 事件位置

- 若给出 `body` + `lat` + `lon` + `alt`，回放端在地图上画标记。
- 位置可缺失（如全局 `flight_end`）；缺位置的事件只出现在事件列表和时间轴。
- 事件位置应取自事件发生时的载具状态，允许与最近样本有 ≤ 0.5 s 的偏差。

### 8.3 事件类型（v1）

**M1 必须实现：**

| type | 触发 | `data` 字段 |
|---|---|---|
| `flight_start` | 开始录制 | `{"reason":"auto"\|"manual"}` |
| `flight_end` | 停止录制 | `{"reason":"manual"\|"scene_exit"\|"application_quit"\|"vessel_destroyed"\|"auto_landing"\|"revert"\|"quickload","duration":332.2}` |
| `takeoff` | situation → `FLYING`（从地面） | `{"speed":85.3}` |
| `touchdown` | `FLYING` → `LANDED`/`SPLASHED` | `{"verticalSpeed":-2.1,"speed":65.0}` |
| `landing` | 着陆后稳定（可选） | `{"speed":0.2}` |
| `gear_up` / `gear_down` | Gear 动作组翻转，或起落架 `deployed` 变化 | `{"part":"Gear"}`（动作组）或模块名 |
| `stage` | 分级 | `{"stage":2}` |
| `engine_ignition` | 发动机点火 | `{"part":"...","throttle":1.0}` |
| `engine_shutdown` | 发动机关机 | `{"part":"..."}` |
| `crash` | 坠毁 | `{"speed":120.0}` |
| `destroyed` | 载具销毁 | `{"reason":"..."}` |
| `soi_change` | SOI 变化 | `{"from":"Kerbin","to":"Mun"}` |
| `scene_exit` | 离开 Flight | `{"scene":"SPACECENTER"}` |
| `note` | 手动书签（可选） | `{"text":"..."}` |

**保留（M2+，写入方可选产生；读取方必须容忍）：**

`decouple`、`undock`、`dock`、`vessel_split`、`vessel_merge`、
`weapon_release`、`hit`、`proximity_detonation`、`gunfire`、`countermeasure`、
`target_lock`、`parachute_deploy`、`parachute_cut`、`fairing_jettison`、
`cargo_bay`、`light`、`rcs`、`time_jump`、`revert`、`quickload`、`recovery`。

### 8.4 事件与时间轴

- 事件 `ut` 必须在 `[manifest.session.startUt, endUt]` 内（允许 1 s 余量）；
  范围外的事件读取方可以丢弃或夹取。
- 同一 `ut` 的多个事件保持写入顺序（稳定排序）。

## 9. `README.txt`（可选）

纯文本，UTF-8，供人阅读：

```text
KerbTac recording
Format: kerbtac v1
Generator: KerbTac Recorder 0.1.0
KSP: 1.12.5.3190
Created: 2026-11-03T12:00:00Z
This file is a ZIP archive. See docs/format-v1.md for the schema.
```

## 10. 校验规则（读取方必须执行）

按顺序执行；任一项失败即拒绝并给出**具体原因**：

1. 文件头是 `PK\x03\x04`（或空 ZIP 的 `PK\x05\x06`）。
2. ZIP 可解压，未加密，条目路径安全（无 `..`、绝对路径、反斜杠）。
3. 解压后总大小与条目数在限制内。
4. `manifest.json` 存在、是合法 JSON、是对象。
5. `manifest.format === "kerbtac"`。
6. `manifest.formatVersion` 是整数且 `1 <= v <= 1`（当前支持上限）。
   - `v > 1`：报“该文件使用 format vX，本播放器最高支持 v1”。
7. `manifest.bodies` / `manifest.events` 指向的条目存在。
8. `bodies.json` 合法；根天体存在；所有被引用的天体及其祖先存在。
9. `events.json` 是数组；每个事件有 `ut` 与 `type`。
10. 每个 `manifest.vessels[].track` 存在且合法；`id` 与文件名一致。
11. 每个段的 `samples` 各列长度一致，`q` 长度 `4N`，`t` 严格递增；
    数值均为有限值。
12. 至少有一个载具至少有一个段有 ≥ 1 个样本；否则提示“没有可回放的载具”。

**容错（不得拒绝，只警告）：**

- 未知顶层字段、未知事件类型、未知载具类型、未知段 `kind`。
- 缺失可选列。
- `t` 的轻微乱序（本地排序后继续，但记录警告）。
- 单个样本的 `lat/lon` 越界（夹取到合法范围，记录警告）。

## 11. 版本与兼容

- `formatVersion` 是**主版本**：不兼容变更时 +1；读取方对更高版本明确拒绝。
- 次版本演进通过**只添加可选字段**实现；旧读取方忽略未知字段。
- 事件类型、载具类型、段 `kind` 是开放字符串；未知值使用默认行为。
- 不把 KSP `ConfigNode`、零件快照、Unity 原始世界坐标写入 v1。

### 11.1 与早期计划草稿的差异（实现裁定）

| 项目 | 早期计划草稿第 8 节 | 本文件 | 原因 |
|---|---|---|---|
| 姿态来源 | `vessel.srfRelRotation` | 由 `forward`/`up` 在 BF 中构造的四元数 | 避免 Unity 左手系→Three.js 右手系的镜像错误；向量构造可在无 KSP 环境下单测 |
| 新增可选列 | 无 | `hdg`、`vs`、`srfSpeed` | 遥测面板需要，且便于校验；均为可选，不破坏兼容 |
| ZIP 压缩 | Deflate | Deflate 优先，Stored 合法回退 | KSP Mono 的 `System.IO.Compression` 可用性需实测，Stored 保证一定能写 |
| 段 `situation` | 列在 samples | 同左 | — |

## 12. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-11-03 | 1（草案） | 从早期计划草稿 §8 整理；补全姿态坐标系定义、校验规则、事件表、可选列 |
| 2026-11-03 | 1（草案） | 明确自转轴在 BF 系、旋转合成为 `q0 * spin`；Kerbin 的 `q0` 为纯 Y 旋转，数值不变 |

## 13. 最小示例

一个只有两个样本、一个事件的最小合法文件（实际 ZIP 内含 4 个文件）：

`manifest.json`

```json
{
  "format": "kerbtac",
  "formatVersion": 1,
  "generator": { "name": "KerbTac Recorder", "version": "0.1.0" },
  "game": { "kspVersion": "1.12.5.3190", "saveName": "MNCS", "scene": "FLIGHT" },
  "session": {
    "id": "20261103T120000Z-abc123",
    "startUt": 100.0,
    "endUt": 100.1
  },
  "bodies": "bodies.json",
  "events": "events.json",
  "vessels": [
    {
      "id": "0f8fad5b-d9cb-469f-a165-70867728950e",
      "name": "Test",
      "type": "Plane",
      "body": "Kerbin",
      "color": "#4fc3f7",
      "track": "vessels/0f8fad5b-d9cb-469f-a165-70867728950e.json"
    }
  ]
}
```

`vessels/0f8fad5b-d9cb-469f-a165-70867728950e.json`

```json
{
  "id": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "name": "Test",
  "type": "Plane",
  "body": "Kerbin",
  "segments": [
    {
      "index": 0,
      "kind": "flight",
      "body": "Kerbin",
      "startUt": 100.0,
      "endUt": 100.1,
      "samples": {
        "t": [100.0, 100.1],
        "lat": [0.0, 0.0],
        "lon": [0.0, 0.0001],
        "alt": [70.0, 70.5],
        "q": [0,0,0,1, 0,0,0,1]
      }
    }
  ]
}
```
