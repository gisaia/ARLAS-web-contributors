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
import { Observable, from} from 'rxjs';
import { Aggregation, AggregationResponse, Filter, Expression } from 'arlas-api';
import { TreeNode, SelectionTree, SimpleNode } from '../models/models';
import jsonSchema from '../jsonSchemas/donutContributorConf.schema.json';



export class DonutContributor extends Contributor {

    /**
     * Title given to the aggregation result
     */
    public title: string;
    /**
     * Data retrieved from ARLAS-server response and to be returned for the donut component as an input
     */
    public donutData: TreeNode;
    /**
     * The minimum ratio of the arc in its ring needed to be plot. Otherwise the arc is considered as OTHER
     */
    public arcMinPourcentage = (this.getConfigValue('arcMinPourcentage')) ? this.getConfigValue('arcMinPourcentage') : 0.01;
    /**
     * List of selected nodes to be returned to the donut component as an input
     */
    public selectedArcsList: Array<Array<SimpleNode>> = new Array<Array<SimpleNode>>();
    /**
     * ARLAS Server Aggregation used to draw the donut, defined in configuration
     */
    private aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');
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
            return from([]);
        }
    }

    public computeData(aggregationResponse: AggregationResponse): TreeNode {
        const donutArc: TreeNode = { id: 'root', fieldValue: 'root', fieldName: 'root', isOther: false, children: [],
         size: aggregationResponse.totalnb };
        this.populateChildren(donutArc, aggregationResponse, 0);
        return donutArc;
    }

    public setData(data: TreeNode): TreeNode {
        this.donutData = data;
        return data;
    }

    public setSelection(data: TreeNode, collaboration: Collaboration): any {
        if (collaboration) {
            const filter = collaboration.filter;
            if (filter === null) {
                this.selectedArcsList = new Array<Array<{ fieldName: string, fieldValue: string }>>();
            } else {
                this.selectedArcsList = new Array<Array<{ fieldName: string, fieldValue: string }>>();
                const fFilters = filter.f;
                const fieldsList = [];
                const mapFieldValues = new Map<string, Set<string>>();
                fFilters.forEach(fFilter => {
                    const values = fFilter[0].value.split(',');
                    const valuesAsSet = new Set<string>();
                    values.forEach(v => valuesAsSet.add(v));
                    mapFieldValues.set(fFilter[0].field, valuesAsSet);
                    fieldsList.push(fFilter[0].field);
                });
                this.selectedArcsList = this.getSelectedNodesPaths(fieldsList, mapFieldValues, this.donutData);
            }
        } else {
            this.selectedArcsList = new Array<Array<{ fieldName: string, fieldValue: string }>>();
        }
        return from([]);
    }

    public selectedArcsListChanged(selectedArcsList: Array<Array<{ fieldName: string, fieldValue: string }>>): void {
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
                        if (arc.fieldName === aggregation.field) {
                            valuesSet.add(arc.fieldValue);
                        }
                        return arc.fieldName !== aggregation.field;
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

    /**
     * @description This method returns the paths of each selected node (the path directions is from the parent to the child).
     * Those paths are constructed from the values comming from the `Collaboration`
     * of this contributor and stored in the `mapFieldValues`
     * @param fieldsList List of fields (which corresponds to the levels of the tree)
     * @param mapFieldValues maps each field name to its values (nodes names)
     * @param data the data tree
     * @param selectedNodesPathsList optional parameter used for recursivity of the method.
     * It is the list of selected nodes paths returned by the method
     * @param selectedNodesPath This path is transmitted to next node level to be enriched if children
     * nodes are to be selected before adding it to `selectedNodesPathsList`
     */
    private getSelectedNodesPaths(fieldsList: Array<string>, mapFieldValues: Map<string, Set<string>>, data: TreeNode,
        selectedNodesPathsList?: Array<Array<SimpleNode>>, selectedNodesPath?: Array<SimpleNode>):
        Array<Array<SimpleNode>> {
        if (!selectedNodesPathsList) {
            selectedNodesPathsList = new Array();
        }
        const field = fieldsList.length > 0 ? fieldsList[0] : undefined;
        if (field) {
            mapFieldValues.get(field).forEach(value => {
                const currentLevelPath = selectedNodesPath ? selectedNodesPath : [];
                const node: TreeNode = this.getNode(field, value, data);
                const pathToAddInList: Array<SimpleNode> = [];
                Object.assign(pathToAddInList, currentLevelPath);
                if (node) {
                    pathToAddInList.push({ fieldName: node.fieldName, fieldValue: node.fieldValue });
                    if (!node.children || node.children.length === 0) {
                        pathToAddInList.reverse();
                        selectedNodesPathsList.push(pathToAddInList);
                    } else {
                        if (fieldsList.length > 1) {
                            this.getSelectedNodesPaths(fieldsList.slice(1), mapFieldValues, node, selectedNodesPathsList, pathToAddInList);
                        } else {
                            pathToAddInList.reverse();
                            selectedNodesPathsList.push(pathToAddInList);
                        }
                    }
                } else {
                    if (currentLevelPath.length > 0) {
                        pathToAddInList.reverse();
                        selectedNodesPathsList.push(pathToAddInList);
                    }
                }
            });
        }
        return selectedNodesPathsList;
    }

    /**
        * @description This method fethes the first node from the `data` tree that has the same `field` and `name`
        * @param field Field of the node
        * @param name Name of the node
        * @param data the tree data from which the node is fetched
        */
    private getNode(field: string, name: string, data: TreeNode): TreeNode {
        if (data && data.fieldValue === name && data.fieldName === field) {
            return data;
        } else {
            if (data && data.children) {
                for (const child of data.children) {
                    const existingNode = this.getNode(field, name, child);
                    if (existingNode) {
                        return existingNode;
                    }
                }
            } else {
                return null;
            }
        }
    }

    private populateChildren(donutData: TreeNode, aggregationResponse: AggregationResponse, aggregationLevel: number): void {
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
                const arc: TreeNode = {
                    id: field + bucket.key + bucket.count, fieldValue: bucket.key,
                    fieldName: field, isOther: false, children: []
                };
                relativeTotal += bucket.count;
                if (bucket.elements !== undefined && bucket.elements[0].elements !== undefined) {
                    if (bucket.count / (countOfBuckets + countOfOthers) >= this.arcMinPourcentage) {
                        arc.isOther = false;
                        arc.size = bucket.count;
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
                const arc: TreeNode = {
                    id: field + aggregationResponse.key + aggregationResponse.count, fieldValue: 'OTHER', fieldName: field,
                    isOther: true, size: countOfOthers + (countOfBuckets - relativeTotal)
                };
                ring.push(arc);
            } else {
                if (countOfOthers > 0) {
                    const arc: TreeNode = {
                        id: field + aggregationResponse.key + aggregationResponse.count, fieldValue: 'OTHER', fieldName: field,
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
