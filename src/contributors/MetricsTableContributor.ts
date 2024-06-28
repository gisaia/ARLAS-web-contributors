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
    Collaboration, CollaborationEvent, CollaborativesearchService,
    ConfigService, Contributor, OperationEnum, projType
} from 'arlas-web-core';
import { Filter, Expression } from 'arlas-api';
import {
    MetricsVectors,
    MetricsTableConfig,
    MetricsTable,
    MetricsTableHeader,
    MetricsTableRow, MetricsTableCell, MetricsTableSortConfig, MetricsVector,
    ComputableResponse,
    MetricsTableResponse
} from '../models/metrics-table.config';
import jsonSchema from '../jsonSchemas/metricsTableContributorConf.schema.json';
import { Observable, forkJoin, map, of, mergeMap, from } from 'rxjs';


/**
 * This contributor fetches metrics from different collection by term. The terms are value of a termfield specified for each collection.
 * The fetched metrics are formatted into a table to provide data to MetricsTableComponent.
 * This contributor handles multi-collection filters.
 */
export class MetricsTableContributor extends Contributor {

    /** @field */
    /** A object that simplifies building arlas-api aggregation requests from the table
     * configuration.
     */
    public table: MetricsVectors;
    /** @param */
    /** Number of terms fetched for each collection. The resulted table
     * might have terms between `nbterms` and `nbCollection * nbterms`.
     */
    public nbterms: number = this.getConfigValue('nbterms');
    /** @param */
    /** Configuration of the table. It includes what are the term fields for each collection and what
     * metrics to display.
     */
    public configuration: MetricsTableConfig = this.getConfigValue('configuration');
    /** @param */
    /**
     */
    public sort: MetricsTableSortConfig = this.getConfigValue('sort');

    /**
     * Type of operator for the filter : equal or not equal
     */
    private filterOperator: Expression.OpEnum = this.getConfigValue('filterOperator') !== undefined ?
        Expression.OpEnum[this.getConfigValue('filterOperator') as string] : Expression.OpEnum.Eq;

    public data: MetricsTable;
    public selectedTerms: Array<string> = [];

