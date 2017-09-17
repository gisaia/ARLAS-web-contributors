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
 * - actionBus suscribe by the contributor to do something when this bus is nexted by the app or another contributor.
 */
export interface Action {
    id: string;
    label: string;
    actionBus: Subject<ProductIdentifier>;
    triggerType?: triggerType.onclick | triggerType.onconsult;
}
/**
 * Couple of field/value id product, use to retrieve the product.
 * - id field name.
 * - id field value.
 */
export interface ProductIdentifier {
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
}

