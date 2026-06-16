/**
 * Canonical GeoLibre host-plugin contract.
 *
 * This module is the single source of truth for the interface between a plugin
 * and the GeoLibre host application. The GeoLibre wrapper in `src/geolibre.ts`
 * imports these types instead of redeclaring them, and downstream plugins built
 * from this template should do the same.
 *
 * The contract is intentionally free of React imports: a map control is
 * referenced only through the structural {@link GeoLibreControl} type, so the
 * same definitions describe both vanilla and React plugins. The concrete control
 * type is supplied as a generic parameter where it matters. The MapLibre `Map`
 * type is imported (type-only) because {@link GeoLibreAppAPI.getMap} hands a
 * plugin the raw map instance.
 */

import type { Map as MapLibreMap } from "maplibre-gl";

/** Corner of the map a control can be docked to. */
export type GeoLibreMapControlPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/**
 * Minimal GeoJSON `FeatureCollection` shape used when a plugin hands the host a
 * dataset to render as a native (MapLibre) layer. Kept structural so this
 * module does not depend on `geojson` types.
 */
export interface GeoLibreFeatureCollection {
  type: "FeatureCollection";
  features: unknown[];
}

/**
 * Visual styling hints for a native layer the host renders on the plugin's
 * behalf. Every field is optional; the host applies sensible defaults for any
 * value the plugin omits.
 */
export interface GeoLibreNativeLayerStyle {
  minZoom?: number;
  maxZoom?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fillOpacity?: number;
  circleRadius?: number;
}

/**
 * Registration payload a plugin passes to
 * {@link GeoLibreAppAPI.registerExternalNativeLayer}. It lets GeoLibre own the
 * MapLibre sources and layers (so they appear in the host's layer panel and
 * respect its theme) while the plugin supplies the data and styling.
 */
export interface GeoLibreNativeLayerRegistration {
  /** Stable, plugin-unique id used later to unregister the layer. */
  id: string;
  /** Human-readable name shown in the host's layer list. */
  name: string;
  /**
   * Layer kind. Defaults to `"geojson"` on the host. Set to `"raster"` to hand
   * the host an XYZ/raster-tile source (for example, titiler-served tiles).
   */
  type?: "geojson" | "raster" | "vector" | string;
  /**
   * MapLibre source spec the host should create (for example,
   * `{ type: "raster", tiles: [...], tileSize: 256, bounds: [...] }`). Omit for
   * inline GeoJSON, where {@link geojson} is used instead.
   */
  source?: Record<string, unknown>;
  /** Optional inline data; omit when the host already has the source. */
  geojson?: GeoLibreFeatureCollection;
  /** MapLibre layer ids the host should create or adopt. */
  nativeLayerIds: string[];
  /** MapLibre source ids backing the layers above. */
  sourceIds?: string[];
  /** Convenience single source id (alternative to {@link sourceIds}). */
  sourceId?: string;
  /** Id of an existing layer to insert this layer before. */
  beforeId?: string;
  /** Initial layer opacity in the range 0..1. */
  opacity?: number;
  /** Styling hints applied to the rendered layer. */
  style?: GeoLibreNativeLayerStyle;
  /** Arbitrary extra data the host may persist or display. */
  metadata?: Record<string, unknown>;
}

/**
 * Structural type for a MapLibre control instance. Using a marker interface
 * keeps this contract independent of the concrete control implementation while
 * still giving the host API a nominal-feeling handle to pass around.
 */
export interface GeoLibreControl {
  onAdd(...args: never[]): HTMLElement;
  onRemove(...args: never[]): void;
}

/**
 * The surface GeoLibre exposes to an active plugin.
 *
 * Only {@link addMapControl} and {@link removeMapControl} are guaranteed. The
 * remaining members are optional host capabilities: always call them with
 * optional chaining (`app.pickLocalDirectoryFiles?.()`) and degrade gracefully
 * when a host build does not provide them.
 *
 * @typeParam TControl - The plugin's concrete control type.
 */
