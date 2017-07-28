
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { ArlasAggregation } from 'arlas-api/model/arlasAggregation';
import { AggregationModel } from 'arlas-api/model/aggregationModel';
import { Filter } from 'arlas-api/model/filter';
import { eventType, CollaborationEvent } from 'arlas-web-core/models/collaborationEvent';
import { Aggregations } from 'arlas-api/model/aggregations';
import { AggregationRequest } from 'arlas-api/model/aggregationRequest';
import { ArlasHits } from 'arlas-api/model/arlasHits';
import { Search } from 'arlas-api/model/search';
import { Size } from 'arlas-api/model/size';

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

        this.settings = this.getConfigValue('settings');
        this.feedTable();
        this.valuesChangedEvent.subscribe(value => {
            const filters = new Array<string>();
            value.forEach(element => {
                filters.push(element.field + ':like:' + element.value);
            });
            const filter: Filter = {
                f: filters
            };

            const data: CollaborationEvent = {
                contributorId: this.identifier,
                detail: filter,
                enabled: true
            };

            this.collaborativeSearcheService.setFilter(data);
        });
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributorId !== this.identifier) {
                this.feedTable(this.identifier);
            }
        });
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
            data = this.collaborativeSearcheService.resolveButNot([eventType.search, search], contributorId);
        } else {
            data = this.collaborativeSearcheService.resolveButNot([eventType.search, search]);
        }
        const dataForTab = new Array<Object>();
        data.subscribe(value => {
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
        });
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
