
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from "rxjs/Observable";
import { ArlasAggregation } from "arlas-api/model/arlasAggregation";
import { AggregationModel } from "arlas-api/model/aggregationModel";
import { Filter } from "arlas-api/model/filter";
import { arlasProjection, eventType } from "arlas-web-core/models/collaborationEvent";
import { Aggregations } from "arlas-api/model/aggregations";
import { AggregationRequest } from "arlas-api/model/aggregationRequest";


export class HistogramContributor extends Contributor {
    constructor(
        identifier: string,
        private valueChangedEvent: Subject<any>,
        private chartData: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService,configService:ConfigService) {
        super(identifier,configService)
        let aggregationsModels = new Array<AggregationModel>()
        let aggregationModel: AggregationModel = this.getConfigValue("aggregationmodel")
        aggregationsModels.push(aggregationModel)
        let aggregations: Aggregations = { aggregations: aggregationsModels }
        this.valueChangedEvent.subscribe(value => {
            let endDate = new Date(value.endvalue)
            let startDate = new Date(value.startvalue)
            let filter: Filter = {
                before: endDate.valueOf() / 1000,
                after: startDate.valueOf() / 1000
            }
            let aggregationRequest: AggregationRequest = {
                filter: filter,
                aggregations: aggregations
            }
            let detail: arlasProjection = {
                aggregationRequest: aggregationRequest,
                filter: filter
            }
            let data = {
                contributor: this,
                eventType: eventType.aggregate,
                detail: detail
            }
            this.collaborativeSearcheService.setFilter(data)
        })
        let aggregationRequest: AggregationRequest = {
            aggregations: aggregations
        }
        let detail: arlasProjection = {
            aggregationRequest: aggregationRequest,
        }
        let data = {
            contributor: this,
            eventType: eventType.aggregate,
            detail: detail
        }
        this.collaborativeSearcheService.setFilter(data)
        let obs = this.collaborativeSearcheService.resolveButNot(eventType.aggregate)
        let dataTab = new Array<any>()
        obs.subscribe(value => {
            value.elements.forEach(element => {
                dataTab.push({ key: element.key, value: element.elements[0].metric.value })
            })
            this.chartData.next(dataTab)
        })
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributor === this) {
                return
            } else {
                let data = this.collaborativeSearcheService.resolveButNot(eventType.aggregate)
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
    getPackageName(): string {
        return  "arlas.catalog.web.app.components.histogram";
    }
}