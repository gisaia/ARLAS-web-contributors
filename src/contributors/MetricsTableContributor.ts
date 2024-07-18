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
    MetricsTable,
    MetricsTableRow, MetricsTableSortConfig,
    ComputableResponse,
    MetricsTableResponse,
    MetricsVectorConfig
} from '../models/metrics-table.config';
import jsonSchema from '../jsonSchemas/metricsTableContributorConf.schema.json';
import { Observable, forkJoin, map, of, mergeMap, from, Subject, take } from 'rxjs';


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
     * might have terms between `numberOfBuckets` and `nbCollection * numberOfBuckets`.
     */
    public nbterms: number;
    /** @param */
    /** Configuration of the table. It includes what are the term fields for each collection and what
     * metrics to display.
     */
    public configuration: MetricsVectorConfig[] = this.getConfigValue('configuration');
    /** @param */
    /**
     */
    public sort: MetricsTableSortConfig = this.getConfigValue('sort');

    /**
     * Type of operator for the filter : equal or not equal
     */
    private filterOperator: Expression.OpEnum = this.getConfigValue('filterOperator') !== undefined ?
        Expression.OpEnum[this.getConfigValue('filterOperator') as string] : Expression.OpEnum.Eq;

    private operatorChangedEvent: Subject<Expression.OpEnum> = new Subject();
    public operatorChanged$: Observable<Expression.OpEnum> = this.operatorChangedEvent.asObservable();

    public maxValue = -Number.MAX_VALUE;

    public data: MetricsTable;
    public selectedTerms: Array<string> = [];
    private computableResponse: ComputableResponse;
    public constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService, collaborativeSearcheService);
        this.sort = this.getConfigValue('sort');
        this.configuration = this.getConfigValue('configuration');
        this.nbterms = this.getConfigValue('numberOfBuckets');
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
                                    keys.forEach(k => {
                                        allKeys.add(k);
                                        mr.keys.add(k);
                                    });
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
                                        keys: mr.keys,
                                        missingKeys,
                                        vector: mr.vector
                                    });
                                })
                            );
                    }
                })),
                ),
                map(mrs => {
                    let columns = [];
                    mrs.forEach(mr => {
                        columns = columns.concat(mr.vector.getColumns());
                    });
                    const cr = new ComputableResponse();
                    cr.columns = columns;
                    cr.metricsResponse = mrs;
                    return cr;
                })
            );
        }
        return from([]);
    }

    /** @override */
    public computeData(data: ComputableResponse): ComputableResponse {
        return data;
    }

    public getFilterOperator() {
        return this.filterOperator;
    }

    public setFilterOperator(operator: Expression.OpEnum, emit = false) {
        this.filterOperator = operator;
        if (emit) {
            this.operatorChangedEvent.next(operator);
        }
    }

    public onRowSelect(terms: Set<string>): void {
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

    /** @override */
    public setData(data: ComputableResponse): any {
        this.data = this.computeMetricsTable(data);
        this.computableResponse = data;
        return from([]);
    }

    private computeMetricsTable(data: ComputableResponse): MetricsTable {
        const rowsMap: Map<string, MetricsTableRow> = new Map();
        const rows: MetricsTableRow[] = [];
        /** key:collection_field_metric ----  value: maxvalue  */
        const maxValues = new Map<string, number>();
        let maxTableValue = -Number.MAX_VALUE;
        const metricsResponses = data.metricsResponse;
        const columnsOrder = data.columns;
        let leadingMr = metricsResponses?.find(mr => mr.vector.isSortable());
        if (!leadingMr && metricsResponses.length > 0) {
            leadingMr = metricsResponses[0];
        }
        if (!!leadingMr) {
            leadingMr.aggregationResponse.elements.forEach(element => {
                const row: MetricsTableRow = { data: [], term: element.key_as_string };
                row.data = Array(columnsOrder.length).fill(null);
                rowsMap.set(element.key_as_string, row);
                rows.push(row);
            });
        }
        metricsResponses.forEach(metricsResponse => {
            const currentCollectionTermfield = metricsResponse.collection + metricsResponse.vector.termfield;
            metricsResponse.aggregationResponse.elements.forEach(element => {
                const row: MetricsTableRow = rowsMap.get(element.key_as_string);
                columnsOrder.forEach((col, i) => {
                    if (currentCollectionTermfield === col.collection + col.termfield) {
                        let uniqueTermMetric;
                        let value;
                        // how we know its the good field that we want if the metrics object can be empty ?
                        if (col.metric === 'count') {
                            uniqueTermMetric = `${col.collection}_${col.metric}`;
                            value = element.count;
                        } else {
                            uniqueTermMetric = `${col.collection}_${col.field}_${col.metric}`;
                            const metric = element?.metrics?.find(metric => metric.type.toLowerCase() === col.metric.toString().toLowerCase() &&
                                metric.field === col.field.replace(/\./g, '_')
                            );
                            if (metric) {
                                value = metric.value;
                            }
                        }
                        // we set the value and the max count
                        if (value !== undefined) {
                            if (value > maxTableValue) {
                                maxTableValue = value;
                            }
                            row.data[i] = {
                                maxColumnValue: 0, maxTableValue: 0, value, metric: col.metric,
                                column: col.collection, field: col.field
                            };
                            if (maxValues.has(uniqueTermMetric) && maxValues.get(uniqueTermMetric) < value) {
                                maxValues.set(uniqueTermMetric, value);
                            } else if (!maxValues.has(uniqueTermMetric)) {
                                maxValues.set(uniqueTermMetric, value);
                            }
                        }
                    }
                });
            });
        });
        const metricsTable: MetricsTable = { data: [], header: [] };
        // att the end we setHeaders
        for (const value of columnsOrder) {
            metricsTable.header.push({ title: value.collection, subTitle: value.field, metric: value.metric, rowfield: value.termfield });
        }

        rowsMap.forEach(row => {
            row.data.forEach(cell => {
                if (cell !== null) {
                    let maxValueKey;
                    if (cell.metric === 'count') {
                        maxValueKey = `${cell.column}_${cell.metric}`;
                    } else {
                        maxValueKey = `${cell.column}_${cell.field}_${cell.metric}`;
                    }
                    cell.maxColumnValue = maxValues.get(maxValueKey);
                    cell.maxTableValue = maxTableValue;
                }
            });
        });
        rows.forEach(r => {
            metricsTable.data.push(rowsMap.get(r.term));
        });

        // we update max value.
        return metricsTable;
    }

    /** @override */
    public setSelection(cr: ComputableResponse, collaboration: Collaboration) {
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

        /** This block verifies if selected terms exist in data, fetches the data if so.
         * Then it adds a row to metricsTable in order to have a complete table.
         */
        if (termsSet.size > 0) {
            const missingRows = [];
            const dataRows = new Set(...this.computableResponse?.metricsResponse.map(r => r.keys));
            termsSet.forEach(term => {
                if (!dataRows.has(term)) {
                    missingRows.push(term);
                }
            });
            if (missingRows.length > 0) {
                this.isDataUpdating = true;
                forkJoin(this.table.vectors.map(v =>
                    this.collaborativeSearcheService.resolveButNotAggregation([projType.aggregate, [v.getAggregation(missingRows)]],
                        this.collaborativeSearcheService.collaborations,
                        v.collection,
                        this.identifier, {}, false, this.cacheDuration
                    ).pipe(
                        take(1),
                        map(ar => {
                            const keys = new Set(ar.elements.map(e => e.key));
                            const baseResponse = cr?.getMetricResponse(v.collection);
                            const aggregationResponse = !!baseResponse ?
                                v.mergeResponses(baseResponse.aggregationResponse, ar) : ar;
                            const baseKeys = cr?.getMetricResponse(v.collection)?.keys;
                            const mergedKeys = ComputableResponse.mergeKeys(keys, baseKeys);
                            const inexistingKeys = ComputableResponse.disjointValues(mergedKeys, new Set(missingRows));
                            const inexistingElements = ComputableResponse.createEmptyArlasElements(inexistingKeys);
                            inexistingElements.forEach(ie => aggregationResponse.elements.push(ie));
                            return ({
                                collection: v.collection,
                                aggregationResponse,
                                keys: mergedKeys,
                                missingKeys: new Set<string>(),
                                vector: v
                            });
                        })
                    )
                )).pipe(
                    map(mrs => {
                        cr.metricsResponse = mrs;
                        return cr;
                    })
                ).subscribe(mr => {
                    this.data = this.computeMetricsTable(mr);
                    this.computableResponse = mr;
                    this.selectedTerms = Array.from(termsSet);
                    this.isDataUpdating = false;
                });
            } else {
                this.selectedTerms = Array.from(termsSet);
            }
        } else {
            this.selectedTerms = Array.from(termsSet);
        }
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
