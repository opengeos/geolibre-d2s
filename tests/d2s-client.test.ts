import { describe, it, expect } from 'vitest';
import {
  NON_RASTER_TYPES,
  cogUrlWithKey,
  dataProductLayerName,
  fgbUrl,
  isRasterDataType,
  loginFormBody,
  normalizeServerUrl,
  titilerStatisticsUrl,
  titilerTileJsonUrl,
  vectorLayerName,
} from '../src/lib/d2s/client';
import type { D2SFlight } from '../src/lib/d2s/types';
import { geojsonBounds } from '../src/lib/core/PluginControl';
import type { FeatureCollection } from 'geojson';

describe('normalizeServerUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeServerUrl('  https://ps2.d2s.org/ ')).toBe('https://ps2.d2s.org');
    expect(normalizeServerUrl('https://ps2.d2s.org///')).toBe('https://ps2.d2s.org');
  });
});

describe('loginFormBody', () => {
  it('uses the OAuth2 username field and url-encodes values', () => {
    const body = loginFormBody('a@b.com', 'p@ss word');
    const parsed = new URLSearchParams(body);
    expect(parsed.get('username')).toBe('a@b.com');
    expect(parsed.get('password')).toBe('p@ss word');
  });
});

describe('cogUrlWithKey', () => {
  it('appends the API key with the right separator', () => {
    expect(cogUrlWithKey('https://x/cog.tif', 'KEY')).toBe(
      'https://x/cog.tif?API_KEY=KEY',
    );
    expect(cogUrlWithKey('https://x/cog.tif?foo=1', 'KEY')).toBe(
      'https://x/cog.tif?foo=1&API_KEY=KEY',
    );
  });
});

describe('titiler URLs', () => {
  it('builds a TileJSON URL with the COG url encoded', () => {
    const url = titilerTileJsonUrl('https://titiler.d2s.org/', 'https://x/c.tif?API_KEY=K');
    expect(url).toContain('https://titiler.d2s.org/cog/WebMercatorQuad/tilejson.json?');
    expect(url).toContain('url=https%3A%2F%2Fx%2Fc.tif%3FAPI_KEY%3DK');
  });

  it('includes extra params such as rescale and colormap', () => {
    const url = titilerTileJsonUrl('https://titiler.d2s.org', 'https://x/c.tif', {
      rescale: '0,100',
      colormap_name: 'terrain',
    });
    expect(url).toContain('rescale=0%2C100');
    expect(url).toContain('colormap_name=terrain');
  });

  it('builds a statistics URL', () => {
    expect(titilerStatisticsUrl('https://titiler.d2s.org', 'https://x/c.tif')).toBe(
      'https://titiler.d2s.org/cog/statistics?url=https%3A%2F%2Fx%2Fc.tif',
    );
  });
});

describe('fgbUrl', () => {
  it('builds the static FlatGeobuf URL with the API key', () => {
    expect(fgbUrl('https://ps2.d2s.org/', 'proj1', 'layer1', 'KEY')).toBe(
      'https://ps2.d2s.org/static/projects/proj1/vector/layer1/layer1.fgb?API_KEY=KEY',
    );
  });
});

describe('isRasterDataType', () => {
  it('rejects the non-raster product types', () => {
    expect(isRasterDataType('ortho')).toBe(true);
    expect(isRasterDataType('dem')).toBe(true);
    for (const type of NON_RASTER_TYPES) {
      expect(isRasterDataType(type)).toBe(false);
    }
  });
});

describe('layer names', () => {
  it('builds a raster layer name from flight metadata', () => {
    const flight: D2SFlight = {
      id: 'f1',
      name: 'North field',
      acquisition_date: '2024-05-01',
      sensor: 'RGB',
    };
    expect(dataProductLayerName(flight, 'ortho')).toBe('North field_2024-05-01_RGB_ortho');
  });

  it('falls back to "Flight" when the name is missing', () => {
    expect(dataProductLayerName({ id: 'f1' }, 'dem')).toBe('Flight_dem');
  });

  it('builds a vector layer name from the project title', () => {
    expect(vectorLayerName('My Project', 'boundary')).toBe('My Project_boundary');
  });
});

describe('geojsonBounds', () => {
  it('computes bounds across mixed geometries', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Point', coordinates: [-90, 40] },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-91, 39],
                [-89, 39],
                [-89, 41],
                [-91, 41],
                [-91, 39],
              ],
            ],
          },
        },
      ],
    };
    expect(geojsonBounds(fc)).toEqual([-91, 39, -89, 41]);
  });

  it('returns null for an empty collection', () => {
    expect(geojsonBounds({ type: 'FeatureCollection', features: [] })).toBeNull();
  });
});
