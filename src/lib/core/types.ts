import type { Map } from 'maplibre-gl';
import type { GeoLibreNativeLayerRegistration } from '../geolibre/host-api';

/**
 * Options for configuring the PluginControl
 */
export interface PluginControlOptions {
  /**
   * Whether the control panel should start collapsed (showing only the toggle button)
   * @default true
   */
  collapsed?: boolean;

  /**
   * Position of the control on the map
   * @default 'top-right'
   */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

  /**
   * Title displayed in the control header
   * @default 'Plugin Control'
   */
  title?: string;

  /**
   * Width of the control panel in pixels
   * @default 300
   */
  panelWidth?: number;

  /**
   * Custom CSS class name for the control container
   */
  className?: string;

  /**
   * Host-provided directory picker (for example, GeoLibre Desktop). Resolves
   * with the selected files, or `null` when the user cancels or no host picker
   * is available. The GeoLibre wrapper binds this to
   * `app.pickLocalDirectoryFiles`; defaults to a no-op returning `null`.
   */
  pickFiles?: () => Promise<File[] | null>;

  /**
   * Host callback to register a native MapLibre layer that GeoLibre owns and
   * renders on the plugin's behalf. Bound by the GeoLibre wrapper to
   * `app.registerExternalNativeLayer`; defaults to a no-op so the control also
   * works as a standalone MapLibre control.
   */
  registerNativeLayer?: (layer: GeoLibreNativeLayerRegistration) => void;

  /**
   * Host callback to remove a native layer previously registered with
   * {@link PluginControlOptions.registerNativeLayer}. Bound by the GeoLibre
   * wrapper to `app.unregisterExternalNativeLayer`; defaults to a no-op.
   */
  unregisterNativeLayer?: (id: string) => void;

  /**
   * Host callback to fetch a URL's bytes (routes through the desktop network
   * layer when available, dodging browser CORS). Bound by the GeoLibre wrapper
   * to `app.fetchArrayBuffer`; defaults to the global `fetch`.
   */
  fetchArrayBuffer?: (url: string) => Promise<ArrayBuffer>;

  /**
   * Host callback to fit the map to `[west, south, east, north]` bounds. Bound
   * by the GeoLibre wrapper to `app.fitBounds`; defaults to a no-op.
   */
  fitBounds?: (bounds: [number, number, number, number]) => void;

  /** Default D2S server URL to prefill in the login form. */
  serverUrl?: string;

  /** titiler base URL used to tile Cloud-Optimized GeoTIFFs. */
  titilerUrl?: string;
}

/**
 * Internal state of the plugin control
 */
export interface PluginState {
  /**
   * Whether the control panel is currently collapsed
   */
  collapsed: boolean;

  /**
   * Current panel width in pixels
   */
  panelWidth: number;

  /**
   * Any custom state data
   */
  data?: Record<string, unknown>;
}

/**
 * Props for the React wrapper component
 */
export interface PluginControlReactProps extends PluginControlOptions {
  /**
   * MapLibre GL map instance
   */
  map: Map;

  /**
   * Callback fired when the control state changes
   */
  onStateChange?: (state: PluginState) => void;
}

/**
 * Event types emitted by the plugin control
 */
export type PluginControlEvent = 'collapse' | 'expand' | 'statechange';

/**
 * Event handler function type
 */
export type PluginControlEventHandler = (event: { type: PluginControlEvent; state: PluginState }) => void;
