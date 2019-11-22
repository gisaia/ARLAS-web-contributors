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
import { Contributor, CollaborativesearchService, ConfigService, CollaborationEvent, projType, OperationEnum, Collaboration } from 'arlas-web-core';
import { Observable, from } from 'rxjs';
import { ComputationRequest, ComputationResponse } from 'arlas-api';
/**
 * This contributor computes a metric on the given field, given the filters
 */
export class ComputeContributor extends Contributor {

    /** Field on which the metric will be computed*/
    public field: string = this.getConfigValue('field');
    /** Field on which the metric will be computed*/
    public metric: string = this.getConfigValue('metric');
    /** Title of the contributor*/
    public title: string = this.getConfigValue('title');
    /** A process to apply on `this.metricValue`*/
    public process: string = this.getConfigValue('process');

    public metricValue: number;
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(identifier: string, collaborativeSearcheService: CollaborativesearchService, configService: ConfigService) {
        super(identifier, configService, collaborativeSearcheService);
    }

    /** return the json schem of this contributor */
    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<ComputationResponse> {
        const computationResponse = this.collaborativeSearcheService.resolveButNotComputation([projType.compute,
            <ComputationRequest>{field: this.field, metric: ComputationRequest.MetricEnum[this.metric.toUpperCase()]}],
             this.collaborativeSearcheService.collaborations, this.identifier );

        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return computationResponse;
        } else {
            return from([]);
        }
    }

    public computeData(data: ComputationResponse): ComputationResponse {
        return data;
    }

    public setData(data: ComputationResponse): any {
        const result = data.value;
        let resultValue = result;
        if (this.process && this.process.trim().length > 0) {
            resultValue = eval(this.process);
        }
        this.metricValue = resultValue;
        return from([]);
    }

    public setSelection(collaboration: Collaboration): any {
        return from([]);
    }

    /**
    * @returns Pretty name of contributor based on query propoerty.
    */
    public getFilterDisplayName(): string {
        return 'Computed ' + this.metric + ' on ' + this.field;
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.compute';
    }
}
