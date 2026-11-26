# KerbTac / 坎迹

KSP 1.12.5 的任务记录仪与离线浏览器回放器。
A mission recorder and offline browser replay player for Kerbal Space Program 1.12.5.

<p align="center">
  <strong>简体中文</strong> &nbsp;·&nbsp; <a href="#english">English</a><br>
  <a href="docs/format-v1.md">回放格式</a> &nbsp;·&nbsp;
  <a href="docs/README.md">格式索引</a> &nbsp;·&nbsp;
  <a href="docs/DATA-NOTES.md">数据说明</a>
</p>

## 中文

把一次 KSP 飞行变成可拖动的时间轴：录制端在游戏内连续记录多艘载具、导弹与炸弹、战斗事件和遥测；播放器在 Chrome 里用 Three.js 以行星为参考系重建整场任务，支持三种视角、轨迹、高度墙、事件和遥测。录制与回放全部离线，不需要服务器，也不上传录像。

## 两部分

| 组件 | 用途 |
| --- | --- |
| **录制端**（`KerbTac.dll`） | KSP 插件。在 Flight 场景里 Start/Stop，连续记录载具、导弹、战斗事件和遥测，分块落盘后归档为 `.kerbtac`。 |
| **播放器**（`KerbTac-Player-v*.html`） | 单个 HTML 文件。直接双击打开 `.kerbtac`，用 Three.js 重建任务场景；不需要安装、服务器或网络。 |

两者可以分开使用：只看录像时不需要启动 KSP；录制端窗口里也有 **Open replay player** 按钮。

## 功能

### 录制

- **全局连续录制**：一次 Start/Stop 覆盖整个 Flight 场景；切换焦点载具不会停止录制或重置计时。
- **多载具记录**：主动载具默认 10 Hz；附近已加载载具按距离采样；0–100,000 km 范围内未加载载具按位置关键帧记录。支持高时间加速，带 10% 迟滞。
- **战斗遥测（BDArmory 可选）**：机炮、干扰弹、导弹与炸弹、命中/击毁、雷达锁定、队伍变更和引擎模式切换。录制端不硬引用 BDArmory；原版飞行不安装 BDA 也能正常录制。
- **任务结构**：自动记录飞行阶段、分级、轨道段、任务断点和章节；时间轴按武器、命中/击毁、锁定、飞行和备注分道。

### 回放

- **三种视角**：External 围绕选中目标，Satellite 正交俯视，Free 自由观察；支持 0.25×–1000× 播放速度。
- **时间轴与事件**：拖动、暂停、跳转、事件聚焦；按载具筛选，显示任务断点和章节刻度。
- **轨迹与高度**：10 秒至 24 小时的轨迹带、AGL 高度墙、速度/升力矢量、标签和雷达锁定线；缺测遥测不会被伪造。
- **模型**：内置原创程序化载具与弹药外形；可以逐载具导入 OBJ/STL，并把模型保存进录像副本。
- **离线**：播放器是单文件网页，不依赖服务器，不上传录像，运行时也没有网络请求。

### 格式

`.kerbtac` 是带版本号的 ZIP + JSON 格式，当前支持 v1 / revision 1–4。新播放器可以读取旧录像；格式契约见 [`docs/format-v1.md`](docs/format-v1.md) 及后续增量文档，数据来源、缺测语义和限制见 [`docs/DATA-NOTES.md`](docs/DATA-NOTES.md)。

## 快速开始

### 安装

