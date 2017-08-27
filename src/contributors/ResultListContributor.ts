
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { projType } from 'arlas-web-core/models/collaborativesearch';
import { Filter, Hits, Search, Size, Expression, Sort } from 'arlas-api';
import { getElementFromJsonObject } from '../utils/utils';
import { Action, IdObject } from '../utils/models';
import * as FileSaver from 'file-saver';

export enum SortEnum {
    asc, desc, none
}

export class DetailedDataRetriever {
    private contributor: ResultListContributor;
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
            details: Map<string, string>, actions: Array<{
                id: string, label: string,
                actionBus: Subject<{ idFieldName: string, idValue: string }>
            }>
        }> = searchResult.map(c => {
            const detailedDataMap = new Map<string, string>();
            const details = this.contributor.getConfigValue('details');
            Object.keys(details).forEach(element => {
                const confEntrie = details[element];
                this.feedDetailledMap(element, detailedDataMap, confEntrie, c.hits[0].data);
            });
            const objectResult = { details: detailedDataMap, actions: this.contributor.actionList };
            return objectResult;
        });
        return obs;
    }

    public setContributor(contributor: ResultListContributor) {
        this.contributor = contributor;
    }
    private isArray(obj: Object) {
        return Object.prototype.toString.call(obj) === '[object Array]';
    }

    private feedDetailledMap(element, detailedDataMap = new Map<string, string>(), confEntrie: any, data: any) {
        if (this.isArray(confEntrie)) {
            confEntrie.forEach(i => {
                Object.keys(i).forEach(subelement => {
                    if (data[element] !== undefined) {
                        data[element].forEach(e => {
                            this.feedDetailledMap(subelement, detailedDataMap, i[subelement], e);
                        });
                    }
                });
            });
        } else {
            const result = data[element];
            let resultset = null;
            if (confEntrie.process.trim().length > 0) {
                resultset = eval(confEntrie.process.trim());
            } else {
                resultset = result;
            }
            if (detailedDataMap.get(confEntrie.label) === null || detailedDataMap.get(confEntrie.label) === undefined) {
                detailedDataMap.set(confEntrie.label, resultset);
            } else {
                const newvalue = detailedDataMap.get(confEntrie.label) + ',' + resultset;
                detailedDataMap.set(confEntrie.label, newvalue);
            }

        }
    }
}

export class ResultListContributor extends Contributor {
    public data: Array<Map<string, string | number | Date>>;
    public fieldsList: Array<{ columnName: string, fieldName: string, dataType: string }> = [];
    public detailedDataRetriever = new DetailedDataRetriever();
    public actionList: Array<Action> = [];
    public actions: Array<Action> = [];
    public downloadAction: Action;
    public consultActionSubjects: Array<Subject<string>> = [];
    private downloadActionBus: Subject<IdObject> = new Subject<IdObject>();


    constructor(
        identifier: string,
        private displayName: string,
        public idFieldName: string,
        private actionOnItemEvent: Subject<{
            action: Action,
            productIdentifier: IdObject
        }>,
        private sortColumnsEvent: Subject<{ fieldName: string, sortDirection: SortEnum }>,
        private setFiltersEvent: Subject<Map<string, string | number | Date>>,
        private consultedItemEvent: Subject<string>,
        public collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService);
        this.collaborativeSearcheService.register(this.identifier, this);
        this.detailedDataRetriever.setContributor(this);
        this.feedTable();

        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                this.feedTable();
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next((error));
            }
        );
        this.actionOnItemEvent.subscribe(action => {
            action.action.actionBus.next(action.productIdentifier);
        });
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
            this.feedTable(sort);
        });

        this.consultedItemEvent.subscribe(value =>
            this.consultActionSubjects.forEach(o => {
                o.next(value);
            })
        );

        this.downloadAction = {
            id: 'download',
            label: 'Download',
            actionBus: this.downloadActionBus
        };
        this.actions.push(this.downloadAction);

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
                    this.download(data.toString(), id.idValue + '.json', 'text/json');
                }
            );
        });
    }

    public getFilterDisplayName(): string {
        return 'List';
    }

    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.table';
    }

    public addAction(action: Action) {
        if (this.actionList.indexOf(action, 0) < 0) {
            this.actionList.push(action);
        }
    }

    public removeAction(action: Action) {
        const index = this.actionList.indexOf(action, 0);
        if (index > -1) {
            this.actionList.splice(index, 1);
        }
    }

    public addConsultActionSubject(consultActionsSubject: Subject<string>) {
        if (this.consultActionSubjects.indexOf(consultActionsSubject, 0) < 0) {
            this.consultActionSubjects.push(consultActionsSubject);
        }
    }

    public removeConsultActionSubject(consultActionsSubject: Subject<string>) {
        const index = this.consultActionSubjects.indexOf(consultActionsSubject, 0);
        if (index > -1) {
            this.consultActionSubjects.splice(index, 1);
        }
    }

    private download(text, name, type) {
        const file = new Blob([text], { type: type });
        FileSaver.saveAs(file, name);
    }

    private feedTable(sort?: Sort) {
        let searchResult: Observable<Hits>;
        const search: Search = { size: { size: this.getConfigValue('search_size') } };
        if (sort) {
            search.sort = sort;
        }
        this.fieldsList = [];
        Object.keys(this.getConfigValue('columns')).forEach(element => {
            this.fieldsList.push(this.getConfigValue('columns')[element]);
        });
        this.data = new Array<Map<string, string | number | Date>>();

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
