import { Subject } from 'rxjs/Subject';

/**
* Enum of sorting value define in Arlas-web-components
*/
export enum SortEnum {
    asc, desc, none
}
/**
* Enum of type of trigger for action define in Arlas-web-components
*/
export enum triggerType {
    onclick, onconsult
}
/**
 * Action trigger by a contributor through the app or another contributor.
 * - id of action.
 * - label of action.
 */
export interface Action {
    id: string;
    label: string;
}
/**
 * Couple of field/value id product, use to retrieve the product.
 * - id field name.
 * - id field value.
 */
export interface ElementIdentifier {
    idFieldName: string;
    idValue: string;
}
/**
* Enum of time unit that the timeline mode could draw.
*/
export enum DateUnit {
    second, millisecond
}

/**
* Enum of time unit that the timeline mode could draw.
*/
export enum DataType {
  numeric, time
}
/**
* Object of start and end value of the chart selector.
*/
export interface SelectedOutputValues {
    startvalue: Date | number;
    endvalue: Date | number;
}
/**
* Object of label and count value use in chip.
*/
export interface SearchLabel {
    label: string;
    count: number;
}
/**
* Object of label and count value use in chip.
*/
export interface OnMoveResult {
    zoom: number;
    center: any;
    extend: Array<number>;
    extendForLoad: Array<number>;
    extendForTest: Array<number>;
    tiles: Array<{ x: number, y: number, z: number }>;
    geohash: Array<string>;


}

export interface FieldsConfiguration {
    idFieldName: string;
    urlImageTemplate?: string;
    urlThumbnailTemplate?: string;
    titleFieldName?: string;

}

