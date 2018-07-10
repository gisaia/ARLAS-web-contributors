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

import { tryCatch } from 'rxjs/util/tryCatch';
import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';
import {
    CollaborativesearchService, Contributor,
    ConfigService, projType, Collaboration, CollaborationEvent
} from 'arlas-web-core';
import {
    Search, Size, Sort,
    Projection, FeatureCollection, Hits,
    Filter, Aggregation, Expression, Hit
} from 'arlas-api';
import { getElementFromJsonObject, isArray, download } from '../utils/utils';
import { Action, ElementIdentifier, triggerType, SortEnum, FieldsConfiguration, Column, Detail, Field } from '../models/models';
import * as jsonpath from 'jsonpath';
import * as jsonSchema from '../jsonSchemas/resultlistContributorConf.schema.json';

/**
* Interface define in Arlas-web-components
*/
export interface DetailedDataRetriever {
    getData(identifier: string): Observable<{ details: Map<string, Map<string, string>>, actions: Array<Action> }>;
}
/**
* Class instanciate to retrieve the detail of an item of a resultlistcomponent.
*/
export class ResultListDetailedDataRetriever implements DetailedDataRetriever {
    /**
    * Contributor which the ResultListDetailedDataRetriever works
    */
    private contributor: ResultListContributor;
    /**
    * Method to retrieve detail data of an item
    * @param identifier string id of the item
    * @returns an observable of object which contains map key,value details and array of Action
    */
    public getData(identifier: string): Observable<{ details: Map<string, Map<string, string>>, actions: Array<Action> }> {
        let searchResult: Observable<Hits>;
        const search: Search = { size: { size: 1 } };
        const expression: Expression = {
            field: this.contributor.fieldsConfiguration.idFieldName,
            op: Expression.OpEnum.Eq,
            value: identifier
        };
        const filter: Filter = {
            f: [[expression]]
        };
        searchResult = this.contributor.collaborativeSearcheService.resolveHits([
            projType.search, search],
            this.contributor.identifier, filter);
        const obs: Observable<{ details: Map<string, Map<string, string>>, actions: Array<Action> }> = searchResult.map(searchData => {
            const detailsMap = new Map<string, Map<string, string>>();
            const details: Array<Detail> = this.contributor.getConfigValue('details');
            details.forEach(group => {
                const detailedDataMap = new Map<string, string>();
                group.fields.forEach(field => {
                    let results = '';
                    if (field.path.indexOf('.') < 0) {
                        results = jsonpath.query(searchData.hits[0].data, '$.' + field.path).join(',');
                    } else {
                        let query = '$.';
                        let composePath = '';
                        let lastElementLength: number;
                        let isDataArray = false;
                        let dataElement: any;
                        field.path.split('.').forEach(pathElment => {
                            if (isDataArray) {
                                dataElement = getElementFromJsonObject(dataElement[0], pathElment);
                            } else {
                                composePath = composePath + '.' + pathElment;
                                dataElement = getElementFromJsonObject(searchData.hits[0].data, composePath.substring(1));
                            }
                            isDataArray = isArray(dataElement);
                            if (isArray(dataElement)) {
                                query = query + pathElment + '[*].';
                                lastElementLength = 4;
                            } else {
                                query = query + pathElment + '.';
                                lastElementLength = 1;
                            }
                        });
                        query = query.substring(0, query.length - lastElementLength);
                        results = jsonpath.query(searchData.hits[0].data, query).join(', ');
                    }
                    if (results.length > 0) {
                        detailedDataMap.set(field.label, results);
                    }
                });
                detailsMap.set(group.name, detailedDataMap);
            });
            const actions = new Array<Action>();
            this.contributor.actionToTriggerOnClick.forEach(action => {
                const ac: Action = {
                    id: action.id,
                    label: action.label,
                    tooltip: action.tooltip,
                    cssClass: ''
                };
                const stylePath = action.cssClass;
                if (stylePath) {
                    ac.cssClass = getElementFromJsonObject(searchData.hits[0].data, stylePath);
                }
                actions.push(ac);

            });
            const objectResult = { details: detailsMap, actions: actions };
            return objectResult;
        });
        return obs;
    }
    /**
    * Get the ResultListContributor
    * @return ResultListContributor
    */
    public getContributor() {
        return this.contributor;
    }
    /**
    * Set the ResultListContributor
    * @param contributor contributor to set
    */
    public setContributor(contributor: ResultListContributor) {
        this.contributor = contributor;
    }
}
/**
 * This contributor works with the Angular ResultListComponent of the Arlas-web-components project.
 * This class make the brigde between the component which displays the data and the
 * collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
 */
