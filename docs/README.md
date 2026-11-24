# KerbTac 文档索引

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
