
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from "rxjs/Observable";
import { ArlasAggregation } from "arlas-api/model/arlasAggregation";
import { AggregationModel } from "arlas-api/model/aggregationModel";
import { Filter } from "arlas-api/model/filter";
import { CollaborationEvent, eventType } from 'arlas-web-core/models/collaborationEvent';
import { Aggregations } from "arlas-api/model/aggregations";
import { AggregationRequest } from "arlas-api/model/aggregationRequest";


export class TimelineContributor extends Contributor {
    constructor(
        identifier: string,
        private displayName: string,
        private valueChangedEvent: Subject<any>,
        private chartData: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService)
        let aggregationsModels = new Array<AggregationModel>()
        let aggregationModel: AggregationModel = this.getConfigValue("aggregationmodel")
        aggregationsModels.push(aggregationModel)
        let aggregations: Aggregations = { aggregations: aggregationsModels }
        let aggregationRequest: AggregationRequest = {
            aggregations: aggregations
        }
        let filter: Filter = {
        }
        let data: CollaborationEvent = {
            contributorId: this.identifier,
            detail: filter
        }
        this.collaborativeSearcheService.setFilter(data)
        this.plotChart(aggregationsModels)

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

            let data: CollaborationEvent = {
                contributorId: this.identifier,
                detail: filter
            }
            this.collaborativeSearcheService.setFilter(data)
        })
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributorId !== this.identifier) {
                this.plotChart(aggregationsModels, this.identifier)
            }
        })
    }
    getPackageName(): string {
        return "arlas.catalog.web.app.components.histogram";
    }
    plotChart(aggregationsModels: Array<AggregationModel>, contributorId?: string) {
        let data;
        let aggregations: Aggregations = { aggregations: aggregationsModels }
        if (contributorId) {
            data = this.collaborativeSearcheService.resolveButNot([eventType.aggregate, aggregations], contributorId)
        } else {
            data = this.collaborativeSearcheService.resolveButNot([eventType.aggregate, aggregations])
        }
        let dataTab = new Array<any>()
        data.subscribe(value => {
            value.elements.forEach(element => {
                dataTab.push({ key: element.key, value: element.elements[0].metric.value })
            })
            this.chartData.next(dataTab)
        })
    }
}