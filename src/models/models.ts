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

import moment from 'moment';
import { Metric, RawGeometry, Aggregation, Search } from 'arlas-api';

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
* Enum of type for cluster calculation
*/
export enum ClusterAggType {
    tile = 'tile', geohash = 'geohash'
}
/**
 * Action trigger by a contributor through the app or another contributor.
 * - id of action.
 * - label of action.
 */
export interface Action {
    id: string;
    label: string;
    tooltip?: string;
    cssClass?: string;
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
* Object of start and end value of the chart selector.
*/
export interface SelectedOutputValues {
    startvalue: Date | number | string;
    endvalue: Date | number | string;
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
    rawExtendForTest: Array<number>;
    extendForTest: Array<number>;
    visibleLayers: Set<string>;
}

export interface FieldsConfiguration {
    /** Id field name */
    idFieldName: string;
    /** Url template of image */
    urlImageTemplate?: string;
    /** Url template of thumbnail */
    urlThumbnailTemplate?: string;
    /** List of fields which values are used as titles in the resultlist. Values are joined with a space ' ' */
    titleFieldNames?: Array<Field>;
    /** List of fields which values are used as tooltips in the resultlist. Values are joined with a space ' ' */
    tooltipFieldNames?: Array<Field>;
    /** Field which value indicates whether there is a image for a row (tile) or not */
    imageFieldName?: string;
    /** Field which value indicates whether there is a thumbnail image for a row (tile) or not */
    thumbnailFieldName?: string;
    /** Name of a Material icon */
    icon?: string;
    /** Field which value is used as a css class name => allows data driven styling of the resultlist rows/tiles */
    iconCssClass?: string;
    /** Field which value is transformed to a hex color (using an ArlasColorService) and associated to the icon color */
    iconColorFieldName?: string;
}

export interface Column {
    columnName: string;
    fieldName: string;
    dataType: string;
    process: string;
    dropdown: boolean;
    dropdownsize: number;
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

export interface TreeNode {
    id: string;
    fieldName: string;
    fieldValue: string;
    isOther: boolean;
    size?: number;
    metricValue?: number;
    children?: Array<TreeNode>;
    color?: string;
}

export interface SimpleNode {
    fieldName: string;
    fieldValue: string;
}

export interface SelectionTree {
    field: string;
    value: string;
    children?: Array<SelectionTree>;
    parent?: SelectionTree;
}

export interface TimeShortcut {
    label: string;
    from: DateExpression;
    to: DateExpression;
    type: string;
}

export interface StringifiedTimeShortcut {
    label: string;
    from: string;
    to: string;
    type: string;
}

export interface LayerSourceConfig {
    id: string;
    name?: string;
    source: string;
    minzoom: number;
    maxzoom: number;
    minfeatures?: number;
    maxfeatures?: number;
    returned_geometry?: string;
    geometry_id?: string;
    geometry_support?: string;
    agg_geo_field?: string;
    colors_from_fields?: Array<string>;
    include_fields?: Array<string>;
    provided_fields?: Array<ColorConfig>;
    normalization_fields?: Array<NormalizationFieldConfig>;
    aggregated_geometry?: string;
    raw_geometry?: RawGeometryConfig;
    granularity?: string;
    metrics?: Array<MetricConfig>;
    filters?: Array<any>;
    aggType?: ClusterAggType;
    windowed?: boolean;
}

export interface ColorConfig {
    color: string;
    label?: string;
}
export enum DateUnitEnum {
    y = 'y',
    M = 'M',
    w = 'w',
    d = 'd',
    h = 'h',
    H = 'H',
    m = 'm',
    s = 's'
}

export enum PageEnum {
    next = 'next', previous = 'previous'
}

export class DateExpression {
    public anchorDate: number | string;
    public translationDuration: number;
    public translationUnit: DateUnitEnum;
    public roundingUnit: DateUnitEnum;

    constructor(anchorDate?, translationDuration?, translationUnit?, roundingUnit?: DateUnitEnum) {
        this.anchorDate = anchorDate;
        this.translationDuration = translationDuration;
        this.translationUnit = translationUnit;
        this.roundingUnit = roundingUnit;
    }

    public toString(): string {
        let stringifiedExpression = this.anchorDate.toString();
        if (this.anchorDate !== 'now') {
            if (Number(this.anchorDate) !== NaN) {
                stringifiedExpression += '||';
            }
        }
        if (this.translationDuration && this.translationUnit) {
            if (this.translationDuration > 0) {
                stringifiedExpression += '+';
            }
            stringifiedExpression += this.translationDuration + this.translationUnit;
        }
        if (this.roundingUnit) {
            stringifiedExpression += '/' + this.roundingUnit;
        }
        return stringifiedExpression;
    }

