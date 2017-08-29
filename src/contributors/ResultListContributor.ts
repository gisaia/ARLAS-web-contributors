import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { projType } from 'arlas-web-core/models/projections';
import { Filter, Hits, Search, Size, Expression, Sort, Projection } from 'arlas-api';
import { getElementFromJsonObject, isArray, feedDetailledMap, download } from '../utils/utils';
import { Action, ProductIdentifier } from '../models/models';
/**
* Enum of sorting value define in Arlas-web-components
*/
export enum SortEnum {
    asc, desc, none
}
/**
* Interface define in Arlas-web-components
*/
export interface DetailedDataRetriever {
    getData(identifier: string): Observable<{ details: Map<string, string>, actions: Array<Action> }>;
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
    public getData(identifier: string): Observable<{ details: Map<string, string>, actions: Array<Action> }> {
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
        searchResult = this.contributor.collaborativeSearcheService.resolve([projType.search, search], this.contributor.identifier, filter);
        const obs: Observable<{
            details: Map<string, string>, actions: Array<Action>
        }> = searchResult.map(c => {
            const detailedDataMap = new Map<string, string>();
            const details = this.contributor.getConfigValue('details');
            Object.keys(details).forEach(element => {
                const confEntrie = details[element];
                feedDetailledMap(element, detailedDataMap, confEntrie, c.hits[0].data);
            });
            const objectResult = { details: detailedDataMap, actions: this.contributor.actionToTrigger };
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
    * List of actions, from all the contributors of the app, which we could trigger in the ResultListComponent.
    */
    public actionToTrigger: Array<Action> = [];
    /**
     * Action subject nexted on download trigger, subscribe by the ResultListContributor to download detail data.
    */
    private downloadActionBus: Subject<ProductIdentifier> = new Subject<ProductIdentifier>();
    /**
    * List of actions, trigger by the ResultListContributor.
    */
    public actions: Array<Action> = [{
        id: 'download',
        label: 'Download',
        actionBus: this.downloadActionBus
    }];
    /**
     * Array of action on consult subject, when consultedItemEvent is trigger each bus is notifiy whith the identifier of consulted line.
    */
    public consultActionSubjects: Array<Subject<string>> = [];
    /**
     * Sort parameter of the list.
    */
    private sort: Sort = {};
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param idFieldName  @Input of Angular ResultListComponent, field name of the id column.
    * @param actionOnItemEvent  @Output of Angular ResultListComponent, send the Action and the identifier on trigger event.
    * @param sortColumnsEvent  @Output of Angular ResultListComponent, send field and the sort order on sort event.
    * @param setFiltersEvent  @Output of Angular ResultListComponent, send a map of field,value filter to add.
    * @param consultedItemEvent  @Output of Angular ResultListComponent, send an identifier string of the consulted item.
    * @param moreDataEvent  @Output of Angular ResultListComponent, send a number when the scroll is in the end of the page,
    to fetch more data.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        public idFieldName: string,
        private actionOnItemEvent: Subject<{
            action: Action,
            productIdentifier: ProductIdentifier
        }>,
        private sortColumnsEvent: Subject<{ fieldName: string, sortDirection: SortEnum }>,
        private setFiltersEvent: Subject<Map<string, string | number | Date>>,
        private consultedItemEvent: Subject<string>,
        private moreDataEvent: Subject<number>,
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
                this.collaborativeSearcheService.collaborationErrorBus.next((error));
            }
        );
        // Subscribe to the actionOnItemEvent to notify the actionBus of the sending Action
        this.actionOnItemEvent.subscribe(action => {
            action.action.actionBus.next(action.productIdentifier);
        });
        // Subscribe to the setFiltersEvent to Set filter to the collaborativeSearcheService
        this.setFiltersEvent.subscribe(filterMap => {
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
        });
        // Subscribe to the sortColumnsEvent to reload data with certain order
        this.sortColumnsEvent.subscribe(s => {
            let prefix = null;
            if (s.sortDirection.toString() === '0') {
                prefix = '';
            } else if (s.sortDirection.toString() === '1') {
                prefix = '-';
            }
            let sort: Sort = {};
            if (prefix !== null) {
                sort = {
                    'sort': prefix + s.fieldName
                };
            }
            this.sort = sort;
            this.feedTable(sort);
        });
        // Subscribe to the consultedItemEvent to notify all the define consultActionSubjects
        this.consultedItemEvent.subscribe(value =>
            this.consultActionSubjects.forEach(o => {
                o.next(value);
            })
        );
        // Subscribe to the moreDataEvent to add data in the list when the scroll is down
        this.moreDataEvent.subscribe(from => {
            this.feedTable(this.sort, from * this.getConfigValue('search_size'));
        });
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
            searchResult = this.collaborativeSearcheService.resolve([projType.search, search], null, filter);
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
        if (this.actionToTrigger.indexOf(action, 0) < 0) {
            this.actionToTrigger.push(action);
        }
    }
    /**
    * Method to remove Action in actionToTrigger
    * @param action action to remove
    */
    public removeAction(action: Action) {
        const index = this.actionToTrigger.indexOf(action, 0);
        if (index > -1) {
            this.actionToTrigger.splice(index, 1);
        }
    }
    /**
    * Method to add Subject<string> in consultActionsSubject
    * @param consultActionsSubject action to add
    */
    public addConsultActionSubject(consultActionsSubject: Subject<string>) {
        if (this.consultActionSubjects.indexOf(consultActionsSubject, 0) < 0) {
            this.consultActionSubjects.push(consultActionsSubject);
        }
    }
    /**
    * Method to add Subject<string> in consultActionsSubject
    * @param consultActionsSubject action to add
    */
    public removeConsultActionSubject(consultActionsSubject: Subject<string>) {
        const index = this.consultActionSubjects.indexOf(consultActionsSubject, 0);
        if (index > -1) {
            this.consultActionSubjects.splice(index, 1);
        }
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
        searchResult = this.collaborativeSearcheService.resolveButNot([projType.search, search]);
        searchResult.subscribe(value => {
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
        });

    }


}
