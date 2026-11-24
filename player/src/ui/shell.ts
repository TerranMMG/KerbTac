/**
 * Tacview-style shell: a full-bleed viewport with overlay drawers, a compact
 * object bar, and a bottom transport/time bar. All app-bound ids stay stable.
 */
export function renderShell(): string {
  return `
<div class="app-shell">
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">K</span>
      <span class="brand-name" data-i18n="app.name">KerbTac</span>
      <span class="brand-tag" data-i18n="app.tagline"></span>
    </div>
    <div class="file-info">
      <span class="file-name" id="file-name"></span>
    </div>
    <div class="top-actions">
      <button class="warn-badge" id="warn-badge" type="button" hidden></button>
      <button class="btn ghost small" id="btn-demo" data-i18n="app.demo" data-i18n-title="app.demoHint"></button>
      <button class="btn ghost small" id="btn-open" data-i18n="app.open" data-i18n-title="app.openHint"></button>
      <button class="btn ghost small" type="button" id="btn-models" aria-controls="models-panel" aria-expanded="false" data-i18n="models.title" disabled></button>
      <button class="btn ghost small lang" id="btn-lang" data-i18n="app.language" data-i18n-title="app.languageHint"></button>
      <button class="icon-btn" id="btn-help" data-i18n-title="app.helpHint" aria-label="Help">?</button>
    </div>
  </header>

  <div class="object-bar">
    <label class="object-field object-field-primary">
      <span data-i18n="object.primary">Primary</span>
      <select id="primary-object" aria-label="Primary object"></select>
    </label>
    <div class="bearing-range" id="bearing-range">
      <span class="bearing" id="bearing-value">—</span>
      <span class="bearing-sep">|</span>
      <span class="aspect" id="aspect-value">—</span>
      <span class="bearing-sep">|</span>
      <span class="range" id="range-value">—</span>
      <span class="bearing-sep">|</span>
      <span class="closure" id="closure-value">—</span>
    </div>
    <label class="object-field object-field-secondary">
      <span data-i18n="object.secondary">Secondary</span>
      <select id="secondary-object" aria-label="Secondary object"></select>
    </label>
    <div class="object-bar-spacer"></div>
    <div class="segmented" id="camera-buttons">
      <button type="button" class="is-active" data-camera="external" data-i18n="camera.external" title="External orbit"></button>
      <button type="button" data-camera="satellite" data-i18n="camera.satellite" title="Satellite top-down"></button>
      <button type="button" data-camera="free" data-i18n="camera.free" title="Free camera"></button>
    </div>
  </div>

  <main class="viewport" id="viewport">
    <div class="labels" id="labels"></div>

    <div class="time-panel" id="time-panel" hidden>
      <div class="time-meta">
        <span id="hud-ut"></span>
        <span class="time-sep">·</span>
        <span id="hud-fps"></span>
      </div>
      <span class="clock-mission" id="clock-mission">T+ 00:00</span>
      <div class="time-footer">
        <span class="play-state" id="play-state"></span>
        <span class="play-speed" id="play-speed">x1</span>
      </div>
    </div>

    <div class="compass" id="compass" hidden aria-hidden="true">
      <span class="compass-arrow" id="compass-arrow"></span>
    </div>

    <div class="empty" id="empty">
      <div class="empty-card">
        <div class="empty-glyph" aria-hidden="true">✈</div>
        <h1 data-i18n="empty.title"></h1>
        <p data-i18n="empty.hint"></p>
        <button class="btn primary" id="btn-browse" data-i18n="empty.browse"></button>
        <p class="fineprint" data-i18n="empty.note"></p>
      </div>
    </div>

    <div class="loading" id="loading" hidden>
      <span class="spinner" aria-hidden="true"></span>
      <span id="loading-text"></span>
    </div>
  </main>

  <section class="models-panel" id="models-panel" aria-labelledby="models-title" inert>
    <div class="panel-head models-header">
      <h2 id="models-title" data-i18n="models.title"></h2>
      <button class="btn ghost small" type="button" id="models-close" data-i18n="models.close"></button>
    </div>
    <div id="model-list"></div>
    <div class="models-footer">
      <span id="models-size" aria-live="polite"></span>
      <div class="models-footer-actions">
        <button class="btn ghost small" type="button" id="models-session" data-i18n="models.session"></button>
        <button class="btn primary small" type="button" id="models-save" data-i18n="models.save" disabled></button>
      </div>
    </div>
  </section>

  <aside class="left-drawer" id="left-drawer">
    <div class="drawer-head">
      <div class="panel-head">
        <h2 data-i18n="vessel.title"></h2>
        <span class="badge" id="vessel-count"></span>
      </div>
      <div class="vessel-list" id="vessel-list"></div>
    </div>
    <section class="events-section">
      <div class="panel-head">
        <h2 data-i18n="events.title"></h2>
        <span class="badge" id="event-count"></span>
      </div>
      <div class="event-filters" id="event-filters">
        <button type="button" class="event-filter is-active" data-filter="all" data-i18n="events.filterAll"></button>
        <button type="button" class="event-filter" data-filter="combat" data-i18n="events.filterCombat"></button>
        <button type="button" class="event-filter" data-filter="flight" data-i18n="events.filterFlight"></button>
        <button type="button" class="event-filter" data-filter="system" data-i18n="events.filterSystem"></button>
      </div>
      <div class="events" id="events"></div>
    </section>
  </aside>

  <aside class="right-drawer" id="right-drawer">
    <section class="telemetry-section">
      <div class="panel-head">
        <h2 data-i18n="telemetry.title"></h2>
        <span class="vessel-chip" id="telemetry-vessel"></span>
      </div>
      <div class="telemetry" id="telemetry"></div>
      <div class="resources" id="resources"></div>
    </section>
    <div id="display-menu" class="display-menu-host"></div>
  </aside>

  <footer class="bottom-bar">
    <div class="transport">
      <div class="transport-playback">
        <button class="icon-btn transport-icon" id="btn-prev-event" type="button" data-i18n-title="timeline.prevEvent" aria-label="Previous event">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM18 5v14l-9-7z"/></svg>
        </button>
        <button class="icon-btn transport-icon" id="btn-slower" type="button" data-i18n-title="timeline.slower" aria-label="Slower">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5v14L2 12zM22 5v14l-9-7z"/></svg>
        </button>
        <button class="play-btn" id="btn-play" type="button">
          <svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          <svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>
        </button>
        <button class="icon-btn transport-icon" id="btn-faster" type="button" data-i18n-title="timeline.faster" aria-label="Faster">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 5v14l9-7zM13 5v14l9-7z"/></svg>
        </button>
        <button class="icon-btn transport-icon" id="btn-next-event" type="button" data-i18n-title="timeline.nextEvent" aria-label="Next event">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14l9-7zM16 5h2v14h-2z"/></svg>
        </button>
        <span class="transport-divider" aria-hidden="true"></span>
        <button class="btn ghost small" id="btn-restart" type="button" data-i18n="timeline.backToStart" data-i18n-title="timeline.reset">Back to start</button>
      </div>
      <label class="transport-trail">
          <span data-i18n="display.trailSize">Trail size</span>
          <input type="range" id="trail-size" min="0" step="1" />
          <output id="trail-size-value">00:10</output>
        </label>
      <div class="transport-spacer"></div>
      <div class="transport-actions">
        <button class="btn ghost small" id="btn-left" type="button" data-i18n="panel.objects" data-i18n-title="panel.objectsHint">Objects</button>
        <button class="btn ghost small" id="btn-right" type="button" data-i18n="panel.data" data-i18n-title="panel.dataHint">Telemetry</button>
        <button class="btn ghost small" id="btn-display" type="button" data-i18n="panel.display" data-i18n-title="panel.displayHint">Display</button>
        <button class="btn ghost small" id="btn-summary" type="button" data-i18n="app.summary" data-i18n-title="app.summaryHint">Summary</button>
        <button class="btn ghost small" id="btn-reset-camera" data-i18n="camera.reset" data-i18n-title="timeline.reset"></button>
      </div>
      <div class="speeds" id="speeds" hidden></div>
    </div>
    <div class="track-row">
      <span class="timeline-offset" id="timeline-elapsed">+00:00:00</span>
      <div class="track" id="track" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>
      <span class="timeline-offset timeline-offset-right" id="timeline-remaining">-00:00:00</span>
    </div>
  </footer>
</div>

<div class="drop-overlay" id="drop-overlay" hidden>
  <div class="drop-inner">
    <div class="drop-glyph" aria-hidden="true">↓</div>
    <p data-i18n="empty.title"></p>
  </div>
</div>

<div class="help-overlay" id="help-overlay" hidden>
  <div class="help-card" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <header>
      <h2 id="help-title" data-i18n="help.title"></h2>
      <button class="icon-btn" id="btn-help-close" aria-label="Close">×</button>
    </header>
    <h3 data-i18n="help.keys"></h3>
    <dl class="keymap">
      <div><dt><kbd>Space</kbd></dt><dd data-i18n="help.key.play"></dd></div>
      <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd data-i18n="help.key.seek"></dd></div>
      <div><dt><kbd>[</kbd> <kbd>]</kbd></dt><dd data-i18n="help.key.speed"></dd></div>
      <div><dt><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></dt><dd data-i18n="help.key.camera"></dd></div>
      <div><dt><kbd>F</kbd></dt><dd data-i18n="help.key.focus"></dd></div>
      <div><dt><kbd>R</kbd></dt><dd data-i18n="help.key.reset"></dd></div>
      <div><dt><kbd>L</kbd></dt><dd data-i18n="help.key.lang"></dd></div>
      <div><dt><kbd>?</kbd></dt><dd data-i18n="help.key.help"></dd></div>
    </dl>
    <p class="fineprint" data-i18n="help.note"></p>
    <button class="btn primary" id="btn-help-ok" data-i18n="help.close"></button>
  </div>
</div>

<div class="help-overlay summary-overlay" id="summary-overlay" hidden>
  <div class="help-card summary-card" role="dialog" aria-modal="true" aria-labelledby="summary-title">
    <header>
      <h2 id="summary-title" data-i18n="summary.title"></h2>
      <button class="icon-btn" id="btn-summary-close" aria-label="Close">×</button>
    </header>
    <div class="summary-body" id="summary-body"></div>
    <button class="btn primary" id="btn-summary-ok" data-i18n="summary.close"></button>
  </div>
</div>

<div class="toast" id="toast" hidden>
  <div class="toast-head">
    <span id="toast-title"></span>
    <button class="icon-btn" id="btn-toast-close" aria-label="Close">×</button>
  </div>
  <p id="toast-detail"></p>
</div>

<input type="file" id="file-input" accept=".kerbtac,application/zip" hidden />
`;
}
