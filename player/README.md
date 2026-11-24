# KerbTac Player

Browser-based Tacview-style replay viewer for `.kerbtac` recordings. Static
single-page app: TypeScript + Three.js, no server, no upload.

- Format contracts: [documentation index](../docs/README.md)

## Quick start

```bash
npm ci
npm run dev        # Vite dev server
```

Load a `.kerbtac` file by dragging it onto the page or using **Open recording**.
**Load demo** opens a bundled synthetic 120 s Kerbin circuit.

## Build

```bash
npm run build      # type-check + single-file bundle
```

Output is `dist/index.html` (about 5 MB): HTML, CSS, JavaScript, the demo
recording and the 16K Kerbin map are inlined, so it opens directly from
`file://` with no web server. WebGL still needs a desktop browser.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | `tsc --noEmit` plus production single-file build |
| `npm run preview` | Serve the built bundle locally |
| `npm test` | All Vitest tests in headless Chrome, including real Worker and DOM coverage |
| `npm run typecheck` | TypeScript only |

Tests use an installed Google Chrome by default. To use another local
Chrome/Chromium executable, run `CHROME_BIN=/path/to/chromium npm test`.

## Playback features

- v1 archives through revision 4: missions, gaps/chapters, actors,
  effects, locks, and optional combat telemetry columns.
- **External** orbit camera around the selected target's local up; no roll,
  pitch 1°–170°, target stays centred at high playback speed.
- **Satellite** orthographic top-down 3D view, north-up, drag to pan, wheel to
  zoom.
- **Free** drag-look camera: left-drag to look, `WASD`/`QE` movement, `Shift`
  boost.
- Attitude ribbon trails with smooth shader clipping, head/tail fades, and the
  same time window for selected and unselected objects (10 s to 24 h).
- Planet-fixed scene at the recording epoch: playback does not simulate Kerbin's
  rotation, so manual satellite focus and landing points stay on the same ground.
- Height walls using AGL placement; blank/obscured metrics are not fabricated.
  Height metrics: ASL, AGL, TAS, AOA, G, vertical speed.
- Side-coloured solid/semi-transparent radar lock lines; lock intervals from
  `locks.json`.
- Missile actors with name-based shapes, launch-gated labels and trails.
- Event timeline lanes, selected-object filtering, gap shading and chapter ticks.
- Deterministic countermeasure effects from `effects.json`; legacy shrapnel is not drawn.
- English / Chinese UI with `localStorage` persistence.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Seek −5 s / +5 s |
| `[` / `]` | Slower / faster |
| `F` | External camera |
| `C` | Free camera |
| `R` | Reset view |
| `L` | Toggle language |
| `?` | Help |

## Display menu

- **Trail size**: 10 s to 24 h, with coarser steps for long histories.
- **Object height**: Disabled / Selected only / All objects.
- **Height metric**: ASL, AGL, TAS, AOA, G, Vertical speed.
- **Model scale**: `0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4 / 6 / 8 / 10`.
- **Vectors**: plain heading/course/lift rays; no arrowheads.
- **Labels**: selected/unselected field sets and independent scales.
- **Radar lock lines**: off by default; source-side colour, semi-transparent.

## Layout

```
src/
  format/      ZIP reading, JSON schema, validation, normalized replay model
  playback/    math, body frames, sampling, clock, display settings, metrics
  scene/       Three.js world, planet, cameras, trails, height wall, actors,
               effects, locks, labels, render-frame conversion
  ui/          shell, timeline, drawers, telemetry, display menu, formatting
  i18n/        English source strings + Chinese translations
tests/         Vitest suites and archive fixture helpers
testdata/      synthetic.kerbtac + recorder.kerbtac (C# writer contract fixture)
```

The player never downloads assets at runtime and makes no network requests after
load.

## Cross-language contract

`testdata/recorder.kerbtac` is the historical C# revision 2 fixture; keep
it unchanged. `npm test` also runs the current C# writer once, then replays
its generated revision 4 archive with sparse multi-chunk columns in Chrome.
The browser suite needs the .NET 8 SDK (`dotnet` on `PATH`, or `DOTNET_BIN`
set to its executable) as well as Chrome. Run the writer separately from
the repository root without overwriting the historical fixture:

```bash
dotnet run --project recorder/tools/KerbTac.FixtureGen -- /tmp/kerbtac-current.kerbtac
```

The optional AeroEquus real-recording test runs when
`KERBTAC_AEROEQUUS_FILE` points to the original local `.kerbtac` file.
The recording itself is not included in the public export.

## Notes

- Kerbin uses a 16K equirectangular map. KSP's body-fixed globe is mirrored when
  viewed through a right-handed renderer; `scene/renderFrame.ts` applies
  `S = diag(1, 1, -1)` to positions and `(-qx, -qy, qz, qw)` to quaternions.
- Scene units are metres. Kerbin's radius is 600 km; the camera far plane is
  30,000 km with a logarithmic depth buffer.
- 32K/64K source maps cannot be loaded directly as a single runtime texture
  (GPU limit ~16384 px and memory cost). The current map uses 16K plus
  procedural surface detail; true multi-resolution tiling is future work.
- BDA `.mu` models are not loaded at runtime; missile markers are name-based
  procedural approximations.
