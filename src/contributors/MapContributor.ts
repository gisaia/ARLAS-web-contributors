
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from "rxjs/Observable";
import { ArlasAggregation } from "arlas-api/model/arlasAggregation";
import { AggregationModel } from "arlas-api/model/aggregationModel";
import { Filter } from "arlas-api/model/filter";
import { arlasProjection, eventType } from "arlas-web-core/models/collaborationEvent";
import { Aggregations } from "arlas-api/model/aggregations";
import { AggregationRequest } from "arlas-api/model/aggregationRequest";
import { ArlasHits } from "arlas-api/model/arlasHits";
import { FeatureCollection } from "arlas-api/model/featureCollection";

export class MapContributor extends Contributor {

    constructor(
        public identifier,
        private layerSubject: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService, configService:ConfigService) {
        super(identifier,configService);
        let data = this.collaborativeSearcheService.resolveButNot(eventType.geosearch)
        data.subscribe(value => { this.layerSubject.next(value) })
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributor === this) {
                return
            } else {
                let data= this.collaborativeSearcheService.resolveButNot(eventType.geosearch)
                data.subscribe(value => { this.layerSubject.next(value) })
            }
        })
    }
    getPackageName(): string {
        return  "arlas.catalog.web.app.components.map";
    }
}