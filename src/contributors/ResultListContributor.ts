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
    Aggregation, ArlasHit, Expression, Filter, Hits, Page, Projection, Search
} from 'arlas-api';
import {
    Collaboration, CollaborationEvent, CollaborativesearchService, ConfigService, Contributor,
    projType
} from 'arlas-web-core';
import { BehaviorSubject, Observable, catchError, filter, finalize, from, map, of, zip } from 'rxjs';
import jsonSchema from '../jsonSchemas/resultlistContributorConf.schema.json' with { type: 'json' };
import { Task, TaskService } from '../models/aias-process';
import {
    Action, ActionFilter, AdditionalInfo, Attachment, AttachmentConfig, CardViewProperty, Column, Detail,
    ElementIdentifier, ExportedColumn, Field, FieldsConfiguration, ItemDataType, PageEnum, SortEnum
} from '../models/models';
import { ProcessError, validProcess } from '../utils/process';
import {
    ASC, appendIdToSort, download, getElementFromJsonObject, getFieldValue, isArray, removePageFromIndex
} from '../utils/utils';

export interface MatchInfo {
    matched: Array<boolean>;
    data: Record<string, ItemDataType>;
}

/**
* Interface defined in Arlas-web-components
*/
export interface DetailedDataRetriever {
    detailsConfig: Array<Detail>;
    getData(identifier: string): Observable<AdditionalInfo>;
    getValues(identifier: string, fields: string[]): Observable<string[]>;
    getActions(item: any): Observable<Array<Action>>;
    getMatch(identifier: string, filters: ActionFilter[][]): Observable<MatchInfo>;
    getTasks(identifier: string): Observable<Task[]>;
}

/**
* Implementation of `DetailedDataRetriever` interface to retrieve detailed information about an item in the resultlist.
*/
export class ResultListDetailedDataRetriever implements DetailedDataRetriever {
    /**
    * Contributor which the ResultListDetailedDataRetriever works
    */
    private contributor: ResultListContributor;
    private readonly detailsFunctionMap = new Map<string, Map<string, Function>>();
    public detailsConfig: Array<Detail>;

    public constructor(contributor: ResultListContributor) {
        this.contributor = contributor;
        const details: Array<Detail> = this.contributor.getConfigValue('details');
        this.detailsConfig = details;
        details.forEach(group => {
            const detailedDataFunctionMap = new Map<string, Function>();
            group.fields.forEach(field => {
                const fieldProcess: string = field.process;
                if (fieldProcess && fieldProcess.trim().length > 0 && validProcess(fieldProcess, 'result')) {
                    const func = new Function('result', '\'use strict\';const r=' +
                        fieldProcess + '; return r;');
                    detailedDataFunctionMap.set(field.label, func);
                }
            });
            this.detailsFunctionMap.set(group.name, detailedDataFunctionMap);
        });
    }

    public getValues(identifier: string, fields: string[]): Observable<string[]> {
        const search: Search = { page: { size: 1 } };
        const expression: Expression = {
            field: this.contributor.fieldsConfiguration.idFieldName,
            op: Expression.OpEnum.Eq,
            value: identifier
        };
        const filterExpression: Filter = {
            f: [[expression]]
        };
        const searchResult: Observable<Hits> = this.contributor.collaborativeSearcheService.resolveHits([
            projType.search, search], this.contributor.collaborativeSearcheService.collaborations,
            this.contributor.collection, this.contributor.identifier, filterExpression,
            /** flat */ true, this.contributor.getCacheDuration());

        return searchResult.pipe(map(data => fields.map(f => data.hits?.[0].data[f.replace(/\./g, '_')])));
    }

    public getMatch(identifier: string, filters: ActionFilter[][]): Observable<MatchInfo> {
        const search: Search = { page: { size: 1 } };
        const expression: Expression = {
            field: this.contributor.fieldsConfiguration.idFieldName,
            op: Expression.OpEnum.Eq,
            value: identifier
        };

        // This makes a AND
        return zip(filters.map(f => {
            const filterExpression = {
                f: [[expression]]
            };
            f.forEach(c => {
                filterExpression.f.push([{
                    field: c.field,
                    op: Expression.OpEnum[c.op.toString() as any] as unknown as Expression.OpEnum,
                    value: c.value
                }]);
            });

            return this.contributor.collaborativeSearcheService.resolveHits([
                projType.search, search], this.contributor.collaborativeSearcheService.collaborations,
                this.contributor.collection, this.contributor.identifier, filterExpression,
                /** flat */ true, this.contributor.getCacheDuration());
        })).pipe(map(hits => ({
                matched: hits.map(h => h.hits?.length !== 0),
                data: hits.find(h => h.hits?.length !== 0)?.hits?.[0].data
            })));
    }

