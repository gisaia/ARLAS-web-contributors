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
* Recursive function to feed a map of detail.
* @param element Object.
* @param detailedDataMap Object.
* @param confEntrie Object.
* @param data Object.
*/
export function feedDetailledMap(element, detailedDataMap = new Map<string, string>(), confEntrie: any, data: any) {
    if (isArray(confEntrie)) {
        confEntrie.forEach(i => {
            Object.keys(i).forEach(subelement => {
                if (getElementFromJsonObject(data, element) !== undefined) {
                    getElementFromJsonObject(data, element).forEach(e => {
                        feedDetailledMap(subelement, detailedDataMap, i[subelement], e);
                    });
                }
            });
        });
    } else {
        const result = getElementFromJsonObject(data, element);
        let resultset = null;
        if (confEntrie.process.trim().length > 0) {
            resultset = eval(confEntrie.process.trim());
        } else {
            resultset = result;
        }
        if (detailedDataMap.get(confEntrie.label) === null || detailedDataMap.get(confEntrie.label) === undefined) {
            detailedDataMap.set(confEntrie.label, resultset);
        } else {
            const newvalue = detailedDataMap.get(confEntrie.label) + ', ' + resultset;
            detailedDataMap.set(confEntrie.label, newvalue);
        }
    }
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
