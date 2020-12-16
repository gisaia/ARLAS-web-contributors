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
    Contributor, ConfigService, CollaborativesearchService, CollaborationEvent,
    OperationEnum, projType, Collaboration
} from 'arlas-web-core';
import { TreeNode, SimpleNode } from '../models/models';
import { Aggregation, AggregationResponse, Filter, Expression } from 'arlas-api';
import jsonSchema from '../jsonSchemas/treeContributorConf.schema.json';
import jp from 'jsonpath/jsonpath.min';

/**
 * This contributor fetches data from multiple term aggregations and format the data as a tree.
 * it can be used to fetch data for Donuts and powerbars
 */
export class TreeContributor extends Contributor {
    /**
      * Title given to the aggregation result
      */
    public title: string;
    /**
     * Data retrieved from ARLAS-server response and to be returned for the donut/powerbars component as an input
     */
    public treeData: TreeNode;
    /**
     * The minimum ratio of the node in its level needed to be plotted. Otherwise the node is considered as OTHER
     */
    public nodeSizeMinPourcentage = (this.getConfigValue('nodeSizeMinPourcentage')) ?
        this.getConfigValue('nodeSizeMinPourcentage') : 0.01;
    /**
     * List of selected nodes to be returned to a component that accepts tree data as an input
     */
    public selectedNodesPathsList: Array<Array<SimpleNode>> = new Array<Array<SimpleNode>>();
    /**
     * ARLAS Server Aggregation used to draw the donut/powerbars, defined in configuration
     */
    private aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    /**
    * Json path to explore element aggregation, count by default
    */
    private json_path: string = this.getConfigValue('jsonpath') !== undefined ? this.getConfigValue('jsonpath') : '$.count';
    /**
     * searched term in the text input filter
     */
    private search = '';


    constructor(
        collection: string,
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        title: string
    ) {
        super(collection, identifier, configService, collaborativeSearcheService);
        this.title = title;
    }

    /**
    * @returns Json schema for configuration.
    */
    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    public getAggregations() {
        return this.aggregations;
    }

