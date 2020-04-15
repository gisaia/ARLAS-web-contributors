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
import { Hits } from 'arlas-api';

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
 * @description appends the `idFieldName` to sortString
 * @param sortString comma separated field names.
 * @param order whether to apply ascending or descending sort on `idFieldName`. Possible values are `asc` and `desc`
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

export function getFieldValue(field: string, data: Hits): any {
    let result = '';
    if (field) {
        if (field.indexOf('.') < 0) {
            result = jp.query(data, '$.' + field);
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
    }
    return result;
}

export function coarseGranularity(zoom: number): {tilesPrecision: number, requestsPrecision: number} {
    if (zoom >= 0 && zoom <= 4) {
        return {tilesPrecision: 1, requestsPrecision: 3};
    } else  if (zoom > 4 && zoom <= 12) {
        return {tilesPrecision: 2, requestsPrecision: 4};
    } else  if (zoom > 12) {
        return {tilesPrecision: 3, requestsPrecision: 5};
    }
}

export function fineGranularity(zoom: number): {tilesPrecision: number, requestsPrecision: number} {
    if (zoom >= 0 && zoom <= 4) {
        return {tilesPrecision: 1, requestsPrecision: 3};
    } else  if (zoom > 4 && zoom <= 7) {
        return {tilesPrecision: 2, requestsPrecision: 4};
    } else  if (zoom > 7 && zoom <= 10) {
        return {tilesPrecision: 3, requestsPrecision: 5};
    } else  if (zoom > 10) {
        return {tilesPrecision: 4, requestsPrecision: 6};
    }
}

export function finestGranularity(zoom: number): {tilesPrecision: number, requestsPrecision: number} {
    if (zoom >= 0 && zoom <= 3) {
        return {tilesPrecision: 1, requestsPrecision: 3};
    } else  if (zoom > 3 && zoom <= 6) {
        return {tilesPrecision: 2, requestsPrecision: 4};
    } else  if (zoom > 6 && zoom <= 9) {
        return {tilesPrecision: 3, requestsPrecision: 5};
    } else  if (zoom > 9 && zoom <= 15) {
        return {tilesPrecision: 4, requestsPrecision: 6};
    } else  if (zoom > 15) {
        return {tilesPrecision: 5, requestsPrecision: 7};
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

