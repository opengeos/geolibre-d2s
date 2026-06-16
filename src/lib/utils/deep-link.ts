/**
 * Deep-linking support for the GeoLibre integration. The plugin can be opened
 * with the D2S server URL preset by adding a query parameter to the GeoLibre
 * URL, e.g. `https://geolibre.app/?d2s-server=https://ps2.d2s.org`.
 *
 * GeoLibre auto-activates a plugin when a URL carries a parameter the plugin
 * declared in `urlParameterNames`, then dispatches the parsed query parameters
 * to the plugin's `handleUrlParameters(app, params)` hook. These helpers operate
 * purely on a `URLSearchParams`, with no DOM or MapLibre imports, so the logic
 * can be unit-tested in isolation.
 */

/** Query-parameter name this plugin owns: presets the D2S server URL. */
export const D2S_SERVER_PARAM = "d2s-server";

/**
 * Extract the D2S server URL from parsed query parameters. Returns the trimmed
 * value, or `null` when the parameter is absent or blank.
 */
export function getD2sServerValue(params: URLSearchParams): string | null {
  const trimmed = params.get(D2S_SERVER_PARAM)?.trim();
  return trimmed ? trimmed : null;
}

/** Minimal structural type for whatever consumes the deep-link value. */
export interface DeepLinkConsumer {
  setServerUrl(value: string): void;
}

/**
 * If the query parameters carry a {@link D2S_SERVER_PARAM} value, forward it to
 * the consumer. No-op when the parameter is absent or blank.
 */
export function maybeHandleDeepLink(
  consumer: DeepLinkConsumer,
  params: URLSearchParams,
): void {
  const value = getD2sServerValue(params);
  if (value) consumer.setServerUrl(value);
}
