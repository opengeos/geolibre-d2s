import { afterEach, describe, expect, it } from 'vitest';
import plugin from '../src/geolibre';
import type { GeoLibreRightPanelRegistration } from '../src/lib/geolibre/host-api';

interface FakeControl {
  onAdd(map: unknown): HTMLElement;
  onRemove(): void;
}

function fakeHost(withDock: boolean) {
  const mapContainer = document.createElement('div');
  document.body.appendChild(mapContainer);
  const map = {
    getContainer: () => mapContainer,
    on() {},
    off() {},
  };
  const controls: FakeControl[] = [];
  const calls: string[] = [];
  let panel: GeoLibreRightPanelRegistration | null = null;
  const host = {
    mapContainer,
    controls,
    calls,
    get panel() {
      return panel;
    },
    addMapControl: (control: FakeControl) => {
      mapContainer.appendChild(control.onAdd(map));
      controls.push(control);
      return true;
    },
    removeMapControl: (control: FakeControl) => {
      control.onRemove();
      controls.splice(controls.indexOf(control), 1);
    },
    ...(withDock
      ? {
          registerRightPanel: (registration: GeoLibreRightPanelRegistration) => {
            panel = registration;
            return () => {
              panel = null;
            };
          },
          openRightPanel: (id: string) => {
            calls.push(`open:${id}`);
            return true;
          },
          closeRightPanel: (id: string) => calls.push(`close:${id}`),
        }
      : {}),
  };
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('GeoLibre docked panel', () => {
  it('opens the panel in the side dock and keeps the control on the map', () => {
    const host = fakeHost(true);
    expect(plugin.activate(host as never)).not.toBe(false);
    try {
      expect(host.controls).toHaveLength(1);
      expect(host.calls).toEqual(['open:geolibre-d2s-panel']);
      expect(host.panel?.deactivatePluginOnClose).toBe(true);
      expect(host.mapContainer.querySelector('.plugin-control-panel')).toBeNull();
      expect(host.mapContainer.querySelector('.plugin-control--docked')).not.toBeNull();

      const dock = document.createElement('div');
      const cleanup = host.panel!.render(dock);
      const docked = dock.querySelector('.plugin-control-panel--docked');
      expect(docked).not.toBeNull();
      expect(docked!.querySelector('.plugin-control-header')).toBeNull();
      expect(docked!.querySelector('input[type="password"]')).not.toBeNull();

      // Another panel displacing this one releases the element only.
      if (typeof cleanup === 'function') cleanup();
      expect(dock.childElementCount).toBe(0);
      expect(host.controls).toHaveLength(1);
    } finally {
      plugin.deactivate(host as never);
    }
    expect(host.controls).toHaveLength(0);
    expect(host.panel).toBeNull();
    expect(host.calls).toContain('close:geolibre-d2s-panel');
  });

  it('falls back to the floating panel on hosts without a dock', () => {
    const host = fakeHost(false);
    expect(plugin.activate(host as never)).not.toBe(false);
    try {
      const floating = host.mapContainer.querySelector('.plugin-control-panel');
      expect(floating).not.toBeNull();
      expect(floating!.classList.contains('plugin-control-panel--docked')).toBe(false);
      expect(floating!.querySelector('.plugin-control-header')).not.toBeNull();
    } finally {
      plugin.deactivate(host as never);
    }
  });
});
