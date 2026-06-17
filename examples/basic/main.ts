import maplibregl from 'maplibre-gl';
import { PluginControl } from '../../src/index';
import type { GeoLibreNativeLayerRegistration } from '../../src/index';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

// Create map
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [0, 0],
  zoom: 2,
});

// Track the MapLibre sources/layers we create for each registered native
// layer so they can be removed again when the plugin unregisters them.
const nativeLayers = new Map<string, { layerIds: string[]; sourceId: string }>();

/**
 * Render a native layer the plugin hands us directly on this MapLibre map.
 *
 * GeoLibre normally owns this step; in the standalone example we play the host
 * and add the source/layers ourselves so "Add selected to map" actually shows
 * data (raster tiles or a GeoJSON vector layer) on the map.
 */
function registerNativeLayer(reg: GeoLibreNativeLayerRegistration): void {
  unregisterNativeLayer(reg.id);
  const sourceId = reg.sourceId ?? reg.sourceIds?.[0] ?? `${reg.id}-source`;

  if (reg.type === 'raster' && reg.source) {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, reg.source as maplibregl.SourceSpecification);
    }
    const layerId = reg.nativeLayerIds[0] ?? `${reg.id}-layer`;
    map.addLayer(
      {
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: { 'raster-opacity': reg.opacity ?? 1 },
      },
      reg.beforeId,
    );
    nativeLayers.set(reg.id, { layerIds: [layerId], sourceId });
    return;
  }

  if (reg.geojson) {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: reg.geojson as GeoJSON.FeatureCollection,
      });
    }
    const style = reg.style ?? {};
    // Add fill, line, and circle layers so any geometry type renders.
    const fillId = `${reg.id}-fill`;
    const lineId = `${reg.id}-line`;
    const circleId = `${reg.id}-circle`;
    map.addLayer(
      {
        id: fillId,
        type: 'fill',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': style.fillColor ?? '#2f7ed8',
          'fill-opacity': style.fillOpacity ?? 0.3,
        },
      },
      reg.beforeId,
    );
    map.addLayer(
      {
        id: lineId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': style.strokeColor ?? '#1f5fa8',
          'line-width': style.strokeWidth ?? 1,
        },
      },
      reg.beforeId,
    );
    map.addLayer(
      {
        id: circleId,
        type: 'circle',
        source: sourceId,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': style.circleRadius ?? 5,
          'circle-color': style.fillColor ?? '#2f7ed8',
          'circle-stroke-color': style.strokeColor ?? '#1f5fa8',
          'circle-stroke-width': style.strokeWidth ?? 1,
        },
      },
      reg.beforeId,
    );
    nativeLayers.set(reg.id, {
      layerIds: [fillId, lineId, circleId],
      sourceId,
    });
  }
}

/** Remove a native layer (and its source) previously registered by id. */
function unregisterNativeLayer(id: string): void {
  const entry = nativeLayers.get(id);
  if (!entry) return;
  for (const layerId of entry.layerIds) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  }
  if (map.getSource(entry.sourceId)) map.removeSource(entry.sourceId);
  nativeLayers.delete(id);
}

// Add navigation controls to top-right
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// Add fullscreen control to top-right (after navigation)
map.addControl(new maplibregl.FullscreenControl(), 'top-right');

// Add plugin control when map loads
map.on('load', () => {
  // Create the plugin control with custom options
  // Set collapsed: true to start with just the 29x29 button (like navigation control)
  const pluginControl = new PluginControl({
    title: 'Data to Science (D2S)',
    collapsed: false,
    panelWidth: 320,
    // Point at the dev origin so requests go through the Vite proxy in
    // vite.config.ts (which forwards /api and /static to the D2S instance),
    // sidestepping the D2S CORS policy during local development.
    serverUrl: window.location.origin,
    // Standalone host wiring: render added layers on this map and zoom to
    // them. Inside GeoLibre these are provided by the host instead.
    registerNativeLayer,
    unregisterNativeLayer,
    fitBounds: (bounds) => {
      map.fitBounds(bounds, { padding: 40, duration: 1000, maxZoom: 18 });
    },
  });

  // Add control to the map
  map.addControl(pluginControl, 'top-left');

  // Add Globe control to the map
  map.addControl(new maplibregl.GlobeControl(), 'top-right');

  // Listen for state changes
  pluginControl.on('statechange', (event) => {
    console.log('Plugin state changed:', event.state);
  });

  pluginControl.on('collapse', () => {
    console.log('Plugin panel collapsed');
  });

  pluginControl.on('expand', () => {
    console.log('Plugin panel expanded');
  });

  console.log('Plugin control added to map');
});
