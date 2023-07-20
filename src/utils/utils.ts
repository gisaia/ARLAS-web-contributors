/*
 * Licensed to Gisaïa under one or more contributor
 * license agreements. See the NOTICE.txt file distributed with
 * this work for additional information regarding copyright
 * ownership. Gisaïa licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import * as FileSaver from 'file-saver';
import jp from 'jsonpath/jsonpath.min';
import { Hits, Aggregation } from 'arlas-api';
import { mix } from 'tinycolor2';
import { LayerSourceConfig } from '../models/models';


export class ColorGeneratorLoader {
    public keysToColors: Array<Array<string>>;
    public colorsSaturationWeight: number;

    public constructor() {
        this.keysToColors = [];
        this.colorsSaturationWeight = 0.5;
    }
    /**
     * This method generates a determistic color from the given key, a list of [key, color] and a saturation weight.
     * @param key The text from which the color is generated
     * @param externalkeysToColors List of [key, color] couples that associates a hex color to each key.
     * @param colorsSaturationWeight Knowing that saturation scale is [0, 1], `colorsSaturationWeight` is a factor (between 0 and 1) that
     * tightens this scale to [(1-colorsSaturationWeight), 1]. Therefore all generated colors saturation will be within this scale.
     */
    public getColor(key: string, externalKeysToColors?: Array<[string, string]>, externalColorsSaturationWeight?: number): string {
        let colorHex = null;
        const keysToColors = externalKeysToColors ? externalKeysToColors : this.keysToColors;
        const saturationWeight = (externalColorsSaturationWeight !== undefined && externalColorsSaturationWeight !== null) ?
            externalColorsSaturationWeight : this.colorsSaturationWeight;
        if (keysToColors) {
            for (let i = 0; i < keysToColors.length; i++) {
                const keyToColor = keysToColors[i];
                if (keyToColor[0] === key) {
                    colorHex = keyToColor[1];
                    break;
                }
            }
            if (!colorHex) {
                colorHex = getHexColor(key, saturationWeight);
            }
        } else {
            colorHex = getHexColor(key, saturationWeight);
        }
        return colorHex;
    }
    public getTextColor(color: string): string {
        return '#ffffff';
    }
}

/**
* Retrieve JSON element from JSON object and string path.
* @param jsonObject  JSON Object.
* @param pathstring  Path to retrieve.
* @returns Element
*/
export function getElementFromJsonObject(jsonObject: any, pathstring: string): any {
    const path = pathstring.split('.');
    if (jsonObject == null) {
        return null;
    }
    if (path.length === 0) {
        return null;
    }
    if (path.length === 1) {
        return jsonObject[path[0]];
    } else {
        return getElementFromJsonObject(jsonObject[path[0]], path.slice(1).join('.'));
    }
}
/**
* Return if an Object in Array or not.
* @param obj Object.
* @returns If the object is an Array or not
*/
export function isArray(obj: Object) {
    return Object.prototype.toString.call(obj) === '[object Array]';
}

/**
* Dowload a file from text.
* @param text Text in downloaded file.
* @param name Name of downloaded file.
* @param type type content in file.
*/
export function download(text: string, name: string, type: string) {
    const file = new Blob([text], { type: type });
    FileSaver.saveAs(file, name);
}

export const ASC = 'asc';
export const DESC = 'desc';

/**
 * @description appends the `idFieldName` to sortString.
 * It checks if the `idFieldName` is already present in the `sortString` and moves to the end of the string if it's the case
 * @param sortString comma separated field names.
 * @param order whether to apply ascending or descending sort on `idFieldName`. Possible values are `asc` and `desc`
 * @param idFieldName id field name to append to the `sortString`
 */
export function appendIdToSort(sortString: string, order: string = ASC, idFieldName: string): string {
    let sortStringWithId = sortString;
    const regex = new RegExp('-?' + idFieldName + ',?');
    const match = sortString.match(regex);
    if (match !== null) {
        match.forEach(m => {
            sortStringWithId = sortString.replace(m, '');
        });
    }
    if (sortStringWithId.endsWith(',')) {
        sortStringWithId = sortStringWithId.substring(0, sortStringWithId.length - 1);
    }
    const idFieldToAppend = (order === DESC) ? '-' + idFieldName : idFieldName;
    if (sortStringWithId !== '') {
        sortStringWithId += ',';
    }
    sortStringWithId += idFieldToAppend;
    return sortStringWithId;
}

