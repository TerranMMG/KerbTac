import { describe, expect, it } from 'vitest';
import { renderShell } from '../src/ui/shell';

describe('renderShell', () => {
  it('renders the Tacview-style shell with three camera modes', () => {
    const html = renderShell();
    expect(html).toContain('class="topbar"');
    expect(html).toContain('class="object-bar"');
    expect(html).toContain('class="viewport"');
    expect(html).toContain('class="time-panel"');
    expect(html).toContain('class="left-drawer"');
    expect(html).toContain('class="right-drawer"');
    expect(html).toContain('class="bottom-bar"');
    expect(html).toContain('data-camera="external"');
    expect(html).toContain('data-camera="satellite"');
    expect(html).toContain('data-camera="free"');
    expect(html).toContain('id="primary-object"');
    expect(html).toContain('id="secondary-object"');
    expect(html).toContain('id="track"');
    expect(html).toContain('id="display-menu"');
    expect(html).toContain('id="timeline-elapsed"');
    expect(html).toContain('id="timeline-remaining"');
    expect(html).not.toContain('id="view-controls"');
    expect(html).not.toContain('id="session-name"');
  });

  it('still exposes every element the app binds to', () => {
    const html = renderShell();
    for (const id of [
      'viewport',
      'labels',
      'file-name',
      'vessel-list',
      'vessel-count',
      'events',
      'event-count',
      'telemetry',
      'resources',
      'telemetry-vessel',
      'clock-mission',
      'play-state',
      'play-speed',
      'compass',
      'btn-play',
      'speeds',
      'empty',
      'hud-ut',
      'hud-fps',
      'timeline-elapsed',
      'timeline-remaining',
      'loading',
      'loading-text',
      'warn-badge',
      'drop-overlay',
      'help-overlay',
      'toast',
      'toast-title',
      'toast-detail',
      'file-input',
    ]) {
      expect(html, `missing #${id}`).toContain(`id="${id}"`);
    }
  });
});
