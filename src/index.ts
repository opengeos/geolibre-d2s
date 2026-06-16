// Import styles
import './lib/styles/plugin-control.css';

// Main entry point - Core exports
export { PluginControl, geojsonBounds } from './lib/core/PluginControl';

// Type exports
export type {
  PluginControlOptions,
  PluginState,
  PluginControlEvent,
  PluginControlEventHandler,
} from './lib/core/types';

// GeoLibre host-plugin contract
export type {
  GeoLibreAppAPI,
  GeoLibrePlugin,
  GeoLibreControl,
  GeoLibreMapControlPosition,
  GeoLibreNativeLayerRegistration,
  GeoLibreNativeLayerStyle,
  GeoLibreFeatureCollection,
} from './lib/geolibre/host-api';

// D2S API client
export {
  D2SClient,
  D2SAuthError,
  DEFAULT_D2S_SERVER,
  DEFAULT_TITILER_URL,
  NON_RASTER_TYPES,
  ELEVATION_TYPES,
  normalizeServerUrl,
  loginFormBody,
  cogUrlWithKey,
  titilerTileJsonUrl,
  titilerStatisticsUrl,
  fgbUrl,
  isRasterDataType,
  dataProductLayerName,
  vectorLayerName,
} from './lib/d2s/client';
export type { RasterTileSource } from './lib/d2s/client';
export type {
  D2SProject,
  D2SFlight,
  D2SDataProduct,
  D2SVectorLayer,
  D2SUser,
} from './lib/d2s/types';

// Deep-linking helpers
export {
  D2S_SERVER_PARAM,
  getD2sServerValue,
  maybeHandleDeepLink,
} from './lib/utils/deep-link';
export type { DeepLinkConsumer } from './lib/utils/deep-link';

// Utility exports
export {
  clamp,
  formatNumericValue,
  generateId,
  debounce,
  throttle,
  classNames,
} from './lib/utils';
