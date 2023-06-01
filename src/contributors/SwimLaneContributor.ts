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

import {
    Collaboration,
    CollaborationEvent,
    CollaborativesearchService,
    ConfigService,
    Contributor,
    OperationEnum,
    projType
} from 'arlas-web-core';
import { Observable, from } from 'rxjs';
import { map, flatMap } from 'rxjs/operators';

import { Aggregation, AggregationResponse, ComputationRequest, ComputationResponse, Filter, Expression } from 'arlas-api';
import { getAggregationPrecision } from '../utils/histoswimUtils';
import jsonSchema from '../jsonSchemas/swimlaneContributorConf.schema.json';
import jp from 'jsonpath/jsonpath.min';

export interface LaneStats {
    min?: number;
    max?: number;
    sum?: number;
    count?: number;
}

export interface SwimlaneStats {
    /** stats for each bucket (column) */
    columnStats: Map<number, LaneStats>;
    /** stats for all all the swimlane */
    globalStats: LaneStats;
    /** number of terms */
    nbLanes?: number;
    /** min value of the bucket key */
    minBorder?: number;
    /** max value of the bucket key */
    maxBorder?: number;
    /** bucket interval */
    bucketLength?: number;
}

export interface SwimlaneData {
    stats: SwimlaneStats;
    lanes: Map<string, Array<{ key: number; value: number; }>>;
}


export class SwimLaneContributor extends Contributor {
    /**
     * Swimlane data has
     * - lanes: a map of
     *      - The keys represent the lanes keywords.
     *      - The value of a lane is a histogram represented as an array.
     * - stats: stats summerizing the swimlane data
     */
    public swimData: SwimlaneData;

    /**
     * selectedSwimlanes is the list of selected terms (lanes) in the swimlane.
     */
    public selectedSwimlanes: Set<string>;

    /**
     * The range of data that this contributor fetches.
     */
    public range: ComputationResponse;

    /**
     * List of aggregation models used to fetch data
     */
    public aggregations: Aggregation[] = this.getSwimlaneAggregations();
    /**
    * Json path to explore element aggregation, count by default
    */
    public json_path: string;
    /**
    * Number of buckets in the swimlane. If not specified, the interval in the aggregagtion model is used instead.
    */
    private nbBuckets: number = this.getConfigValue('numberOfBuckets');
    /**
    * Wether use UTC for display time
    */
    public useUtc = this.getConfigValue('useUtc') !== undefined ? this.getConfigValue('useUtc') : true;

