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

/**
 * This contributor fetches data provided by a term aggrgation and formates it to be exploitable by donut and powerbars components.
 * This way, it's possible to configure the same contributor for a donut and a powerbar
 */

import { Contributor, CollaborativesearchService, ConfigService, CollaborationEvent,
     projType, OperationEnum, Collaboration } from 'arlas-web-core';
import { Aggregation, AggregationResponse, Filter } from 'arlas-api';
import jsonSchema from '../jsonSchemas/termsChartContributorConf.schema.json';
import { Observable, from } from 'rxjs';
import { FormattedTermsChartData } from '../models/models.js';
import { DonutContributorService } from '../services/donutContributorService.js';
import { PowerbarsContributorService } from '../services/powerbarsContributorService.js';

export class TermsChartContributor extends Contributor {
    /**
     * Title given to the aggregation result
     */
    public title: string;
    /**
     * Data retrieved from ARLAS-server response and to be returned for the donut and powerbars components as an input
     */
    public formattedTermsChartData: FormattedTermsChartData;
    /**
     * Object that contains the lists of selected terms formatted according to the component type (donut or powerbars)
     */
    public formattedSelectedTerms: {selectedArcs: Array<Array<{ ringName: string, name: string }>>, selectedBars: Set<string>} =
        {
            selectedArcs: new Array<Array<{ ringName: string, name: string }>>(),
            selectedBars: new Set<string>()
        };
    /**
     * ARLAS Server Aggregation used to draw the donut and powerbars, defined in configuration
     */
    private aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    private search = '';

    private donutService: DonutContributorService ;
    private powerbarsService: PowerbarsContributorService;

    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        title: string
    ) {
        super(identifier, configService, collaborativeSearcheService);
        this.title = title;
        this.donutService = new DonutContributorService(identifier, collaborativeSearcheService, 0, title);
        this.powerbarsService = new PowerbarsContributorService(identifier, collaborativeSearcheService);
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
        return 'arlas.web.contributors.terms';
    }

    public getFilterDisplayName(): string {
        return this.title;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<any> {
        const filterAgg: Filter = {};
        if (this.search.length > 0) {
            this.aggregations[this.aggregations.length - 1].include = encodeURI(this.search).concat('.*');
            filterAgg.q = [[this.aggregations[0].field.concat(':').concat(this.search).concat('*')]];
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

    public computeData(aggregationResponse: AggregationResponse): FormattedTermsChartData {
        const termsFormatedData: FormattedTermsChartData = {donutData: null, powerbarsData: null};
        termsFormatedData.donutData = this.donutService.computeData(this.aggregations, aggregationResponse);
        termsFormatedData.powerbarsData = this.powerbarsService.computeData(aggregationResponse, '$.count');
        return termsFormatedData;
    }

    public setData(data: FormattedTermsChartData): FormattedTermsChartData {
        this.formattedTermsChartData = data;
        return data;
    }

    public setSelection(data: FormattedTermsChartData, collaboration: Collaboration): any {
        this.formattedSelectedTerms = {
            selectedArcs: this.donutService.getSelectedArcs(collaboration),
            selectedBars: this.powerbarsService.getSelectedBars(collaboration)
        };
        return from([]);
    }

    public selectedArcsListChanged(selectedArcsList: Array<Array<{ ringName: string, name: string }>>) {
        this.donutService.updateCollaborationOnSelectedArcsChange(this.aggregations, selectedArcsList);
    }

    public selectedBarsChanged(selectedBars: Set<string>) {
        this.powerbarsService.updateCollaborationOnSelectedBarsChange(selectedBars, this.aggregations[0].field);
        this.formattedSelectedTerms.selectedBars = selectedBars;
    }

    public updatePowerbarsData(search: any) {
        this.search = search;
        this.powerbarsService.updatePowerbarsData(search, this.aggregations, '$.count', this.formattedTermsChartData.powerbarsData);
    }
}
