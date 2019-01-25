import { Observable, from} from 'rxjs';

import { Contributor, ConfigService, CollaborativesearchService, CollaborationEvent,
    OperationEnum, projType, Collaboration } from 'arlas-web-core';
import { TreeNode, SelectionTree, SimpleNode } from '../models/models';
import { Aggregation, AggregationResponse, Filter, Expression } from 'arlas-api';
import jsonSchema from '../jsonSchemas/donutContributorConf.schema.json';


export class TreeContributor extends Contributor {
   /**
     * Title given to the aggregation result
     */
    public title: string;
    /**
     * Data retrieved from ARLAS-server response and to be returned for the donut component as an input
     */
    public treeData: TreeNode;
    /**
     * first level of treeData flatten to an Array of [fieldValue, size]
     */
    public flattenFirstLevelNodes: Array<[string, number]>;
    /**
     * The minimum ratio of the arc in its ring needed to be plot. Otherwise the arc is considered as OTHER
     */
    public nodeValueMinPourcentage = (this.getConfigValue('nodeValueMinPourcentage')) ?
        this.getConfigValue('nodeValueMinPourcentage') : 0.01;
    /**
     * List of selected nodes to be returned to the donut component as an input
     */
    public selectedNodesPathsList: Array<Array<SimpleNode>> = new Array<Array<SimpleNode>>();
    /**
     * List of selected nodes of first level flattened to a Set of fieldValue
     */
    public selectedFirstLevelNodesList: Set<string>;
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
        return 'arlas.web.contributors.tree';
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
        const node: TreeNode = { id: 'root', fieldValue: 'root', fieldName: 'root', isOther: false, children: [],
         size: aggregationResponse.totalnb };
        this.populateChildren(node, aggregationResponse, 0);
        return node;
    }

    public setData(data: TreeNode): TreeNode {
        this.treeData = data;
        this.flattenFirstLevelNodes = new Array();
        if (data.children) {
            data.children.forEach(node => {
                if (!node.isOther) {
                    this.flattenFirstLevelNodes.push([node.fieldValue, node.size]);
                }
            });
        }
        return data;
    }

    public setSelection(data: TreeNode, collaboration: Collaboration): any {
        this.selectedNodesPathsList = new Array<Array<SimpleNode>>();
        this.selectedFirstLevelNodesList = new Set();
        if (collaboration) {
            const filter = collaboration.filter;
            if (filter) {
                const fFilters = filter.f;
                const fieldsList = [];
                const mapFiledValues = new Map<string, Set<string>>();
                let firstField = null;
                for (let i = 0; i < fFilters.length; i++) {
                    const fFilter = fFilters[i];
                    if (i === 0) {
                        firstField = fFilter[0].field;
                    }
                    const values = fFilter[0].value.split(',');
                    const valuesAsSet = new Set<string>();
                    values.forEach(v => valuesAsSet.add(v));
                    mapFiledValues.set(fFilter[0].field, valuesAsSet);
                    fieldsList.push(fFilter[0].field);
                }
                this.selectedNodesPathsList = this.getSelectedNodesPaths(fieldsList, mapFiledValues, this.treeData);
                if (firstField) {
                    this.selectedFirstLevelNodesList = mapFiledValues.get(firstField);
                }
            }
        } else {
            this.selectedNodesPathsList = new Array<Array<SimpleNode>>();
        }
        return from([]);
    }

    public selectedFirstLevelNodesChanged(selectedFirstLevelNodes: Set<string>) {
        const upperLevelsExpressions: Array<Array<Expression>> = new Array();
        const collaboration = this.collaborativeSearcheService.collaborations.get(this.identifier);
        if (collaboration && collaboration.filter) {
            Object.assign(upperLevelsExpressions, this.collaborativeSearcheService.collaborations.get(this.identifier).filter.f);
            upperLevelsExpressions.shift();
        }
        const filterValue: Filter = { f: [] };
        const equalExpression: Expression = {
            field: this.aggregations[0].field,
            op: Expression.OpEnum.Eq,
            value: ''
        };
        if (selectedFirstLevelNodes.size > 0) {
            selectedFirstLevelNodes.forEach(selectedBar => {
                equalExpression.value += selectedBar + ',';
            });
            equalExpression.value = equalExpression.value.substring(0, equalExpression.value.length - 1);
            filterValue.f.push([equalExpression]);
            if (upperLevelsExpressions) {
                upperLevelsExpressions.forEach(expressions => {
                    filterValue.f.push(expressions);
                });
            }
            const resultedCollaboration: Collaboration = {
                filter: filterValue,
                enabled: true
            };
            this.collaborativeSearcheService.setFilter(this.identifier, resultedCollaboration);
        } else {
            this.collaborativeSearcheService.removeFilter(this.identifier);
        }
        this.selectedFirstLevelNodesList = selectedFirstLevelNodes;
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

    private populateChildren(nodeToPopulate: TreeNode, aggregationResponse: AggregationResponse, aggregationLevel: number): void {
        const nodeChildren = nodeToPopulate.children;
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
                const childNode: TreeNode = {
                    id: field + bucket.key + bucket.count, fieldValue: bucket.key,
                    fieldName: field, isOther: false, children: []
                };
                relativeTotal += bucket.count;
                if (bucket.elements !== undefined && bucket.elements[0].elements !== undefined) {
                    if (bucket.count / (countOfBuckets + countOfOthers) >= this.nodeValueMinPourcentage) {
                        childNode.isOther = false;
                        childNode.size = bucket.count;
                        this.populateChildren(childNode, bucket.elements[0], aggregationLevel + 1);
                        nodeChildren.push(childNode);
                    } else {
                        relativeTotal -= bucket.count;
                        isOther = true;
                    }
                } else {
                    childNode.isOther = false;
                    childNode.size = bucket.count;
                    nodeChildren.push(childNode);
                }
            }

            if (isOther) {
                const arc: TreeNode = {
                    id: field + aggregationResponse.key + aggregationResponse.count, fieldValue: 'OTHER', fieldName: field,
                    isOther: true, size: countOfOthers + (countOfBuckets - relativeTotal)
                };
                nodeChildren.push(arc);
            } else {
                if (countOfOthers > 0) {
                    const arc: TreeNode = {
                        id: field + aggregationResponse.key + aggregationResponse.count, fieldValue: 'OTHER', fieldName: field,
                        isOther: true, size: countOfOthers
                    };
                    nodeChildren.push(arc);
                }
            }
        } else {
            nodeToPopulate = null;
        }
    }
}
