
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { projType } from 'arlas-web-core/models/collaborativesearch';
import { Filter } from 'arlas-api';
import { Search } from 'arlas-api';
import { Size } from 'arlas-api';
import { Expression } from 'arlas-api';

export class TableContributor extends Contributor {
    constructor(
        identifier: string,
        private displayName: string,
        private settings: Object,
        private dataSubject: Subject<any>,
        private source: Object,
        private valuesChangedEvent: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.collaborativeSearcheService.register(this.identifier, this);
        this.settings = this.getConfigValue('settings');
        this.feedTable();
        this.valuesChangedEvent.subscribe(
            value => {
                const fs = new Array<Expression>();
                value.forEach(element => {
                    const expression: Expression = {
                        field: element.field,
                        op: Expression.OpEnum.Like,
                        value: element.value
                    };

                    fs.push(element.field + ':like:' + element.value);
                });
                const filter: Filter = {
                    f: fs
                };

                const data: Collaboration = {
                    filter: filter,
                    enabled: true
                };

                this.collaborativeSearcheService.setFilter(this.identifier, data);
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                if (contributorId !== this.identifier) {
                    this.feedTable(this.identifier);
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next((error));
            }
        );
    }

    public getFilterDisplayName(): string {
        return 'List';
    }

    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.table';
    }
    private feedTable(contributorId?: string) {
        let data;
        const search: Search = {};
        const size: Size = { size: this.getConfigValue('search_size') };
        search['size'] = size;
        if (contributorId) {
            data = this.collaborativeSearcheService.resolveButNot([projType.search, search], contributorId);
        } else {
            data = this.collaborativeSearcheService.resolveButNot([projType.search, search]);
        }
        const dataForTab = new Array<Object>();
        data.subscribe(
            value => {
                if (value.nbhits > 0) {
                    value.hits.forEach(h => {
                        const line = {};
                        Object.keys(this.settings['columns']).forEach(element => {
                            if (element === 'id') {
                                line['id'] = h.md.id;
                            } else {
                                line[element] = this.getElementFromJsonObject(h.data, element);
                            }
                        });
                        dataForTab.push(line);
                    });
                }
                this.dataSubject.next({ data: dataForTab, settings: this.settings });
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }

    private getElementFromJsonObject(jsonObject: any, pathstring: string): any {
        const path = pathstring.split('.');
        if (jsonObject == null) {
            return null;
        }
        if (path.length === 0) {
            return null;
        }
        if (path.length === 1) {
            return jsonObject[path[0]];
        } else {
            return this.getElementFromJsonObject(jsonObject[path[0]], path.slice(1).join('.'));
        }
    }
}