1. 从 [Releases](https://github.com/TerranMMG/KerbTac/releases) 或 [SpaceDock](https://spacedock.info/mod/4889/KerbTac) 下载最新的 `KerbTac-v*.zip`，解压到 **KSP 游戏根目录**（包含 `KSP_x64.exe` 的目录），不要解压进 `GameData` 里面。
2. 确认存在 `GameData/KerbTac/Plugins/KerbTac.dll`。
3. 启动游戏。原版游戏即可录制；安装 BDArmory Plus 后可以额外记录战斗数据。

升级时请同时更新录制端和播放器。新播放器可以读取旧录像；旧播放器遇到新录像里部分未采集的遥测列时，可能拒绝整份文件。

### 录制

1. 进入飞行场景，从右侧工具栏打开 **KerbTac Recorder**。
2. 如果状态不是 **Recording**，点 **Start**；结束时点 **Stop**，等待窗口显示 **Saved**。
3. 录像保存在 `GameData/KerbTac/Recordings/<存档名>/`。

### 回放

1. 点 **Open replay player**，浏览器会打开模组内置的本地播放器。
2. 用 **Choose file** 选择 `.kerbtac`，或把文件拖进页面。
3. 也可以直接打开 Release 中的 `KerbTac-Player-v*.html`，不需要启动服务器或上传录像。

## 兼容性

- **KSP 1.12.5.3190**（Windows 实机验收）。
- **BDArmory Plus 1.13.x** 为可选依赖；原版游戏不安装 BDA 也能录制和回放。
- 播放器面向桌面版 Chrome/Chromium，需要 WebGL；界面支持中英文切换。

## 已知限制

- BDA 数据通过反射读取，属于 best-effort；BDA 大版本升级后字段可能变化。
- 激光武器按普通曳光弹绘制；Hydra70 火箭归入机炮事件；干扰弹烟雾以及旧录像的爆炸/破片特效不绘制。
- 轨迹底层是 10 Hz 采样；高时间加速和未加载载具使用位置关键帧或稀疏轨道段。
- 星球底图为 16K 单张纹理；32K/64K 局部瓦片 LOD 尚未实现。
- 旧版播放器可能拒绝包含新遥测列的新录像，升级时请配套更新。

## 许可证与来源

KerbTac 的原创代码采用 **MIT**，见 [LICENSE](LICENSE)。第三方资产、依赖许可证和 Kerbin 底图来源见 [NOTICE.md](NOTICE.md)。仓库不包含 KSP 程序集、Squad 二进制或 BDArmory DLL。

---

## English

<p align="center">
  <a href="#中文">简体中文</a> &nbsp;·&nbsp; <strong>English</strong><br>
  <a href="docs/format-v1.md#english">Format</a> &nbsp;·&nbsp;
  <a href="docs/README.md#english">Format index</a> &nbsp;·&nbsp;
  <a href="docs/DATA-NOTES.md#english">Data notes</a>
</p>

Turn a KSP flight into a scrubbable timeline: the recorder continuously captures multiple vessels, missiles and bombs, combat events, and telemetry inside the game; the player rebuilds the mission in a planet-fixed Three.js scene in Chrome, with three cameras, trails, altitude walls, events, and telemetry. Recording and replay are fully offline: no server and no uploads.

### Two parts

| Component | Purpose |
| --- | --- |
| **Recorder** (`KerbTac.dll`) | A KSP plugin. Start/Stop in a Flight scene; it records vessels, missiles, combat events, and telemetry, spills chunks to disk, and archives them as `.kerbtac`. |
| **Player** (`KerbTac-Player-v*.html`) | A single HTML file. Open a `.kerbtac` directly and rebuild the mission with Three.js; no install, server, or network required. |

They can be used separately: replaying a recording does not require KSP, and the recorder window includes an **Open replay player** button.

### Features

#### Recording

- **Continuous global recording**: one Start/Stop covers the whole Flight scene; changing the focused vessel does not stop recording or reset the clock.
- **Multi-vessel capture**: the active vessel is sampled at 10 Hz by default; nearby loaded vessels are sampled by distance; unloaded vessels within 0–100,000 km are recorded as position keyframes. High time warp is supported with 10% hysteresis.
- **Combat telemetry (optional BDArmory)**: gunfire, countermeasures, missiles and bombs, hits and kills, radar locks, team changes, and engine mode changes. The recorder does not hard-reference BDArmory; stock flights record normally without it.
- **Mission structure**: flight phases, staging, orbit segments, gaps, and chapters are captured automatically; the timeline separates weapons, hits/kills, locks, flight, and notes.

#### Replay

- **Three cameras**: External orbits the selected target, Satellite provides an orthographic top-down view, and Free allows free look; playback runs from 0.25× to 1000×.
- **Timeline and events**: drag, pause, seek, and focus events; filter by vessel and show mission gaps and chapter ticks.
- **Trails and altitude**: 10-second to 24-hour trail bands, AGL altitude walls, velocity/lift vectors, labels, and radar lock lines; missing telemetry is never fabricated.
- **Models**: original procedural vessel and munition shapes are built in; import OBJ/STL per vessel and save the models into a copy of the recording.
- **Offline**: the player is a single HTML file with no server, no uploads, and no runtime network requests.

#### Format

`.kerbtac` is a versioned ZIP + JSON format, currently v1 / revisions 1–4. The current player reads older recordings; the format contract starts at [`docs/format-v1.md`](docs/format-v1.md#english), and data provenance, missing-value semantics, and limitations are documented in [`docs/DATA-NOTES.md`](docs/DATA-NOTES.md#english).

### Quick start

#### Installation

1. Download the latest `KerbTac-v*.zip` from [Releases](https://github.com/TerranMMG/KerbTac/releases) or [SpaceDock](https://spacedock.info/mod/4889/KerbTac) and extract it into the **KSP game root** (the folder containing `KSP_x64.exe`), not into `GameData`.
2. Confirm that `GameData/KerbTac/Plugins/KerbTac.dll` exists.
3. Start the game. The stock game records as-is; BDArmory Plus adds combat data.

Update the recorder and player together. The current player reads older recordings; an older player may reject a newer recording that contains telemetry columns it does not understand.

#### Recording

1. Enter a Flight scene and open **KerbTac Recorder** from the right-side toolbar.
2. If the status is not **Recording**, click **Start**; click **Stop** when finished and wait for **Saved**.
3. Recordings are stored under `GameData/KerbTac/Recordings/<save name>/`.

#### Replay

1. Click **Open replay player** to open the bundled local player in your browser.
2. Choose or drag a `.kerbtac` file onto the page.
3. You can also open `KerbTac-Player-v*.html` from the release directly; no server or upload is required.

### Compatibility

- **KSP 1.12.5.3190** (verified on Windows).
- **BDArmory Plus 1.13.x** is optional; the stock game records and replays without BDA.
- The player targets desktop Chrome/Chromium and requires WebGL; the UI supports English and Chinese.

### Known limitations

- BDA data is read through reflection on a best-effort basis; major BDA updates may change fields.
- Laser weapons are drawn as ordinary tracers; Hydra70 rockets are grouped into gunfire events; countermeasure smoke and legacy explosion/shrapnel effects are not drawn.
- Trails are based on 10 Hz samples; high time warp and unloaded vessels use position keyframes or sparse orbit segments.
- The planet uses a single 16K texture; 32K/64K tiled LOD is not implemented.
- An older player may reject a newer recording with new telemetry columns, so keep recorder and player versions matched.

### License and credits

Original KerbTac code is licensed under the **MIT** license; see [LICENSE](LICENSE). Third-party assets, dependency licenses, and the Kerbin basemap source are documented in [NOTICE.md](NOTICE.md). The repository does not redistribute KSP assemblies, Squad binaries, or BDArmory DLLs.
