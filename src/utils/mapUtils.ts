import { Expression, Search, Hits, Filter } from 'arlas-api';
import { Observable } from 'rxjs';
import { ElementIdentifier } from 'models/models';
import { projType } from 'arlas-web-core';
import { getElementFromJsonObject } from './utils';
import bbox from '@turf/bbox';
import { CollaborativesearchService } from 'arlas-web-core/services/collaborativesearch.service';
import { map } from 'rxjs/internal/operators/map';
import * as meta from '@turf/meta';
import { bboxes } from 'ngeohash';

export function getBounds(elementidentifier: ElementIdentifier, collaborativeSearcheService: CollaborativesearchService)
    : Observable<Array<Array<number>>> {
    let searchResult: Observable<Hits>;
    const search: Search = { page: { size: 1 } };
    const expression: Expression = {
        field: elementidentifier.idFieldName,
        op: Expression.OpEnum.Eq,
        value: elementidentifier.idValue
    };
    const filter: Filter = {
        f: [[expression]]
    };
    searchResult = collaborativeSearcheService
        .resolveHits([projType.search, search], collaborativeSearcheService.collaborations, '', filter);
    return searchResult
        .pipe(
            map(h => {
                const geojsonData = getElementFromJsonObject(h.hits[0].md, 'geometry');
                const box = bbox(geojsonData);
                const minX = box[0];
                const minY = box[1];
                const maxX = box[2];
                const maxY = box[3];
                return [[minX, minY], [maxX, maxY]];
            }));
}

export function extentToGeohashes(extent: Array<number>, zoom: number,
    granularityFunction: (zoom: number) => {tilesPrecision: number, requestsPrecision: number}): Set<string> {
    let geohashList = [];
    const west = extent[1];
    const east = extent[3];
    const south = extent[2];
    const north = extent[0];
    if (west < -180 && east > 180) {
      geohashList = bboxes(Math.min(south, north),
        -180,
        Math.max(south, north),
        180, Math.max(granularityFunction(zoom).tilesPrecision, 1));
    } else if (west < -180 && east < 180) {
      const geohashList_1: Array<string> = bboxes(Math.min(south, north),
        Math.min(-180, west + 360),
        Math.max(south, north),
        Math.max(-180, west + 360), Math.max(granularityFunction(zoom).tilesPrecision, 1));
      const geohashList_2: Array<string> = bboxes(Math.min(south, north),
        Math.min(east, 180),
        Math.max(south, north),
        Math.max(east, 180), Math.max(granularityFunction(zoom).tilesPrecision, 1));
      geohashList = geohashList_1.concat(geohashList_2);
    } else if (east > 180 && west > -180) {
      const geohashList_1: Array<string> = bboxes(Math.min(south, north),
        Math.min(180, east - 360),
        Math.max(south, north),
        Math.max(180, east - 360), Math.max(granularityFunction(zoom).tilesPrecision, 1));
      const geohashList_2: Array<string> = bboxes(Math.min(south, north),
        Math.min(west, -180),
        Math.max(south, north),
        Math.max(west, -180), Math.max(granularityFunction(zoom).tilesPrecision, 1));
      geohashList = geohashList_1.concat(geohashList_2);
    } else {
      geohashList = bboxes(Math.min(south, north),
        Math.min(east, west),
        Math.max(south, north),
        Math.max(east, west), Math.max(granularityFunction(zoom).tilesPrecision, 1));
    }
    return new Set(geohashList);
}

export function tileToString(tile: { x: number, y: number, z: number }): string {
    return tile.x.toString() + '_' + tile.y.toString() + '_' + tile.z.toString();
}

export function stringToTile(tileString: string): { x: number, y: number, z: number } {
    const numbers = tileString.split('_');
    return { x: +numbers[0], y: +numbers[1], z: +numbers[2]};
}

function tiled(num: number): number {
    return Math.floor(num / 256);
}

