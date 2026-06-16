/**
 * A small, dependency-free client for the Data to Science (D2S) REST API,
 * reimplementing the browse-and-view subset of the `d2spy` SDK that the GeoLibre
 * plugin needs. It authenticates with a JWT session cookie (credentialed
 * `fetch`) and separately fetches an `API_KEY` used to stream Cloud-Optimized
 * GeoTIFFs (via titiler) and FlatGeobuf files directly.
 *
 * The pure URL/name builders and predicates are exported separately so they can
 * be unit-tested without a network or DOM.
 */

import type {
  D2SDataProduct,
  D2SFlight,
  D2SProject,
  D2SUser,
  D2SVectorLayer,
} from "./types";

/** Default D2S instance shown in the UI. */
export const DEFAULT_D2S_SERVER = "https://ps2.d2s.org";

/** Default titiler instance used to tile Cloud-Optimized GeoTIFFs. */
export const DEFAULT_TITILER_URL = "https://titiler.d2s.org";

/**
 * Data product types that are not single rasters and cannot be added to the map
 * as raster tiles. Mirrors the QGIS plugin's filter.
 */
export const NON_RASTER_TYPES: ReadonlySet<string> = new Set([
  "panoramic",
  "point_cloud",
  "3dgs",
]);

/**
 * Single-band elevation products that render poorly without a rescale, so the
 * client applies stretched statistics and a terrain colormap for them.
 */
export const ELEVATION_TYPES: ReadonlySet<string> = new Set(["dem", "dsm"]);

/** Raised when a request fails because the session is missing or expired. */
export class D2SAuthError extends Error {}

/** Strip a trailing slash so paths can be concatenated predictably. */
export function normalizeServerUrl(server: string): string {
  return server.trim().replace(/\/+$/, "");
}

/** Build the `application/x-www-form-urlencoded` body for the login request. */
export function loginFormBody(email: string, password: string): string {
  // The D2S token endpoint expects the OAuth2 password-grant field name
  // `username`, not `email`.
  const params = new URLSearchParams();
  params.set("username", email);
  params.set("password", password);
  return params.toString();
}

/** Append the API key to a data product (COG) URL for authenticated streaming. */
export function cogUrlWithKey(dataProductUrl: string, apiKey: string): string {
  const sep = dataProductUrl.includes("?") ? "&" : "?";
  return `${dataProductUrl}${sep}API_KEY=${encodeURIComponent(apiKey)}`;
}

/** Build a titiler TileJSON URL for a COG, with optional extra query params. */
export function titilerTileJsonUrl(
  titilerBase: string,
  cogUrl: string,
  extraParams: Record<string, string> = {},
): string {
  const base = normalizeServerUrl(titilerBase);
  const params = new URLSearchParams({ url: cogUrl, ...extraParams });
  return `${base}/cog/WebMercatorQuad/tilejson.json?${params.toString()}`;
}

/** Build a titiler statistics URL for a COG. */
export function titilerStatisticsUrl(
  titilerBase: string,
  cogUrl: string,
): string {
  const base = normalizeServerUrl(titilerBase);
  const params = new URLSearchParams({ url: cogUrl });
  return `${base}/cog/statistics?${params.toString()}`;
}

/** Build the FlatGeobuf URL for a project vector layer. */
export function fgbUrl(
  server: string,
  projectId: string,
  layerId: string,
  apiKey: string,
): string {
  const base = normalizeServerUrl(server);
  return `${base}/static/projects/${projectId}/vector/${layerId}/${layerId}.fgb?API_KEY=${encodeURIComponent(
    apiKey,
  )}`;
}

/** Whether a data product can be rendered as a raster tile layer. */
export function isRasterDataType(dataType: string): boolean {
  return !NON_RASTER_TYPES.has(dataType);
}

/** Layer name for a raster data product: `{flight}_{date}_{sensor}_{type}`. */
export function dataProductLayerName(
  flight: D2SFlight,
  dataType: string,
): string {
  const name = flight.name || "Flight";
  const parts = [name, flight.acquisition_date, flight.sensor, dataType].filter(
    Boolean,
  );
  return parts.join("_");
}

/** Layer name for a vector map layer: `{projectTitle}_{layerName}`. */
export function vectorLayerName(
  projectTitle: string,
  layerName: string,
): string {
  return `${projectTitle}_${layerName}`;
}

/** Result of resolving a COG into a renderable raster source. */
export interface RasterTileSource {
  tiles: string[];
  bounds?: [number, number, number, number];
  minzoom?: number;
  maxzoom?: number;
}

/** Minimal shape of a titiler TileJSON response. */
interface TitilerTileJson {
  tiles: string[];
  bounds?: number[];
  minzoom?: number;
  maxzoom?: number;
}

/** A titiler `/cog/statistics` band entry. */
interface TitilerBandStats {
  min?: number;
  max?: number;
  percentile_2?: number;
  percentile_98?: number;
}

/**
 * Client for one D2S instance. Construct, then call {@link login}; subsequent
 * calls reuse the session cookie and the fetched API key.
 */
export class D2SClient {
  readonly server: string;
  readonly titilerUrl: string;
  private _apiKey: string | null = null;

  constructor(server: string, titilerUrl: string = DEFAULT_TITILER_URL) {
    this.server = normalizeServerUrl(server);
    this.titilerUrl = normalizeServerUrl(titilerUrl);
  }

