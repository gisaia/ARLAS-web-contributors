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

import { Observable, Subject, from } from 'rxjs';
import {
    Collaboration,
    CollaborativesearchService,
    ConfigService,
    Contributor,
    CollaborationEvent,
    projType
} from 'arlas-web-core';
import { Hits } from 'arlas-api';
import jsonSchema from '../jsonSchemas/searchContributorConf.schema.json';
import { Aggregation, AggregationResponse, Filter, Expression } from 'arlas-api';

export class SearchContributor extends Contributor {

    /**
     * Keyword field on which the full text search is applied
     */
    public searchField: string = this.getConfigValue('search_field');

    /**
     * Keyword field on which the autocompletion is performed
     */
    public autoCompleteField: string = this.getConfigValue('autocomplete_field');

    /**
     * Number of suggested keywords by the autocompletion
     */
    public autoCompleteSize: number = this.getAutoCompleteSize();

    public lastBackspaceBus: Subject<boolean>;

    public searching = false;

    private AUTOCOMPLETE_DEFAULT_SIZE = 20;

    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param  lastBackspaceBus bus from searchcomponent properties, send if the input is empty on backspace
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    public constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        collection: string
    ) {
        super(identifier, configService, collaborativeSearcheService, collection);
        this.collections = [];
        this.collections.push({
            collectionName: collection
        });
    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    public isUpdateEnabledOnOwnCollaboration() {
        return false;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<[]> {
        return from([]);
    }

    public computeData(data: { label: string; hits: Hits; }): { label: string; hits: Hits; } {
        return data;
    }
    public setData(data: { label: string; hits: Hits; }): any {
        return from([]);

    }
    public setSelection(collaboration: Collaboration): any {
        return from([]);
    }

    /**
    * @returns Pretty name of contributor.
    */
    public getFilterDisplayName(): string {
        return '';
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.search';
    }

    public getAutoCompleteResponse$(search: string): Observable<AggregationResponse> {
        const aggregation: Aggregation = {
            type: Aggregation.TypeEnum.Term,
            field: this.autoCompleteField,
            include: search + '.*',
            size: (this.autoCompleteSize).toString()
        };
        // Add filter to improve aggregation performances
        const filterAgg: Filter = {
            f: [[{
                field: this.autoCompleteField,
                op: Expression.OpEnum.Like,
                value: search
            }]]
        };

        this.searching = true;
        return this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, [aggregation]],
            this.collaborativeSearcheService.collaborations,
            this.collection,
            this.identifier,
            filterAgg
        );

    }


    public search(value: string) {
        if (value.trim() !== '') {
            const filter: Filter = {
                q: [[this.searchField + ':' + value.trim()]]
            };
            const collabFilters = new Map<string, Filter[]>();
            collabFilters.set(this.collection, [filter]);
            const collaboration: Collaboration = {
                filters: collabFilters,
                enabled: true
            };

            this.collaborativeSearcheService.setFilter(this.identifier, collaboration);
        }
    }

    private getAutoCompleteSize(): number {
        const autoCompleteSize = this.getConfigValue('autocomplete_size');
        return (autoCompleteSize !== undefined) ? autoCompleteSize : this.AUTOCOMPLETE_DEFAULT_SIZE;
    }
}