    public toMillisecond(roundUp: boolean, useUtc: boolean): number {
        let dateValue: moment.Moment;
        if (this.anchorDate === 'now') {
            if (useUtc) {
                dateValue = moment().utc();
            } else {
                dateValue = moment();
            }
        } else {
            if (useUtc) {
                dateValue = moment(this.anchorDate).utc();
            } else {
                dateValue = moment(this.anchorDate);
            }
        }
        if (this.translationDuration && this.translationUnit) {
            switch (this.translationUnit) {
                case DateUnitEnum.y: {
                    dateValue.add(this.translationDuration, 'year');
                    break;
                }
                case DateUnitEnum.M: {
                    dateValue.add(this.translationDuration, 'month');
                    break;
                }
                case DateUnitEnum.w: {
                    dateValue.add(this.translationDuration, 'week');
                    break;
                }
                case DateUnitEnum.d: {
                    dateValue.add(this.translationDuration, 'day');
                    break;
                }
                case DateUnitEnum.h: {
                    dateValue.add(this.translationDuration, 'hour');
                    break;
                }
                case DateUnitEnum.m: {
                    dateValue.add(this.translationDuration, 'minute');
                    break;
                }
                case DateUnitEnum.s: {
                    dateValue.add(this.translationDuration, 'second');
                    break;
                }
            }
        }
        if (this.roundingUnit) {
            roundUp ? this.roundUp(dateValue) : this.roundDown(dateValue);
        }
        return dateValue.unix() * 1000 + dateValue.millisecond();
    }

    public static toDateExpression(expression: string): DateExpression {
        const dateExpression = new DateExpression();
        if (expression.length >= 3) {
            // Check if the anchor date is equal to "now"
            if (expression.substring(0, 3) === 'now') {
                dateExpression.anchorDate = expression.substring(0, 3);
                if (expression.length > 3) {
                    const postAnchor = expression.substring(3);
                    this.setPostAnchorExpression(postAnchor, dateExpression);
                }
            }
        }
        return dateExpression;
    }


    private static setPostAnchorExpression(postAnchor: string, dateExpression: DateExpression): void {
        // Check if it starts with an operator
        // "/" operator is for rounding the date up or down
        const op = postAnchor.substring(0, 1);
        if (op === '/' || op === '-' || op === '+') {
            if (op === '/') {
                // If the operator is "/", it should be followed by one character : a date math unit,
                if (postAnchor.length === 2) {
                    dateExpression.roundingUnit = <DateUnitEnum>postAnchor.substring(1, 2);
                }
            } else {
                if (op === '+' || op === '-') {
                    // example of postAnchor value : -2h/M
                    if (postAnchor.length > 1) {
                        const operands = postAnchor.substring(1).split('/');
                        // translationDuration == 2
                        dateExpression.translationDuration = parseFloat(operands[0].substring(0, operands[0].length - 1));
                        if (op === '-') {
                            dateExpression.translationDuration = -1 * dateExpression.translationDuration;
                        }
                        // translationUnit == h
                        dateExpression.translationUnit = <DateUnitEnum>operands[0].substring(operands[0].length - 1);
                        if (operands.length === 2) {
                            // roundingUnit == M
                            dateExpression.roundingUnit = <DateUnitEnum>operands[1];
                        }
                    }
                }
            }
        }
    }

    private roundDown(dateValue: moment.Moment) {
        switch (this.roundingUnit) {
            case DateUnitEnum.y: {
                dateValue.month(0);
                dateValue.date(1);
                dateValue.hour(0);
                dateValue.minute(0);
                dateValue.second(0);
                dateValue.millisecond(0);
                break;
            }
            case DateUnitEnum.M: {
                dateValue.date(1);
                dateValue.hour(0);
                dateValue.minute(0);
                dateValue.second(0);
                dateValue.millisecond(0);
                break;
            }
            case DateUnitEnum.w: {
                dateValue.date(dateValue.startOf('isoWeek').get('date'));
                dateValue.hour(0);
                dateValue.minute(0);
                dateValue.second(0);
                dateValue.millisecond(0);
                break;
            }
            case DateUnitEnum.d: {
                dateValue.hour(0);
                dateValue.minute(0);
                dateValue.second(0);
                dateValue.millisecond(0);
                break;
            }
            case DateUnitEnum.h: {
                dateValue.minute(0);
                dateValue.second(0);
                dateValue.millisecond(0);
                break;
            }
            case DateUnitEnum.m: {
                dateValue.second(0);
                dateValue.millisecond(0);
                break;
            }
            case DateUnitEnum.s: {
                dateValue.millisecond(0);
                break;
            }
        }

    }

