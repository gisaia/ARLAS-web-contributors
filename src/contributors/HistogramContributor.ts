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

import { Observable, from } from 'rxjs';
import {
    Collaboration,
    CollaborativesearchService,
    ConfigService,
    Contributor,
    OperationEnum,
    projType, CollaborationEvent
} from 'arlas-web-core';
import { Filter, Aggregation, AggregationResponse, RangeResponse, RangeRequest} from 'arlas-api';
import { SelectedOutputValues, StringifiedTimeShortcut } from '../models/models';
import { getSelectionToSet, getvaluesChanged, getAggregationPrecision } from '../utils/histoswimUtils';
import jsonSchema from '../jsonSchemas/histogramContributorConf.schema.json';
import { getPredefinedTimeShortcuts } from '../utils/timeShortcutsUtils';
import jp from 'jsonpath/jsonpath.min';
import { map, flatMap } from 'rxjs/operators';

/**
* This contributor works with the Angular HistogramComponent of the Arlas-web-components project.
* This class make the brigde between the component which displays the data and the
* collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
*/
export class HistogramContributor extends Contributor {
    /**
    * New data need to be draw on the histogram (could be set to
    @Input() data of HistogramComponent
    */
    public chartData: Array<{ key: number, value: number }> = new Array<{ key: number, value: number }>();
    /**
    * New selection current need to be draw on the histogram (could be set to
    @Input() intervalSelection of HistogramComponent
    */
    public intervalSelection: SelectedOutputValues;
    /**
    * New selections need to be draw on the histogram (could be set to
    @Input() intervalSelection of HistogramComponent
    */
    public intervalListSelection: SelectedOutputValues[] = [];

    /**
    * List of all the predefined time shortcuts
    */
    public timeShortcuts: Array<StringifiedTimeShortcut>;

    /**
     * List of shortcuts labels to fetch from the predefined time shortcuts list
     */
    public timeShortcutsLabels: Array<string> = this.getConfigValue('timeShortcuts');

