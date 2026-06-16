/**
 * TypeScript shapes for the subset of the Data to Science (D2S) REST API that
 * the GeoLibre plugin consumes. Field names mirror the D2S API responses (and
 * the `d2spy` SDK schemas) so the raw JSON can be used without remapping.
 */

/** A D2S project (the top of the Project -> Flight -> Data Product hierarchy). */
export interface D2SProject {
  id: string;
  title: string;
  description?: string;
  flight_count?: number;
  start_date?: string | null;
  end_date?: string | null;
  role?: string;
}

/** A single drone acquisition belonging to a project. */
export interface D2SFlight {
  id: string;
  name?: string | null;
  acquisition_date?: string;
  altitude?: number;
  side_overlap?: number;
  forward_overlap?: number;
  sensor?: string;
  platform?: string;
  project_id?: string;
}

/** A processed raster/point-cloud output of a flight. */
export interface D2SDataProduct {
  id: string;
  data_type: string;
  url: string;
  original_filename?: string;
  status?: string;
  flight_id?: string;
  bbox?: number[];
  stac_properties?: Record<string, unknown>;
}

/** A project-level vector "map layer" served as FlatGeobuf. */
export interface D2SVectorLayer {
  layer_id: string;
  layer_name: string;
  [key: string]: unknown;
}

/** The current authenticated user; carries the API key used for file streaming. */
export interface D2SUser {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  api_access_token?: string | null;
}
