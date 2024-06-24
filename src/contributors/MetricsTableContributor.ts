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
import { AggregationResponse } from 'arlas-api';
import { MetricsVectors, MetricsTableConfig, MetricsTable, MetricsVector, MetricsTableSortConfig } from '../models/metrics-table.config';
import { Observable, forkJoin, map, mergeMap, of } from 'rxjs';
import jsonSchema from '../jsonSchemas/metricsTableContributorConf.schema.json';

export interface MetricsTableResponse {
    collection: string;
    aggregationResponse: AggregationResponse;
    keys: Set<string>;
    missingKeys: Set<string>;
    vector: MetricsVector;
    /** if true, it means the tables terms should be sorted according to this vector. */
    leadsTermsOrder?: boolean;
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
        this.table = new MetricsVectors(this.configuration, this.sort, this.nbterms);
        this.collections = this.table.vectors.map(v => ({
            field: v.configuration.termfield,
            collectionName: v.collection
        }));
    }

    /** @override */
    public fetchData(collaborationEvent: CollaborationEvent): Observable<Array<MetricsTableResponse>> {
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
                        const termsToInclude = Array.from(mr.missingKeys).join(',');
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
                ));
        }
        return of();
    }

    /** @override */
    /** todo !!!! specify data type and return type  */
    public computeData(data: Array<MetricsTableResponse>): MetricsTable {
        console.log('test is ok');
        return null;
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