  /** The API key fetched after login, or null when not yet available. */
  get apiKey(): string | null {
    return this._apiKey;
  }

  /** Build an absolute API URL for a path beginning with `/api/...`. */
  private apiUrl(path: string): string {
    return `${this.server}${path}`;
  }

  /** Credentialed GET returning parsed JSON; maps 401 to {@link D2SAuthError}. */
  private async getJson<T>(path: string): Promise<T> {
    const response = await fetch(this.apiUrl(path), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) {
      throw new D2SAuthError("Session expired. Please log in again.");
    }
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}): ${path}`);
    }
    return (await response.json()) as T;
  }

  /**
   * Log in to the D2S instance. On success the JWT session cookie is stored by
   * the browser and the user's API key is fetched (requesting a new one if the
   * account does not have one yet).
   */
  async login(email: string, password: string): Promise<D2SUser> {
    const response = await fetch(this.apiUrl("/api/v1/auth/access-token"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: loginFormBody(email, password),
    });
    if (response.status === 401 || response.status === 400) {
      throw new D2SAuthError("Invalid email or password.");
    }
    if (!response.ok) {
      throw new Error(`Login failed (${response.status}).`);
    }
    return this.refreshApiKey();
  }

  /** Fetch the current user, requesting an API key if one is not set yet. */
  async refreshApiKey(): Promise<D2SUser> {
    let user = await this.getCurrentUser();
    if (!user.api_access_token) {
      await this.requestApiKey();
      user = await this.getCurrentUser();
    }
    this._apiKey = user.api_access_token ?? null;
    return user;
  }

  /** GET the current authenticated user. */
  async getCurrentUser(): Promise<D2SUser> {
    return this.getJson<D2SUser>("/api/v1/users/current");
  }

  /** Ask the server to generate an API key for the current user. */
  async requestApiKey(): Promise<void> {
    await this.getJson<unknown>("/api/v1/auth/request-api-key");
  }

  /** List projects that have at least one raster data product. */
  async getProjects(): Promise<D2SProject[]> {
    return this.getJson<D2SProject[]>("/api/v1/projects?has_raster=true");
  }

  /** List flights with rasters for a project. */
  async getFlights(projectId: string): Promise<D2SFlight[]> {
    return this.getJson<D2SFlight[]>(
      `/api/v1/projects/${projectId}/flights?has_raster=true`,
    );
  }

  /** List data products for a flight. */
  async getDataProducts(
    projectId: string,
    flightId: string,
  ): Promise<D2SDataProduct[]> {
    return this.getJson<D2SDataProduct[]>(
      `/api/v1/projects/${projectId}/flights/${flightId}/data_products`,
    );
  }

  /** List project-level vector map layers. */
  async getVectorLayers(projectId: string): Promise<D2SVectorLayer[]> {
    return this.getJson<D2SVectorLayer[]>(
      `/api/v1/projects/${projectId}/vector_layers`,
    );
  }

  /** Build the FlatGeobuf URL for a vector layer (requires an API key). */
  fgbUrlFor(projectId: string, layerId: string): string {
    if (!this._apiKey) {
      throw new D2SAuthError("Not authenticated.");
    }
    return fgbUrl(this.server, projectId, layerId, this._apiKey);
  }

  /**
   * Resolve a data product into a renderable raster tile source using titiler.
   * Elevation products (DEM/DSM) are stretched to their 2nd/98th percentiles
   * and given a terrain colormap; other products render with titiler defaults.
   */
  async getRasterTileSource(
    dataProduct: D2SDataProduct,
  ): Promise<RasterTileSource> {
    if (!this._apiKey) {
      throw new D2SAuthError("Not authenticated.");
    }
    const cogUrl = cogUrlWithKey(dataProduct.url, this._apiKey);

    const extraParams: Record<string, string> = {};
    if (ELEVATION_TYPES.has(dataProduct.data_type)) {
      const rescale = await this.tryElevationRescale(cogUrl);
      if (rescale) {
        extraParams.rescale = rescale;
        extraParams.colormap_name = "terrain";
      }
    }

    const tileJsonUrl = titilerTileJsonUrl(this.titilerUrl, cogUrl, extraParams);
    const response = await fetch(tileJsonUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`titiler request failed (${response.status}).`);
    }
    const tileJson = (await response.json()) as TitilerTileJson;
    const bounds =
      Array.isArray(tileJson.bounds) && tileJson.bounds.length === 4
        ? (tileJson.bounds as [number, number, number, number])
        : undefined;
    return {
      tiles: tileJson.tiles,
      bounds,
      minzoom: tileJson.minzoom,
      maxzoom: tileJson.maxzoom,
    };
  }

  /**
   * Best-effort `min,max` rescale string from titiler band statistics. Returns
   * null if statistics are unavailable, so the caller can render without a
   * rescale rather than fail.
   */
  private async tryElevationRescale(cogUrl: string): Promise<string | null> {
    try {
      const response = await fetch(
        titilerStatisticsUrl(this.titilerUrl, cogUrl),
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) return null;
      const stats = (await response.json()) as Record<string, TitilerBandStats>;
      const band = stats.b1 ?? Object.values(stats)[0];
      if (!band) return null;
      const min = band.percentile_2 ?? band.min;
      const max = band.percentile_98 ?? band.max;
      if (typeof min !== "number" || typeof max !== "number" || min === max) {
        return null;
      }
      return `${min},${max}`;
    } catch {
      return null;
    }
  }
}
