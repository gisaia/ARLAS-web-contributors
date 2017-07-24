
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from "rxjs/Observable";
import { ArlasAggregation } from "arlas-api/model/arlasAggregation";
import { AggregationModel } from "arlas-api/model/aggregationModel";
import { Filter } from "arlas-api/model/filter";
import {  eventType } from "arlas-web-core/models/collaborationEvent";
import { Aggregations } from "arlas-api/model/aggregations";
import { AggregationRequest } from "arlas-api/model/aggregationRequest";
import { ArlasHits } from "arlas-api/model/arlasHits";
import { FeatureCollection } from "arlas-api/model/featureCollection";
import { Search } from "arlas-api/model/search";

export class MapContributor extends Contributor {

    constructor(
        public identifier,
        private displayName: string,
        private layerSubject: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.addLayer();
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributorId !== this.identifier) {
                this.addLayer();
            }
        })
    }
    getPackageName(): string {
        return "arlas.catalog.web.app.components.map";
    }
    addLayer(contributorId?: string) {
        let data;
        let search :Search ={}
        if (contributorId) {
            data = this.collaborativeSearcheService.resolveButNot([eventType.geosearch,search], contributorId)
        } else {
            data = this.collaborativeSearcheService.resolveButNot([eventType.geosearch,search])
        }
        data.subscribe(value => { this.layerSubject.next(value) })
    }
}