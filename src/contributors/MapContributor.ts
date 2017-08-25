
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { projType } from 'arlas-web-core/models/collaborativesearch';
import { Search, Expression, Hits } from 'arlas-api';
import { Size } from 'arlas-api';
import { Filter } from 'arlas-api';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { Action, IdObject } from '../utils/models';
import { getElementFromJsonObject } from '../utils/utils';



export class MapContributor extends Contributor {
    public actions: Array<Action> = [];
    public addLayeActionrDetailBus: Subject<IdObject> = new Subject<IdObject>();
    public removeLayerActionDetailBus: Subject<IdObject> = new Subject<IdObject>();
    constructor(
        public identifier,
        private displayName: string,
        private selectedBbox: Subject<Array<number>>,
        private removeBbox: Subject<boolean>,
        private addLayerDetailBus: Subject<{
            geometry: string,
            id: string
        }>,
        private removeLayerDetailBus: Subject<string>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.actions.push(
            {
                id: 'showonmap',
                label: 'Show on map',
                actionBus: this.addLayeActionrDetailBus
            });
        this.actions.push(
            {
                id: 'removefrommap',
                label: 'Remove from map',
                actionBus: this.removeLayerActionDetailBus
            });
        this.collaborativeSearcheService.register(this.identifier, this);
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                if (contributorId !== this.identifier) {
                    if (contributorId === 'remove-all' || contributorId === 'remove-' + this.identifier) {
                        this.removeBbox.next(true);
                    }
                }
                this.removeLayerDetailBus.next('all');
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
        this.selectedBbox.subscribe(
            value => {
                let pwithin = '';
                value.forEach(v => pwithin = pwithin + ',' + v);
                const filters: Filter = {
                    pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
                };
                const data: Collaboration = {
                    filter: filters,
                    enabled: true
                };
                this.collaborativeSearcheService.setFilter(this.identifier, data);
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
        this.removeBbox.subscribe(
            value => {
                if (value) {
                    if (this.collaborativeSearcheService.getFilter(this.identifier) !== null) {
                        this.collaborativeSearcheService.removeFilter(this.identifier);
                    };
                }
            }
        );

        this.addLayeActionrDetailBus.subscribe(id => {
            let searchResult: Observable<Hits>;
            const search: Search = { size: { size: 1 } };
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
            searchResult.subscribe(h => {
                const geojsonData = getElementFromJsonObject(h.hits[0].data, this.getConfigValue('geometry'));
                this.addLayerDetailBus.next(
                    {
                        geometry: geojsonData,
                        id: id.idValue
                    }
                );
            });
        });

        this.removeLayerActionDetailBus.subscribe(id => {
            this.removeLayerDetailBus.next(id.idValue);
        });
    }

    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.map';
    }

    public getFilterDisplayName(): string {
        return 'GeoBox';
    }


}
