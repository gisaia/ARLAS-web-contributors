
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { ArlasAggregation } from 'arlas-api/model/arlasAggregation';
import { AggregationModel } from 'arlas-api/model/aggregationModel';
import { Filter } from 'arlas-api/model/filter';
import { eventType } from 'arlas-web-core/models/collaborationEvent';
import { Aggregations } from 'arlas-api/model/aggregations';
import { AggregationRequest } from 'arlas-api/model/aggregationRequest';
import { ArlasHits } from 'arlas-api/model/arlasHits';
import { FeatureCollection } from 'arlas-api/model/featureCollection';
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
        this.addLayer();
        this.collaborativeSearcheService.collaborationBus.subscribe(
            value => {
                if (value.contributorId !== this.identifier) {
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

    private addLayer(contributorId?: string) {
        let data;
        const search: Search = {};
        const size: Size = { size: this.getConfigValue('search_size') };
        search['size'] = size;
        if (contributorId) {
            data = this.collaborativeSearcheService.resolveButNot([eventType.geosearch, search], contributorId);
        } else {
            data = this.collaborativeSearcheService.resolveButNot([eventType.geosearch, search]);
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