    public constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService, collaborativeSearcheService);
        this.sort = this.getConfigValue('sort');
        this.configuration = this.getConfigValue('configuration');
        this.nbterms = this.getConfigValue('nbterms');
        this.table = new MetricsVectors(this.configuration, this.sort, this.nbterms);
        this.collections = this.table.vectors.map(v => ({
            field: v.configuration.termfield,
            collectionName: v.collection
        }));
    }

    /** @override */
    public fetchData(collaborationEvent: CollaborationEvent): Observable<ComputableResponse> {
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            const allKeys = new Set<string>();
            /** Base aggregations to get terms and their metrics for each collection (vector) */
            return forkJoin(this.table.vectors.map(v =>
                this.collaborativeSearcheService.resolveButNotAggregation([projType.aggregate, [v.getAggregation()]],
                    this.collaborativeSearcheService.collaborations,
                    v.collection,
                    this.identifier, {}, false, this.cacheDuration
                ).pipe(
                    map(ar => {
                        const keys = new Set(ar.elements.map(e => e.key));
                        keys.forEach(k => allKeys.add(k));
                        return ({
                            collection: v.collection,
                            aggregationResponse: ar,
                            keys,
                            missingKeys: new Set<string>(),
                            vector: v
                        });
                    })
                )
            )).pipe(
                /** For each vector, recuperate the missing keys that exist in other vectors */
                map(metricsResponses => {
                    metricsResponses.forEach(mr => {
                        allKeys.forEach(k => {
                            if (!mr.keys.has(k)) {
                                mr.missingKeys.add(k);
                            }
                        });
                    });
                    return metricsResponses;
                }),
                /** The following block launches a list of Complementary aggregations for each vector (only in case of missing keys),
                 *  in order to fetch the missing keys and complete the table. */
                mergeMap(metricsResponses => forkJoin(metricsResponses.map(mr => {
                    if (mr.missingKeys.size === 0) {
                        return of(mr);
                    } else {
                        const termsToInclude = Array.from(mr.missingKeys);
                        return this.collaborativeSearcheService
                            .resolveButNotAggregation([projType.aggregate, [mr.vector.getAggregation(termsToInclude)]],
                                this.collaborativeSearcheService.collaborations,
                                mr.collection,
                                this.identifier, {}, false, this.cacheDuration
                            ).pipe(
                                map(ar => {
                                    const keys = new Set(ar.elements.map(e => e.key));
                                    keys.forEach(k => allKeys.add(k));
                                    const missingKeys = new Set<string>();
                                    allKeys.forEach(k => {
                                        if (!keys.has(k)) {
                                            missingKeys.add(k);
                                        }
                                    });
                                    return ({
                                        collection: mr.collection,
                                        /** merging response of the base aggregation and the complementary aggregation  */
                                        aggregationResponse: mr.vector.mergeResponses(mr.aggregationResponse, ar),
                                        keys,
                                        missingKeys,
                                        vector: mr.vector,
                                        leadsTermsOrder: mr.vector.leadsSort()
                                    });
                                })
                            );
                    }
                })),
                ),
                map(mrs => {
                    const sortedMrs = this.orderMetricsTableResponse(mrs);
                    let columns = [];
                    sortedMrs.forEach(mr => {
                        columns = columns.concat(mr.vector.getColumns());
                    });
                    return {
                        columns,
                        metricsResponse: mrs
                    };
                })
            );
        }
        return of();
    }

    /** @override */
    /** todo !!!! specify data type and return type  */
    public computeData(data: ComputableResponse): MetricsTable {
        // todo: to be improved
        const rows: Map<string, MetricsTableRow> = new Map();
        const maxCount = new Map();
        const metricsResponses = data.metricsResponse;
        const columnsOrder = data.columns;

        metricsResponses.forEach(metricsResponse => {
            const currentCollection = metricsResponse.collection;
            metricsResponse.aggregationResponse.elements.forEach(element => {
                let row: MetricsTableRow;
                if (rows.has(element.key_as_string)) {
                    row = rows.get(element.key_as_string);
                } else {
                    row = { data: [], term: element.key_as_string };
                    row.data = Array(columnsOrder.length).fill(null);
                    rows.set(element.key_as_string, row);
                }
                columnsOrder.forEach((col, i) => {
                    if (currentCollection === col.collection) {
                        let uniqueTermMetric;
                        let value;
                        // how we know its the good field that we want if the metrics object can be empty ?
                        if (col.metric === 'count') {
                            uniqueTermMetric = `${col.collection}_${col.metric}`;
                            value = element.count;
                        } else {
                            uniqueTermMetric = `${col.collection}_${col.field}_${col.metric}`;
                            const metric = element.metrics.find(metric => metric.type.toLowerCase() === col.metric.toString().toLowerCase() &&
                                    metric.field === col.field.replace(/\./g, '_')
                            );
                            if (metric) {
                                value = metric.value;
                            }
                        }
                        // we set the value and the max count
                        if (value) {
                            row.data[i] = { maxValue: 0, value, metric: col.metric, column: col.collection, field: col.field };
                            if (maxCount.has(uniqueTermMetric) && maxCount.get(uniqueTermMetric) < value) {
                                maxCount.set(uniqueTermMetric, value);
                            } else if (!maxCount.has(uniqueTermMetric)) {
                                maxCount.set(uniqueTermMetric, value);
                            }
                        }
                    }
                });
            });
        });
        console.error(rows);
        console.error(maxCount);

        const metricsTable: MetricsTable = { data: [], header: [] };
        // att the end we setHeaders
        for (const value of columnsOrder) {
            metricsTable.header.push({ title: value.collection, subTitle: value.field, metric: value.metric });
        }

        rows.forEach(row => {
            row.data.forEach(cell => {
                if (cell !== null) {
                    let maxCountKey;
                    if (cell.metric === 'count') {
                        maxCountKey = `${cell.column}_${cell.metric}`;
                    } else {
                        maxCountKey = `${cell.column}_${cell.field}_${cell.metric}`;
                    }
                    cell.maxValue = maxCount.get(maxCountKey);
                }
            });
            metricsTable.data.push(row);
        });

        // we update max value.
        console.error(metricsTable);
        return metricsTable;
    }

    private onRowSelect(terms: Set<string>): void {
        if (terms.size > 0) {
            const collabFilters = new Map<string, Filter[]>();
            this.table.vectors.forEach(v => {
                const filter: Filter = { f: [] };
                const equalExpression: Expression = {
                    field: v.configuration.termfield,
                    op: this.filterOperator,
                    value: ''
                };
                terms.forEach(value => {
                    equalExpression.value += value + ',';
                });
                if (equalExpression.value !== '') {
                    equalExpression.value = equalExpression.value.substring(0, equalExpression.value.length - 1);
                    filter.f.push([equalExpression]);
                }
                collabFilters.set(v.collection, [filter]);
            });
            const collaboration: Collaboration = {
                filters: collabFilters,
                enabled: true
            };
            this.collaborativeSearcheService.setFilter(this.identifier, collaboration);
        } else {
            this.collaborativeSearcheService.removeFilter(this.identifier);
        }
    }

    private orderMetricsTableResponse(data: Array<MetricsTableResponse>): Array<MetricsTableResponse> {
        return data.sort(((response, comparingResponse) => (response.leadsTermsOrder) ? -1 : 0));
    }

    /** @override */
    public setData(data: MetricsTable): any {
        this.data = data;
        return from([]);

    }

    /** @override */
    /** todo !!!! specify data type and return type  */
    public setSelection(data: MetricsTable, collaboration: Collaboration) {
        const termsSet = new Set<string>();
        if (collaboration) {
            let filter: Filter;
            if (collaboration.filters) {
                collaboration.filters.forEach((filters, collection) => {
                    filter = filters[0];
                    if (filter) {
                        const fFilters = filter.f;
                        fFilters.forEach(fFilter => {
                            const values = fFilter[0].value.split(',');
                            values.forEach(v => termsSet.add(v));
                        });
                    }

                });
            }
        }
        this.selectedTerms = Array.from(termsSet);
        return from([]);
    }

    /**
     * @override
     * @returns Package name for the configuration service.
     */
    public getPackageName(): string {
        return 'arlas.web.contributors.metricslist';
    }

    /** @override */
    /** todo !!!! specify data type and return type  */
    public getFilterDisplayName(): string {
        return 'Todo';
    }

    /** @override */
    public isUpdateEnabledOnOwnCollaboration(): boolean {
        return false;
    }

    /** @override */
    public static getJsonSchema(): Object {
        return jsonSchema;
    }

}