    private INVALID_AGGREGATIONS_MESSAGE =
        '`aggregationmodels` should contain 2 bucket aggregations. The first one should be a `term` aggregation. '
        + 'The second one should be a `histogram` OR `datehistogram` aggregation.';
    private INVALID_SWIMLANES_MESSAGE = '`swimlanes` property is mandatory and should contain at least one item.';

    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    public constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService, collection: string, private isOneDimension?: boolean
    ) {
        super(identifier, configService, collaborativeSearcheService, collection);
        this.collections = [];
        this.collections.push({
            collectionName: collection
        });
        if (this.getConfigValue('swimlanes')[0]['jsonpath'] !== undefined) {
            this.json_path = this.getConfigValue('swimlanes')[0]['jsonpath'];
        } else {
            this.json_path = '$.count';
        }
    }
    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    public isUpdateEnabledOnOwnCollaboration() {
        return false;
    }

    /**
     * Set filter on value change, used in output of component
     * @param selectedSwimlanes List of selected lanes of the swimlane
     */
    public valueChanged(selectedSwimlanes: Set<string>) {
        const filterValue: Filter = { f: [] };
        const equalExpression: Expression = {
            field: this.getTermField(),
            op: Expression.OpEnum.Eq,
            value: ''
        };
        if (selectedSwimlanes.size > 0) {
            selectedSwimlanes.forEach(selectedLane => {
                equalExpression.value += selectedLane + ',';
            });
            equalExpression.value = equalExpression.value.substring(0, equalExpression.value.length - 1);
            filterValue.f.push([equalExpression]);
            const collabFilters = new Map<string, Filter[]>();
            collabFilters.set(this.collection, [filterValue]);
            const collaboration: Collaboration = {
                filters: collabFilters,
                enabled: true
            };
            this.collaborativeSearcheService.setFilter(this.identifier, collaboration);
        } else {
            this.collaborativeSearcheService.removeFilter(this.identifier);
        }
        this.selectedSwimlanes = selectedSwimlanes;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<AggregationResponse> {
        this.checkAggregations();
        const collaborations = new Map<string, Collaboration>();
        this.collaborativeSearcheService.collaborations.forEach((k, v) => {
            collaborations.set(v, k);
        });
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            if (this.nbBuckets) {
                return (this.collaborativeSearcheService.resolveButNotComputation([projType.compute,
                <ComputationRequest>{ filter: null, field: this.getXAxisField(), metric: ComputationRequest.MetricEnum.SPANNING }],
                    collaborations, this.collection, this.identifier, {}, false, this.cacheDuration)
                    .pipe(
                        map((computationResponse: ComputationResponse) => {
                            const dataRange = !!computationResponse.value ? computationResponse.value : 0;
                            this.range = !!computationResponse.value ? computationResponse : null;
                            this.aggregations[1].interval = getAggregationPrecision(this.nbBuckets, dataRange, this.aggregations[1].type);
                        }),
                        flatMap(() =>
                            this.collaborativeSearcheService.resolveButNotAggregation(
                                [projType.aggregate, this.aggregations], collaborations,
                                this.collection, this.identifier, {}, false, this.cacheDuration)
                        )
                    )
                );
            } else {
                return this.collaborativeSearcheService.resolveButNotAggregation(
                    [projType.aggregate, this.aggregations], this.collaborativeSearcheService.collaborations,
                    this.collection, this.identifier, {}, false, this.cacheDuration);
            }
        } else {
            return from([]);
        }
    }

    public computeData(aggResponse: AggregationResponse): SwimlaneData {
        const mapResponse = new Map<string, Array<{ key: number; value: number; }>>();
        const responseStats: SwimlaneStats = {
            columnStats: new Map<number, LaneStats>(),
            globalStats: {
                /** the min is placed at the greatest number at first to be replaced step by step by the min value in data */
                min: Number.MAX_VALUE,
                /** the max is placed at the lowest number at first to be replaced step by step by the max value in data */
                max: -Number.MAX_VALUE,
                sum: 0,
                count: 0
            },
            nbLanes: 0
        };
        if (aggResponse.elements !== undefined) {
            aggResponse.elements.forEach(element => {
                const key = element.key;
                const dataTab = new Array<{ key: number; value: number; }>();
                responseStats.nbLanes++;
                element.elements.forEach(e => {
                    e.elements.forEach(el => {
                        const value = jp.query(el, this.json_path)[0];
                        dataTab.push({ key: el.key, value: value });
                        this.updateStats(responseStats, +el.key, value);
                    });
                });
                mapResponse.set(key, dataTab);
            });
            const keys = Array.from(responseStats.columnStats.keys()).sort((a, b) => a - b);
            responseStats.minBorder = keys[0];
            responseStats.maxBorder = keys[keys.length - 1];
            if (keys.length > 1) {
                responseStats.bucketLength = keys[1] - keys[0];
            }
            this.fillBlanks(mapResponse, keys);
        }
        const swimlaneData: SwimlaneData = {
            stats: responseStats,
            lanes: mapResponse
        };
        return swimlaneData;
    }

    public setData(data: SwimlaneData): SwimlaneData {
        this.swimData = data;
        return this.swimData;
    }

    public setSelection(data: SwimlaneData, collaboration: Collaboration): any {
        if (collaboration) {
            let f: Filter;
            if (collaboration.filters && collaboration.filters.get(this.collection)) {
                f = collaboration.filters.get(this.collection)[0];
            }
            if (!f) {
                this.selectedSwimlanes = new Set();
            } else {
                const selectedSwimlanesAsArray = f.f[0];
                this.selectedSwimlanes = new Set();
                selectedSwimlanesAsArray.forEach(termsList => {
                    termsList.value.split(',').forEach(term => {
                        this.selectedSwimlanes.add(term);
                    });
                });
            }
        } else {
            this.selectedSwimlanes = new Set();
        }
        return from([]);

    }

    public getPackageName(): string {
        return 'arlas.web.contributors.swimlane';
    }

    public getFilterDisplayName(): string {
        const displayName = this.getConfigValue('name');
        return displayName ? displayName : 'Swimlane';
    }

    private checkAggregations(): void {
        if (!this.aggregations || this.aggregations.length < 2) {
            console.error(this.INVALID_AGGREGATIONS_MESSAGE);
            throw new Error(this.INVALID_AGGREGATIONS_MESSAGE);
        } else {
            if (this.aggregations[0].type !== Aggregation.TypeEnum.Term ||
                (this.aggregations[1].type !== Aggregation.TypeEnum.Datehistogram &&
                    this.aggregations[1].type !== Aggregation.TypeEnum.Histogram)) {
                console.error(this.INVALID_AGGREGATIONS_MESSAGE);
                throw new Error(this.INVALID_AGGREGATIONS_MESSAGE);
            }
        }
    }

    private getSwimlaneAggregations(): any {
        const swimlanes = this.getConfigValue('swimlanes');
        if (swimlanes && swimlanes.length > 0) {
            return swimlanes[0]['aggregationmodels'];
        } else {
            console.error(this.INVALID_SWIMLANES_MESSAGE);
            throw new Error(this.INVALID_SWIMLANES_MESSAGE);
        }
    }

    private getTermField(): string {
        if (this.aggregations && this.aggregations.length > 1) {
            return this.aggregations[0].field;
        }
        return '';
    }

    private getXAxisField(): string {
        if (this.aggregations && this.aggregations.length > 1) {
            return this.aggregations[1].field;
        }
        return '';
    }

    private fillBlanks(mapResponse: Map<string, Array<{ key: number; value: number; }>>, keys: Array<number>): void {
        mapResponse.forEach((v, k) => {
            const minV = v[0].key;
            const maxV = v[v.length - 1].key;
            if (minV > keys[0]) {
                const upstreamBlanks = keys.filter(n => n < minV).reverse();
                upstreamBlanks.forEach(c => {
                    v.unshift({ key: c, value: 0 });
                });
            }
            if (maxV < keys[keys.length - 1]) {
                const downstramBlanks = keys.filter(n => n > maxV);
                downstramBlanks.forEach(c => {
                    v.push({ key: c, value: 0 });
                });
            }
        });
    }

    private updateStats(stat: SwimlaneStats, key: number, value: number): void {
        const columnStat = stat.columnStats.get(key);
        const isValueValid = this.isValueValid(value);
        if (!columnStat) {
            const stats = {
                max: isValueValid ? value : -Number.MAX_VALUE,
                min: isValueValid ? value : Number.MAX_VALUE,
                sum: isValueValid ? value : 0
            };
            stat.columnStats.set(key, stats);
        } else {
            if (isValueValid) {
                if (value < columnStat.min) {
                    columnStat.min = value;
                }
                if (value > columnStat.max) {
                    columnStat.max = value;
                }
                columnStat.sum += value;
            }
            stat.columnStats.set(key, columnStat);
        }
        if (isValueValid) {
            if (value < stat.globalStats.min) {
                stat.globalStats.min = value;
            }
            if (value > stat.globalStats.max) {
                stat.globalStats.max = value;
            }
            stat.globalStats.sum += value;
            stat.globalStats.count++;
        }
    }

    private isValueValid(value: number): boolean {
        return value !== undefined ? !Number.isNaN(Number(value)) && !(value + '' === 'Infinity') && !(value + '' === '-Infinity') : false;
    }
}
