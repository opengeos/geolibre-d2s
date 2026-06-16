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
let position: GeoLibreMapControlPosition = "top-left";
let pendingState: Partial<PluginState> | null = null;

function createControl(app: AppAPI): PluginControl {
  const nextControl = new PluginControl({
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
    fitBounds: app.fitBounds ? (bounds) => app.fitBounds!(bounds) : undefined,
  });

  if (pendingState) {
    nextControl.setState(pendingState);
  }

  return nextControl;
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

export const plugin: GeoLibrePlugin<PluginControl> = {
  id: "geolibre-d2s",
  name: "GeoLibre D2S",
  version: "0.1.0",
  urlParameterNames: [D2S_SERVER_PARAM],
  activate(app) {
    control = control ?? createControl(app);
    const added = app.addMapControl(control, position);
    if (!added) {
      control = null;
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
    if (!control) return;
    pendingState = control.getState();
    app.removeMapControl(control);
    control = null;
  },
  getMapControlPosition() {
    return position;
  },
  setMapControlPosition(app, nextPosition) {
    position = nextPosition;
    if (!control) return;

    app.removeMapControl(control);
    const added = app.addMapControl(control, position);
    if (!added) {
      pendingState = control.getState();
      control = null;
      return false;
    }
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
