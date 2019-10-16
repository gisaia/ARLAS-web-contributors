import { Expression, Search, Hits, Filter } from 'arlas-api';
import { Observable } from 'rxjs';
import { ElementIdentifier } from 'models/models';
import { projType } from 'arlas-web-core';
import { getElementFromJsonObject } from './utils';
import bbox from '@turf/bbox';
import { CollaborativesearchService } from 'arlas-web-core/services/collaborativesearch.service';
import { map } from 'rxjs/internal/operators/map';
import * as meta from '@turf/meta';

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

export function tileToString(tile: { x: number, y: number, z: number }): string {
    return tile.x.toString() + tile.y.toString() + tile.z.toString();
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
