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


import jsonSchema from '../jsonSchemas/computeContributorConf.schema.json';
import {
    Contributor, CollaborativesearchService, ConfigService,
    CollaborationEvent, projType, OperationEnum, Collaboration
} from 'arlas-web-core';
import { Observable, from, forkJoin } from 'rxjs';
import { ComputationRequest, ComputationResponse, Filter, Hits } from 'arlas-api';
import { ComputeConfig } from '../models/models';
import { validProcess } from '../utils/utils';


/**
 * This contributor computes a metric on the given field, given the filters
 */
export class ComputeContributor extends Contributor {

    /** Array of which metrics & filters will be computed*/
    public metrics: Array<ComputeConfig> = this.getConfigValue('metrics');
    /** String value of function to apply to the results of computation metrics*/
    public function: string = this.getConfigValue('function');
    /** Title of the contributor*/
    public title: string = this.getConfigValue('title');
    /** Function to apply to the results of computation metrics*/
    public processFunction: Function;

    public metricValue: number;
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    public constructor(identifier: string, collaborativeSearcheService: CollaborativesearchService, configService: ConfigService,
        collection: string) {
        super(identifier, configService, collaborativeSearcheService, collection);
        this.collections = [];
        this.collections.push({
            collectionName: collection
        });
        if (this.function.trim().length > 0 && validProcess(this.function, 'm')) {
            this.processFunction = new Function('m', '\'use strict\';const r=' + this.function + '; return r;');
        }
    }

    /** return the json schem of this contributor */
    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    public isUpdateEnabledOnOwnCollaboration() {
        return false;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<Array<ComputationResponse>> {
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            const computationResponse: Observable<Array<ComputationResponse | Hits>> = forkJoin(this.metrics.map(m => {
                if (m.metric !== 'count') {
                    return this.collaborativeSearcheService.resolveButNotComputation([projType.compute,
                    <ComputationRequest>{ field: m.field, metric: ComputationRequest.MetricEnum[m.metric.toUpperCase()] }],
                        this.collaborativeSearcheService.collaborations, this.collection, this.identifier, !!m.filter ? m.filter : {},
                        false, this.cacheDuration);
                } else {
                    return this.collaborativeSearcheService.resolveButNotHits([projType.count, {}],
                        this.collaborativeSearcheService.collaborations, this.collection, this.identifier, !!m.filter ? m.filter : {},
                        false, this.cacheDuration);
                }
            }));
            return computationResponse;
        } else {
            return from([]);
        }
    }

    public computeData(data: Array<ComputationResponse | Hits>): Array<ComputationResponse> {
        return data;
    }

    public setData(data: Array<ComputationResponse | Hits>): any {
        const m = data.map(d => {
            if ('value' in d) {
                return (d as ComputationResponse).value;
            } else {
                return (d as Hits).totalnb;
            }
        });
        if (this.processFunction) {
            const resultValue = this.processFunction(m);
            this.metricValue = resultValue;
        } else {
            throw new Error('Invalid compute function: not defined.');
        }
        return from([]);
    }

    public setSelection(collaboration: Collaboration): any {
        return from([]);
    }

    /**
    * @returns Pretty name of contributor based on query propoerty.
    */
    public getFilterDisplayName(): string {
        return this.title;
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.compute';
    }
}
