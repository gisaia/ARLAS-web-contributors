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