    /**
     * Histogram's range
    */
    public range: RangeResponse;
    /**
    * ARLAS Server Aggregation used to draw the chart, define in configuration
    */
    protected aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    /**
    * Json path to explore element aggregation, count by default
    */
    private json_path: string = this.getConfigValue('jsonpath') !== undefined ? this.getConfigValue('jsonpath') : '$.count';
    /**
    * Number of buckets in the histogram. If not specified, the interval in the aggregagtion model is used instead.
    */
    protected nbBuckets: number = this.getConfigValue('numberOfBuckets');
    /**
    * ARLAS Server field of aggregation used to draw the chart, retrieve from Aggregation
    */
    protected field: string = (this.aggregations !== undefined) ? (this.aggregations[this.aggregations.length - 1].field) : (undefined);
    /**
    * Start value of selection use to the display of filterDisplayName
    */
    protected startValue: string;
    /**
    * End value of selection use to the display of filterDisplayName
    */
    protected endValue: string;
    /**
    * Max value of all bucketn use for oneDimension histogram palette
    */
    protected maxValue = 0;
    /**
    * Labels of the timelines
    */
    public timeLabel;
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService, protected isOneDimension?: boolean
    ) {
        super(identifier, configService, collaborativeSearcheService);
        const lastAggregation: Aggregation = this.aggregations[this.aggregations.length - 1];
        if (lastAggregation.type.toString().toLocaleLowerCase() === Aggregation.TypeEnum.Datehistogram.toString().toLocaleLowerCase()) {
            this.timeShortcuts = getPredefinedTimeShortcuts();
            if (this.timeShortcutsLabels) {
                this.timeShortcuts = this.timeShortcuts.filter(s => this.timeShortcutsLabels.indexOf(s.label) >= 0);
            }
        }

    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    /**
    * @returns Pretty name of contribution based on startValue/endValue properties
    */
    public getFilterDisplayName(): string {
        let displayName = '';
        const name = this.getConfigValue('name');
        const lastAggregation: Aggregation = this.aggregations[this.aggregations.length - 1];
        if (lastAggregation.type.toString().toLocaleLowerCase() === Aggregation.TypeEnum.Datehistogram.toString().toLocaleLowerCase()) {
            displayName = 'Timeline';
        } else if (lastAggregation.type.toString().toLocaleLowerCase() === Aggregation.TypeEnum.Histogram.toString().toLocaleLowerCase()) {
            displayName = this.startValue + ' <= ' + name + ' <= ' + this.endValue;
        } else {
            displayName = name;
        }
        return displayName;
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.histogram';
    }
    /**
    * Set filter on value change, use in output of component
    * @param value DateType.millisecond | DateType.second
    */
    public valueChanged(values: SelectedOutputValues[]) {
        const resultList = getvaluesChanged(values, this.field, this.identifier, this.collaborativeSearcheService);
        this.intervalSelection = resultList[0];
        this.startValue = resultList[1];
        this.endValue = resultList[2];
        this.timeLabel = this.getShortcutLabel(this.intervalSelection, this.startValue, this.endValue);
    }

    public getShortcutLabel(intervalSelection: SelectedOutputValues, startValue: string, endValue: string): string {
        if (this.timeShortcuts) {
            const labels = this.timeShortcuts.filter(t => (t.from === startValue) && (t.to === endValue)).map(t => t.label);
            if (labels.length === 1) {
                return labels[0];
            } else {
                if (intervalSelection) {
                    const start = +intervalSelection.startvalue;
                    const end = +intervalSelection.endvalue;
                    return start + ' to ' + end;
                } else {
                    return '';
                }
            }
        } else {
            return '';
        }
    }

    public fetchData(collaborationEvent?: CollaborationEvent): Observable<AggregationResponse> {
        this.maxValue = 0;
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return this.fetchDataGivenFilter(this.identifier);
        } else {
            return from([]);
        }
    }

    public computeData(aggResponse: AggregationResponse): Array<{ key: number, value: number }> {
        const dataTab = new Array<{ key: number, value: number }>();
        if (aggResponse.elements !== undefined) {
            aggResponse.elements.forEach(element => {
                const value = jp.query(element, this.json_path)[0];
                if (this.maxValue <= value) {
                    this.maxValue = value;
                }
                dataTab.push({ key: element.key, value: value });
            });
        }
        return dataTab;
    }

    public setData(data: Array<{ key: number, value: number }>): Array<{ key: number, value: number }> {
        if (!this.isOneDimension || this.isOneDimension === undefined) {
            this.chartData = data;
        } else {
            data.forEach(obj => {
                obj.value = obj.value / this.maxValue;
            });
            this.chartData = data;
        }
        return this.chartData;
    }

    public setSelection(data: Array<{ key: number, value: number }>, collaboration: Collaboration): any {
        const resultList = getSelectionToSet(data, collaboration);
        this.intervalListSelection = resultList[0];
        this.intervalSelection = resultList[1];
        this.startValue = resultList[2];
        this.endValue = resultList[3];
        this.timeLabel = this.getShortcutLabel(this.intervalSelection, this.startValue, this.endValue);
        return from([]);

    }

    protected fetchDataGivenFilter(identifier: string, additionalFilter?: Filter): Observable<AggregationResponse> {
        const collaborations = new Map<string, Collaboration>();
        this.collaborativeSearcheService.collaborations.forEach((k, v) => { collaborations.set(v, k); });
        if (this.nbBuckets) {
            const agg = this.collaborativeSearcheService.resolveButNotFieldRange([projType.range,
            <RangeRequest>{ filter: null, field: this.field }], collaborations, identifier, additionalFilter)
                .pipe(
                    map((rangeResponse: RangeResponse) => {
                        const dataRange = (rangeResponse.min !== undefined && rangeResponse.max !== undefined) ?
                            (rangeResponse.max - rangeResponse.min) : 0;
                        const range = (rangeResponse.min !== undefined && rangeResponse.max !== undefined) ? rangeResponse : null;
                        const aggregationPrecision = getAggregationPrecision(this.nbBuckets, dataRange, this.aggregations[0].type);
                        const result = {
                            range: range,
                            aggregationPrecision: aggregationPrecision
                        };
                        return result;
                    }),
                    map((r => {
                        this.range = r.range;
                        this.aggregations[0].interval = r.aggregationPrecision;
                        return this.collaborativeSearcheService.resolveButNotAggregation(
                            [projType.aggregate, this.aggregations], collaborations,
                            identifier, additionalFilter);
                    }
                    )),
                    flatMap(a => a)
                );

            return agg;

        } else {
            return this.collaborativeSearcheService.resolveButNotAggregation(
                [projType.aggregate, this.aggregations], collaborations,
                identifier, additionalFilter);
        }
    }
}