export class ResultListContributor extends Contributor {
    /**
    * Data to feed result list, @Input() data of ResultListComponent.
    */
    public data: Array<Map<string, string | number | Date>> = new Array<Map<string, string | number | Date>>();
    /**
    * List of column of the table, @Input() fieldsList of ResultListComponent.
    */
    public fieldsList: Array<{ columnName: string, fieldName: string, dataType: string }> = [];
    /**
    * Instance of DetailedDataRetriever class, @Input() detailedDataRetriever of ResultListComponent.
    */
    public detailedDataRetriever = new ResultListDetailedDataRetriever();
    /**
    * List of actions, from all the contributors of the app, which we could trigger on click in the ResultListComponent.
    */
    public actionToTriggerOnClick: Array<Action> = [];


    public filtersMap: Map<string, string | number | Date> = new Map<string, string | number | Date>();
    /**
     * Sort parameter of the list.
    */
    private sort: Sort = {};
    /**
     * geoSort parameter of the list.
    */
    private geoOrderSort: Sort = {};

    private includesvalues = new Array<string>();


    public fieldsConfiguration = this.getConfigValue('fieldsConfiguration');
    private columns: Array<Column> = (this.getConfigValue('columns') !== undefined) ? (this.getConfigValue('columns')) : ([]);
    private columnsProcess = {};
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param fieldsConfiguration  @Input of Angular ResultListComponent, FieldsConfiguration.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService, collaborativeSearcheService);
        // Link the ResultListContributor and the detailedDataRetriever
        this.detailedDataRetriever.setContributor(this);
        this.fieldsList = [];
        this.columns.forEach(column => {
            this.columnsProcess[column.columnName] = column.process;
            this.fieldsList.push(column);
            this.includesvalues.push(column.fieldName);
        });
        this.includesvalues.push(this.fieldsConfiguration.idFieldName);
        if (this.fieldsConfiguration.titleFieldNames) {
            this.includesvalues.concat(this.fieldsConfiguration.titleFieldNames.map(field => field.fieldPath));
        }
        if (this.fieldsConfiguration.urlImageTemplate) {
            this.includesvalues.concat(this.fieldsFromUrlTemplate(this.fieldsConfiguration.urlImageTemplate));
        }
        if (this.fieldsConfiguration.urlThumbnailTemplate) {
            this.includesvalues.concat(this.fieldsFromUrlTemplate(this.fieldsConfiguration.urlThumbnailTemplate));
        }
        if (this.fieldsConfiguration.imageEnabled) {
            this.includesvalues.push(this.fieldsConfiguration.imageEnabled);
        }
        if (this.fieldsConfiguration.thumbnailEnabled) {
            this.includesvalues.push(this.fieldsConfiguration.thumbnailEnabled);
        }
        const setOfIncludeValues = new Set(this.includesvalues);
        this.includesvalues = Array.from(setOfIncludeValues);
    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }
    /**
    * Download item information as json
    * @param productIdentifier productIdentifier of item to dowload
    */
    public downloadItem(elementidentifier: ElementIdentifier) {
        let searchResult: Observable<Hits>;
        const search: Search = {
            size: { size: 1 },
            form: {
                pretty: true
            }
        };
        const expression: Expression = {
            field: elementidentifier.idFieldName,
            op: Expression.OpEnum.Eq,
            value: elementidentifier.idValue
        };
        const filter: Filter = {
            f: [[expression]]
        };
        const actionsList = new Array<string>();
        searchResult = this.collaborativeSearcheService.resolveHits([projType.search, search], null, filter);
        searchResult.map(data => JSON.stringify(data)).subscribe(
            data => {
                download(data.toString(), elementidentifier.idValue + '.json', 'text/json');
            }
        );
    }
    /**
    * @returns Pretty name of contribution.
    */
    public getFilterDisplayName(): string {
        return 'List';
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.resultlist';
    }
    /**
    * Method to add Action in actionToTrigger
    * @param action action to add
    */
    public addAction(action: Action) {
        if (this.actionToTriggerOnClick.indexOf(action, 0) < 0) {
            this.actionToTriggerOnClick.push(action);
        }
    }
    /**
    * Method to remove Action in actionToTrigger
    * @param action action to remove
    */
    public removeAction(action: Action) {
        const indexOnClick = this.actionToTriggerOnClick.indexOf(action, 0);
        if (indexOnClick > -1) {
            this.actionToTriggerOnClick.splice(indexOnClick, 1);
        }
    }
    /**
    * Method call when emit the output sortColumnEvent
    * @param sort sort params
    */
    public sortColumn(sortOutput: { fieldName: string, sortDirection: SortEnum }) {
        let prefix = null;
        if (sortOutput.sortDirection.toString() === '0') {
            prefix = '';
        } else if (sortOutput.sortDirection.toString() === '1') {
            prefix = '-';
        }
        let sort: Sort = {};
        if (prefix !== null) {
            sort = {
                'sort': prefix + sortOutput.fieldName
            };
        }
        this.sort = sort;
        this.geoOrderSort = {};
        this.getHitsObservable(this.includesvalues, this.sort)
            .map(f => this.computeData(f))
            .map(f => this.setData(f))
            .map(f => this.setSelection(f, this.collaborativeSearcheService.getCollaboration(this.identifier)))
            .subscribe(data => data);
    }
    /**
    * Method call when emit the output sortColumnEvent
    * @param sort sort params
    */
    public geoSort(lat: number, lng: number) {
        let sort: Sort = {};
        sort = {
            'sort': 'geodistance:' + lat.toString() + ' ' + lng.toString()
        };
        this.geoOrderSort = sort;
        this.getHitsObservable(this.includesvalues, this.geoOrderSort)
            .map(f => this.computeData(f))
            .map(f => this.setData(f))
            .map(f => this.setSelection(f, this.collaborativeSearcheService.getCollaboration(this.identifier)))
            .subscribe(data => data);
    }
    /**
    * Method call when emit the output setFiltersEvent
    * @param filterMap filter params
    */
    public setFilters(filterMap: Map<string, string | number | Date>) {
        if (filterMap.size === 0) {
            this.collaborativeSearcheService.removeFilter(this.identifier);
        } else {
            const expressions: Array<Expression> = [];
            filterMap.forEach((k, v) => {
                let op;
                if (v === this.fieldsConfiguration.idFieldName) {
                    op = Expression.OpEnum.Eq;
                } else {
                    op = Expression.OpEnum.Like;
                }
                if (k.toString().indexOf(',') > 0) {
                    k.toString().split(',').forEach(va => {
                        const expression: Expression = {
                            field: v,
                            op: op,
                            value: <string>va
                        };
                        expressions.push(expression);
                    });
                } else {
                    const expression: Expression = {
                        field: v,
                        op: op,
                        value: <string>k
                    };
                    expressions.push(expression);
                }
            });
            const filterValue: Filter = {
                f: [expressions]
            };
            const collaboration: Collaboration = { filter: filterValue, enabled: true };
            this.collaborativeSearcheService.setFilter(this.identifier, collaboration);
        }
    }
    /**
    * Method call when emit the output moreDataEvent
    * @param from· number of time that's scroll bar down
    */
    public getMoreData(from: number) {
        if (this.geoOrderSort !== {}) {
            this.getHitsObservable(this.includesvalues, this.geoOrderSort, from * this.getConfigValue('search_size'))
                .map(f => this.computeData(f))
                .map(f => f.forEach(d => { this.data.push(d); }))
                .subscribe(data => data);
        } else {
            this.getHitsObservable(this.includesvalues, this.sort, from * this.getConfigValue('search_size'))
                .map(f => this.computeData(f))
                .map(f => f.forEach(d => { this.data.push(d); }))
                .subscribe(data => data);
        }
    }
    public fetchData(collaborationEvent: CollaborationEvent): Observable<Hits> {
        return this.getHitsObservable(this.includesvalues, this.geoOrderSort);
    }

    public computeData(hits: Hits): Array<Map<string, string | number | Date>> {
        const listResult = new Array<Map<string, string | number | Date>>();
        if (hits.nbhits > 0) {
            hits.hits.forEach(h => {
                const map = new Map<string, string | number | Date>();
                this.fieldsList.forEach(element => {
                    const result: string = getElementFromJsonObject(h.data, element.fieldName);
                    const process: string = this.columnsProcess[element.columnName];
                    let resultValue = result;
                    if (process) {
                        if (process.trim().length > 0) {
                            resultValue = eval(this.columnsProcess[element.columnName]);
                        }
                    }
                    map.set(element.fieldName, resultValue);
                });
                if (this.fieldsConfiguration.titleFieldNames) {
                    this.fieldsConfiguration.titleFieldNames.forEach(field => {
                        this.setProcessFieldData(h, field, map, 'title');
                    });
                }
                if (this.fieldsConfiguration.tooltipFieldNames) {
                    this.fieldsConfiguration.tooltipFieldNames.forEach(field => {
                        this.setProcessFieldData(h, field, map, 'tooltip');
                    });
                }
                if (this.fieldsConfiguration.iconCssClass) {
                    const resultValue: string = getElementFromJsonObject(h.data, this.fieldsConfiguration.iconCssClass);
                    map.set(this.fieldsConfiguration.iconCssClass, resultValue);
                }
                if (this.fieldsConfiguration.urlImageTemplate) {
                    this.setUrlField('urlImageTemplate', h, map);
                }
                if (this.fieldsConfiguration.urlThumbnailTemplate) {
                    this.setUrlField('urlThumbnailTemplate', h, map);
                }
                if (this.fieldsConfiguration.imageEnabled) {
                    const imageEnabled = getElementFromJsonObject(h.data, this.fieldsConfiguration.imageEnabled);
                    if (imageEnabled != null) {
                        map.set('imageEnabled', imageEnabled.toString());
                    } else {
                        map.set('imageEnabled', '');
                    }
                }
                if (this.fieldsConfiguration.thumbnailEnabled) {
                    const thumbnailEnabled = getElementFromJsonObject(h.data, this.fieldsConfiguration.thumbnailEnabled);
                    if (thumbnailEnabled != null) {
                        map.set('thumbnailEnabled', thumbnailEnabled.toString());
                    } else {
                        map.set('thumbnailEnabled', '');
                    }
                }
                listResult.push(map);
            });
        }
        return listResult;

    }
    public setData(listResult: Array<Map<string, string | number | Date>>) {
        this.data = listResult;
        return this.data;

    }
    public setSelection(listResult: Array<Map<string, string | number | Date>>, collaboration: Collaboration): any {
        if (collaboration !== null) {
            const map = new Map<string, string | number | Date>();
            collaboration.filter.f.forEach(e => {
                e.forEach(f => {
                    if (map.get(f.field) === undefined) {
                        map.set(f.field, f.value);
                    } else {
                        map.set(f.field, map.get(f.field) + ',' + f.value);
                    }
                });
            });
            this.filtersMap = map;
        } else {
            this.filtersMap = new Map<string, string | number | Date>();
        }
        return Observable.from([]);
    }

    private getHitsObservable(includesvalues: Array<string>, sort?: Sort, from?: number): Observable<Hits> {
        const projection: Projection = {};
        const search: Search = { size: { size: this.getConfigValue('search_size') } };
        if (sort) {
            search.sort = sort;
        }
        if (from) {
            search.size.from = from;
        }
        search.projection = projection;
        projection.includes = includesvalues.join(',');
        const newData = [];
        const searchResult = this.collaborativeSearcheService
            .resolveButNotHits([projType.search, search])
            .finally(() => this.collaborativeSearcheService.contribFilterBus.next(this));
        return searchResult;
    }
    private fieldsFromUrlTemplate(urlTemplate: string): string {
        return urlTemplate
            .split('/')
            .filter(f => f.indexOf('{') >= 0)
            .map(f => f.slice(1, -1))
            .map(m => {
                let t;
                if (m.indexOf('$') >= 0) {
                    t = m.split('$')[0];
                } else {
                    t = m;
                }
                return t;
            }).join(',');
    }
    private setUrlField(urlField: string, h: Hit, map: Map<string, string | number | Date>) {
        this.fieldsConfiguration[urlField]
            .split('/')
            .filter(f => f.indexOf('{') >= 0).map(f => f.slice(1, -1)).forEach(f => {
                if (f.indexOf('$') >= 0) {
                    const tree = f.split('$');
                    let v = h.data;
                    for (const t of tree) {
                        if (v !== undefined) {
                            v = v[t];
                        } else {
                            v = undefined;
                            break;
                        }
                    }
                    let urlTemplate = '';
                    if (v !== undefined) {
                        if (this.getConfigValue('process')[urlField] !== undefined) {
                            const processUrlTemplate: string =
                                this.getConfigValue('process')[urlField]['process'];
                            if (processUrlTemplate.trim().length > 0) {
                                urlTemplate = eval(processUrlTemplate);
                            } else {
                                urlTemplate = v;
                            }
                        } else {
                            urlTemplate = v;
                        }
                        map.set(f, urlTemplate);
                    } else {
                        map.set(f, urlTemplate);
                    }
                } else {
                    map.set(f,
                        getElementFromJsonObject(h.data, f));
                }
            });
    }

    private setProcessFieldData(h: Hit, field: Field, map: Map<string, string | number | Date>, dataType: string) {
        const result: string = getElementFromJsonObject(h.data, field.fieldPath);
        const process: string = field.process;
        let resultValue = result;
        if (process) {
            if (process.trim().length > 0) {
                resultValue = eval(field.process);
            }
        }
        map.set(field.fieldPath + '_' + dataType, resultValue);
    }
}
