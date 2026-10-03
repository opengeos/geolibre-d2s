import { PluginControl } from "./lib/core/PluginControl";
import type { PluginState } from "./lib/core/types";
import type {
  GeoLibreAppAPI,
  GeoLibreMapControlPosition,
  GeoLibrePlugin,
} from "./lib/geolibre/host-api";
import { D2S_SERVER_PARAM, maybeHandleDeepLink } from "./lib/utils/deep-link";
import "./lib/styles/plugin-control.css";

// The host API is generic over the control type; bind it to this plugin's
// concrete control so the wired callbacks are fully typed.
type AppAPI = GeoLibreAppAPI<PluginControl>;

let control: PluginControl | null = null;
// The panel docks in GeoLibre's side panel, so the toolbar button is hidden and
// its corner only matters on hosts without a dock, which keep the default.
const position: GeoLibreMapControlPosition = "top-left";
let pendingState: Partial<PluginState> | null = null;
let unregisterPanel: (() => void) | null = null;

const PANEL_ID = "geolibre-d2s-panel";

/** Whether the host offers GeoLibre's dockable side panel. */
function hasDock(app: AppAPI): boolean {
  return Boolean(app.registerRightPanel && app.openRightPanel);
}

function createControl(app: AppAPI): PluginControl {
  const nextControl = new PluginControl({
    docked: hasDock(app),
    collapsed: pendingState?.collapsed ?? true,
    panelWidth: pendingState?.panelWidth ?? 320,
    title: "Data to Science (D2S)",
    serverUrl:
      (pendingState?.data?.serverUrl as string | undefined) ?? undefined,
    // Bind optional host capabilities; each falls back to a safe default on
    // hosts (or standalone usage) that do not provide them.
    registerNativeLayer: (layer) => app.registerExternalNativeLayer?.(layer),
    unregisterNativeLayer: (id) => app.unregisterExternalNativeLayer?.(id),
    fetchArrayBuffer: app.fetchArrayBuffer
      ? (url) => app.fetchArrayBuffer!(url)
      : undefined,
    fitBounds: makeFitBounds(app),
    // The desktop webview drops the D2S session cookie (third-party at
    // tauri://localhost), so sign in through the host's native client there.
    sessionFetch: app.nativeFetch
      ? (input, init) => app.nativeFetch!(input, init)
      : undefined,
  });

  if (pendingState) {
    nextControl.setState(pendingState);
  }

  return nextControl;
}

/**
 * Resolve a `fitBounds` callback for the control, preferring the host's
 * dedicated capability and falling back to the raw MapLibre map.
 *
 * Many hosts (including the web viewer) do not implement the optional
 * `app.fitBounds`, which would leave the "Add selected to map" action unable to
 * zoom to freshly added layers. When the host instead exposes `app.getMap`, we
 * drive the map's own `fitBounds` directly. The map is resolved lazily inside
 * the callback so it is read when the user adds layers (map ready) rather than
 * at activation time (map may still be null).
 *
 * @param app The GeoLibre host API bound to this plugin's control.
 * @returns A bounds-fitting callback, or `undefined` when no host capability can
 *   move the viewport.
 */
function makeFitBounds(
  app: AppAPI,
): ((bounds: [number, number, number, number]) => void) | undefined {
  if (app.fitBounds) {
    return (bounds) => app.fitBounds!(bounds);
  }
  if (app.getMap) {
    return (bounds) => {
      const map = app.getMap!();
      map?.fitBounds(bounds, { padding: 40, duration: 1000, maxZoom: 18 });
    };
  }
  return undefined;
}

function isPluginState(value: unknown): value is Partial<PluginState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if ("collapsed" in candidate && typeof candidate.collapsed !== "boolean") {
    return false;
  }
  if ("panelWidth" in candidate && typeof candidate.panelWidth !== "number") {
    return false;
  }
  if (
    "data" in candidate &&
    (typeof candidate.data !== "object" ||
      candidate.data === null ||
      Array.isArray(candidate.data))
  ) {
    return false;
  }

  return true;
}

/**
 * Register the side panel that shows the control's panel element.
 *
 * @param app The GeoLibre host API.
 */
function registerPanel(app: AppAPI): void {
  unregisterPanel?.();
  unregisterPanel =
    app.registerRightPanel?.({
      id: PANEL_ID,
      title: "Data to Science (D2S)",
      dock: "replace-style",
      defaultWidth: 340,
      deactivatePluginOnClose: true,
      render: (container) => {
        const panel = control?.getPanel();
        if (panel) container.replaceChildren(panel);
        return () => {
          if (panel?.parentElement === container) panel.remove();
        };
      },
    }) ?? null;
}

/**
 * Remove the control and its docked panel, caching the control's state.
 *
 * @param app The GeoLibre host API.
 */
function teardown(app: AppAPI): void {
  if (control) {
    pendingState = control.getState();
    app.removeMapControl(control);
    control = null;
  }
  if (unregisterPanel) {
    app.closeRightPanel?.(PANEL_ID);
    unregisterPanel();
    unregisterPanel = null;
  }
}

export const plugin: GeoLibrePlugin<PluginControl> = {
  id: "geolibre-d2s",
  name: "Data to Science (D2S)",
  version: "0.1.1",
  urlParameterNames: [D2S_SERVER_PARAM],
  activate(app) {
    control = control ?? createControl(app);
    const added = app.addMapControl(control, position);
    if (!added) {
      control = null;
      return false;
    }
    if (!hasDock(app)) return;
    // The panel docks; the control stays on the map for the plugin's lifetime
    // because the layers it adds are registered through it. Another docked
    // panel displacing this one only releases the panel element.
    registerPanel(app);
    if (!app.openRightPanel!(PANEL_ID)) {
      teardown(app);
      return false;
    }
  },
  // Deep link: GeoLibre auto-activates this plugin when a URL carries the
  // parameter it owns and dispatches the parsed parameters here, e.g.
  // ?d2s-server=https://ps2.d2s.org
  handleUrlParameters(_app, params) {
    if (control) maybeHandleDeepLink(control, params);
  },
  deactivate(app) {
    teardown(app);
  },
  getProjectState() {
    return control?.getState() ?? pendingState ?? undefined;
  },
  applyProjectState(_app, state) {
    if (!isPluginState(state)) return false;
    pendingState = state;
    control?.setState(state);
  },
};

export default plugin;