export function project(lat: number, lng: number, zoom: number): { x: number, y: number } {

    const R = 6378137;
    const sphericalScale = 0.5 / (Math.PI * R);
    const d = Math.PI / 180;
    const max = 1 - 1E-15;
    const sin = Math.max(Math.min(Math.sin(lat * d), max), -max);
    const scale = 256 * Math.pow(2, zoom);

    const point = {
        x: R * lng * d,
        y: R * Math.log((1 + sin) / (1 - sin)) / 2
    };

    point.x = tiled(scale * (sphericalScale * point.x + 0.5));
    point.y = tiled(scale * (-sphericalScale * point.y + 0.5));

    return point;
}
export function getTiles(bounds: Array<Array<number>>, zoom: number): Array<{ x: number, y: number, z: number }> {
    // north,west
    const min = project(bounds[1][1], bounds[0][0], zoom);
    // south,east
    const max = project(bounds[0][1], bounds[1][0], zoom);
    const tiles = [];
    for (let x = min.x; x <= max.x; x++) {
        for (let y = min.y; y <= max.y; y++) {

            tiles.push({
                x: x % (2 ** (zoom)),
                y: y % (2 ** (zoom)),
                z: zoom
            });
        }
    }
    return tiles;
}

export function xyz(bounds, minZoom, maxZoom?): Array<{ x: number, y: number, z: number }> {
    let min;
    let max;
    let tiles = [];

    if (!maxZoom) {
        max = min = minZoom;
    } else if (maxZoom < minZoom) {
        min = maxZoom;
        max = minZoom;
    } else {
        min = minZoom;
        max = maxZoom;
    }
    for (let z = min; z <= max; z++) {
        tiles = tiles.concat(getTiles(bounds, z));
    }
    return tiles;
}
/**
 * Takes a GeoJSON Feature or FeatureCollection and truncates the precision of the geometry.
 *
 * @name truncate
 * @param {GeoJSON} geojson any GeoJSON Feature, FeatureCollection, Geometry or GeometryCollection.
 * @param {Object} [options={}] Optional parameters
 * @param {number} [options.precision=6] coordinate decimal precision
 * @param {number} [options.coordinates=3] maximum number of coordinates (primarly used to remove z coordinates)
 * @param {boolean} [options.mutate=false] allows GeoJSON input to be mutated (significant performance increase if true)
 * @returns {GeoJSON} layer with truncated geometry
 * @example
 */

export function truncate(geojson, options) {
    if (options === void 0) { options = {}; }
    // Optional parameters
    let precision = options.precision;
    let coordinates = options.coordinates;
    const mutate = options.mutate;
    // default params
    precision = (precision === undefined || precision === null || isNaN(precision)) ? 6 : precision;
    coordinates = (coordinates === undefined || coordinates === null || isNaN(coordinates)) ? 3 : coordinates;
    // validation
    if (!geojson) {
        throw new Error('<geojson> is required');
    }
    if (typeof precision !== 'number') {
        throw new Error('<precision> must be a number');
    }
    if (typeof coordinates !== 'number') {
        throw new Error('<coordinates> must be a number');

    }
    // prevent input mutation
    if (mutate === false || mutate === undefined) {
        geojson = JSON.parse(JSON.stringify(geojson));
    }
    const factor = Math.pow(10, precision);
    // Truncate Coordinates
    meta.coordEach(geojson, function (coords) {
        truncateCoords(coords, factor, coordinates);
    });
    return geojson;
}
/**
 * Truncate Coordinates - Mutates coordinates in place
 *
 * @private
 * @param {Array<any>} coords Geometry Coordinates
 * @param {number} factor rounding factor for coordinate decimal precision
 * @param {number} coordinates maximum number of coordinates (primarly used to remove z coordinates)
 * @returns {Array<any>} mutated coordinates
 */
export function truncateCoords(coords, factor, coordinates) {
    // Remove extra coordinates (usually elevation coordinates and more)
    if (coords.length > coordinates) {
        coords.splice(coordinates, coords.length);
    }
    // Truncate coordinate decimals
    for (let i = 0; i < coords.length; i++) {
        coords[i] = Math.round(coords[i] * factor) / factor;
    }
    return coords;
}


export function isClockwise(poly) {
    let sum = 0;
    for (let i = 0; i < poly.length - 1; i++) {
        const cur = poly[i];
        const next = poly[i + 1];
        sum += (next[0] - cur[0]) * (next[1] + cur[1]);
    }
    return sum > 0;
}
