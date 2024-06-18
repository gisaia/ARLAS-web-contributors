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

import { Collaboration, CollaborationEvent, CollaborativesearchService, ConfigService, Contributor, OperationEnum, projType } from 'arlas-web-core';
import { AggregationResponse } from 'arlas-api';
import { MetricsMatrix, MetricsMatrixConfig } from '../models/metrics-matrix.config';
import { Observable, forkJoin, of } from 'rxjs';

/**
 * This contributor fetches metrics from different collection by term. The terms are value of a termfield specified for each collection.
 * The fetched metrics are formatted into a table to provide data to MetricsMatrixComponent.
 * This contributor handles multi-collection filters.
 */
export class MetricsMatrixContributor extends Contributor {

    /** @field */
    public matrix: MetricsMatrix;
    /** @field */
    public nbTerms: number;

    public constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        /** configuration to query data for metrics matrix */
        configuration: MetricsMatrixConfig, 
        /** Number of terms for each collection (same for all). */
        nbTerms: number) {
        super(identifier, configService, collaborativeSearcheService);
        this.matrix = new MetricsMatrix(configuration, nbTerms);
    }

    /** @override */
    public fetchData(collaborationEvent: CollaborationEvent): Observable<Array<AggregationResponse>> {
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return forkJoin(this.matrix.vectors.map(v =>
                this.collaborativeSearcheService.resolveButNotAggregation([projType.aggregate, [v.getAggregation()]],
                    this.collaborativeSearcheService.collaborations,
                    this.collection,
                    this.identifier, {}, false, this.cacheDuration
                )))
        }
        return of()
    }

    /** @override */
    /** todo !!!! specify data type and return type  */
    public computeData(data: any): any {

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