/**
 * This method invert the sort direction of `sortString`. It is used when fetching previous pages.
 * @param sortString comma separated fields on which sort is applied
 */
export function invertSortDirection(sortString: string): string {
    if (sortString !== '') {
        const invertedSortList = Array.from(sortString.split(',')).map(s => {
            if (s.startsWith('-')) {
                return s.substring(1, s.length);
            } else {
                return '-' + s;
            }
        });
        return invertedSortList.join(',');
    } else {
        return sortString;
    }
}

/**
 *
 * @param fromIndex remove `pageSize` elements from `data` array starting from `fromIndex`
 * @param data the data list from which pages are removed
 * @param pageSize how many hits/features are inside each page
 * @param maxPages Maximum number of pages to keep in `data` list
 */
export function removePageFromIndex(fromIndex, data: Array<any>, pageSize: number, maxPages: number): void {
    if (data.length > pageSize * maxPages) {
        data.splice(fromIndex, pageSize);
    }
}

/**
 * Returns the value of the desired field in the JSON data.
 * @param field Field to find in the data JSON
 * @param data JSON data to explore
 */
export function getFieldValue(field: string, data: Hits): any {
    let result;
    if (field) {
        if (field.indexOf('.') < 0) {
            const query = jp.stringify(['$', field]);
            result = jp.query(data, query);
        } else {
            let query = '$.';
            let composePath = '';
            let lastElementLength: number;
            let isDataArray = false;
            let dataElement: any;
            field.split('.').forEach(pathElment => {
                if (isDataArray) {
                    dataElement = getElementFromJsonObject(dataElement[0], pathElment);
                } else {
                    composePath = composePath + '.' + pathElment;
                    dataElement = getElementFromJsonObject(data, composePath.substring(1));
                }
                isDataArray = isArray(dataElement);
                if (isArray(dataElement)) {
                    query = query + pathElment + '[*].';
                    lastElementLength = 4;
                } else {
                    query = query + pathElment + '.';
                    lastElementLength = 1;
                }
            });
            query = query.substring(0, query.length - lastElementLength);
            result = jp.query(data, query);
        }

        if (result.length === 1) {
            result = result[0];
        } else {
            result = result.join(',');
        }
    }
    return result;
}

export function coarseTopoGranularity(zoom: number): { tilesPrecision: number; requestsPrecision: number; } {
    return { tilesPrecision: 2, requestsPrecision: 2 };
}
export function mediumTopoGranularity(zoom: number): { tilesPrecision: number; requestsPrecision: number; } {
    return { tilesPrecision: 2, requestsPrecision: 2 };
}
export function fineTopoGranularity(zoom: number): { tilesPrecision: number; requestsPrecision: number; } {
    return { tilesPrecision: 2, requestsPrecision: 2 };
}
export function finestTopoGranularity(zoom: number): { tilesPrecision: number; requestsPrecision: number; } {
    return { tilesPrecision: 2, requestsPrecision: 2 };
}


export function networkFetchingLevelGranularity(precision): { tilesPrecision: number; requestsPrecision: number; } {
    return { tilesPrecision: precision, requestsPrecision: precision };
}

