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

import { Observable, from } from 'rxjs';
import {
    Collaboration,
    CollaborativesearchService,
    ConfigService,
    Contributor,
    OperationEnum,
    projType, CollaborationEvent
} from 'arlas-web-core';
import { Aggregation, AggregationResponse } from 'arlas-api';
import jsonSchema from '../jsonSchemas/powerbarsContributorConf.schema.json';
import { PowerbarsContributorService } from '../services/powerbarsContributorService.js';

/**
* This contributor works with the Angular PowerbarsComponent of the Arlas-web-components project.
* This class make the brigde between the component which displays the data and the
* collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
*/
export class PowerbarsContributor extends Contributor {
     /**
     * data retrieved from Server response and to be returned for the component as input
     * @Input() inputData
     */
    public powerbarsData: Array<[string, number]>;

    /**
     * selectedBars is the list of selected terms in the component.
     */
    public selectedBars: Set<string>;

    /**
     * Title given to the aggregation result
     */
    public title: string;

    public powerbarsService: PowerbarsContributorService;
    /**
    * ARLAS Server Aggregation used to draw the chart, define in configuration
    */
    private aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');

    /**
    * Json path to explore element aggregation, count by default
    */
    private json_path: string = this.getConfigValue('jsonpath') !== undefined ? this.getConfigValue('jsonpath') : '$.count';

    /**
    * ARLAS Server field of aggregation used to draw the powerbars, retrieve from Aggregation
    */
    private field: string = (this.aggregations !== undefined) ? (this.aggregations[this.aggregations.length - 1].field) : (undefined);

    private search = '';

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
        title: string
    ) {
        super(identifier, configService, collaborativeSearcheService);
        this.powerbarsService = new PowerbarsContributorService(identifier, collaborativeSearcheService);
        this.title = title;
    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    /**
    * @returns Pretty name of contribution based on selected bar
    */
    public getFilterDisplayName(): string {
        return this.title;
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.powerbars';
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<AggregationResponse> {
        const filterAgg: Filter = {};
        if (this.search.length > 0) {
            this.aggregations[this.aggregations.length - 1].include = encodeURI(this.search).concat('.*');
            filterAgg.q = [[this.field.concat(':').concat(this.search).concat('*')]];
        } else {
            delete this.aggregations[this.aggregations.length - 1].include;
        }
        const aggregationObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, this.aggregations], this.collaborativeSearcheService.collaborations,
            this.identifier, filterAgg
        );
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return aggregationObservable;
        } else {
            return from([]);
        }
    }

    public computeData(aggregationResponse: AggregationResponse): Array<[string, number]> {
        return this.powerbarsService.computeData(aggregationResponse, this.json_path);
    }

    public setData(data: Array<[string, number]>): Array<[string, number]> {
        this.powerbarsData = data;
        return data;
    }

    public setSelection(data: Array<[string, number]>, collaboration: Collaboration): any {
        this.selectedBars = this.powerbarsService.getSelectedBars(collaboration);
        return from([]);
    }

    public selectedBarsChanged(selectedBars: Set<string>) {
        this.powerbarsService.updateCollaborationOnSelectedBarsChange(selectedBars, this.field);
        this.selectedBars = selectedBars;
    }

    public updatePowerbarsData(search: any) {
        this.search = search;
        const filterAgg: Filter = {};
        if (this.search.length > 0) {
            this.aggregations[this.aggregations.length - 1].include = encodeURI(this.search).concat('.*');
            filterAgg.q = [[this.field.concat(':').concat(this.search).concat('*')]];
        } else {
            delete this.aggregations[this.aggregations.length - 1].include;
        }
        const aggregationObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, this.aggregations], this.collaborativeSearcheService.collaborations,
            this.identifier, filterAgg
        );
        aggregationObservable.subscribe(aggregationResonse => {
            const powerbarsTab = new Array<[string, number]>();
            if (aggregationResonse.elements !== undefined) {
                aggregationResonse.elements.forEach(element => {
                    const value = jp.query(element, this.json_path)[0];
                    powerbarsTab.push([element.key, value]);
                });
                this.sortPowerBarsTab(powerbarsTab);
            }
            this.powerbarsData = powerbarsTab;
        });
    }

    /**
     * Sorts the powerbarsTab from the biggest term value to the lower
     */
    private sortPowerBarsTab(powerbarsTab: Array<[string, number]>): void {
        powerbarsTab.sort((a: [string, number], b: [string, number]) => b[1] - a[1]);
    }
}
