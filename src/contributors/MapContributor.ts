
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService } from 'arlas-web-core';
import { Observable } from "rxjs/Observable";
import { ArlasAggregation } from "api-arlas/model/arlasAggregation";
import { AggregationModel } from "api-arlas/model/aggregationModel";
import { Filter } from "api-arlas/model/filter";
import { arlasProjection, eventType } from "arlas-web-core/models/collaborationEvent";
import { Aggregations } from "api-arlas/model/aggregations";
import { AggregationRequest } from "api-arlas/model/aggregationRequest";
import { ArlasHits } from "api-arlas/model/arlasHits";
import { FeatureCollection } from "api-arlas/model/featureCollection";

export class MapContributor {
    constructor(
        private layerSubject: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService) {
        let data: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNot(eventType.geosearch)
        data.subscribe(value => { this.layerSubject.next(value) })
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributor === this) {
                return
            } else {
                let data: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNot(eventType.geosearch)
                data.subscribe(value => { this.layerSubject.next(value) })
            }
        })
    }
}