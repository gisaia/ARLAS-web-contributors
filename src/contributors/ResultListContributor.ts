import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { projType } from 'arlas-web-core/models/projections';
import { Filter, Hits, Search, Size, Expression, Sort, Projection } from 'arlas-api';
import { getElementFromJsonObject, isArray, feedDetailledMap, download } from '../utils/utils';
import { Action, ProductIdentifier, triggerType, SortEnum } from '../models/models';

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
            field: this.contributor.idFieldName,
            op: Expression.OpEnum.Eq,
            value: identifier
        };
        const filter: Filter = {
            f: [expression]
        };
        searchResult = this.contributor.collaborativeSearcheService.resolveHits([
            projType.search, search],
            this.contributor.identifier, filter);
        const obs: Observable<{ details: Map<string, Map<string, string>>, actions: Array<Action> }> = searchResult.map(c => {
            const detailsMap = new Map<string, Map<string, string>>();
            const details = this.contributor.getConfigValue('details');
            Object.keys(details).forEach(group => {
                const detailedDataMap = new Map<string, string>();
                Object.keys(details[group]).forEach(element => {
                    const confEntrie = details[group][element];
                    feedDetailledMap(element, detailedDataMap, confEntrie, c.hits[0].data);
                    detailsMap.set(group, detailedDataMap);
                });
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
    * Data to feed result list,@Input() data of ResultListComponent.
    */
    public data: Array<Map<string, string | number | Date>> = new Array<Map<string, string | number | Date>>();
    /**
    * List of column of the table,@Input() fieldsList of ResultListComponent.
    */
    public fieldsList: Array<{ columnName: string, fieldName: string, dataType: string }> = [];
    /**
    * Instance of DetailedDataRetriever class,@Input() detailedDataRetriever of ResultListComponent.
    */
    public detailedDataRetriever = new ResultListDetailedDataRetriever();
    /**
    * List of actions, from all the contributors of the app, which we could trigger on click in the ResultListComponent.
    */
    public actionToTriggerOnClick: Array<Action> = [];
    /**
    * List of actions, from all the contributors of the app, which we could trigger on consult in the ResultListComponent.
    */
    public actionToTriggerOnConsult: Array<Action> = [];
    /**
     * Action subject nexted on download trigger, subscribe by the ResultListContributor to download detail data.
    */
    public downloadActionBus: Subject<ProductIdentifier> = new Subject<ProductIdentifier>();
    /**
    * List of actions, trigger by the ResultListContributor.
    */
    public actions: Array<Action> = [{
        id: 'download',
        label: 'Download',
        actionBus: this.downloadActionBus,
        triggerType: triggerType.onclick
    }];
    /**
     * Sort parameter of the list.
    */
    private sort: Sort = {};
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param idFieldName  @Input of Angular ResultListComponent, field name of the id column.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        public idFieldName: string,
        public collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService);
        // Register the contributor in collaborativeSearcheService registry
        this.collaborativeSearcheService.register(this.identifier, this);
        // Link the ResultListContributor and the detailedDataRetriever
        this.detailedDataRetriever.setContributor(this);
        // Load data in resultList on init
        this.feedTable();
        // Subscribe to the collaborationBus to retrieve new data
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                this.feedTable();
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
        // Subscribe to the downloadActionBus to download data on trigger
        this.downloadActionBus.subscribe(id => {
            let searchResult: Observable<Hits>;
            const search: Search = {
                size: { size: 1 },
                form: {
                    pretty: true,
                    human: true
                }
            };
            const expression: Expression = {
                field: id.idFieldName,
                op: Expression.OpEnum.Eq,
                value: id.idValue
            };
            const filter: Filter = {
                f: [expression]
            };
            const actionsList = new Array<string>();
            searchResult = this.collaborativeSearcheService.resolveHits([projType.search, search], null, filter);
            searchResult.map(data => JSON.stringify(data)).subscribe(
                data => {
                    download(data.toString(), id.idValue + '.json', 'text/json');
                }
            );
        });
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
        return 'catalog.web.app.components.table';
    }
    /**
    * Method to add Action in actionToTrigger
    * @param action action to add
    */
    public addAction(action: Action) {
        if (this.actionToTriggerOnClick.indexOf(action, 0) < 0 && action.triggerType === triggerType.onclick) {
            this.actionToTriggerOnClick.push(action);
        }
        if (this.actionToTriggerOnConsult.indexOf(action, 0) < 0 && action.triggerType === triggerType.onconsult) {
            this.actionToTriggerOnConsult.push(action);
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
        const indexOnConsult = this.actionToTriggerOnConsult.indexOf(action, 0);
        if (indexOnConsult > -1) {
            this.actionToTriggerOnConsult.splice(indexOnConsult, 1);
        }
    }

    /**
    * Method to notify the bus of action of a new trigger
    * @param onAction action and productIdentifier to trigger
    */
    public actionOnItem(onAction: { action: Action, productIdentifier: ProductIdentifier }) {
        onAction.action.actionBus.next(onAction.productIdentifier);
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
        this.feedTable(sort);
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
                const expression: Expression = {
                    field: v,
                    op: Expression.OpEnum.Like,
                    value: <string>k
                };
                expressions.push(expression);
            });
            const filterValue: Filter = {
                f: expressions
            };
            const collaboration: Collaboration = { filter: filterValue, enabled: true };
            this.collaborativeSearcheService.setFilter(this.identifier, collaboration);
        }
    }
    /**
    * Method call when emit the output consultedItemEvent
    * @param item ProductIdentifier params
    */
    public consultItem(item: ProductIdentifier) {
        this.actionToTriggerOnConsult.forEach(action => action.actionBus.next(item));
    }
    /**
    * Method call when emit the output moreDataEvent
    * @param from· number of time that's scroll bar down
    */
    public getMoreData(from: number) {
        this.feedTable(this.sort, from * this.getConfigValue('search_size'));
    }
    /**
    * Method to retrieve data from Arlas Server and update ResultList Component
    * @param sort sort option in  Arlas Search Parameter
    * @param from option in  Arlas Search Parameter
    */
    private feedTable(sort?: Sort, from?: number) {
        let searchResult: Observable<Hits>;
        const projection: Projection = {};
        let includesvalue = '';
        const search: Search = { size: { size: this.getConfigValue('search_size') } };
        if (sort) {
            search.sort = sort;
        }
        if (from) {
            if (from === 0) {
                this.data = new Array<Map<string, string | number | Date>>();
            } else {
                search.size.from = from;
            }
        } else {
            this.data = new Array<Map<string, string | number | Date>>();
        }
        this.fieldsList = [];
        Object.keys(this.getConfigValue('columns')).forEach(element => {
            this.fieldsList.push(this.getConfigValue('columns')[element]);
            includesvalue = includesvalue + ',' + this.getConfigValue('columns')[element].fieldName;
        });
        search.projection = projection;
        projection.includes = includesvalue.substring(1);
        searchResult = this.collaborativeSearcheService.resolveButNotHits([projType.search, search]);
        searchResult.subscribe(
            value => {
                if (value.nbhits > 0) {
                    value.hits.forEach(h => {
                        const map = new Map<string, string | number | Date>();
                        this.fieldsList.forEach(element => {
                            const result: string = getElementFromJsonObject(h.data, element.fieldName);
                            const process: string = this.getConfigValue('process')[element.fieldName]['process'];
                            let resultValue = null;
                            if (process.trim().length > 0) {
                                resultValue = eval(this.getConfigValue('process')[element.fieldName]['process']);
                            } else {
                                resultValue = result;

                            }
                            map.set(element.fieldName, resultValue);
                        });
                        this.data.push(map);
                    });
                }
            },
            error => { this.collaborativeSearcheService.collaborationErrorBus.next(error); }
        );
    }
}