    public getActions(item: any): Observable<Array<Action>> {
        const actions = new Array<Action>();
        this.contributor.actionToTriggerOnClick.forEach(action => {
            const ac: Action = {
                id: action.id,
                label: action.label,
                tooltip: action.tooltip,
                cssClass: '',
                collection: this.contributor.collection,
                reverseAction: action.reverseAction,
                activated: action.activated,
                icon: action.icon,
                show: action.show,
                fields: action.fields,
                filters: action.filters
            };
            const cssFields = action.cssClass;
            if (cssFields && item.itemData) {
                if (typeof cssFields === 'string') {
                    const cssClass = item.itemData ? item.itemData.get(cssFields) : undefined;
                    ac.cssClass = String(cssClass);
                } else {
                    // array case
                    let css = '';
                    cssFields.forEach((field, index) => css += (index > 0 ? '-' : '') + item.itemData.get(field).trim().replace(' ', '-'));
                    ac.cssClass = css;
                }
            }
            actions.push(ac);
        });
        return from(new Array(actions));
    }

    public getTasks(identifier: string): Observable<Task[]> {
        const tasks$ = this.contributor.taskService.getTasks(this.contributor.collection, identifier)
            .pipe(catchError(e => {
                console.error(e);
                return of([]);
            }));
        return tasks$;
    }

