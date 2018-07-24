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

import * as jsonSchema from '../jsonSchemas/analyticsContributorConf.schema.json';
import * as jsonpath from 'jsonpath';
import {
    Contributor, CollaborativesearchService, ConfigService,
    CollaborationEvent, projType, OperationEnum, Collaboration
} from 'arlas-web-core';
import { Aggregation, AggregationResponse } from 'arlas-api';
import { Observable } from 'rxjs/Observable';

/**
* This contributor works with the Angular Analytic board of the Arlas-web-components project.
* This contributor send data to hide/show panel in Analytic board.
* This class make the brigde between the component which displays the data and the
* collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
*/
export class AnalyticsContributor extends Contributor {

    /**
     * Map of string,boolean retrieved from Server response and to be returned for the component as input
     * @Input() inputData
     */
    public analitycsIdtoShowed: Map<string, boolean> = new Map<string, boolean>();
    /**
    * ARLAS Server Aggregation used to draw the chart, define in configuration
    */
    private aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');


    /**
    * Json path to explore element aggregation, count by default
    */
    private json_path: string = this.getConfigValue('jsonpath') !== undefined ? this.getConfigValue('jsonpath') : '$.count';

    /**
    * Build a new contributor.
    * @param identifier  Identifier of the contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        private groupIdToValues: Map<string, Array<string>>
    ) {
        super(identifier, configService, collaborativeSearcheService);
    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    /**
    * @returns Pretty name of contribution based on selected bar
    */
    public getFilterDisplayName(): string {
        return '';
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.analytics';
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<AggregationResponse> {
        const aggregationObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, this.aggregations], this.collaborativeSearcheService.collaborations,
            this.identifier
        );
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return aggregationObservable;
        } else {
            return Observable.from([]);
        }
    }

    public computeData(aggregationResonse: AggregationResponse): Map<string, number> {
        const valueToMetric = new Map<string, number>();
        if (aggregationResonse.elements !== undefined) {
            aggregationResonse.elements.forEach(element => {
                const value = jsonpath.query(element, this.json_path)[0];
                valueToMetric.set(element.key, value);
            });
        }
        return valueToMetric;
    }

    public setData(data: Map<string, number>): Map<string, number> {
        this.groupIdToValues.forEach((values, key) => {
            if (values.indexOf('*') > 0) {
                this.analitycsIdtoShowed.set(key, true);
            } else if (values.map(v => data.get(v)).filter(v => v !== undefined && v > 0).length > 0) {
                this.analitycsIdtoShowed.set(key, true);
            } else {
                this.analitycsIdtoShowed.set(key, false);
            }
        });
        return data;
    }

    public setSelection(data: Array<[string, number]>, collaboration: Collaboration): any {
        return Observable.from([]);
    }
}
