
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

export class TableContributor {
    constructor(
        private settings: Object,
        private dataSubject: Subject<any>,
        private source: Object,
        private valuesChangedEvent: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService) {
        let data: Observable<ArlasHits> = this.collaborativeSearcheService.resolveButNot(eventType.search)
        let dataForTab = new Array<Object>();
        data.subscribe(value => {
            value.hits.forEach(h => {
                dataForTab.push({
                    id: h.md.id,
                    name: h.data.name,
                    address: h.data.address,
                    contract_name: h.data.contract_name,
                    bike_stands: h.data.bike_stands,
                    available_bike_stands: h.data.available_bike_stands,
                    available_bikes: h.data.available_bikes,
                })
            })
            this.dataSubject.next(dataForTab)
        })
        this.valuesChangedEvent.subscribe(value => {
            let arrayString = new Array<string>()
            value.forEach(element => {
                arrayString.push(element.field + ":like:" + element.value)
            });
            let filter: Filter = {
                f: arrayString
            }
            let detail: arlasProjection = {
                filter: filter
            }
            let data = {
                contributor: this,
                eventType: eventType.search,
                detail: detail
            }
            this.collaborativeSearcheService.setFilter(data)

            if (arrayString.length > 0) {
                this.collaborativeSearcheService.setFilter(data)

            } else {
                this.collaborativeSearcheService.contributions.forEach(x => {
                    if (x.contributor == this) {
                        this.collaborativeSearcheService.removeFilter(x)
                    }
                })
                this.collaborativeSearcheService.setFilter(data)

            }
        })
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributor === this) {
                return
            } else {
                let data: Observable<ArlasHits> = this.collaborativeSearcheService.resolveButNot(eventType.search)
                let dataForTab = new Array<Object>();
                data.subscribe(value => {
                    value.hits.forEach(h => {
                        dataForTab.push({
                            id: h.md.id,
                            name: h.data.name,
                            address: h.data.address,
                            contract_name: h.data.contract_name,
                            bike_stands: h.data.bike_stands,
                            available_bike_stands: h.data.available_bike_stands,
                            available_bikes: h.data.available_bikes,
                        })
                    })
                    this.dataSubject.next(dataForTab)
                })

            }
        })
    }
}