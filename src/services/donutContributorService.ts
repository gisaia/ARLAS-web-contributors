import { Aggregation, AggregationResponse, Filter, Expression } from 'arlas-api';
import { CollaborativesearchService, Collaboration } from 'arlas-web-core';
import { DonutArc, SelectionTree } from '../models/models';

export class DonutContributorService {
    /**
     * Data retrieved from ARLAS-server response and to be returned for the donut component as an input
     */
    public donutData: DonutArc;

    /**
     * List of selected nodes returned from the donut component
     */
    private componentSelectedArcsList: Array<Array<{ ringName: string, name: string }>> =
        new Array<Array<{ ringName: string, name: string }>>();

    constructor(
        private identifier: string,
        private collaborativeSearcheService: CollaborativesearchService,
        public arcMinPourcentage: number,
        public title: string

    ) {
    }

    public computeData(aggregations: Array<Aggregation>, aggregationResponse: AggregationResponse): DonutArc {
        const donutArc: DonutArc = { id: 'root', name: 'root', ringName: 'root', isOther: false, children: [],
         size: aggregationResponse.totalnb };
        this.populateChildren(donutArc, aggregations, aggregationResponse, 0);
        return donutArc;
    }

    public getSelectedArcs(collaboration: Collaboration): any {
        let selectedArcsList = new Array<Array<{ ringName: string, name: string }>>();
        if (collaboration) {
            const filter = collaboration.filter;
            if (filter) {
                selectedArcsList = new Array<Array<{ ringName: string, name: string }>>();
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
                    selectedArcsList.push(this.getNodeAsArray(lastNode));
                });
                // ADD THE HIGHER SELECTED NODES TO selectedArcsList
                let depth = 0;
                selectedArcsList.forEach(function (nodePath) {
                    if (nodePath.length > depth) {
                        depth = nodePath.length;
                    }
                });
                this.componentSelectedArcsList.forEach(arc => {
                    if (arc.length < depth) {
                        selectedArcsList.push(arc);
                    }
                });
            }
        }
        return selectedArcsList;
    }

    public updateCollaborationOnSelectedArcsChange(aggregations: Array<Aggregation>,
        selectedArcsList: Array<Array<{ ringName: string, name: string }>>): void {
        this.componentSelectedArcsList = selectedArcsList;
        if (selectedArcsList.length > 0) {
            const filter: Filter = { f: [] };
            aggregations.forEach(aggregation => {
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

    private populateChildren(donutData: DonutArc, aggregations: Array<Aggregation>,
        aggregationResponse: AggregationResponse, aggregationLevel: number): void {
        const ring = donutData.children;
        const field = aggregations[aggregationLevel].field;
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
                        arc.size = bucket.count;
                        this.populateChildren(arc, aggregations, bucket.elements[0], aggregationLevel + 1);
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