export interface GeoLibreAppAPI<TControl extends GeoLibreControl = GeoLibreControl> {
  /**
   * Add the plugin's control to the map. Returns `false` when the host refuses
   * (for example, the slot is occupied), in which case the plugin should treat
   * activation as failed.
   */
  addMapControl: (
    control: TControl,
    position?: GeoLibreMapControlPosition,
  ) => boolean;
  /** Remove a previously added control from the map. */
  removeMapControl: (control: TControl) => void;
  /**
   * Open the host's native directory picker and resolve with the selected
   * files, or `null` if the user cancels. Present only on hosts that support
   * local file access (for example, GeoLibre Desktop).
   */
  pickLocalDirectoryFiles?: () => Promise<File[] | null>;
  /**
   * Resolve a fetchable URL for an asset bundled inside this plugin's own
   * folder, given the plugin id and a path relative to its manifest (for
   * example, `"dist/sample-data"`). Use this for assets the plugin ships and
   * loads over HTTP at runtime.
   *
   * Returns `null` when the plugin was not loaded from a URL base (for example,
   * a desktop filesystem install), so the asset is not reachable over HTTP. Call
   * with optional chaining and treat both `undefined` (host lacks the method)
   * and `null` (asset not resolvable) as "this asset is unavailable", hiding any
   * UI that depends on it.
   */
  resolvePluginAssetUrl?: (
    pluginId: string,
    relativePath: string,
  ) => string | null;
  /**
   * Hand the host a dataset to render as a native MapLibre layer it owns. See
   * {@link GeoLibreNativeLayerRegistration}.
   */
  registerExternalNativeLayer?: (
    layer: GeoLibreNativeLayerRegistration,
  ) => void;
  /** Remove a native layer previously registered with the given id. */
  unregisterExternalNativeLayer?: (id: string) => void;
  /**
   * Return the raw MapLibre map instance, or `null` before the map is ready or
   * on hosts that do not expose it. Lets a plugin add sources/layers directly
   * when the higher-level helpers do not fit.
   */
  getMap?: () => MapLibreMap | null;
  /**
   * Fetch a URL and resolve with its bytes. On GeoLibre Desktop this routes
   * through the host's network layer (bypassing browser CORS); on the web it is
   * a credentialed-capable fetch. Prefer this for cross-origin binary data such
   * as FlatGeobuf files.
   */
  fetchArrayBuffer?: (url: string) => Promise<ArrayBuffer>;
  /**
   * Add a GeoJSON `FeatureCollection` as a host-managed layer that appears in
   * the layer panel. `sourcePath` is an optional provenance hint (for example,
   * the originating URL).
   */
  addGeoJsonLayer?: (
    name: string,
    data: GeoLibreFeatureCollection,
    sourcePath?: string,
  ) => void;
  /** Fit the map viewport to `[west, south, east, north]` bounds. */
  fitBounds?: (bounds: [number, number, number, number]) => void;
}

/**
 * The object a plugin's GeoLibre entry point must export. GeoLibre calls these
 * members across the plugin lifecycle; everything beyond `id`, `name`,
 * `version`, `activate`, and `deactivate` is optional and only invoked when the
 * plugin declares it.
 *
 * @typeParam TControl - The plugin's concrete control type.
 */
export interface GeoLibrePlugin<TControl extends GeoLibreControl = GeoLibreControl> {
  /** Stable plugin id; must match `plugin.json`'s `id`. */
  id: string;
  /** Display name; must match `plugin.json`'s `name`. */
  name: string;
  /** Semantic version; must match `plugin.json`'s `version`. */
  version: string;
  /**
   * Query-parameter names this plugin owns. When the host opens a URL carrying
   * one of these, it auto-activates the plugin and routes the parameters to
   * {@link handleUrlParameters}.
   */
  urlParameterNames?: string[];
  /**
   * Activate the plugin: create and add the control. Return `false` (or remain
   * unactivated) if the control could not be added.
   */
  activate: (app: GeoLibreAppAPI<TControl>) => boolean | void;
  /**
   * Deactivate the plugin: capture any state to restore later, then remove the
   * control.
   */
  deactivate: (app: GeoLibreAppAPI<TControl>) => void;
  /**
   * Handle deep-link query parameters declared in {@link urlParameterNames}.
   * Dispatched by the host once the plugin is active. May be async.
   */
  handleUrlParameters?: (
    app: GeoLibreAppAPI<TControl>,
    params: URLSearchParams,
  ) => void | Promise<void>;
  /** Report the control's current dock position (for persistence). */
  getMapControlPosition?: () => GeoLibreMapControlPosition;
  /** Move the control to a new dock position. */
  setMapControlPosition?: (
    app: GeoLibreAppAPI<TControl>,
    position: GeoLibreMapControlPosition,
  ) => boolean | void;
  /** Serialize plugin state so the host can save it with the project. */
  getProjectState?: () => unknown;
  /** Restore plugin state previously produced by {@link getProjectState}. */
  applyProjectState?: (
    app: GeoLibreAppAPI<TControl>,
    state: unknown,
  ) => boolean | void;
}
