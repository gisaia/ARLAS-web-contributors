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
    Contributor, CollaborationEvent, Collaboration, projType, OperationEnum,
    CollaborativesearchService, ConfigService
} from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Aggregation, AggregationResponse, Filter, Expression } from 'arlas-api';
import { DonutArc, SelectionTree } from '../models/models';
import * as jsonSchema from '../jsonSchemas/donutContributorConf.schema.json';



export class DonutContributor extends Contributor {

    /**
     * Title given to the aggregation result
     */
    public title: string;
    /**
     * Data retrieved from ARLAS-server response and to be returned for the donut component as an input
     */
    public donutData: DonutArc;
    /**
     * The minimum ratio of the arc in its ring needed to be plot. Otherwise the arc is considered as OTHER
     */
    public arcMinPourcentage = 0.04;
    /**
     * List of selected nodes to be returned to the donut component as an input
     */
    public selectedArcsList: Array<Array<{ ringName: string, name: string }>> =
        new Array<Array<{ ringName: string, name: string }>>();
    /**
     * ARLAS Server Aggregation used to draw the donut, defined in configuration
     */
    private aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    /**
     * List of selected nodes returned from the donut component
     */
    private componentSelectedArcsList: Array<Array<{ ringName: string, name: string }>> =
        new Array<Array<{ ringName: string, name: string }>>();

    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        title: string

    ) {
        super(identifier, configService, collaborativeSearcheService);
        this.title = title;
    }

    /**
    * @returns Json schema for configuration.
    */
    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.donut';
    }

    public getFilterDisplayName(): string {
        return this.title;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<any> {
        const aggregationObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, this.aggregations], this.collaborativeSearcheService.collaborations,
            this.identifier
        );
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return aggregationObservable;
        } else {
            return Observable.from([]);
        }
    }

    public computeData(aggregationResonse: AggregationResponse): DonutArc {
        const donutArc: DonutArc = { id: 'root', name: 'root', ringName: 'root', isOther: false, children: [] };
        this.populateChildren(donutArc, aggregationResonse, 0);
        return donutArc;
    }

    public setData(data: DonutArc): DonutArc {
        this.donutData = data;
        return data;
    }

    public setSelection(data: DonutArc, collaboration: Collaboration): any {
        if (collaboration) {
            const filter = collaboration.filter;
            if (filter === null) {
                this.selectedArcsList = new Array<Array<{ ringName: string, name: string }>>();
            } else {
                this.selectedArcsList = new Array<Array<{ ringName: string, name: string }>>();
                const fFilters = filter.f;
                const fieldsList = [];
                const mapFiledValues = new Map<string, Set<string>>();
                fFilters.forEach(fFilter => {
                    const values = fFilter[0].value.split(',');
                    const valuesAsSet = new Set<string>();
                    values.forEach(v => valuesAsSet.add(v));
                    mapFiledValues.set(fFilter[0].field, valuesAsSet);
                    fieldsList.push(fFilter[0].field);
                });
                fieldsList.reverse();
                const node: SelectionTree = { field: 'root', value: 'root', children: [] };
                const lastChildren = [];
                this.builtSelectionTree(fieldsList[0], node, mapFiledValues, fieldsList, lastChildren);
                lastChildren.forEach(lastNode => {
                    this.selectedArcsList.push(this.getNodeAsArray(lastNode));
                });
                // ADD THE HIGHER SELECTED NODES TO selectedArcsList
                let depth = 0;
                this.selectedArcsList.forEach(function (nodePath) {
                    if (nodePath.length > depth) {
                        depth = nodePath.length;
                    }
                });
                this.componentSelectedArcsList.forEach(arc => {
                    if (arc.length < depth) {
                        this.selectedArcsList.push(arc);
                    }
                });
            }
        } else {
            this.selectedArcsList = new Array<Array<{ ringName: string, name: string }>>();
        }
        return Observable.from([]);
    }

    public selectedArcsListChanged(selectedArcsList: Array<Array<{ ringName: string, name: string }>>): void {
        this.componentSelectedArcsList = selectedArcsList;
        if (selectedArcsList.length > 0) {
            const filter: Filter = { f: [] };
            this.aggregations.forEach(aggregation => {
                const equalExpression: Expression = {
                    field: aggregation.field,
                    op: Expression.OpEnum.Eq,
                    value: ''
                };
                const valuesSet = new Set<string>();
                selectedArcsList.forEach(arcPath => {
                    arcPath.every(arc => {
                        if (arc.ringName === aggregation.field) {
                            valuesSet.add(arc.name);
                        }
                        return arc.ringName !== aggregation.field;
                    });
                });
                valuesSet.forEach(value => {
                    equalExpression.value += value + ',';
                });
                if (equalExpression.value !== '') {
                    equalExpression.value = equalExpression.value.substring(0, equalExpression.value.length - 1);
                    filter.f.push([equalExpression]);
                }
            });
            const collaboration: Collaboration = {
                filter: filter,
                enabled: true
            };
            this.collaborativeSearcheService.setFilter(this.identifier, collaboration);
        } else {
            this.collaborativeSearcheService.removeFilter(this.identifier);
        }
    }

    private builtSelectionTree(field: string, node: SelectionTree, mapFiledValues: Map<string, Set<string>>,
        fieldsList: Array<string>, lastChildren: SelectionTree[]): void {
        mapFiledValues.get(field).forEach(value => {
            const n: SelectionTree = { field: field, value: value, children: [], parent: node };
            const nextField = this.getNextField(field, fieldsList);
            if (nextField !== null) {
                this.builtSelectionTree(nextField, n, mapFiledValues, fieldsList, lastChildren);
            } else {
                lastChildren.push(n);
            }
            node.children.push(n);
        });
    }

    private getNextField(field: string, fieldsList: Array<string>): string {
        const fieldIndex = fieldsList.indexOf(field);
        if (fieldIndex === fieldsList.length - 1) {
            return null;
        } else {
            return fieldsList[fieldIndex + 1];
        }
    }

    private getNodeAsArray(n: SelectionTree): Array<{ ringName: string, name: string }> {
        const nodePathAsArray = new Array();
        nodePathAsArray.push({ ringName: n.field, name: n.value });
        if (n.parent && n.parent.parent) {
            while (n.parent.parent) {
                n = n.parent;
                nodePathAsArray.push({ ringName: n.field, name: n.value });
            }
        }
        nodePathAsArray.reverse();
        return nodePathAsArray;
    }

    private populateChildren(donutData: DonutArc, aggregationResponse: AggregationResponse, aggregationLevel: number): void {
        const ring = donutData.children;
        const field = this.aggregations[aggregationLevel].field;
        const countOfOthers = aggregationResponse.sumotherdoccounts;
        if (aggregationResponse.elements !== undefined && aggregationResponse.name !== undefined) {
            const aggregationBuckets = aggregationResponse.elements;
            let countOfBuckets = 0;
            aggregationBuckets.forEach(bucket => {
                countOfBuckets += bucket.count;
            });
            let relativeTotal = 0;
            let isOther = false;
            for (let i = 0; i < aggregationBuckets.length && !isOther; i++) {
                const bucket = aggregationBuckets[i];
                const arc: DonutArc = {
                    id: field + bucket.key + bucket.count, name: bucket.key,
                    ringName: field, isOther: false, children: []
                };
                relativeTotal += bucket.count;
                if (bucket.elements !== undefined && bucket.elements[0].elements !== undefined) {
                    if (bucket.count / (countOfBuckets + countOfOthers) >= this.arcMinPourcentage) {
                        arc.isOther = false;
                        this.populateChildren(arc, bucket.elements[0], aggregationLevel + 1);
                        ring.push(arc);
                    } else {
                        relativeTotal -= bucket.count;
                        isOther = true;
                    }
                } else {
                    arc.isOther = false;
                    arc.size = bucket.count;
                    ring.push(arc);
                }
            }

            if (isOther) {
                const arc: DonutArc = {
                    id: field + aggregationResponse.key + aggregationResponse.count, name: 'OTHER', ringName: field,
                    isOther: true, size: countOfOthers + (countOfBuckets - relativeTotal)
                };
                ring.push(arc);
            } else {
                if (countOfOthers > 0) {
                    const arc = {
                        id: field + aggregationResponse.key + aggregationResponse.count, name: 'OTHER', ringName: field,
                        isOther: true, size: countOfOthers
                    };
                    ring.push(arc);
                }
            }
        } else {
            donutData = null;
        }
    }
}
