# KerbTac 文档索引

<p align="center">
  <strong>简体中文</strong> &nbsp;·&nbsp; <a href="#english">English</a>
</p>

## 中文

KerbTac 的 `.kerbtac` 录像格式按 revision 增量公开。格式契约描述容器、字段和校验规则；
数据说明描述数据来源、采样方式、战斗归因、缺测语义和已知限制。

## 从哪里开始

1. 第一次读格式：[`format-v1.md`](format-v1.md)（ZIP 容器、坐标、manifest、vessels、events）。
2. 按 revision 读增量：[`format-v1.1.md`](format-v1.1.md) → [`format-v1.2.md`](format-v1.2.md) → [`format-v1.3.md`](format-v1.3.md)。
3. 判断某份录像的数据是否可信、缺测怎么处理：[`DATA-NOTES.md`](DATA-NOTES.md)。

## 格式契约

| 文档 | 内容 |
| --- | --- |
| [`format-v1.md`](format-v1.md) | 基础 v1：ZIP 容器、坐标/姿态、manifest、bodies、vessels、events、校验 |
| [`format-v1.1.md`](format-v1.1.md) | v1.1：`formatRevision 2`、逻辑航段/存储分块、mission/gaps/chapters、actors/effects/locks/summary、新增样本列 |
| [`format-v1.2.md`](format-v1.2.md) | v1.2：`formatRevision 3`、BDA 战斗事件、`data` 键、主体约定、body-fixed 特效初速 |
| [`format-v1.3.md`](format-v1.3.md) | v1.3：`formatRevision 4`、录制模式、分级血缘、`modelRole`、威胁射程、轨道段、可选列缺测语义 |

## 数据说明

| 文档 | 内容 |
| --- | --- |
| [`DATA-NOTES.md`](DATA-NOTES.md) | 数据来源与文件用途、采样/分段、身份与分类、战斗归因、缺测与置信度、模型资产、校验排错、隐私与限制 |

## 快速事实

| 项 | 值 |
| --- | --- |
| 容器 | 标准 ZIP；`.kerbtac`（也接受 `.zip`）；条目用 stored 或 deflate |
| 内部文本 | UTF-8 JSON，无 BOM；数字禁止 `NaN` / `Infinity` |
| 时间 | KSP UT，单位秒 |
| 位置 | 星球固定系 `lat` / `lon` / `alt`（米，海平面以上） |
| 姿态 | 四元数 `[x, y, z, w]`，轨迹中可写成扁平 `4N` 数组 |
| 版本 | `formatVersion = 1`，当前 `formatRevision = 4`，读取方兼容 1–4 |
| 采样 | 主动载具默认 10 Hz；未加载载具 10 秒位置关键帧；导弹 actor 约 20 Hz |
| 回放 | 单文件 HTML，桌面 Chrome/Chromium + WebGL；运行时无网络请求 |

---

## English

<p align="center">
  <a href="#中文">简体中文</a> &nbsp;·&nbsp; <strong>English</strong>
</p>

KerbTac publishes the `.kerbtac` recording format as incremental revisions. The format contract covers the container, fields, and validation rules; the data notes cover data provenance, sampling, combat attribution, missing-value semantics, and known limitations.

### Where to start

1. New to the format: [`format-v1.md`](format-v1.md#english) (ZIP container, coordinates, manifest, vessels, events).
2. Read the revisions in order: [`format-v1.1.md`](format-v1.1.md) → [`format-v1.2.md`](format-v1.2.md) → [`format-v1.3.md`](format-v1.3.md).
3. Check whether a recording's data is trustworthy and how missing values are handled: [`DATA-NOTES.md`](DATA-NOTES.md#english).

### Format contract

| Document | Content |
| --- | --- |
| [`format-v1.md`](format-v1.md#english) | Base v1: ZIP container, coordinates/attitude, manifest, bodies, vessels, events, validation |
| [`format-v1.1.md`](format-v1.1.md) | v1.1: `formatRevision 2`, logical flight segments/storage chunks, mission/gaps/chapters, actors/effects/locks/summary, new sample columns |
| [`format-v1.2.md`](format-v1.2.md) | v1.2: `formatRevision 3`, BDA combat events, `data` keys, subject conventions, body-fixed effect initial velocity |
| [`format-v1.3.md`](format-v1.3.md) | v1.3: `formatRevision 4`, recording modes, staging lineage, `modelRole`, threat range, orbit segments, missing-value semantics for optional columns |

### Data notes

| Document | Content |
| --- | --- |
| [`DATA-NOTES.md`](DATA-NOTES.md#english) | Data provenance and file purposes, sampling/chunking, identity and classification, combat attribution, missing values and confidence, model assets, validation/troubleshooting, privacy and limitations |

### Quick facts

| Item | Value |
| --- | --- |
| Container | Standard ZIP; `.kerbtac` (`.zip` also accepted); entries stored or deflated |
| Internal text | UTF-8 JSON, no BOM; `NaN` / `Infinity` are forbidden |
| Time | KSP UT, seconds |
| Position | Body-fixed `lat` / `lon` / `alt` (meters above sea level) |
| Attitude | Quaternion `[x, y, z, w]`; trails may use a flat `4N` array |
| Version | `formatVersion = 1`, current `formatRevision = 4`, readers support 1–4 |
| Sampling | Active vessel 10 Hz by default; unloaded vessels 10-second position keyframes; missile actors about 20 Hz |
| Replay | Single-file HTML, desktop Chrome/Chromium + WebGL; no runtime network requests |
