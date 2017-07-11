
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService } from 'arlas-web-core';
import { Observable } from "rxjs/Observable";
import { ArlasAggregation } from "api-arlas/model/arlasAggregation";
import { AggregationModel } from "api-arlas/model/aggregationModel";
import { Filter } from "api-arlas/model/filter";
import { arlasProjection, eventType } from "arlas-web-core/models/collaborationEvent";
import { Aggregations } from "api-arlas/model/aggregations";
import { AggregationRequest } from "api-arlas/model/aggregationRequest";


export class HistogramContributor {
    constructor(
        private valueChangedEvent: Subject<any>,
        private chartData: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService) {
        let aggregationsModels = new Array<AggregationModel>()
        let aggregationModel: AggregationModel = {
            type: "term",
            field: "timestamp",
            collectField: "available_bikes",
            collectFct: "sum",
            size: "100",
            order: "asc",
            on: "field"
        }
        aggregationsModels.push(aggregationModel)
        let aggregations: Aggregations = { aggregations: aggregationsModels }
        this.valueChangedEvent.subscribe(value => {
            let endDate = new Date(value.endvalue)
            let startDate = new Date(value.startvalue)
            let filter: Filter = {
                before: endDate.valueOf()/1000,
                after: startDate.valueOf()/1000
            }
            let aggregationRequest: AggregationRequest = {
                filter: filter,
                aggregations: aggregations
            }
            let detail: arlasProjection = {
                aggregationRequest: aggregationRequest,
                filter:filter
            }
            let data = {
                contributor: this,
                eventType: eventType.aggregate,
                detail: detail
            }
            this.collaborativeSearcheService.setFilter(data)
        })
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributor === this) {
                return
            } else {
                let data: Observable<ArlasAggregation> = this.collaborativeSearcheService.resolveButNot(eventType.aggregate)
                let dataTab = new Array<any>()
                data.subscribe(value => {
                    value.elements.forEach(element => {
                        dataTab.push({ key: element.key, value: element.elements[0].metric.value })
                    })
                    this.chartData.next(dataTab)
                })
                return
            }
        })
    }
}