    /**
    * Method to retrieve detail data of an item
    * @param identifier string id of the item
    * @returns an observable of object that contains details information in form of a map and an array of actions applicable on the item.
    */
    public getData(identifier: string): Observable<AdditionalInfo> {
        const search: Search = { page: { size: 1 } };
        const expression: Expression = {
            field: this.contributor.fieldsConfiguration.idFieldName,
            op: Expression.OpEnum.Eq,
            value: identifier
        };
        const filterExpression: Filter = {
            f: [[expression]]
        };
        const search$: Observable<Hits> = this.contributor.collaborativeSearcheService.resolveHits([
            projType.search, search], this.contributor.collaborativeSearcheService.collaborations,
            this.contributor.collection, this.contributor.identifier, filterExpression, false, this.contributor.getCacheDuration());



        const obs: Observable<AdditionalInfo> = search$.pipe(map(searchData => {
            const detailsMap = new Map<string, Map<string, string>>();
            const details: Array<Detail> = this.contributor.getConfigValue('details');
            details.forEach(group => {
                const detailedDataMap = new Map<string, string>();
                group.fields.forEach(field => {
                    const result = getFieldValue(field.path, searchData.hits?.[0].data);
                    if (result !== null && result !== undefined && result !== '') {
                        const processFunction = this.detailsFunctionMap.get(group.name)?.get(field.label);
                        let resultValue = result;
                        if (processFunction) {
                            resultValue = processFunction(result);
                        }
                        detailedDataMap.set(field.label, resultValue);
                    }
                });
                detailsMap.set(group.name, detailedDataMap);
            });
            const attachments = new Array<Attachment>();
            const attachmentsConfig: Array<AttachmentConfig> = this.contributor.getConfigValue('attachments') !== undefined
                ? this.contributor.getConfigValue('attachments') : [];
            attachmentsConfig.forEach(att => {
                // Not sure of the type here
                const attachmentsValues: Attachment[] = getFieldValue(att.attachmentsField, searchData.hits?.[0].data);
                if (attachmentsValues && isArray(attachmentsValues)) {
                    attachmentsValues.forEach(attachmentValue => {
                        const label = getFieldValue(att.attachmentLabelField, attachmentValue)?.toString();
                        const url = getFieldValue(att.attachementUrlField, attachmentValue)?.toString();
                        const type = getFieldValue(att.attachmentTypeField, attachmentValue)?.toString();
                        const description = getFieldValue(att.attachmentDescriptionField, attachmentValue)?.toString();
                        attachments.push({
                            label: label,
                            url: url,
                            description: description,
                            type: type,
                            icon: att.attachmentIcon
                        });
                    });
                }
            });
            const actions = new Array<Action>();
            this.contributor.actionToTriggerOnClick.forEach(action => {
                const ac: Action = {
                    id: action.id,
                    label: action.label,
                    tooltip: action.tooltip,
                    cssClass: '',
                    collection: this.contributor.collection,
                    reverseAction: action.reverseAction,
                    activated: action.activated,
                    icon: action.icon,
                    show: action.show,
                    fields: action.fields
                };
                const cssFields = action.cssClass;
                if (cssFields) {
                    if (typeof cssFields === 'string') {
                        ac.cssClass = getElementFromJsonObject(searchData.hits?.[0].data, cssFields);
                    } else {
                        // array case
                        let css = '';
                        cssFields.forEach((field, index) => css += (index > 0 ? '-' : '')
                            + getElementFromJsonObject(searchData.hits?.[0].data, field).trim().replace(' ', '-'));
                        ac.cssClass = css;
                    }
                }
                actions.push(ac);

            });
            const objectResult: AdditionalInfo = { details: detailsMap, actions, attachments };
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
    public data: Array<Map<string, ItemDataType>> = new Array();
    /**
    * List of columns of the table, @Input() fieldsList of ResultListComponent.
    */
    public fieldsList: Array<{ columnName: string; fieldName: string; dataType: string; useColorService?: boolean; }> = [];
    /**
    * List of properties configured to display in a card,  @Input() fieldsList of ResultListComponent.
    */
    public cardViewProperties: Array<CardViewProperty> = [];
    /**
    * List of properties configured to display in a card from configuration
    */
    private readonly cardViewPropertiesConfig: Array<CardViewProperty> = this.getConfigValue('cardViewProperties') || [];
    private cardViewPropertiesProcess: Record<string, Function> = {};

    /**
    * List of values to select mapped to each field represented on the resultList. The list of values to select is wrapped in an Observable.
    */
    public dropDownMapValues: Map<string, Observable<Array<string>>> = new Map<string, Observable<Array<string>>>();
    /**
    * Instance of DetailedDataRetriever class, @Input() detailedDataRetriever of ResultListComponent.
    */
    public detailedDataRetriever = new ResultListDetailedDataRetriever(this);
    /**
    * List of actions, from all the contributors of the app, which we could trigger on click in the ResultListComponent.
    */
    public actionToTriggerOnClick: Array<Action> = [];

    public filtersMap: Map<string, ItemDataType> = new Map();

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

    public highlightItems = new Set<string>();

    /**
     * Emits when an error occurs when applying a process
     */
    public processErrorBus = new BehaviorSubject<ProcessError | undefined>(undefined);

    public taskService: TaskService;
    /**
     * Url at which the status of the AIAS processes for items can be found.
     */
    public processStatusUrl: string | undefined;

    private includesvalues = new Array<string>();
    private isImageEnabled = false;
    private isThumbnailEnabled = false;
    private isDetailsTitleEnabled = false;
    private readonly columns: Array<Column> = this.getConfigValue('columns') || [];
    private columnsProcess: Record<string, Function> = {};
    /** CONSTANTS */
    private readonly NEXT_AFTER = '_nextAfter';
    private readonly PREVIOUS_AFTER = '_previousAfter';
    private readonly urlImageTemplateFunction: Function | undefined;
    private readonly urlThumbnailTemplateFunction: Function | undefined;
    private readonly titleFunctions = new Map<string, Function>();
    private readonly tooltipFunctionn = new Map<string, Function>();
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param fieldsConfiguration  @Input of Angular ResultListComponent, FieldsConfiguration.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    public constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService, collection: string,
        taskService: TaskService
    ) {
        super(identifier, configService, collaborativeSearcheService, collection);
        this.taskService = taskService;

        this.urlImageTemplateFunction = this.getImageUrlTemplateFunction('urlImageTemplate');
        this.urlThumbnailTemplateFunction = this.getImageUrlTemplateFunction('urlThumbnailTemplate');
        this.collections = [];
        this.collections.push({
            collectionName: collection
        });
        this.fieldsList = [];
        this.columns.forEach(column => {
            if (column.process && column.process.trim().length > 0 && validProcess(column.process, 'result')) {
                try {
                    const func = new Function('result', '\'use strict\';const r='
                        + column.process + '; return r;');
                    this.columnsProcess[column.columnName] = func;
                } catch (error) {
                    this.processErrorBus.next({
                        column: column.columnName,
                        context: 'create',
                        error
                    });
                }
            }

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


        this.cardViewProperties = [];
        this.cardViewPropertiesConfig.forEach(cvProperty => {
            if (cvProperty.process && cvProperty.process.trim().length > 0 && validProcess(cvProperty.process, 'result')) {
                try {
                    const func = new Function('result', '\'use strict\';const r='
                        + cvProperty.process + '; return r;');
                    this.cardViewPropertiesProcess[cvProperty.prettyName] = func;
                } catch (error) {
                    this.processErrorBus.next({
                        column: cvProperty.prettyName,
                        context: 'create',
                        error
                    });
                }
            }

            this.cardViewProperties.push(cvProperty);
            this.includesvalues.push(cvProperty.fieldName);
        });


        this.includesvalues.push(this.fieldsConfiguration.idFieldName);
        if (this.fieldsConfiguration.titleFieldNames) {
            this.includesvalues = this.includesvalues.concat(this.fieldsConfiguration.titleFieldNames.map(field => field.fieldPath));
        }
        if (this.fieldsConfiguration.urlImageTemplate) {
            this.includesvalues = this.includesvalues.concat(this.fieldsFromUrlTemplate(this.fieldsConfiguration.urlImageTemplate));
        }
        if (this.fieldsConfiguration.urlImageTemplates) {
            this.fieldsConfiguration.urlImageTemplates.forEach(descUrl => {
                this.includesvalues = this.includesvalues.concat(this.fieldsFromUrlTemplate(descUrl.url));
                this.includesvalues = this.includesvalues.concat(this.fieldsFromUrlTemplate(descUrl.description));
                if (descUrl.filter) {
                    this.includesvalues.push(descUrl.filter.field);
                }
            });
        }
        if (this.fieldsConfiguration.urlThumbnailTemplate) {
            this.includesvalues = this.includesvalues.concat(this.fieldsFromUrlTemplate(this.fieldsConfiguration.urlThumbnailTemplate));
        }
        if (this.fieldsConfiguration.detailsTitleTemplate) {
            this.includesvalues = this.includesvalues.concat(this.fieldsFromUrlTemplate(this.fieldsConfiguration.detailsTitleTemplate));
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

        if (this.fieldsConfiguration.titleFieldNames) {
            this.fieldsConfiguration.titleFieldNames.forEach(field => {
                if (field.process && field.process.trim().length > 0 && validProcess(field.process, 'result')) {
                    const func = new Function('result', '\'use strict\';const r=' +
                        field.process + '; return r;');
                    this.titleFunctions.set(field.fieldPath, func);
                }
            });
        }
        if (this.fieldsConfiguration.tooltipFieldNames) {
            this.fieldsConfiguration.tooltipFieldNames.forEach(field => {
                if (field.process && field.process.trim().length > 0 && validProcess(field.process, 'result')) {
                    const func = new Function('result', '\'use strict\';const r=' +
                        field.process + '; return r;');
                    this.tooltipFunctionn.set(field.fieldPath, func);
                }
            });
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

    public isUpdateEnabledOnOwnCollaboration() {
        return false;
    }

    /** Returns the current columns/details/idfieldname/urltemplates of thumbnail and quicklooks  */
    public getAllFields(): ExportedColumn[] {
        let exportedFields: ExportedColumn[] = [];
        if (!!this.columns) {
            this.columns.forEach(column => {
                exportedFields.push({
                    displayName: column.columnName,
                    field: column.fieldName
                });
            });
        }
        const details: Array<Detail> = this.getConfigValue('details');
        if (!!details) {
            details.forEach(group => {
                if (!!group && !!group.fields && Array.isArray(group.fields)) {
                    exportedFields = exportedFields.concat(group.fields.map(f => ({
                        displayName: f.label,
                        field: f.path
                    })));
                }
            });
        }
        if (!!this.fieldsConfiguration) {
            exportedFields.push({
                displayName: this.fieldsConfiguration.idFieldName,
                field: this.fieldsConfiguration.idFieldName
            });
        }
        if (!!this.fieldsConfiguration.titleFieldNames && Array.isArray(this.fieldsConfiguration.titleFieldNames)) {
            exportedFields = exportedFields.concat(this.fieldsConfiguration.titleFieldNames.map(field => ({
                displayName: field.fieldPath,
                field: field.fieldPath
            })));
        }
        if (this.fieldsConfiguration.urlImageTemplates) {
            this.fieldsConfiguration.urlImageTemplates.forEach(descUrl => {
                const urlTemplate = this.fieldsFromUrlTemplate(descUrl.url);
                if (!!urlTemplate && Array.isArray(urlTemplate)) {
                    exportedFields = exportedFields.concat(urlTemplate.map(s => ({
                        displayName: s,
                        field: s
                    })));

                }
                const descriptionTemplate = this.fieldsFromUrlTemplate(descUrl.description);
                if (!!descriptionTemplate && Array.isArray(descriptionTemplate)) {
                    exportedFields = exportedFields.concat(descriptionTemplate.map(s => ({
                        displayName: s,
                        field: s
                    })));
                }
                if (descUrl.filter) {
                    exportedFields.push({
                        displayName: descUrl.filter.field,
                        field: descUrl.filter.field
                    });
                }
            });
        }
        if (this.fieldsConfiguration.urlThumbnailTemplate) {
            const urlTemplate = this.fieldsConfiguration.urlThumbnailTemplate;
            if (!!urlTemplate && Array.isArray(urlTemplate)) {
                exportedFields = exportedFields.concat(urlTemplate.map(s => ({
                    displayName: s,
                    field: s
                })));

            }

        }
        return exportedFields;
    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    public setHighlightItems(items: Array<string>) {
        this.highlightItems = new Set(items);
    }
    /**
    * Download item information as json
    * @param productIdentifier productIdentifier of item to dowload
    */
    public downloadItem(elementidentifier: ElementIdentifier) {
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
        const searchResult: Observable<Hits> = this.collaborativeSearcheService
            .resolveHits([projType.search, search], this.collaborativeSearcheService.collaborations,
                this.collection, undefined, filterExpression, false, this.cacheDuration);
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
    public sortColumn(sortParams: { fieldName: string; sortDirection: SortEnum; }, sortById?: boolean) {
        this.geoOrderSort = '';
        let sort = '';
        if (sortParams && sortParams.fieldName && sortParams.sortDirection !== undefined && sortParams.sortDirection !== null) {
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
                .subscribe();
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
            .subscribe();
    }
    /**
    * Method call when emit the output setFiltersEvent
    * @param filterMap filter params
    */
    public setFilters(filterMap: Map<string, ItemDataType>) {
        if (filterMap.size === 0) {
            this.collaborativeSearcheService.removeFilter(this.identifier);
        } else {
            const filterValue = {
                f: new Array<Expression[]>(),
                collection: this.collection
            };
            filterMap.forEach((k, v) => {
                let op: Expression.OpEnum;
                if (v === this.fieldsConfiguration.idFieldName) {
                    op = Expression.OpEnum.Eq;
                    const expressions: Array<Expression> = [];
                    if (k.toString().indexOf(',') > 0) {
                        k.toString().split(',').forEach(va => {
                            const expression: Expression = {
                                field: v,
                                op: op,
                                value: va
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
                                value: va
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
            const collabFilters = new Map<string, Filter[]>();
            collabFilters.set(this.collection, [filterValue]);
            const collaboration: Collaboration = { filters: collabFilters, enabled: true };
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
        this.getHitsObservable(this.includesvalues, sort, undefined, startFrom * this.pageSize)
            .pipe(
                map(f => this.computeData(f)),
                map(f => f.forEach(d => {
                    this.data.push(d);
                }))
            )
            .subscribe(data => data);
    }
    /**
     * Get the previous/following page.
     * @param reference the last/first hit returned in the list and from which next/previous data is fetched.
     * @param whichPage Whether to fetch next or previous page.
     */
    public getPage(reference: Map<string, ItemDataType>, whichPage: PageEnum): void {
        const sort = (this.geoOrderSort) ? this.geoOrderSort : this.sort;
        let after;
        if (whichPage === PageEnum.previous) {
            after = reference.get(this.PREVIOUS_AFTER);
        } else {
            after = reference.get(this.NEXT_AFTER);
        }
        const sortWithId = appendIdToSort(sort, ASC, this.fieldsConfiguration.idFieldName);
        if (after !== undefined) {
            this.getHitsObservable(this.includesvalues, sortWithId, after as string, undefined, whichPage)
                .pipe(
                    map(f => this.computeData(f)),
                    map(f => {
                        /**
                         * if maxPages === -1 then we keep adding data to the list without removing old data
                         */
                        if (this.maxPages !== -1) {
                            if (whichPage === PageEnum.next) {
                                f.forEach(d => {
                                    this.data.push(d);
                                });
                            } else {
                                f.reverse().forEach(d => {
                                    this.data.unshift(d);
                                });
                            }

                            if (whichPage === PageEnum.next) {
                                removePageFromIndex(0, this.data, this.pageSize, this.maxPages);
                            } else {
                                removePageFromIndex(this.data.length - this.pageSize, this.data, this.pageSize, this.maxPages);
                            }

                            if (f.length === 0) {
                                /** notifies the end of fetching up-items or down-items */
                                this.fetchState = { endListUp: whichPage === PageEnum.previous, endListDown: whichPage === PageEnum.next };
                            } else {
                                this.fetchState = { endListUp: false, endListDown: false };
                            }
                        } else {
                            if (whichPage === PageEnum.next) {
                                f.forEach(d => {
                                    this.data.push(d);
                                });
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

    public fetch$(size: number, fields: string[], filter: Filter | undefined): Observable<Hits> {
        let sort = '';
        if (this.geoOrderSort) {
            sort = this.geoOrderSort;
        } else {
            if (this.sort) {
                sort = this.sort;
            }
        }
        const projection: Projection = {};
        const search = { page: { size } as Page, projection };
        if (sort) {
            search.page.sort = sort;
        }
        projection.includes = fields.join(',');
        const searchResult$ = this.collaborativeSearcheService
            .resolveButNotHits([projType.search, search],
                this.collaborativeSearcheService.collaborations,
                this.collection, undefined, filter, false, this.cacheDuration);
        return searchResult$;
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

    public computeData(hits: Hits): Array<Map<string, ItemDataType>> {
        const listResult = new Array<Map<string, ItemDataType>>();
        const next = hits.links?.next;
        const previous = hits.links?.previous;
        let nextAfter: string | null = null;
        let previousAfter: string | null = null;
        if (next) {
            nextAfter = new URL(next.href).searchParams.get('after');
        }
        if (previous) {
            previousAfter = new URL(previous.href).searchParams.get('before');
        }
        if (hits.hits && hits.hits.length > 0) {
            hits.hits.forEach(h => {
                const fieldValueMap = new Map<string, ItemDataType>();
                if (next && nextAfter) {
                    fieldValueMap.set(this.NEXT_AFTER, nextAfter);
                }
                if (previous && previousAfter) {
                    fieldValueMap.set(this.PREVIOUS_AFTER, previousAfter);
                }
                if (this.includeMetadata) {
                    this.includeMetadata.forEach(md => {
                        const resultValue: string = getElementFromJsonObject(h.data, md);
                        fieldValueMap.set(md, resultValue);
                    });
                }

                if (this.fieldsConfiguration.idFieldName) {
                    let resultValue: string = getElementFromJsonObject(h.data, this.fieldsConfiguration.idFieldName);
                    if (resultValue !== undefined) {
                        resultValue = resultValue.toString();
                    }
                    fieldValueMap.set(this.fieldsConfiguration.idFieldName, resultValue);
                }

                this.fieldsList.forEach(element => {
                    const result: string = getElementFromJsonObject(h.data, element.fieldName);
                    const processFunction = this.columnsProcess[element.columnName];
                    let resultValue = result;
                    if (processFunction) {
                        try {
                            resultValue = processFunction(result);
                        } catch (error) {
                            this.processErrorBus.next({
                                column: element.columnName,
                                context: 'apply',
                                value: result,
                                error
                            });
                        }
                    }
                    fieldValueMap.set(this.getTableKey(element), resultValue);
                });

                this.cardViewProperties.forEach(element => {
                    const result: string = getElementFromJsonObject(h.data, element.fieldName);
                    const processFunction = this.cardViewPropertiesProcess[element.prettyName];
                    let resultValue = result;
                    if (processFunction) {
                        try {
                            resultValue = processFunction(result);
                        } catch (error) {
                            this.processErrorBus.next({
                                column: element.prettyName,
                                context: 'apply',
                                value: result,
                                error
                            });
                        }
                    }
                    fieldValueMap.set(this.getCardKey(element), resultValue);
                });

                if (this.fieldsConfiguration.titleFieldNames) {
                    this.fieldsConfiguration.titleFieldNames.forEach(field => {
                        this.setProcessFieldData(h, field, fieldValueMap, 'title', this.titleFunctions.get(field.fieldPath));
                    });
                }
                if (this.fieldsConfiguration.tooltipFieldNames) {
                    this.fieldsConfiguration.tooltipFieldNames.forEach(field => {
                        this.setProcessFieldData(h, field, fieldValueMap, 'tooltip', this.tooltipFunctionn.get(field.fieldPath));
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
                if (this.fieldsConfiguration.urlImageTemplate && this.fieldsConfiguration.urlImageTemplate !== '') {
                    this.isImageEnabled = this.setUrlField(this.fieldsConfiguration.urlImageTemplate,
                        h, fieldValueMap, 'urlImageTemplate');
                    fieldValueMap.set('imageEnabled', this.isImageEnabled.toString());
                }
                if (this.fieldsConfiguration.urlImageTemplates && this.fieldsConfiguration.urlImageTemplates.length > 0) {
                    this.isImageEnabled = true;
                    this.fieldsConfiguration.urlImageTemplates.forEach(descUrl => {
                        this.isImageEnabled = this.isImageEnabled && this.setUrlField(descUrl.url, h, fieldValueMap);
                        if (descUrl.filter) {
                            fieldValueMap.set(descUrl.filter.field, getElementFromJsonObject(h.data, descUrl.filter.field));
                        }
                    });
                    fieldValueMap.set('imageEnabled', this.isImageEnabled.toString());
                }
                if (this.fieldsConfiguration.urlThumbnailTemplate && this.fieldsConfiguration.urlThumbnailTemplate !== '') {
                    this.isThumbnailEnabled = this.setUrlField(this.fieldsConfiguration.urlThumbnailTemplate,
                        h, fieldValueMap, 'urlThumbnailTemplate');
                    fieldValueMap.set('thumbnailEnabled', this.isThumbnailEnabled.toString());
                }
                if (this.fieldsConfiguration.detailsTitleTemplate && this.fieldsConfiguration.detailsTitleTemplate !== '') {
                    this.isDetailsTitleEnabled = this.setUrlField(this.fieldsConfiguration.detailsTitleTemplate,
                        h, fieldValueMap);
                    fieldValueMap.set('detailsTitleEnabled', this.isDetailsTitleEnabled.toString());
                }
                listResult.push(fieldValueMap);
            });
        }
        return listResult;

    }
    private getCardKey(element: CardViewProperty): string {
        return element.fieldName + '_' + element.prettyName + '_' + element.icon + '_card';
    }

    private getTableKey(element: { columnName: string; fieldName: string; dataType: string; useColorService?: boolean; }): string {
        return element.fieldName + '_' + element.columnName + '_table';
    }

    public setData(listResult: Array<Map<string, ItemDataType>>) {
        this.data = listResult;
        return this.data;

    }
    public setSelection(listResult: Array<Map<string, ItemDataType>>, collaboration: Collaboration | undefined) {
        if (collaboration !== undefined) {
            const fieldValueMap = new Map<string, ItemDataType>();
            let filterValue: Filter;
            const filters = collaboration.filters.get(this.collection);
            if (filters && filters.length > 0) {
                filterValue = filters[0];
                filterValue.f?.forEach(e => {
                    e.forEach(f => {
                        if (fieldValueMap.get(f.field) === undefined) {
                            fieldValueMap.set(f.field, f.value);
                        } else {
                            fieldValueMap.set(f.field, fieldValueMap.get(f.field) + ',' + f.value);
                        }
                    });
                });
            }
            this.filtersMap = fieldValueMap;
        } else {
            this.filtersMap = new Map<string, ItemDataType>();
        }
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

    public getCacheDuration() {
        return this.cacheDuration;
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
        const search = { page: { size: this.pageSize } as Page, projection };
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
        projection.includes = includesvalues.join(',');
        const searchResult = this.collaborativeSearcheService
            .resolveButNotHits([projType.search, search],
                this.collaborativeSearcheService.collaborations,
                this.collection, undefined, this.filter, false, this.cacheDuration)
            .pipe(
                finalize(() => this.collaborativeSearcheService.contribFilterBus.next(this))
            );
        return searchResult;
    }


    private fieldsFromUrlTemplate(urlTemplate: string): Array<string> {
        return urlTemplate.match(/{(?:[a-zA-Z0-9_$.]*)}/g)?.map(f => f.replace('{', '').replace('}', '').split('$')[0]) || [];
    }


    /**
     *
     * @param urlTemplate Template for an url
     * @param h Arlas hit containing the data
     * @param fieldValueMap [fieldName - fieldValue] map that is set inside this method
     * @param urlfield Legacy parameter, to use process on the fields composant l'url
     * @returns Returns true if all the fields in the template exist in 'h.data', false if at least one doesn't exist
     */
    private setUrlField(urlTemplate: string, h: ArlasHit, fieldValueMap: Map<string, ItemDataType>,
        urlField?: 'urlThumbnailTemplate' | 'urlImageTemplate'): boolean {
        let allFieldsExist = true;
        urlTemplate.match(/{(?:[a-zA-Z0-9_$.]*)}/g)
            ?.map(f => f.replace('{', '').replace('}', '')).forEach((f: string) => {
                if (f.includes('$')) {
                    const tree = f.split('$');
                    let v = h.data;
                    for (const t of tree) {
                        if (v !== undefined) {
                            v = v[t];
                        } else {
                            v = undefined;
                            allFieldsExist = false;
                            break;
                        }
                    }
                    let urlTemplate = '';
                    if (v !== undefined) {
                        if (!!urlField) {
                            if (urlField === 'urlThumbnailTemplate' && this.urlThumbnailTemplateFunction) {
                                urlTemplate = this.urlThumbnailTemplateFunction(v);
                            } else if (urlField === 'urlImageTemplate' && this.urlImageTemplateFunction) {
                                urlTemplate = this.urlImageTemplateFunction(v);
                            } else {
                                urlTemplate = v;
                            }
                        } else {
                            urlTemplate = v;
                        }
                        fieldValueMap.set(f, urlTemplate);
                    } else {
                        fieldValueMap.set(f, urlTemplate);
                        allFieldsExist = false;
                    }
                } else {
                    const fieldValue = getElementFromJsonObject(h.data, f);
                    if (fieldValue === undefined || fieldValue === null) {
                        allFieldsExist = false;
                    }
                    fieldValueMap.set(f, fieldValue);
                }
            });
        return allFieldsExist;
    }

    private setProcessFieldData(h: ArlasHit, field: Field, fieldValueMap: Map<string, ItemDataType>, dataType: string,
        func: Function | undefined): void {
        const result: string = getElementFromJsonObject(h.data, field.fieldPath);
        let resultValue = result;
        if (func) {
            resultValue = func(result);
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
            .resolveButNotAggregation([projType.aggregate, aggregations], this.collaborativeSearcheService.collaborations, this.collection);
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

    private getImageUrlTemplateFunction(urlField: string): Function | undefined {
        if (!!this.getConfigValue('process') && this.getConfigValue('process')[urlField] !== undefined) {
            const processUrlTemplate: string = this.getConfigValue('process')[urlField]['process'];
            if (processUrlTemplate && processUrlTemplate.trim().length > 0 && validProcess(processUrlTemplate, 'result')) {
                const func = new Function('result', '\'use strict\';const r=' + processUrlTemplate + '; return r;');
                return func;
            };
        };
    }
}
