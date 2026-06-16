# GeoLibre D2S

A [GeoLibre](https://github.com/opengeos/GeoLibre) plugin to browse and view your [Data to Science (D2S)](https://d2s.org) projects, flights, and data products directly on the map. It is the web/desktop counterpart of the [D2S QGIS plugin](https://github.com/gdslab/d2spy-qgis-plugin).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Sign in** to any D2S instance (default `https://ps2.d2s.org`).
- **Browse** your hierarchy: Project &rarr; Flight &rarr; Data Product, plus project-level vector map layers.
- **Add rasters** (orthomosaics, DEMs/DSMs, and other Cloud-Optimized GeoTIFFs) to the map as tile layers served by [titiler](https://titiler.d2s.org). DEM/DSM products are auto-stretched and given a terrain colormap.
- **Add vector map layers** (FlatGeobuf) as GeoJSON layers.
- **Theme-aware** UI that follows the GeoLibre light/dark theme.
- Layers register with the host so they appear in GeoLibre's layer panel and are removed when the plugin is deactivated.

> Scope: this plugin is **browse/view only**. Creating projects/flights and uploading data products (the QGIS plugin's "Create" tab) are out of scope.

## How it works

| D2S data | Source | Rendered as |
| --- | --- | --- |
| Raster data product | COG `url` + `?API_KEY=` &rarr; titiler `tilejson.json` | MapLibre raster tile layer |
| Vector map layer | `/static/.../{layer}.fgb?API_KEY=` | GeoJSON layer (FlatGeobuf decoded in-browser) |

Authentication uses a JWT session cookie (credentialed `fetch`) for the REST API, plus a per-user `API_KEY` that is appended to the COG and FlatGeobuf URLs so titiler and the static file server can authorize streaming.

## Build the GeoLibre plugin bundle

GeoLibre loads external plugins from a `plugin.json` manifest plus a bundled ESM entry and CSS.

```bash
npm install
npm run build:geolibre      # -> geolibre-plugin/dist/index.js + style.css
npm run package:geolibre    # -> geolibre-plugin/geolibre-d2s-<version>.zip
```

### Install into GeoLibre

```bash
# Desktop: copy the bundle into GeoLibre's plugins directory
npm run install:geolibre

# Web: drop the bundle into a GeoLibre checkout's public/plugins
npm run install:geolibre -- --web /path/to/GeoLibre
```

Or serve the bundle over HTTP (with CORS) and add its `plugin.json` URL in GeoLibre under **Settings &rarr; Plugins**:

```bash
npm run serve:geolibre
```

## Usage

1. Open the plugin from the GeoLibre Plugins menu; click its toolbar button to open the panel.
2. Enter your D2S **server**, **email**, and **password**, then **Log in**.
3. Pick a **Project**, then a **Flight**.
4. Check one or more **Data products** and click **Add selected to map**. Check **Map layers** (vector) the same way.

You can preset the server with a deep link: `https://your-geolibre/?d2s-server=https://ps2.d2s.org`.

## Host API used

The plugin talks to GeoLibre through the typed `GeoLibreAppAPI` contract in `src/lib/geolibre/host-api.ts`:

- `addMapControl` / `removeMapControl` - mount the control.
- `registerExternalNativeLayer` / `unregisterExternalNativeLayer` - hand the host raster and GeoJSON layers it owns (shown in the layer panel) and clean them up on teardown.
- `fetchArrayBuffer` - fetch FlatGeobuf bytes (routes through the desktop network layer to bypass browser CORS when available; falls back to `fetch`).
- `fitBounds` - zoom to a newly added layer.

## CORS and authentication

D2S authenticates with a JWT **cookie**, so the browser must be allowed to send that cookie cross-origin. By default a D2S instance answers with `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Methods: GET`, which a browser **rejects** for a credentialed request (you get `Failed to fetch` / "Access-Control-Allow-Credentials ... must be 'true'"). It still works when you log in on the D2S site itself because that is same-origin.

### Production fix (server-side, required for the GeoLibre web app)

Configure CORS on the D2S server to allow your GeoLibre origin(s) **with credentials**. With FastAPI:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    # Must be explicit origins, not "*", when credentials are allowed.
    allow_origins=[
        "https://geolibre.app",
        "http://localhost:5173",       # local dev
        "tauri://localhost",            # GeoLibre Desktop (macOS/Linux)
        "https://tauri.localhost",      # GeoLibre Desktop (Windows)
    ],
    allow_credentials=True,
    allow_methods=["*"],   # the default GET-only list blocks the login POST
    allow_headers=["*"],
    expose_headers=["*"],
)
```

The session cookie must also be `SameSite=None; Secure` to be sent from another origin.

### Local development workaround (no server change)

`npm run dev` proxies `/api` and `/static` to the D2S instance (see `vite.config.ts`), so the browser sees same-origin requests and the cookie flows. In the playground the **Server** field is prefilled with the dev origin (`http://localhost:5173`) to route through the proxy. Point the proxy at a different instance with:

```bash
D2S_PROXY_TARGET=https://your.d2s.org npm run dev
```

This proxy is dev-only and is not part of the built GeoLibre bundle.

## Development

```bash
npm run dev            # standalone control playground (examples/)
npm run test           # Vitest unit tests
npm run lint           # ESLint
npm run build          # standalone library + GeoLibre bundle
```

The control is also usable as a standalone MapLibre `IControl` (see `examples/`), which is handy for developing the UI outside GeoLibre. Outside GeoLibre the host callbacks degrade to safe defaults.

## Project structure

```
src/
  geolibre.ts                 # GeoLibre plugin entry (exports the GeoLibrePlugin)
  index.ts                    # standalone library entry
  lib/
    core/PluginControl.ts     # the D2S browse control (MapLibre IControl)
    d2s/client.ts             # D2S REST client + titiler/FlatGeobuf URL builders
    d2s/types.ts              # D2S API response types
    geolibre/host-api.ts      # GeoLibre host-plugin contract
    styles/plugin-control.css # themeable styles
    utils/deep-link.ts        # ?d2s-server= deep link
geolibre-plugin/plugin.json   # plugin manifest (id/name/version/entry/style)
```

## Credits

Based on the [GeoLibre plugin template](https://github.com/opengeos/geolibre-plugin-template) and the [D2S QGIS plugin](https://github.com/gdslab/d2spy-qgis-plugin) by the Purdue Geospatial Data Science Lab.

## License

MIT
