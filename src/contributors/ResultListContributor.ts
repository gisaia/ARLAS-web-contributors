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
import { filter, map, finalize } from 'rxjs/operators';

import {
    CollaborativesearchService, Contributor,
    ConfigService, projType, Collaboration, CollaborationEvent
} from 'arlas-web-core';
import {
    Search,
    Projection, Hits,
    Filter, Aggregation, Expression, Hit
} from 'arlas-api';
import { getElementFromJsonObject, isArray, download, appendIdToSort, removePageFromIndex, ASC, getFieldValue } from '../utils/utils';
import {
    Action, ElementIdentifier, SortEnum, Column, Detail, Field, FieldsConfiguration,
    PageEnum, AdditionalInfo, Attachment, AttachmentConfig
} from '../models/models';
import jsonSchema from '../jsonSchemas/resultlistContributorConf.schema.json';

/**
* Interface defined in Arlas-web-components
*/
export interface DetailedDataRetriever {
    getData(identifier: string): Observable<AdditionalInfo>;
    getActions(item: any): Observable<Array<Action>>;
}

/**
* Implementation of `DetailedDataRetriever` interface to retrieve detailed information about an item in the resultlist.
*/
export class ResultListDetailedDataRetriever implements DetailedDataRetriever {
    /**
    * Contributor which the ResultListDetailedDataRetriever works
    */
    private contributor: ResultListContributor;

