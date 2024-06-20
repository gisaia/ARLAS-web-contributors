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
import { MetricsVectors, MetricsTableConfig, MetricsTable } from '../models/metrics-table.config';
import { Observable, forkJoin, map, of } from 'rxjs';

export interface MetricsTableResponse {
    collection: string;
    aggregationResponse: AggregationResponse;
}

/**
 * This contributor fetches metrics from different collection by term. The terms are value of a termfield specified for each collection.
 * The fetched metrics are formatted into a table to provide data to MetricsTableComponent.
 * This contributor handles multi-collection filters.
 */
export class MetricsTableContributor extends Contributor {

    /** @field */
    public table: MetricsVectors;
    /** @field */
    public nbTerms: number;
    public configuration: MetricsTableConfig = this.getConfigValue('configuration');

    public constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        /** configuration to query data for metrics table */
        /** Number of terms for each collection (same for all). */
        nbTerms: number,
        configuration
    ) {
        super(identifier, configService, collaborativeSearcheService);
        this.configuration = configuration;
        this.table = new MetricsVectors(this.configuration, nbTerms);
    }

    /** @override */
    public fetchData(collaborationEvent: CollaborationEvent): Observable<Array<MetricsTableResponse>> {
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return forkJoin(this.table.vectors.map(v =>
                this.collaborativeSearcheService.resolveButNotAggregation([projType.aggregate, [v.getAggregation()]],
                    this.collaborativeSearcheService.collaborations,
                    v.collection,
                    this.identifier, {}, false, this.cacheDuration
                ).pipe(
                    map(ar =>({
                        collection: v.collection,
                        aggregationResponse: ar
                    }))
                )
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
    /** todo !!!! specify data type and return type  */
    public setData(data: any) {

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

}