export function coarseGranularity(zoom: number, type?: Aggregation.TypeEnum): { tilesPrecision: number; requestsPrecision: number; } {
    if (!type) {
        type = Aggregation.TypeEnum.Geohash;
    }
    if (type === Aggregation.TypeEnum.Geohash) {
        if (zoom >= 0 && zoom < 4) {
            return { tilesPrecision: 1, requestsPrecision: 2 };
        } else if (zoom >= 4 && zoom < 7) {
            return { tilesPrecision: 1, requestsPrecision: 3 };
        } else if (zoom >= 7 && zoom < 10) {
            return { tilesPrecision: 2, requestsPrecision: 4 };
        } else if (zoom >= 10 && zoom < 13) {
            return { tilesPrecision: 3, requestsPrecision: 5 };
        } else if (zoom >= 13) {
            return { tilesPrecision: 4, requestsPrecision: 6 };
        }
    } else {
        const tilesPrecision = Math.trunc(zoom) % 2 === 0 ? Math.trunc(zoom) + 1 : Math.trunc(zoom);
        return { tilesPrecision: tilesPrecision, requestsPrecision: tilesPrecision + 2 };
    }
}


export function mediumGranularity(zoom: number, type?: Aggregation.TypeEnum): { tilesPrecision: number; requestsPrecision: number; } {
    if (!type) {
        type = Aggregation.TypeEnum.Geohash;
    }
    if (type === Aggregation.TypeEnum.Geohash) {
        if (zoom >= 0 && zoom < 3) {
            return { tilesPrecision: 1, requestsPrecision: 2 };
        } else if (zoom >= 3 && zoom < 6) {
            return { tilesPrecision: 1, requestsPrecision: 3 };
        } else if (zoom >= 6 && zoom < 9) {
            return { tilesPrecision: 2, requestsPrecision: 4 };
        } else if (zoom >= 9 && zoom < 12) {
            return { tilesPrecision: 3, requestsPrecision: 5 };
        } else if (zoom >= 12 && zoom < 15) {
            return { tilesPrecision: 4, requestsPrecision: 6 };
        } else if (zoom >= 15) {
            return { tilesPrecision: 5, requestsPrecision: 7 };
        }
    } else {
        const tilesPrecision = Math.trunc(zoom) % 2 === 0 ? Math.trunc(zoom) + 1 : Math.trunc(zoom);
        return { tilesPrecision: tilesPrecision, requestsPrecision: tilesPrecision + 3 };
    }
}

export function fineGranularity(zoom: number, type?: Aggregation.TypeEnum): { tilesPrecision: number; requestsPrecision: number; } {
    if (!type) {
        type = Aggregation.TypeEnum.Geohash;
    }
    if (type === Aggregation.TypeEnum.Geohash) {
        if (zoom >= 0 && zoom < 2) {
            return { tilesPrecision: 1, requestsPrecision: 2 };
        } else if (zoom >= 2 && zoom < 5) {
            return { tilesPrecision: 1, requestsPrecision: 3 };
        } else if (zoom >= 5 && zoom < 8) {
            return { tilesPrecision: 2, requestsPrecision: 4 };
        } else if (zoom >= 8 && zoom < 10.5) {
            return { tilesPrecision: 3, requestsPrecision: 5 };
        } else if (zoom >= 10.5 && zoom < 14) {
            return { tilesPrecision: 4, requestsPrecision: 6 };
        } else if (zoom >= 14 && zoom < 17) {
            return { tilesPrecision: 5, requestsPrecision: 7 };
        } else if (zoom >= 17) {
            return { tilesPrecision: 6, requestsPrecision: 8 };
        }
    } else {
        return { tilesPrecision: Math.trunc(zoom) + 1, requestsPrecision: Math.trunc(zoom) + 5 };

    }
}

export function finestGranularity(zoom: number, type?: Aggregation.TypeEnum): { tilesPrecision: number; requestsPrecision: number; } {
    if (!type) {
        type = Aggregation.TypeEnum.Geohash;
    }
    if (type === Aggregation.TypeEnum.Geohash) {
        if (zoom >= 0 && zoom < 3) {
            return { tilesPrecision: 1, requestsPrecision: 3 };
        } else if (zoom >= 3 && zoom < 5) {
            return { tilesPrecision: 1, requestsPrecision: 4 };
        } else if (zoom >= 5 && zoom < 8) {
            return { tilesPrecision: 2, requestsPrecision: 5 };
        } else if (zoom >= 8 && zoom < 11) {
            return { tilesPrecision: 3, requestsPrecision: 6 };
        } else if (zoom >= 11 && zoom < 14) {
            return { tilesPrecision: 4, requestsPrecision: 7 };
        } else if (zoom >= 14 && zoom < 17) {
            return { tilesPrecision: 5, requestsPrecision: 8 };
        } else if (zoom >= 17 && zoom < 20) {
            return { tilesPrecision: 6, requestsPrecision: 9 };
        } else if (zoom >= 20) {
            return { tilesPrecision: 7, requestsPrecision: 10 };
        }
    } else {

        return { tilesPrecision: Math.trunc(zoom) + 1, requestsPrecision: Math.trunc(zoom) + 7 };

    }
}