    public setAggregations(aggregations: Array<Aggregation>) {
        this.aggregations = aggregations;
    }

    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.tree';
    }

    public getFilterDisplayName(): string {
        return this.title;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<AggregationResponse> {
        const filterAgg: Filter = {};
        // TODO : choose which level of aggregation to filter with `search`
        if (this.search.length > 0) {
            this.aggregations[0].include = '.*'.concat(encodeURI(this.search)).concat('.*');
            const expression: Expression = {};
            expression.field = this.aggregations[0].field;
            expression.op = Expression.OpEnum.Like;
            expression.value = '.*'.concat(this.search).concat('.*');
            filterAgg.f = [[expression]];

        } else {
            delete this.aggregations[0].include;
        }
        const aggregationObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            this.collection,
            [projType.aggregate, this.aggregations], this.collaborativeSearcheService.collaborations,
            this.identifier, filterAgg, false, this.cacheDuration
        );
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return aggregationObservable;
        } else {
            return from([]);
        }
    }

    public computeData(aggregationResponse: AggregationResponse): TreeNode {
        const node: TreeNode = { id: 'root', fieldValue: 'root', fieldName: 'root', isOther: false, children: [] };
        if (this.json_path !== '$.count') {
            let nodeSize = 0;
            if (aggregationResponse && aggregationResponse.elements) {
                aggregationResponse.elements.forEach(element => {
                    const value = jp.query(element, this.json_path)[0];
                    nodeSize += value;
                });
            }
            node.size = nodeSize;
            node.metricValue = 0;
        } else {
            node.size = aggregationResponse.totalnb;
            node.metricValue = aggregationResponse.totalnb;
        }
        this.populateChildren(node, aggregationResponse, 0);
        return node;
    }

    public setData(data: TreeNode): TreeNode {
        this.treeData = data;
        return data;
    }

    public setSelection(data: TreeNode, collaboration: Collaboration): any {
        if (collaboration) {
            const filter = collaboration.filter;
            if (filter) {
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
                const selectedNodesPathsList = this.getSelectedNodesPaths(fieldsList, mapFiledValues, this.treeData);
                // Array of array to Map
                const currentSelectedNodesPathsMap = new Map();
                selectedNodesPathsList.forEach(path => {
                    let id = '';
                    for (let i = 1; i <= path.length; i++) {
                        id += path[path.length - i].fieldName + path[path.length - i].fieldValue;
                        currentSelectedNodesPathsMap.set(id, path.slice(path.length - i, path.length));
                    }
                });
                // Array of array to Map
                const olderSelectedNodesPathsMap = new Map();
                this.selectedNodesPathsList.forEach(path => {
                    let id = '';
                    for (let i = 1; i <= path.length; i++) {
                        id += path[path.length - i].fieldName + path[path.length - i].fieldValue;
                        olderSelectedNodesPathsMap.set(id, path.slice(path.length - i, path.length));
                    }
                });
                const mergedMap = new Map([...Array.from(currentSelectedNodesPathsMap.entries()),
                ...Array.from(olderSelectedNodesPathsMap.entries())]);
                const selectedPaths = new Array<Array<SimpleNode>>();
                mergedMap.forEach((value, key) => {
                    let addpath = true;
                    // check if path has all its nodes fieldNames and fieldValues coherant with the filters in collaboration
                    for (let i = 0; i < value.length; i++) {
                        if (!mapFiledValues.get(value[i].fieldName) || !mapFiledValues.get(value[i].fieldName).has(value[i].fieldValue)) {
                            addpath = false;
                            break;
                        }
                    }
                    if (addpath) {
                        selectedPaths.push(value);
                    }
                });
                this.selectedNodesPathsList = selectedPaths;
            }
        } else {
            this.selectedNodesPathsList = new Array<Array<SimpleNode>>();
        }
        return from([]);
    }

    public selectedNodesListChanged(selectedNodesPathsList: Array<Array<SimpleNode>>): void {
        if (selectedNodesPathsList.length > 0) {
            const filter: Filter = { f: [] };
            this.aggregations.forEach(aggregation => {
                const equalExpression: Expression = {
                    field: aggregation.field,
                    op: Expression.OpEnum.Eq,
                    value: ''
                };
                const valuesSet = new Set<string>();
                selectedNodesPathsList.forEach(nodesPath => {
                    nodesPath.every(node => {
                        if (node.fieldName === aggregation.field) {
                            valuesSet.add(node.fieldValue);
                        }
                        return node.fieldName !== aggregation.field;
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
                collection: this.collection,
                filter: filter,
                enabled: true
            };
            this.collaborativeSearcheService.setFilter(this.identifier, collaboration);
        } else {
            this.collaborativeSearcheService.removeFilter(this.identifier);
        }
    }

    /**
     * @description apply the `search` term to filter the tree data
     * @param search the term used to filter tree data
     */
    public updateTreeDataSearch(search: any) {
        // TODO : choose which level of aggregation to filter with `search`
        this.search = search;
        const filterAgg: Filter = {};
        if (this.search.length > 0) {
            this.aggregations[0].include = '.*'.concat(encodeURI(this.search)).concat('.*');
            const expression: Expression = {};
            expression.field = this.aggregations[0].field;
            expression.op = Expression.OpEnum.Like;
            expression.value = '.*'.concat(this.search).concat('.*');
            filterAgg.f = [[expression]];
        } else {
            delete this.aggregations[0].include;
        }
        const aggregationObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            this.collection,
            [projType.aggregate, this.aggregations], this.collaborativeSearcheService.collaborations,
            this.identifier, filterAgg, false, this.cacheDuration
        );

        aggregationObservable.subscribe(aggregationResponse => {
            this.treeData = this.computeData(aggregationResponse);
            this.setSelection(this.treeData, this.collaborativeSearcheService.collaborations.get(this.collection)
                .get(this.identifier));
        });
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

    private populateChildren(nodeToPopulate: TreeNode, aggregationResponse: AggregationResponse, aggregationLevel: number): void {
        const nodeChildren = nodeToPopulate.children;
        const field = this.aggregations[aggregationLevel].field;
        const metricValueOfOthers = (this.json_path === '$.count') ? aggregationResponse.sumotherdoccounts : 0;
        if (aggregationResponse.elements !== undefined && aggregationResponse.name !== undefined) {
            const aggregationBuckets = aggregationResponse.elements;
            let sumOfBucketsMetrics = 0;
            aggregationBuckets.forEach(bucket => {
                const value = jp.query(bucket, this.json_path)[0];
                sumOfBucketsMetrics += value;
            });
            let relativeTotal = 0;
            let isOther = false;
            for (let i = 0; i < aggregationBuckets.length && !isOther; i++) {
                const bucket = aggregationBuckets[i];
                const bucketMetricValue = jp.query(bucket, this.json_path)[0];
                const childNode: TreeNode = {
                    id: field + bucket.key + bucketMetricValue, fieldValue: bucket.key,
                    fieldName: field, isOther: false, children: []
                };
                relativeTotal += bucketMetricValue;
                if (bucket.elements !== undefined && bucket.elements[0].elements !== undefined) {
                    if (bucketMetricValue / (sumOfBucketsMetrics + metricValueOfOthers) >= this.nodeSizeMinPourcentage) {
                        childNode.isOther = false;
                        if (sumOfBucketsMetrics > nodeToPopulate.size) {
                            childNode.size = bucketMetricValue * nodeToPopulate.size / sumOfBucketsMetrics;
                        } else {
                            childNode.size = bucketMetricValue;
                        }
                        childNode.metricValue = bucketMetricValue;
                        this.populateChildren(childNode, bucket.elements[0], aggregationLevel + 1);
                        nodeChildren.push(childNode);
                    } else {
                        relativeTotal -= bucketMetricValue;
                        isOther = true;
                    }
                } else {
                    childNode.isOther = false;
                    if (sumOfBucketsMetrics > nodeToPopulate.size) {
                        childNode.size = bucketMetricValue * nodeToPopulate.size / sumOfBucketsMetrics;
                    } else {
                        childNode.size = bucketMetricValue;
                    }
                    childNode.metricValue = Math.round(bucketMetricValue * 1000) / 1000;
                    nodeChildren.push(childNode);
                }
            }

            if (isOther) {
                const arc: TreeNode = {
                    id: field + aggregationResponse.key + aggregationResponse.count, fieldValue: 'OTHER', fieldName: field,
                    isOther: true, size: metricValueOfOthers + (sumOfBucketsMetrics - relativeTotal),
                    metricValue: metricValueOfOthers + (sumOfBucketsMetrics - relativeTotal)
                };
                nodeChildren.push(arc);
            } else {
                if (metricValueOfOthers > 0) {
                    const arc: TreeNode = {
                        id: field + aggregationResponse.key + aggregationResponse.count, fieldValue: 'OTHER', fieldName: field,
                        isOther: true, size: metricValueOfOthers + (sumOfBucketsMetrics - relativeTotal),
                        metricValue: metricValueOfOthers + (sumOfBucketsMetrics - relativeTotal)
                    };
                    nodeChildren.push(arc);
                }
            }
        } else {
            nodeToPopulate = null;
        }
    }
}
