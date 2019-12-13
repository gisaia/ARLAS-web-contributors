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
import { map, mergeAll } from 'rxjs/operators';


import {
    Collaboration,
    CollaborativesearchService,
    ConfigService,
    Contributor,
    OperationEnum,
    projType, CollaborationEvent
} from 'arlas-web-core';
import { Hits, Filter } from 'arlas-api';
import jsonSchema from '../jsonSchemas/chipssearchContributorConf.schema.json';
/**
 * This contributor must work with SearchContributor and a component
 * to display several chips label from SearchComponent.
 * This class make the brigde between the component which displays the data and the
 * collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
 */
export class ChipsSearchContributor extends Contributor {

    /**
    * Global query based on all concatenate chips word
    */
    public query: string;
    /**
    * Map of string/number, label/count of all chips, use in input of component
    */
    public chipMapData: Map<string, number> = new Map<string, number>();

    public lastBackspaceBus: Subject<boolean>;

    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param  lastBackspaceBus bus from searchcomponent properties, send if the input is empty on backspace
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService, collaborativeSearcheService);
    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<{ label: string, hits: Hits }> {
        const tabOfCount: Array<Observable<{ label: string, hits: Hits }>> = [];
        if (collaborationEvent.id !== this.identifier) {
            let f = new Array<string>();
            const fil = this.collaborativeSearcheService.getCollaboration(this.identifier);
            if (fil != null) {
                f = Array.from(this.chipMapData.keys());
                f.forEach(k => {
                    if (fil.filter.q[0].indexOf(k) < 0) {
                        this.chipMapData.delete((k));
                    }
                });
                f = fil.filter.q[0];
            }
            if (f.length > 0) {
                f.forEach((k) => {
                    if (k.length > 0) {
                        const filter: Filter = {
                            q: [[k]]
                        };
                        const countData: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits(
                            [projType.count, {}], this.collaborativeSearcheService.collaborations,
                            this.identifier,
                            filter, false, this.cacheDuration
                        );
                        tabOfCount.push(
                            countData.pipe(
                                map(c => {
                                    return { label: k, hits: c };
                                })
                            )
                        );
                    }
                });
            } else {
                this.chipMapData.clear();
                this.query = '';
            }
        } else {
            if (collaborationEvent.operation.toString() === OperationEnum.remove.toString()) {
                this.chipMapData.clear();
                this.query = '';
            }
        }
        return from(tabOfCount).pipe(mergeAll());
    }

    public computeData(data: { label: string, hits: Hits }): { label: string, hits: Hits } {
        return data;
    }
    public setData(data: { label: string, hits: Hits }): any {
        this.chipMapData.set(data.label, data.hits.totalnb);
        let query = '';
        this.chipMapData.forEach((k, q) => {
            query = query + q + '||';
        });
        this.query = query.substring(0, query.length - 2);
        return from([]);

    }
    public setSelection(collaboration: Collaboration): any {
        return from([]);
    }

    /**
    * @returns Pretty name of contributor based on query propoerty.
    */
    public getFilterDisplayName(): string {
        return this.query;
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.chipssearch';
    }
    /**
    * Add a new chip with value and count, set filter.
    * @param value  Label of the chip.
    */
    public addWord(value: string) {
        if (value !== undefined && value !== null) {
            if (value.length > 0) {
                this.chipMapData.set(value, 0);
                this.setFilterFromMap();
                const filter: Filter = {
                    q: [[value]]
                };
                const countData: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits(
                    [projType.count, {}], this.collaborativeSearcheService.collaborations,
                    this.identifier,
                    filter, false, this.cacheDuration
                );
                countData.subscribe(
                    count => {
                        this.chipMapData.set(value, count.totalnb);
                    }
                );
            }
        }
    }
    /**
    * Remove a chip , set filter.
    * @param value  Label of the chip.
    */
    public removeWord(word: string) {
        this.chipMapData.delete(word);
        if (this.chipMapData.size === 0) {
            this.collaborativeSearcheService.removeFilter(this.identifier);
        }
        this.setFilterFromMap();
    }
    /**
     * Subscribe to the sizeOnSearchBackspaceBus to remove last chip on backspace keyup
     */
    public activateLastBackspace(lastBackspace: Subject<boolean>) {
        this.lastBackspaceBus = lastBackspace;
        this.lastBackspaceBus.subscribe(value => {
            if (value && this.chipMapData.size > 0) {
                this.removeLastWord();
            }
        });
    }

    /**
    * Remove last chip , set filter.
    */
    private removeLastWord() {
        const chipAsArray = Array.from(this.chipMapData.keys());
        const lastLabel = chipAsArray[chipAsArray.length - 1];
        if (lastLabel !== undefined) {
            this.removeWord(lastLabel);
        }
    }
    /**
    * Set Filter for collaborative search service from wordToCount map.
    */
    private setFilterFromMap() {
        let strquery = '';
        const tabquery = [];

        this.chipMapData.forEach((k, q) => {
            tabquery.push(q);
            strquery = strquery + q + '||';
        });
        strquery = strquery.substring(0, strquery.length - 2);

        this.query = strquery;
        const filters: Filter = {
            q: [tabquery]
        };
        if (this.query.trim().length > 0) {
            const data: Collaboration = {
                filter: filters,
                enabled: true
            };
            this.collaborativeSearcheService.setFilter(this.identifier, data);
        }
    }
}
