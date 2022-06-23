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

import { Observable, from, zip, Subject } from 'rxjs';
import {
    Collaboration,
    CollaborativesearchService,
    ConfigService,
    Contributor,
    OperationEnum,
    projType, CollaborationEvent
} from 'arlas-web-core';
import { Filter, Aggregation, AggregationResponse, ComputationRequest, ComputationResponse, Interval } from 'arlas-api';
import { SelectedOutputValues, StringifiedTimeShortcut } from '../models/models';
import { getSelectionToSet, getvaluesChanged, getAggregationPrecision, adjustHistogramInterval } from '../utils/histoswimUtils';
import jsonSchema from '../jsonSchemas/histogramContributorConf.schema.json';
import { getPredefinedTimeShortcuts } from '../utils/timeShortcutsUtils';
import jp from 'jsonpath/jsonpath.min';
import { map, flatMap, filter } from 'rxjs/operators';
import { CollectionAggField } from 'arlas-web-core/utils/utils';

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
    public chartData: Array<{ key: number, value: number, chartId?: string }> =
        new Array<{ key: number, value: number, chartId?: string }>();

    public chartDataEvent: Subject<{ key: number, value: number, chartId?: string }[]> = new Subject();
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
     * List of years shortcuts labels
     */
    public yearShortcutsLabels: Array<string> = this.getConfigValue('yearShortcuts');

    /**
     * Histogram's range
    */
    public range: number;
    /**
    * ARLAS Server Aggregation used to draw the chart, define in configuration
    */
    protected aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    /**
    * Json path to explore element aggregation, count by default
    */
    protected json_path: string = this.getConfigValue('jsonpath') !== undefined ? this.getConfigValue('jsonpath') : '$.count';
    /**
    * Number of buckets in the histogram. If not specified, the interval in the aggregagtion model is used instead.
    */
    protected nbBuckets: number = this.getConfigValue('numberOfBuckets');
    /**
    * ARLAS Server field of aggregation used to draw the chart, retrieve from Aggregation
    */
    protected field: string = (!!this.aggregations) ? (this.aggregations[this.aggregations.length - 1].field) : (undefined);
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
    * Wether use UTC for display time
    */
    public useUtc = this.getConfigValue('useUtc') !== undefined ? this.getConfigValue('useUtc') : true;

    /** to be set in the toolkit when creating the contributor */
    public maxBuckets = 200;
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService, collection: string, protected isOneDimension?: boolean,
        public additionalCollections?: Array<{ collectionName: string, field: string }>
    ) {
        super(identifier, configService, collaborativeSearcheService, collection);
        const lastAggregation: Aggregation = !!this.aggregations ? this.aggregations[this.aggregations.length - 1] : undefined;
        if (!!lastAggregation && lastAggregation.type.toString().toLocaleLowerCase() ===
            Aggregation.TypeEnum.Datehistogram.toString().toLocaleLowerCase()) {
            this.timeShortcuts = getPredefinedTimeShortcuts()
                .filter(ts => ts.type.indexOf('year') < 0);
            if (this.timeShortcutsLabels) {
                this.timeShortcuts = getPredefinedTimeShortcuts()
                    .filter(s => this.timeShortcutsLabels.indexOf(s.label) >= 0);
            }
            if (this.yearShortcutsLabels) {
                this.timeShortcuts = this.timeShortcuts
                    .concat(getPredefinedTimeShortcuts()
                        .filter(s => this.yearShortcutsLabels.indexOf(s.label) >= 0));
            }
        }
        this.collections = this.getAllCollections();
        this.collaborativeSearcheService.registerCollections(this);
    }

    public getNbBuckets() {
        return this.nbBuckets;
    }

    public setNbBuckets(nbBuckets: number): void {
        this.nbBuckets = nbBuckets;
    }

    public getField() {
        return this.field;
    }

    public setField(field) {
        this.field = field;
    }

    public getJsonPath() {
        return this.json_path;
    }

    public getAggregations() {
        const aggregations: Aggregation[] = [];
        /** clone the aggregations to avoid side effects by external code */
        if (!!this.aggregations) {
            this.aggregations.forEach(agg => {
                let interval;
                const aggregation: Aggregation = {
                    type: agg.type,
                    field: agg.field,
                    metrics: agg.metrics
                };
                if (!!agg.interval) {
                    interval = {
                        value: agg.interval.value
                    };
                    if (agg.interval.unit !== undefined && agg.interval.unit !== null) {
                        interval.unit = agg.interval.unit;
                    }
                    aggregation.interval = interval;
                }
                aggregations.push(aggregation);
            });
        }
        return aggregations;
    }

    public setAggregations(aggregations: Array<Aggregation>) {
        this.aggregations = aggregations;
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
     * Triggers the collaboration of this contributor on the given intervals and for the given collections
     * @param values List of selected intervals in the histogram
     * @param collections List of collections to declare in the collaboration. This list should be a subset of
     * collections declared in this contributor.
     */
    public valueChanged(values: SelectedOutputValues[], collections?: CollectionAggField[]) {
        if (collections) {
            const paramCollections = collections.map(c => c.collectionName);
            const allCollectionsSet = new Set(this.getAllCollections().map(c => c.collectionName));
            /** collections given as parameters should be in the `allCollections` list, otherwise an error is thrown */
            const strangerCollections = paramCollections.filter(c => !allCollectionsSet.has(c));
            if (strangerCollections.length > 0) {
                const is = strangerCollections.length > 1 ? 'are' : 'is';
                const plural = strangerCollections.length > 1 ? 's' : '';
                throw Error(`Collection${plural} '${strangerCollections.join(' ')}'
                    ${is} not declared in the ${this.getName()} contributor `);
            }

        }
        if (!collections) {
            collections = this.getAllCollections();
        }
        const resultList = getvaluesChanged(values, collections, this.identifier, this.collaborativeSearcheService, this.useUtc);
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

    public fetchData(collaborationEvent?: CollaborationEvent): Observable<AggregationResponse[]> {
        this.maxValue = 0;
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return this.fetchDataGivenFilter(this.identifier);
        } else {
            return from([]);
        }
    }


    public getAllCollections() {
        return (!!this.additionalCollections ? this.additionalCollections : []).concat({
            collectionName: this.collection,
            field: this.field
          });
    }

    public computeData(aggResponses: AggregationResponse[]): Array<{ key: number, value: number, chartId: string }> {
        const dataTab = new Array<{ key: number, value: number, chartId: string }>();
        aggResponses.forEach(aggResponse => {
            if (aggResponse.elements !== undefined) {
                aggResponse.elements.forEach(element => {
                    const value = jp.query(element, this.json_path)[0];
                    if (this.maxValue <= value) {
                        this.maxValue = value;
                    }
                    dataTab.push({ key: element.key, value: value, chartId: aggResponse['collection'] });
                });
            }
        });

        return dataTab.sort((a, b) => a.key < b.key ? -1 : (a.key > b.key ? 1 : 0));
    }

    public setData(data: Array<{ key: number, value: number, chartId?: string }>): Array<{ key: number, value: number, chartId?: string }> {
        if (!this.isOneDimension || this.isOneDimension === undefined) {
            this.chartData = data;
        } else {
            data.forEach(obj => {
                obj.value = obj.value / this.maxValue;
            });
            this.chartData = data;
        }

        if (this.nbBuckets === undefined && !!data && data.length > 1) {
            this.range = (+data[data.length - 1].key - +data[0].key);
        }

        this.chartDataEvent.next(this.chartData);
        return this.chartData;
    }

    public setSelection(data: Array<{ key: number, value: number, chartId?: string }>, collaboration: Collaboration): any {
        const resultList = getSelectionToSet(data, this.collection, collaboration, this.useUtc);
        this.intervalListSelection = resultList[0];
        this.intervalSelection = resultList[1];
        this.startValue = resultList[2];
        this.endValue = resultList[3];
        this.timeLabel = this.getShortcutLabel(this.intervalSelection, this.startValue, this.endValue);
        return from([]);
    }

    protected fetchDataGivenFilter(identifier: string, additionalFilters?: Map<string, Filter>): Observable<AggregationResponse[]> {
        const collaborations = new Map<string, Collaboration>();
        this.collaborativeSearcheService.collaborations.forEach((k, v) => { collaborations.set(v, k); });
        const aggregations = this.aggregations;
        /** We calculate the range all the time */
        const agg = zip(...Array.from(this.collections)
                    .map(ac => {
                        const additionalFilter = !!additionalFilters ? additionalFilters.get(ac.collectionName) : undefined;
                        return this.collaborativeSearcheService.resolveButNotComputation([projType.compute,
                    <ComputationRequest>{ filter: null, field: ac.field, metric: ComputationRequest.MetricEnum.SPANNING }],
                        collaborations, ac.collectionName, identifier, additionalFilter, false, this.cacheDuration); }))
                    .pipe(
                        map((computationResponses: ComputationResponse[]) => {
                            const dataRange = Math.max(...computationResponses.map(d => (!!d.value) ? d.value : 0));
                            let histogramInterval;
                            /** if nbBuckets is defined, we calculate the needed bucket interval to obtain this number. */
                            if (this.nbBuckets) {
                                histogramInterval = getAggregationPrecision(this.nbBuckets, dataRange, this.aggregations[0].type);
                            } else {
                                /** Otherwise we use the interval; that we adjust in case it generates more than `maxBuckets` buckets */
                                const initialInterval = aggregations[0].interval;
                                histogramInterval = adjustHistogramInterval(this.aggregations[0].type,
                                     this.maxBuckets, initialInterval, dataRange);
                            }
                            const result = {
                                dataRange,
                                aggregationPrecision: histogramInterval
                            };
                            return result;
                        }),
                        map((r => {
                            this.range = r.dataRange;
                            const aggregation: Aggregation = {
                                type: aggregations[0].type,
                                interval:  r.aggregationPrecision
                            };
                            return zip(...Array.from(this.collections).map(ac => {
                                aggregation.field = ac.field;
                                const additionalFilter = !!additionalFilters ? additionalFilters.get(ac.collectionName) : undefined;
                                return this.resolveHistogramAgg(identifier, [aggregation], collaborations, additionalFilter, ac);
                            }));
                        })),
                        flatMap(a => a)
                    );

                return agg;
    }

    protected resolveHistogramAgg(identifier: string, aggregations: Array<Aggregation>, collaborations: Map<string, Collaboration>,
        additionalFilter: Filter, ac: CollectionAggField): Observable<AggregationResponse> {
        return this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, aggregations], collaborations,
            ac.collectionName, identifier, additionalFilter, false, this.cacheDuration).pipe(map(d => {
                d['collection'] = ac.collectionName;
                return d;
            }));
    }

}
