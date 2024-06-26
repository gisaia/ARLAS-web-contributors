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
import { AggregationResponse, Metric as ArlasApiMetric } from 'arlas-api';
import {
    MetricsVectors,
    MetricsTableConfig,
    MetricsTable,
    MetricsTableHeader,
    MetricsTableRow, MetricsTableCell, MetricsTableSortConfig, MetricsVector
} from '../models/metrics-table.config';
import jsonSchema from '../jsonSchemas/metricsTableContributorConf.schema.json';
import { Observable, forkJoin, map, of, mergeMap } from 'rxjs';
import { computableResponseMock } from '../models/mock-metrics';
import { AggregationMetric } from 'arlas-api/api';

export interface MetricsTableResponse {
    collection: string;
    aggregationResponse: AggregationResponse;
    keys: Set<string>;
    missingKeys: Set<string>;
    vector: MetricsVector;
    /** if true, it means the tables terms should be sorted according to this vector. */
    leadsTermsOrder?: boolean;
}


export interface ComputableResponse {
    columns: MetricsTableColumn[];
    metricsResponse: Array<MetricsTableResponse>;
}

export interface MetricsTableColumn {
    collection: string;
    metric: ArlasApiMetric.CollectFctEnum | 'count';
    field?: string;
}

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

    public data: MetricsTable;

    public constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService, collaborativeSearcheService);
        this.sort = this.getConfigValue('sort');
        this.configuration = this.getConfigValue('configuration');
        this.nbterms = this.getConfigValue('nbterms');
        /* this.table = new MetricsVectors(this.configuration, this.sort, this.nbterms);
        this.collections = this.table.vectors.map(v => ({
            field: v.configuration.termfield,
            collectionName: v.collection
        }));*/
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
            metricsResponse.aggregationResponse.elements.forEach(elements => {
                let row: MetricsTableRow;
                if (rows.has(elements.key_as_string)) {
                    row = rows.get(elements.key_as_string);
                } else {
                    row = {data: [], term: elements.key_as_string};
                    row.data = Array(columnsOrder.length).fill(null);
                    rows.set(elements.key_as_string, row);
                }
                let colCount = 0;
                columnsOrder.forEach((col, i) => {
                    if (currentCollection === col.collection) {
                        let uniqueTermMetric;
                        let value;
                        // how we know its the good field that we want if the metrics object can be empty ?
                        if (col.metric === 'count' && colCount === i) {
                            uniqueTermMetric = `${col.collection}_${elements.key_as_string}_${col.metric}`;
                            value = elements.count;
                        } else {
                            uniqueTermMetric = `${col.collection}_${col.field}_${elements.key_as_string}_${col.metric}`;
                            const metric = elements.metrics.find(metric =>
                                metric.type.toLowerCase() === col.metric.toString().toLowerCase() &&
                                metric.field === col.field
                            );
                            if(metric){
                                value = metric.value;
                            }
                        }
                        // we set the value and the max count
                        if(value){
                            row.data[i] = {maxValue: 0, value, metric: col.metric, column: col.collection, field:col.field};
                            if (maxCount.has(uniqueTermMetric) && maxCount.get(uniqueTermMetric) < value) {
                                maxCount.set(uniqueTermMetric, value);
                            } else {
                                maxCount.set(uniqueTermMetric, value);
                            }
                        }
                        console.error(colCount);
                    }
                    colCount++;
                });
            });
        });
        console.error(rows);
        console.error(maxCount);

        const metricsTable: MetricsTable = {data: [], header: []};
        // att the end we setHeaders
        for (const value of columnsOrder) {
            metricsTable.header.push({title: value.collection, subTitle: value.field, metric: value.metric});
        }

        rows.forEach(row => {
            row.data.forEach(cell => {
                if (cell !== null) {
                    let maxCountKey;
                    if(cell.metric === 'count'){
                        maxCountKey = `${cell.column}_${row.term}_${cell.metric}`;
                    } else {
                        maxCountKey = `${cell.column}_${cell.field}_${row.term}_${cell.metric}`;
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

    private orderMetricsTableResponse(data: Array<MetricsTableResponse>): Array<MetricsTableResponse> {
        return data.sort(((response, comparingResponse) => (response.leadsTermsOrder) ? -1 : 0));
    }

    /** @override */
    public setData(data: MetricsTable): void {
        this.data = data;
    }

    /** @override */
    /** todo !!!! specify data type and return type  */
    public setSelection(data: any, c: Collaboration) {

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
