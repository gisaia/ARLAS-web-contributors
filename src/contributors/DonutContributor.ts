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
    Contributor, CollaborationEvent, Collaboration, projType, OperationEnum,
    CollaborativesearchService, ConfigService
} from 'arlas-web-core';
import { Observable, from} from 'rxjs';
import { Aggregation, AggregationResponse } from 'arlas-api';
import { DonutArc } from '../models/models';
import jsonSchema from '../jsonSchemas/donutContributorConf.schema.json';
import { DonutContributorService } from '../services/donutContributorService';



export class DonutContributor extends Contributor {
    public donutService: DonutContributorService;
    /**
     * Title given to the aggregation result
     */
    public title: string;
    /**
     * Data retrieved from ARLAS-server response and to be returned for the donut component as an input
     */
    public donutData: DonutArc;
    /**
     * The minimum ratio of the arc in its ring needed to be plot. Otherwise the arc is considered as OTHER
     */
    public arcMinPourcentage = (this.getConfigValue('arcMinPourcentage')) ? this.getConfigValue('arcMinPourcentage') : 0.01;
    /**
     * List of selected nodes to be returned to the donut component as an input
     */
    public selectedArcs: Array<Array<{ ringName: string, name: string }>> =
        new Array<Array<{ ringName: string, name: string }>>();
    /**
     * ARLAS Server Aggregation used to draw the donut, defined in configuration
     */
    private aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    /**
     * List of selected nodes returned from the donut component
     */

     constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        title: string

    ) {
        super(identifier, configService, collaborativeSearcheService);
        this.title = title;
        this.donutService = new DonutContributorService(identifier, collaborativeSearcheService, this.arcMinPourcentage, title);
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
        return 'arlas.web.contributors.donut';
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

    public computeData(aggregationResponse: AggregationResponse): DonutArc {
        return this.donutService.computeData(this.aggregations, aggregationResponse);
    }

    public setData(data: DonutArc): DonutArc {
        this.donutData = data;
        return data;
    }

    public setSelection(data: DonutArc, collaboration: Collaboration): any {
        this.selectedArcs = this.donutService.getSelectedArcs(collaboration);
        return from([]);
    }

    public selectedArcsListChanged(selectedArcsList: Array<Array<{ ringName: string, name: string }>>): void {
        this.donutService.updateCollaborationOnSelectedArcsChange(this.aggregations, selectedArcsList);
    }
}
