# KerbTac / 坎迹

KSP 1.12.5 的任务记录仪与离线浏览器回放器。
A mission recorder and offline browser replay player for Kerbal Space Program 1.12.5.

---

## 中文

### 概述

KerbTac（坎迹）由两部分组成：一个运行在 KSP 内的录制端插件，和一个在浏览器里离线回放的单文件播放器。录制端在一次飞行中连续记录多艘载具、导弹与炸弹、战斗事件和遥测；播放器用 Three.js 以行星为参考系重建整场任务，可以拖动时间轴、切换视角、查看事件、轨迹和高度。

它适合两类用途：

- 记录任务过程，事后复盘飞行轨迹、分级、着陆和轨道。
- 记录 BDArmory 战斗，按时间轴回看导弹发射、命中、击毁、干扰弹和队伍变化。

### 主要功能

- **全局连续录制**：一次 Start/Stop 覆盖整个 Flight 场景；切换焦点载具不会停止录制或重置计时。
- **多载具记录**：主动载具默认 10 Hz；附近已加载载具按距离采样；范围内未加载载具按位置关键帧记录。支持 0–100,000 km 范围和 10% 迟滞，高时间加速下自动补齐位置。
- **战斗遥测（BDArmory 可选）**：机炮、干扰弹、导弹与炸弹、命中/击毁、雷达锁定、队伍变更和引擎模式切换。录制端不硬引用 BDArmory；未安装时原版飞行仍可正常录制。
- **Tacview 式回放**：External / Satellite / Free 三种视角；0.25×–1000× 播放速度；10 秒至 24 小时的轨迹；高度墙、速度/升力矢量、标签、雷达锁定线和事件时间轴。
- **任务结构**：自动记录飞行阶段、分级、轨道段、任务断点和章节；时间轴按武器、命中/击毁、锁定、飞行和备注分道。
- **模型与轨迹**：内置原创程序化载具和弹药外形；也可以给单艘载具导入 OBJ/STL 模型，并把模型一起保存进录像副本。
- **离线播放**：播放器是单个 HTML 文件，直接双击即可打开；不需要服务器，不上传录像，不请求网络资源。
- **开放格式**：录像使用 ZIP + JSON 的 `.kerbtac` 格式，带版本号和增量修订；新播放器兼容旧录像。

### 安装

