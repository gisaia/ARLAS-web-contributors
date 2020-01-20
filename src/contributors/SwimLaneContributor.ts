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

import { Aggregation, AggregationResponse, RangeResponse, RangeRequest, Filter, Expression } from 'arlas-api';
import { getAggregationPrecision } from '../utils/histoswimUtils';
import jsonSchema from '../jsonSchemas/swimlaneContributorConf.schema.json';
import jp from 'jsonpath/jsonpath.min';



export class SwimLaneContributor extends Contributor {
    /**
    * New data need to be draw in the swimlane (could be set to
    @Input() data of Swimlane Component
    */
    public swimData: Map<string, Array<{ key: number, value: number }>> = new Map<string, Array<{ key: number, value: number }>>();

    /**
     * selectedSwimlanes is the list of selected terms in the swimlane.
     */
    public selectedSwimlanes: Set<string>;

    /**
     * The range of data that this contributor fetches.
     */
    public range: RangeResponse;

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

    private INVALID_AGGREGATIONS_MESSAGE = '`aggregationmodels` should contain 2 bucket aggregations. The first one should be a `term` aggregation. The second one should be a `histogram` OR `datehistogram` aggregation.';
    private INVALID_SWIMLANES_MESSAGE = '`swimlanes` property is mandatory and should contain at least one item.';

    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService, private isOneDimension?: boolean
    ) {
        super(identifier, configService, collaborativeSearcheService);
        if (this.getConfigValue('swimlanes')[0]['jsonpath'] !== undefined) {
            this.json_path = this.getConfigValue('swimlanes')[0]['jsonpath'];
        } else {
            this.json_path = '$.count';
        }
    }
    public static getJsonSchema(): Object {
        return jsonSchema;
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
            const collaboration: Collaboration = {
                filter: filterValue,
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
        this.collaborativeSearcheService.collaborations.forEach((k, v) => { collaborations.set(v, k); });
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            if (this.nbBuckets) {
                return (this.collaborativeSearcheService.resolveButNotFieldRange([projType.range,
                <RangeRequest>{ filter: null, field: this.getXAxisField() }], collaborations, this.identifier
                , {}, false, this.cacheDuration)
                    .pipe(
                        map((rangeResponse: RangeResponse) => {
                            const dataRange = (rangeResponse.min !== undefined && rangeResponse.max !== undefined) ?
                                (rangeResponse.max - rangeResponse.min) : 0;
                            this.range = (rangeResponse.min !== undefined && rangeResponse.max !== undefined) ? rangeResponse : null;
                            this.aggregations[1].interval = getAggregationPrecision(this.nbBuckets, dataRange, this.aggregations[1].type);
                        }),
                        flatMap(() =>
                            this.collaborativeSearcheService.resolveButNotAggregation(
                                [projType.aggregate, this.aggregations], collaborations,
                                this.identifier, {}, false, this.cacheDuration)
                        )
                    )
                );
            } else {
                return this.collaborativeSearcheService.resolveButNotAggregation(
                    [projType.aggregate, this.aggregations], this.collaborativeSearcheService.collaborations,
                    this.identifier, {}, false, this.cacheDuration);
            }
        } else {
            return from([]);
        }
    }

    public computeData(aggResponse: AggregationResponse): Map<string, Array<{ key: number, value: number }>> {
        const mapResponse = new Map<string, Array<{ key: number, value: number }>>();
        if (aggResponse.elements !== undefined) {
            aggResponse.elements.forEach(element => {
                const key = element.key;
                const dataTab = new Array<{ key: number, value: number }>();
                element.elements.forEach(e => {
                    e.elements.forEach(el => {
                        const value = jp.query(el, this.json_path)[0];
                        dataTab.push({ key: el.key, value: value });
                    });
                });
                mapResponse.set(key, dataTab);
            });
        }
        return mapResponse;
    }

    public setData(data: any): Map<string, Array<{ key: number, value: number }>> {
        this.swimData = data;
        return this.swimData;
    }

    public setSelection(data: Map<string, Array<{ key: number, value: number }>>, collaboration: Collaboration): any {
        if (collaboration) {
            const f = collaboration.filter;
            if (f === null) {
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
                     this.aggregations[1].type !== Aggregation.TypeEnum.Histogram) ) {
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
}