    public getActions(item: any): Observable<Array<Action>> {
        const actions = new Array<Action>();
        this.contributor.actionToTriggerOnClick.forEach(action => {
            const ac: Action = {
                id: action.id,
                label: action.label,
                tooltip: action.tooltip,
                cssClass: ''
            };
            const cssClass = item.itemData ? item.itemData.get(action.cssClass) : undefined;
            // cssClass = false is a valid possibiliy
             if (cssClass !== undefined) {
                ac.cssClass = String(cssClass);
            }
            actions.push(ac);
        });
        return from(new Array(actions));
    }
    /**
    * Method to retrieve detail data of an item
    * @param identifier string id of the item
    * @returns an observable of object that contains details information in form of a map and an array of actions applicable on the item.
    */
    public getData(identifier: string): Observable<AdditionalInfo> {
        let searchResult: Observable<Hits>;
        const search: Search = { page: { size: 1 } };
        const expression: Expression = {
            field: this.contributor.fieldsConfiguration.idFieldName,
            op: Expression.OpEnum.Eq,
            value: identifier
        };
        const filterExpression: Filter = {
            f: [[expression]]
        };
        searchResult = this.contributor.collaborativeSearcheService.resolveHits([
            projType.search, search], this.contributor.collaborativeSearcheService.collaborations,
            this.contributor.identifier, filterExpression, false, this.contributor.cacheDuration);
        const obs: Observable<AdditionalInfo> = searchResult.pipe(map(searchData => {
            const detailsMap = new Map<string, Map<string, string>>();
            const details: Array<Detail> = this.contributor.getConfigValue('details');
            details.forEach(group => {
                const detailedDataMap = new Map<string, string>();
                group.fields.forEach(field => {
                    const result = getFieldValue(field.path, searchData.hits[0].data).join(',');
                    if (result.length > 0) {
                        const process: string = field.process;
                        let resultValue = result;
                        if (process) {
                            if (process.trim().length > 0) {
                                resultValue = eval(field.process);
                            }
                        }
                        detailedDataMap.set(field.label, resultValue);
                    }
                });
                detailsMap.set(group.name, detailedDataMap);
            });
            const attachments = new Array<Attachment>();
            const attachmentsConfig: Array<AttachmentConfig> = (this.contributor.getConfigValue('attachments') !== undefined)
                ? (this.contributor.getConfigValue('attachments')) : ([]);
            attachmentsConfig.forEach(att => {
                const attachmentsValues = getFieldValue(att.attachmentsField, searchData.hits[0].data);
                if (attachmentsValues && attachmentsValues.length === 1) {
                    if (isArray(attachmentsValues[0])) {
                        attachmentsValues[0].forEach(attachmentValue => {
                            const label = getFieldValue(att.attachmentLabelField,
                                attachmentValue).toString();
                            const url = getFieldValue(att.attachementUrlField,
                                attachmentValue).toString();
                            const type = getFieldValue(att.attachmentTypeField,
                                attachmentValue).toString();
                            const description = getFieldValue(att.attachmentDescriptionField,
                                attachmentValue).toString();
                            attachments.push({
                                label: label,
                                url: url,
                                description: description,
                                type: type,
                                icon: att.attachmentIcon
                            });
                        });
                    }
                }
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
            const objectResult = { details: detailsMap, actions: actions, attachments: attachments };
            return objectResult;

        }));
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
    * Data to populate result list, @Input() data of ResultListComponent.
    */
    public data: Array<Map<string, string | number | Date>> = new Array<Map<string, string | number | Date>>();
    /**
    * List of columns of the table, @Input() fieldsList of ResultListComponent.
    */
    public fieldsList: Array<{ columnName: string, fieldName: string, dataType: string, useColorService?: boolean }> = [];
    /**
    * List of values to select mapped to each field represented on the resultList. The list of values to select is wrapped in an Observable.
    */
    public dropDownMapValues: Map<string, Observable<Array<string>>> = new Map<string, Observable<Array<string>>>();
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
     * A configuration object that allows to set id field, title field, fields used in tooltip/icons and urls to images & thumbnails
     */
    public fieldsConfiguration: FieldsConfiguration = this.getConfigValue('fieldsConfiguration');

    /**
     * List of metadata fields to include in the search query
     */
    public includeMetadata: Array<string> = this.getConfigValue('includeMetadata');
    /**
     * Number of items in a page of the list. Default to 100.
     */
    public pageSize = this.getConfigValue('search_size') ? this.getConfigValue('search_size') : 100;
    /**
     * Maximum number of pages that the contributor fetches. Default to 3.
     */
    public maxPages = this.getConfigValue('max_pages') ? this.getConfigValue('max_pages') : 3;
    /**
     * Indicates whether the contributor reached the start/end page
     */
    public fetchState = { endListUp: true, endListDown: false };
    /**
     * A filter that is taken into account when fetching list items and that is not included in the global collaboration.
     */
    public filter = {};
    /**
     * comma seperated field names that sort the list. Order matters.
    */
    public sort = '';
    /**
     * geoSort parameter of the list.
    */
    public geoOrderSort = '';

    public cacheDuration = this.cacheDuration;

    private includesvalues = new Array<string>();
    private columns: Array<Column> = (this.getConfigValue('columns') !== undefined) ? (this.getConfigValue('columns')) : ([]);
    private columnsProcess = {};
    /** CONSTANTS */
    private NEXT_AFTER = '_nextAfter';
    private PREVIOUS_AFTER = '_previousAfter';
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
            if (column.dropdown) {
                let size = 10;
                if (column.dropdownsize) {
                    size = column.dropdownsize;
                }
                this.dropDownMapValues.set(column.fieldName, this.getDropDownValues(column.fieldName, size.toString()));
            } else {
                this.dropDownMapValues.set(column.fieldName, from([[]]));
            }
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
        if (this.fieldsConfiguration.imageFieldName) {
            this.includesvalues.push(this.fieldsConfiguration.imageFieldName);
        }
        if (this.fieldsConfiguration.thumbnailFieldName) {
            this.includesvalues.push(this.fieldsConfiguration.thumbnailFieldName);
        }
        if (this.fieldsConfiguration.iconCssClass) {
            this.includesvalues.push(this.fieldsConfiguration.iconCssClass);
        }
        if (this.fieldsConfiguration.iconColorFieldName) {
            this.includesvalues.push(this.fieldsConfiguration.iconColorFieldName);
        }
        if (this.includeMetadata) {
            this.includeMetadata.forEach(field => this.includesvalues.push(field));
        }
        const setOfIncludeValues = new Set(this.includesvalues);
        this.includesvalues = Array.from(setOfIncludeValues);

        this.collaborativeSearcheService.collaborationBus
            // if filter comes from other contributor or if it's a remove filter
            .pipe(filter(c => c.id !== this.identifier || c.operation === 1))
            .subscribe(c => {
                this.dropDownMapValues.clear();
                this.columns.forEach(column => {
                    if (column.dropdown) {
                        let size = 10;
                        if (column.dropdownsize) {
                            size = column.dropdownsize;
                        }
                        this.dropDownMapValues.set(column.fieldName, this.getDropDownValues(column.fieldName, size.toString()));
                    } else {
                        this.dropDownMapValues.set(column.fieldName, from([[]]));
                    }
                });
            });
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
            page: { size: 1 },
            form: {
                pretty: true
            }
        };
        const expression: Expression = {
            field: elementidentifier.idFieldName,
            op: Expression.OpEnum.Eq,
            value: elementidentifier.idValue
        };
        const filterExpression: Filter = {
            f: [[expression]]
        };
        searchResult = this.collaborativeSearcheService
            .resolveHits([projType.search, search], this.collaborativeSearcheService.collaborations,
                null, filterExpression, false, this.cacheDuration);
        searchResult.pipe(map(data => JSON.stringify(data))).subscribe(
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
     * Sorts the list according to the given sort parameters. If `sortParams` is not defined, and `sortById=true` then the list is sorted by
     * id (`fieldsConfiguration.idFieldName`)
     * @param sortParams sort parameters. They include on which field (column) to sort and in which direction (ascending, descending)
     * @param sortById whether to add a sort by id (`fieldsConfiguration.idFieldName`) to the sorted column
     */
    public sortColumn(sortParams: { fieldName: string, sortDirection: SortEnum }, sortById?: boolean) {
        this.geoOrderSort = '';
        let sort = '';
        if (sortParams && sortParams.fieldName && sortParams.sortDirection) {
            let prefix = null;
            if (sortParams.sortDirection.toString() === '0') {
                prefix = '';
            } else if (sortParams.sortDirection.toString() === '1') {
                prefix = '-';
            }
            if (prefix !== null) {
                sort = prefix + sortParams.fieldName;
            }
            if (sortById) {
                this.sort = appendIdToSort(sort, ASC, this.fieldsConfiguration.idFieldName);
            } else {
                this.sort = sort;
            }
        } else {
            if (sortById) {
                this.sort = appendIdToSort(sort, ASC, this.fieldsConfiguration.idFieldName);
            }
        }
        if (this.sort && this.sort !== '') {
            this.getHitsObservable(this.includesvalues, this.sort)
                .pipe(
                    map(f => this.computeData(f)),
                    map(f => this.setData(f)),
                    map(f => this.setSelection(f, this.collaborativeSearcheService.getCollaboration(this.identifier)))
                )
                .subscribe(data => data);
        }
    }
    /**
    * Method sorts by geo-distance to a given geo-point
    * @param lat latitude of the geo-point
    * @param lng longitude of the geo-point
    * @param sortById whether to add a sort by id to the geosort or not
    */
    public geoSort(lat: number, lng: number, sortById?: boolean) {
        let geosort = '';
        geosort = 'geodistance:' + lat.toString() + ' ' + lng.toString();
        if (sortById) {
            this.geoOrderSort = appendIdToSort(geosort, ASC, this.fieldsConfiguration.idFieldName);
        } else {
            this.geoOrderSort = geosort;
        }
        this.sort = '';
        this.getHitsObservable(this.includesvalues, this.geoOrderSort)
            .pipe(
                map(f => this.computeData(f)),
                map(f => this.setData(f)),
                map(f => this.setSelection(f, this.collaborativeSearcheService.getCollaboration(this.identifier)))
            )
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
            const filterValue: Filter = {
                f: []
            };
            filterMap.forEach((k, v) => {
                let op;
                if (v === this.fieldsConfiguration.idFieldName) {
                    op = Expression.OpEnum.Eq;
                    const expressions: Array<Expression> = [];
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
                    filterValue.f.push(expressions);
                } else {
                    op = Expression.OpEnum.Like;
                    if (k.toString().indexOf(',') > 0) {
                        const expressions: Array<Expression> = [];
                        k.toString().split(',').forEach(va => {
                            const expression: Expression = {
                                field: v,
                                op: op,
                                value: <string>va
                            };
                            expressions.push(expression);
                        });
                        filterValue.f.push(expressions);
                    } else {
                        const expression: Expression = {
                            field: v,
                            op: op,
                            value: <string>k
                        };
                        filterValue.f.push([expression]);
                    }
                }
            });

            const collaboration: Collaboration = { filter: filterValue, enabled: true };
            this.collaborativeSearcheService.setFilter(this.identifier, collaboration);
        }
    }
    /**
     * Method called to load more rows into the list.
     * @param startFrom It corresponds to the number of times this method is being called. It's used to calculate an offset to get
     * the following items
     * @param sortById Whether to add a sortById to the cuurent sort/geosort
     * @deprecated Use `getPage` method instead
     */
    public getMoreData(startFrom: number, sortById?: boolean) {
        const currentSort = this.geoOrderSort ? this.geoOrderSort : this.sort;
        let sort;
        if (sortById) {
            sort = appendIdToSort(currentSort, ASC, this.fieldsConfiguration.idFieldName);
        } else {
            sort = currentSort;
        }
        this.getHitsObservable(this.includesvalues, sort, null, startFrom * this.pageSize)
            .pipe(
                map(f => this.computeData(f)),
                map(f => f.forEach(d => { this.data.push(d); }))
            )
            .subscribe(data => data);
    }
    /**
     * Get the previous/following page.
     * @param reference the last/first hit returned in the list and from which next/previous data is fetched.
     * @param whichPage Whether to fetch next or previous page.
     */
    public getPage(reference: Map<string, string | number | Date>, whichPage: PageEnum): void {
        const sort = (this.geoOrderSort) ? this.geoOrderSort : this.sort;
        let after;
        if (whichPage === PageEnum.previous) {
            after = reference.get(this.PREVIOUS_AFTER);
        } else {
            after = reference.get(this.NEXT_AFTER);
        }
        const sortWithId = appendIdToSort(sort, ASC, this.fieldsConfiguration.idFieldName);
        if (after !== undefined) {
            this.getHitsObservable(this.includesvalues, sortWithId, after, null, whichPage)
                .pipe(
                    map(f => this.computeData(f)),
                    map(f => {
                        /**
                         * if maxPages === -1 then we keep adding data to the list without removing old data
                         */
                        if (this.maxPages !== -1) {
                            (whichPage === PageEnum.next) ? f.forEach(d => { this.data.push(d); }) :
                                f.reverse().forEach(d => { this.data.unshift(d); });
                            (whichPage === PageEnum.next) ? removePageFromIndex(0, this.data, this.pageSize, this.maxPages) :
                                removePageFromIndex(this.data.length - this.pageSize, this.data, this.pageSize, this.maxPages);
                            if (f.length === 0) {
                                /** notifies the end of fetching up-items or down-items */
                                this.fetchState = { endListUp: whichPage === PageEnum.previous, endListDown: whichPage === PageEnum.next };
                            } else {
                                this.fetchState = { endListUp: false, endListDown: false };
                            }
                        } else {
                            if (whichPage === PageEnum.next) {
                                f.forEach(d => { this.data.push(d); });
                            }
                            this.fetchState = { endListUp: true, endListDown: f.length === 0 };
                        }
                        return f;
                    })
                )
                .subscribe(data => data);
        } else {
            this.fetchState = { endListUp: whichPage === PageEnum.previous, endListDown: whichPage === PageEnum.next };
        }

    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<Hits> {
        let sort = '';
        if (this.geoOrderSort) {
            sort = this.geoOrderSort;
        } else {
            if (this.sort) {
                sort = this.sort;
            }
        }
        return this.getHitsObservable(this.includesvalues, sort);
    }

    public computeData(hits: Hits): Array<Map<string, string | number | Date>> {
        const listResult = new Array<Map<string, string | number | Date>>();
        const next = hits.links.next;
        const previous = hits.links.previous;
        let nextAfter;
        let previousAfter;
        if (next) {
            nextAfter = new URL(next.href).searchParams.get('after');
        }
        if (previous) {
            previousAfter = new URL(previous.href).searchParams.get('before');
        }
        if (hits.nbhits > 0) {
            hits.hits.forEach(h => {
                const fieldValueMap = new Map<string, string | number | Date>();
                if (next) {
                    fieldValueMap.set(this.NEXT_AFTER, nextAfter);
                }
                if (previous) {
                    fieldValueMap.set(this.PREVIOUS_AFTER, previousAfter);
                }
                if (this.includeMetadata) {
                    this.includeMetadata.forEach(md => {
                        const resultValue: string = getElementFromJsonObject(h.data, md);
                        fieldValueMap.set(md, resultValue);
                    });
                }
                this.fieldsList.forEach(element => {
                    const result: string = getElementFromJsonObject(h.data, element.fieldName);
                    const process: string = this.columnsProcess[element.columnName];
                    let resultValue = result;
                    if (process) {
                        if (process.trim().length > 0) {
                            resultValue = eval(this.columnsProcess[element.columnName]);
                        }
                    }
                    fieldValueMap.set(element.fieldName, resultValue);
                });
                if (this.fieldsConfiguration.idFieldName) {
                    const resultValue: string = getElementFromJsonObject(h.data, this.fieldsConfiguration.idFieldName);
                    fieldValueMap.set(this.fieldsConfiguration.idFieldName, resultValue);
                }
                if (this.fieldsConfiguration.titleFieldNames) {
                    this.fieldsConfiguration.titleFieldNames.forEach(field => {
                        this.setProcessFieldData(h, field, fieldValueMap, 'title');
                    });
                }
                if (this.fieldsConfiguration.tooltipFieldNames) {
                    this.fieldsConfiguration.tooltipFieldNames.forEach(field => {
                        this.setProcessFieldData(h, field, fieldValueMap, 'tooltip');
                    });
                }
                if (this.fieldsConfiguration.iconCssClass) {
                    const resultValue: string = getElementFromJsonObject(h.data, this.fieldsConfiguration.iconCssClass);
                    fieldValueMap.set(this.fieldsConfiguration.iconCssClass, resultValue);
                }
                if (this.fieldsConfiguration.iconColorFieldName) {
                    const resultValue: string = getElementFromJsonObject(h.data, this.fieldsConfiguration.iconColorFieldName);
                    fieldValueMap.set(this.fieldsConfiguration.iconColorFieldName.concat('_title'), resultValue);
                }
                if (this.fieldsConfiguration.urlImageTemplate) {
                    this.setUrlField('urlImageTemplate', h, fieldValueMap);
                }
                if (this.fieldsConfiguration.urlThumbnailTemplate) {
                    this.setUrlField('urlThumbnailTemplate', h, fieldValueMap);
                }
                if (this.fieldsConfiguration.imageFieldName) {
                    const imageEnabled = getElementFromJsonObject(h.data, this.fieldsConfiguration.imageFieldName);
                    if (imageEnabled != null) {
                        fieldValueMap.set('imageEnabled', imageEnabled.toString());
                    } else {
                        fieldValueMap.set('imageEnabled', '');
                    }
                }
                if (this.fieldsConfiguration.thumbnailFieldName) {
                    const thumbnailEnabled = getElementFromJsonObject(h.data, this.fieldsConfiguration.thumbnailFieldName);
                    if (thumbnailEnabled != null) {
                        fieldValueMap.set('thumbnailEnabled', thumbnailEnabled.toString());
                    } else {
                        fieldValueMap.set('thumbnailEnabled', '');
                    }
                }
                listResult.push(fieldValueMap);
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
            const fieldValueMap = new Map<string, string | number | Date>();
            collaboration.filter.f.forEach(e => {
                e.forEach(f => {
                    if (fieldValueMap.get(f.field) === undefined) {
                        fieldValueMap.set(f.field, f.value);
                    } else {
                        fieldValueMap.set(f.field, fieldValueMap.get(f.field) + ',' + f.value);
                    }
                });
            });
            this.filtersMap = fieldValueMap;
        } else {
            this.filtersMap = new Map<string, string | number | Date>();
        }
        return from([]);
    }

    public resolveDropDownButNot(column: Column) {
        this.columns.filter(c => c.fieldName !== column.fieldName).forEach(co => {
            if (co.dropdown) {
                let size = 10;
                if (co.dropdownsize) {
                    size = column.dropdownsize;
                }
                this.dropDownMapValues.set(co.fieldName, this.getDropDownValues(co.fieldName, size.toString()));
            } else {
                this.dropDownMapValues.set(co.fieldName, from([[]]));
            }
        });

    }
    /**
     * Returns an observable of Hits
     * @param includesvalues List of field names to include in the Hits
     * @param sort comma separated field names on which hits are sorted
     * @param reference comma seperated field values from which next/previous data is fetched
     * @param origin (page.from in arlas api) an offset from which fetching hits starts. It's ignored if reference is set.
     */
    private getHitsObservable(includesvalues: Array<string>, sort?: string, reference?: string,
        origin?: number, whichPage?: PageEnum): Observable<Hits> {
        const projection: Projection = {};
        const search: Search = { page: { size: this.pageSize } };
        if (sort) {
            search.page.sort = sort;
        }
        if (reference) {
            if (whichPage === PageEnum.previous) {
                search.page.before = reference;
            } else {
                search.page.after = reference;
            }
        } else {
            if (origin !== undefined && origin !== null) {
                search.page.from = origin;
            }
        }
        search.projection = projection;
        projection.includes = includesvalues.join(',');
        const searchResult = this.collaborativeSearcheService
            .resolveButNotHits([projType.search, search],
                this.collaborativeSearcheService.collaborations,
                null, this.filter, false, this.cacheDuration)
            .pipe(
                finalize(() => this.collaborativeSearcheService.contribFilterBus.next(this))
            );
        return searchResult;
    }
    private fieldsFromUrlTemplate(urlTemplate: string): Array<string> {
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
            });
    }
    private setUrlField(urlField: string, h: Hit, fieldValueMap: Map<string, string | number | Date>) {
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
                        fieldValueMap.set(f, urlTemplate);
                    } else {
                        fieldValueMap.set(f, urlTemplate);
                    }
                } else {
                    fieldValueMap.set(f,
                        getElementFromJsonObject(h.data, f));
                }
            });
    }

    private setProcessFieldData(h: Hit, field: Field, fieldValueMap: Map<string, string | number | Date>, dataType: string): void {
        const result: string = getElementFromJsonObject(h.data, field.fieldPath);
        const process: string = field.process;
        let resultValue = result;
        if (process) {
            if (process.trim().length > 0) {
                resultValue = eval(field.process);
            }
        }
        fieldValueMap.set(field.fieldPath + '_' + dataType, resultValue);
    }

    private getDropDownValues(field: string, size: string): Observable<Array<string>> {
        const aggregations: Aggregation[] = new Array<Aggregation>();
        aggregations.push({
            type: Aggregation.TypeEnum.Term,
            field: field,
            size: size
        });
        const result = this.collaborativeSearcheService
            .resolveButNotAggregation([projType.aggregate, aggregations], this.collaborativeSearcheService.collaborations);
        if (result) {
            return result.pipe(map(aggResponse => {
                if (aggResponse.elements) {
                    return aggResponse.elements.map(element => (<any>element).key_as_string);
                } else {
                    return [];
                }
            }));
        } else {
            return from([]);
        }
    }
}
