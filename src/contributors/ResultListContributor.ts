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
import { Action, ElementIdentifier, triggerType, SortEnum, FieldsConfiguration, Column, Detail } from '../models/models';
import * as jsonpath from 'jsonpath';

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
            const objectResult = { details: detailsMap, actions: this.contributor.actionToTriggerOnClick };
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
        this.columns.forEach(column => {
            this.columnsProcess[column.columnName] = column.process;
        });
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
                pretty: true,
                human: true
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
        this.getHitsObservable(this.sort)
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
        this.getHitsObservable(this.geoOrderSort)
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
            this.getHitsObservable(this.geoOrderSort, from * this.getConfigValue('search_size'))
                .map(f => this.computeData(f))
                .map(f => f.forEach(d => { this.data.push(d); }))
                .subscribe(data => data);
        } else {
            this.getHitsObservable(this.sort, from * this.getConfigValue('search_size'))
                .map(f => this.computeData(f))
                .map(f => f.forEach(d => { this.data.push(d); }))
                .subscribe(data => data);
        }
    }
    public fetchData(collaborationEvent: CollaborationEvent): Observable<Hits> {
        return this.getHitsObservable(this.geoOrderSort);
    }

    public computeData(hits: Hits): Array<Map<string, string | number | Date>> {
        const listResult = new Array<Map<string, string | number | Date>>();
        if (hits.nbhits > 0) {
            hits.hits.forEach(h => {
                const map = new Map<string, string | number | Date>();
                this.fieldsList.forEach(element => {
                    const result: string = getElementFromJsonObject(h.data, element.fieldName);
                    const process: string = this.columnsProcess[element.columnName];
                    let resultValue = null;
                    if (process.trim().length > 0) {
                        resultValue = eval(this.columnsProcess[element.columnName]);
                    } else {
                        resultValue = result;
                    }
                    map.set(element.fieldName, resultValue);
                });
                if (this.fieldsConfiguration.urlImageTemplate) {
                    this.setUrlField('urlImageTemplate', h, map);
                }
                if (this.fieldsConfiguration.urlThumbnailTemplate) {
                    this.setUrlField('urlThumbnailTemplate', h, map);
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

    private getHitsObservable(sort?: Sort, from?: number): Observable<Hits> {
        const projection: Projection = {};
        let includesvalue = '';
        const search: Search = { size: { size: this.getConfigValue('search_size') } };
        if (sort) {
            search.sort = sort;
        }
        if (from) {
            search.size.from = from;
        }
        this.fieldsList = [];
        this.columns.forEach(element => {
            this.fieldsList.push(element);
            includesvalue = includesvalue + ',' + element.fieldName;
        });
        if (this.fieldsConfiguration.titleFieldName) {
            includesvalue = includesvalue + ',' + this.fieldsConfiguration.titleFieldName;
        }
        includesvalue = includesvalue + ',' + this.fieldsConfiguration.idFieldName;
        if (this.fieldsConfiguration.urlImageTemplate) {
            includesvalue = includesvalue + ',' + this.fieldsFromUrlTemplate(this.fieldsConfiguration.urlImageTemplate);
        }
        if (this.fieldsConfiguration.urlThumbnailTemplate) {
            includesvalue = includesvalue + ',' + this.fieldsFromUrlTemplate(this.fieldsConfiguration.urlThumbnailTemplate);
        }
        search.projection = projection;
        projection.includes = includesvalue.trim().substring(1);
        const newData = [];
        const searchResult = this.collaborativeSearcheService.resolveButNotHits([projType.search, search]);
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
}
