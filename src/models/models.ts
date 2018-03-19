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

export interface Column {
    columnName: string;
    fieldName: string;
    dataType: string;
    process: string;
}

export interface Detail {
    name: string;
    order: number;
    fields: Array<FieldDetail>;
}
export interface FieldDetail {
    path: string;
    label: string;
    process: string;
}

export interface DonutArc {
    name: string;
    id: string;
    ringName: string;
    isOther: boolean;
    size?: number;
    children?: Array<DonutArc>;
}

export interface SelectionTree {
    field: string;
    value: string;
    children?: Array<SelectionTree>;
    parent?: SelectionTree;
}