    private roundUp(dateValue: moment.Moment) {
        switch (this.roundingUnit) {
            case DateUnitEnum.y: {
                dateValue.month(11);
                dateValue.date(31);
                dateValue.hour(23);
                dateValue.minute(59);
                dateValue.second(59);
                dateValue.millisecond(999);
                break;
            }
            case DateUnitEnum.M: {
                dateValue.date(dateValue.endOf('month').get('date'));
                dateValue.hour(23);
                dateValue.minute(59);
                dateValue.second(59);
                dateValue.millisecond(999);
                break;
            }
            case DateUnitEnum.w: {
                dateValue.date(dateValue.endOf('isoWeek').get('date'));
                dateValue.hour(23);
                dateValue.minute(59);
                dateValue.second(59);
                dateValue.millisecond(999);
                break;
            }
            case DateUnitEnum.d: {
                dateValue.hour(23);
                dateValue.minute(59);
                dateValue.second(59);
                dateValue.millisecond(999);
                break;
            }
            case DateUnitEnum.h: {
                dateValue.minute(59);
                dateValue.second(59);
                dateValue.millisecond(999);
                break;
            }
            case DateUnitEnum.m: {
                dateValue.second(59);
                dateValue.millisecond(999);
                break;
            }
            case DateUnitEnum.s: {
                dateValue.millisecond(999);
                break;
            }
        }
    }
}
export interface Field {
    fieldPath: string;
    process?: string;
}

export interface Attachment {
    url: string;
    label?: string;
    type?: string;
    description?: string;
    icon?: string;
}

export interface AdditionalInfo {
    details?: Map<string, Map<string, string>>;
    actions?: Array<Action>;
    attachments?: Array<Attachment>;
}

export interface AttachmentConfig {
    attachmentsField: string;
    attachementUrlField: string;
    attachmentLabelField?: string;
    attachmentTypeField?: string;
    attachmentDescriptionField?: string;
    attachmentIcon?: string;
}

/**
 * This interface defines how to apply normalization on the values of a field.
 * 1. `on` : Choose the **date** or **numeric** field which values are normalized.
 * 2. `per` : (Optional) Choose the **keyword** field in order to normalize the `"on"` values per keyword.
 */
export interface NormalizationFieldConfig {
    on: string;
    per?: string;
}

export interface RawGeometryConfig {
    geometry: string;
    sort: string;
}

/**
 * This class defines how to apply normalization on the values of a field.
 * 1. `on` : Choose the **date** or **numeric** field which values are normalized.
 * 2. `per` : (Optional) Choose the **keyword** field in order to normalize the `"on"` values per keyword.
 * An object of this class stores the **min** and **max** values of the `"on"` field (given the `"per"` field)
 */
export class FeaturesNormalization implements NormalizationFieldConfig {
    public on: string;
    public per?: string;
    public minMaxPerKey ? = new Map<string, [number, number]>();
    public minMax?: [number, number];
}

export class LayerSource {
    public id: string;
    public source: string;
    public layerMinzoom: number;
    public layerMaxzoom: number;
    public sourceMinzoom: number;
    public sourceMaxzoom: number;
}

export class LayerFeatureSource extends LayerSource {
    public maxfeatures: number;
    public normalizationFields: Array<NormalizationFieldConfig>;
    public includeFields: Set<string>;
    public providedFields: Array<ColorConfig>;
    public colorFields: Set<string>;
    public returnedGeometry: string;
}

export class LayerClusterSource extends LayerSource {
    public minfeatures: number;
    public aggGeoField: string;
    public granularity: Granularity;
    public aggregatedGeometry: Aggregation.AggregatedGeometriesEnum;
    public rawGeometry: RawGeometry;
    public metrics: Array<MetricConfig>;
    public type: ClusterAggType;
}

/** Topology = feature-metric */
export class LayerTopologySource extends LayerSource {
    public maxfeatures: number;
    public metrics: Array<MetricConfig>;
    public geometryId: string;
    public rawGeometry: RawGeometry;
    public granularity: Granularity;
    public providedFields: Array<ColorConfig>;
    public colorFields: Set<string>;
    public includeFields: Set<string>;
}

export enum Granularity {
    coarse = 'Coarse',
    medium = 'Medium',
    fine = 'Fine',
    finest = 'Finest',
}

export interface MetricConfig {
    field: string;
    metric: Metric.CollectFctEnum | string;
    normalize: boolean;
}

export interface SourcesAgg {
    agg: Aggregation;
    sources: Array<string>;
}

export interface SourcesSearch {
    search: Search;
    sources: Array<string>;
}
