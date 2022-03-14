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
import { isNumber } from 'util';

export function getBounds(elementidentifier: ElementIdentifier, collaborativeSearcheService: CollaborativesearchService, collection: string)
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
        .resolveHits([projType.search, search], collaborativeSearcheService.collaborations, collection, '', filter);
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
    granularityFunction: (zoom: number, clusterType?) => { tilesPrecision: number, requestsPrecision: number }): Set<string> {
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

export function extentToString(extent: Array<number>): string {
    return extent[1] + ',' + extent[2] + ',' + extent[3] + ',' + extent[0];
}

export function stringToExtent(s: string): Array<number> {
    const ss = s.split(',');
    return [+ss[3], +ss[0], +ss[1], +ss[2]];
}

export function stringToTile(tileString: string): { x: number, y: number, z: number } {
    const numbers = tileString.split('_');
    return { x: +numbers[0], y: +numbers[1], z: +numbers[2] };
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

/**
 *
 * @param rawExtent Raw extent of the map. eg : -200,-10,-120,10
 * @param wrappedExtent Wrapped extent of the map. eg : 160,-10,-120,10
 * @returns Splits the rawExtent into 2 extents if the rawExtent crosses the anti-meridean :
 * eg : rawExtent=-200,-10,-120,10 && wrappedExtent=160,-10,-120,10 ==> Returns ["160,-10,180,10" , "-180,-10,-120,10" ]
 */
export function getCanonicalExtents(rawExtent: string, wrappedExtent: string): string[] {
    const finalExtends = [];
    const wrapExtentTab = wrappedExtent.split(',').map(d => parseFloat(d)).map(n => Math.floor(n * 100000) / 100000);
    const rawExtentTab = rawExtent.split(',').map(d => parseFloat(d)).map(n => Math.floor(n * 100000) / 100000);
    const rawExtentForTest = rawExtentTab.join(',');
    const wrapExtentForTest = wrapExtentTab.join(',');
    if (rawExtentTab[0] < -180 && rawExtentTab[2] > 180) {
        finalExtends.push('-180' + ',' + '-90' + ',' + '180' + ',' + '90');
    } else if (rawExtentForTest === wrapExtentForTest) {
        finalExtends.push(wrappedExtent.trim());
    } else {
        let west = wrapExtentTab[0];
        let east = wrapExtentTab[2];
        if (west < 0 && east < 0) {
            west = west * -1;
            east = east * -1;
        }
        if (west > east) {
            const firstExtent = wrapExtentTab[0] + ',' + wrapExtentTab[1] + ',' + '180' + ',' + wrapExtentTab[3];
            const secondExtent = '-180' + ',' + wrapExtentTab[1] + ',' + wrapExtentTab[2] + ',' + wrapExtentTab[3];
            finalExtends.push(firstExtent.trim());
            finalExtends.push(secondExtent.trim());
        } else {
            finalExtends.push(('0' + ',' + wrapExtentTab[1] + ',180,' + wrapExtentTab[3]).trim());
            finalExtends.push(('-180' + ',' + wrapExtentTab[1] + ',0,' + wrapExtentTab[3]).trim());
        }
    }
    return finalExtends;
}


export function numToString(num: number, p?: number): string {
    // what tier? (determines SI symbol)
    const suffixes = ['', 'k', 'M', 'b', 't'];
    const suffixNum = Math.log10(Math.abs(num)) / 3 | 0;

    if (suffixNum === 0) {
        if (Math.abs(num) < 0.1) {
            return formatNumber(+num);
        }
        return formatNumber(+num, ' ', 0);
    }
    // get suffix and determine scale
    const suffix = suffixes[suffixNum];
    const scale = Math.pow(10, suffixNum * 3);
    // scale the number
    const scaled = num / scale;
    // format number and add suffix
    return scaled.toFixed(1) + suffix;
}

export function formatNumber(x, formatChar = ' ', roundPrecision?: number): string {
    if (isNumber(x)) {
        const trunc = Math.trunc(x);
        const integerFraction = (x + '').split('.');
        const spacedNumber = Math.abs(trunc).toString().replace(/\B(?=(\d{3})+(?!\d))/g, formatChar);
        const spacedNumberString = x < 0 ? '-' + spacedNumber : spacedNumber;
        if (integerFraction.length === 2) {
            const fraction: string = integerFraction[1];
            let precision = 0;
            if (roundPrecision === undefined) {
                let numberOfZeros = 0;
                for (let i = 0; i < fraction.length; i++) {
                    if (fraction.charAt(i) === '0') {
                        numberOfZeros++;
                    } else {
                        break;
                    }
                }
                /** number of zeros + 1 (before comma) + 2 for precision */
                precision = numberOfZeros + 1 + 2;
            } else {
                precision = roundPrecision + 1;
            }
            const roundedNumber = Math.round(x * Math.pow(10, precision)) /
                Math.pow(10, precision);
            const roundedIntergerFraction = (roundedNumber + '').split('.');
            if (roundedIntergerFraction.length === 2) {
                return spacedNumberString + '.' + roundedIntergerFraction[1];
            } else {
                return spacedNumberString;
            }
        } else {
            return spacedNumberString;
        }
    }
    return x;
}
