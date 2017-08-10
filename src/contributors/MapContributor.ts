
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { projType } from 'arlas-web-core/models/collaborativesearch';
import { Search } from 'arlas-api/model/search';
import { Size } from 'arlas-api/model/size';

export class MapContributor extends Contributor {

    constructor(
        public identifier,
        private displayName: string,
        private layerSubject: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.collaborativeSearcheService.register(this.identifier, this);
        this.addLayer();
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                if (contributorId !== this.identifier) {
                    this.addLayer();
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }

    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.map';
    }

    public getFilterDisplayName(): string {
        return 'GeoBox';
    }

    private addLayer(contributorId?: string) {
        let data;
        const search: Search = {};
        const size: Size = { size: this.getConfigValue('search_size') };
        search['size'] = size;
        if (contributorId) {
            data = this.collaborativeSearcheService.resolveButNot([projType.geosearch, search], contributorId);
        } else {
            data = this.collaborativeSearcheService.resolveButNot([projType.geosearch, search]);
        }
        data.subscribe(
            value => {
                this.layerSubject.next(value);
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }
}
