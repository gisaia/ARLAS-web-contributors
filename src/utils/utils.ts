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

