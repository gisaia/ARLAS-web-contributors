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
