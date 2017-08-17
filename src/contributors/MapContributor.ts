
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { projType } from 'arlas-web-core/models/collaborativesearch';
import { Search } from 'arlas-api/model/search';
import { Size } from 'arlas-api/model/size';
import { Filter } from 'arlas-api/model/filter';
import { Collaboration } from 'arlas-web-core/models/collaboration';

export class MapContributor extends Contributor {

    constructor(
        public identifier,
        private displayName: string,
        private selectedBbox: Subject<Array<number>>,
        private removeBbox: Subject<boolean>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.collaborativeSearcheService.register(this.identifier, this);
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                if (contributorId !== this.identifier) {
                    // TO DO addLayer
                }
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
            value => { if (value) { this.collaborativeSearcheService.removeFilter(this.identifier); } }
        );
    }

    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.map';
    }

    public getFilterDisplayName(): string {
        return 'GeoBox';
    }


}