1. 退出 KSP 1.12.5。
2. 从 [Releases](https://github.com/TerranMMG/KerbTac/releases) 下载 `KerbTac-v0.1.0.zip`，解压到 **KSP 游戏根目录**（包含 `KSP_x64.exe` 的目录），不要解压进 `GameData` 里面。
3. 确认存在 `GameData/KerbTac/Plugins/KerbTac.dll`。
4. 启动游戏。原版游戏即可录制；安装 BDArmory Plus 后可以额外记录战斗数据。

升级时请同时更新录制端和播放器。新播放器可以读取旧录像；旧播放器遇到新录像里部分未采集的遥测列时，可能拒绝整份文件。

### 使用

1. 进入飞行场景，从右侧工具栏打开 **KerbTac Recorder**。
2. 如果状态不是 **Recording**，点 **Start**；结束时点 **Stop**，等待窗口显示 **Saved**。录像保存在 `GameData/KerbTac/Recordings/<存档名>/`。
3. 点 **Open replay player**，浏览器会打开模组内置的本地播放器。用 **Choose file** 选择 `.kerbtac`，或把文件拖进页面。
4. 也可以直接打开 Release 中的 `KerbTac-Player-v0.1.0.html`，不需要启动服务器或上传录像。

### 兼容性

- **KSP 1.12.5.3190**（Windows 实机验收）。
- **BDArmory Plus 1.13.x** 为可选依赖；原版游戏不安装 BDA 也能录制和回放。
- 播放器面向桌面版 Chrome/Chromium，需要 WebGL；支持中英文界面。

### 已知限制

- BDA 数据通过反射读取，属于 best-effort；BDA 大版本升级后字段可能变化。
- 激光武器按普通曳光弹绘制；Hydra70 火箭归入机炮事件；干扰弹烟雾以及旧录像的爆炸/破片特效不绘制。
- 轨迹底层是 10 Hz 采样；高时间加速和未加载载具使用位置关键帧或稀疏轨道段。
- 星球底图为 16K 单张纹理；32K/64K 局部瓦片 LOD 尚未实现。
- 旧版播放器可能拒绝包含新遥测列的新录像，升级时请配套更新。

### 许可证

KerbTac 的原创代码采用 **MIT**，见 [LICENSE](LICENSE)。第三方资产、依赖许可证和 Kerbin 底图来源见 [NOTICE.md](NOTICE.md)。仓库不包含 KSP 程序集、Squad 二进制或 BDArmory DLL。

---

## English

### Overview

KerbTac is a mission recorder and offline replay player for Kerbal Space Program 1.12.5. The recorder is a KSP plugin that continuously captures multiple vessels, missiles and bombs, combat events, and telemetry during a flight. The player is a single self-contained HTML file that reconstructs the mission in a planet-fixed Three.js scene, with a scrubbable timeline, multiple camera modes, events, trails, and altitude visualisation.

It is built for two kinds of use:

- Record a mission and review its trajectory, staging, landing, and orbit afterwards.
- Record BDArmory combat and replay missile launches, hits, kills, countermeasures, and team changes along the timeline.

### Features

- **Continuous global recording**: one Start/Stop covers the whole Flight scene; changing the focused vessel does not stop recording or reset the clock.
- **Multi-vessel capture**: the active vessel is sampled at 10 Hz by default; nearby loaded vessels are sampled by distance; unloaded vessels inside range are recorded as position keyframes. Supports a 0–100,000 km range with 10% hysteresis and fills positions under high time warp.
- **Combat telemetry (optional BDArmory)**: gunfire, countermeasures, missiles and bombs, hits and kills, radar locks, team changes, and engine mode changes. The recorder does not hard-reference BDArmory; stock flights record normally without it.
- **Tacview-style replay**: External, Satellite, and Free cameras; 0.25×–1000× playback; trails from 10 seconds to 24 hours; altitude walls, velocity/lift vectors, labels, radar lock lines, and an event timeline.
- **Mission structure**: flight phases, staging, orbit segments, gaps, and chapters are captured automatically; the timeline separates weapons, hits/kills, locks, flight, and notes.
- **Models and trails**: original procedural vessel and munition shapes are built in; you can also import OBJ/STL models per vessel and save them into a copy of the recording.
- **Offline playback**: the player is one HTML file that opens directly from disk. No server, no uploads, and no runtime network requests.
- **Open format**: recordings use the ZIP + JSON `.kerbtac` format with a version number and incremental revisions; the current player reads older recordings.

### Installation

1. Exit KSP 1.12.5.
2. Download `KerbTac-v0.1.0.zip` from [Releases](https://github.com/TerranMMG/KerbTac/releases) and extract it into the **KSP game root** (the folder containing `KSP_x64.exe`), not into `GameData`.
3. Confirm that `GameData/KerbTac/Plugins/KerbTac.dll` exists.
4. Start the game. The stock game can be recorded as-is; installing BDArmory Plus adds combat data.

Update the recorder and the player together. The current player reads older recordings; an older player may reject a newer recording that contains telemetry columns it does not understand.

### Usage

1. Enter a Flight scene and open **KerbTac Recorder** from the right-side toolbar.
2. If the status is not **Recording**, click **Start**; click **Stop** when finished and wait for **Saved**. Recordings are stored under `GameData/KerbTac/Recordings/<save name>/`.
3. Click **Open replay player** to open the bundled local player in your browser. Choose or drag a `.kerbtac` file onto the page.
4. You can also open `KerbTac-Player-v0.1.0.html` from the release directly; no server or upload is required.

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

### License

Original KerbTac code is licensed under the **MIT** license; see [LICENSE](LICENSE). Third-party assets, dependency licenses, and the Kerbin basemap source are documented in [NOTICE.md](NOTICE.md). The repository does not redistribute KSP assemblies, Squad binaries, or BDArmory DLLs.