export function featurestTilesGranularity(zoom: number): number {
    if (zoom >= 0 && zoom < 3) {
        return 2;
    } else if (zoom >= 3 && zoom < 5) {
        return 4;
    } else if (zoom >= 5 && zoom < 7) {
        return 6;
    } else if (zoom >= 7 && zoom < 9) {
        return 8;
    } else if (zoom >= 9 && zoom < 11) {
        return 10;
    } else if (zoom >= 11 && zoom < 13) {
        return 12;
    } else if (zoom >= 13 && zoom < 15) {
        return 14;
    } else if (zoom >= 15 && zoom < 17) {
        return 16;
    } else if (zoom >= 17 && zoom < 19) {
        return 18;
    } else if (zoom >= 19 && zoom < 21) {
        return 20;
    } else if (zoom >= 21 && zoom < 23) {
        return 22;
    } else if (zoom >= 23 && zoom < 25) {
        return 24;
    }
}

export function getHexColor(key: string, saturationWeight: number): string {
    const text = key + ':' + key.split('').reverse().join('') + ':' + key;
    // string to int
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = text.charCodeAt(i) + ((hash << 5) - hash);
    }
    // int to rgb
    let hex = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    hex = '00000'.substring(0, 6 - hex.length) + hex;
    const color = mix(hex, hex);
    color.lighten(5);
    const saturation = color.toHsv().s;
    if (saturation < (1 - saturationWeight) * 100) {
        const range = (1 - saturationWeight) * 100 - saturation;
        color.saturate(range);
    }
    color.brighten(10);
    return color.toHexString();
}

export function rgbToHex(rgb: string): string {
    const color = mix(rgb, rgb);
    return color.toHexString();
}


export function getSourceName(ls: LayerSourceConfig): string {
    let sourceType = 'cluster';
    if (ls.returned_geometry) {
        sourceType = 'feature';
    } else if (ls.geometry_id) {
        sourceType = 'feature-metric';
    }
    const sourceNameComponents = [];
    sourceNameComponents.push(sourceType);
    switch (sourceType) {
        case 'cluster':
            sourceNameComponents.push(ls.agg_geo_field);
            sourceNameComponents.push(ls.granularity);
            sourceNameComponents.push(ls.aggType);
            if (ls.aggregated_geometry) {
                sourceNameComponents.push(ls.aggregated_geometry);
            } else {
                sourceNameComponents.push(ls.raw_geometry.geometry);
                sourceNameComponents.push(ls.raw_geometry.sort);
            }
            if (ls.fetched_hits && ls.fetched_hits.sorts) {
                sourceNameComponents.push(ls.fetched_hits.sorts.join('_'));
            }
            break;
        case 'feature-metric':
            sourceNameComponents.push(ls.geometry_id);
            sourceNameComponents.push(ls.raw_geometry.geometry);
            sourceNameComponents.push(ls.raw_geometry.sort);
            sourceNameComponents.push(ls.network_fetching_level);
            if (ls.fetched_hits && ls.fetched_hits.sorts) {
                sourceNameComponents.push(ls.fetched_hits.sorts.join('_'));
            }
            break;
        case 'feature':
            sourceNameComponents.push(ls.returned_geometry);
            sourceNameComponents.push(ls.render_mode);
            break;
    }
    return sourceNameComponents.join('-');
}

export function notInfinity(value: any) {
    return value !== 'Infinity' && value !== '-Infinity' && value !== Infinity && value !== -Infinity;
}
