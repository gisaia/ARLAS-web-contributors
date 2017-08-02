
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { ArlasAggregation } from 'arlas-api/model/arlasAggregation';
import { AggregationModel } from 'arlas-api/model/aggregationModel';
import { Filter } from 'arlas-api/model/filter';
import { CollaborationEvent, eventType } from 'arlas-web-core/models/collaborationEvent';
import { Aggregations } from 'arlas-api/model/aggregations';

export enum DateType {
    second, millisecond
}

export class TimelineContributor extends Contributor {
    constructor(
        identifier: string,
        private displayName: string,
        private valueChangedEvent: Subject<any>,
        private chartData: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        dateType: DateType) {
        super(identifier, configService);
        const aggregationModel: AggregationModel = this.getConfigValue('aggregationmodel');
        const aggregationsModels = new Array<AggregationModel>();
        aggregationsModels.push(aggregationModel);
        const filter: Filter = {};
        this.plotChart(aggregationsModels);
        this.valueChangedEvent.subscribe(
            value => {
                const endDate = new Date(value.endvalue);
                const startDate = new Date(value.startvalue);
                let multiplier = 1;
                if (dateType === DateType.second) {
                    multiplier = 1000;
                }
                const filterValue: Filter = {
                    before: endDate.valueOf() / 1 * multiplier,
                    after: startDate.valueOf() / 1 * multiplier
                };
                this.updateAndSetCollaborationEvent(this.identifier, filterValue);
            },
            error => { this.collaborativeSearcheService.collaborationErrorBus.next(error); });

        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributorId !== this.identifier) {
                this.plotChart(aggregationsModels, this.identifier);
            }
        },
            error => { this.collaborativeSearcheService.collaborationErrorBus.next(error); });
    }

    public getFilterDisplayName(): string {
        return '';
    }

    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.histogram';
    }

    private updateAndSetCollaborationEvent(identifier: string, filter: Filter): void {
        const data: CollaborationEvent = {
            contributorId: identifier,
            detail: filter,
            enabled: true
        };
        this.collaborativeSearcheService.setFilter(data);
    }

    private plotChart(aggregationsModels: Array<AggregationModel>, contributorId?: string) {
        let data;
        const aggregations: Aggregations = { aggregations: aggregationsModels };
        if (contributorId) {
            data = this.collaborativeSearcheService.resolveButNot([eventType.aggregate, aggregations], contributorId);
        } else {
            data = this.collaborativeSearcheService.resolveButNot([eventType.aggregate, aggregations]);
        }
        const dataTab = new Array<any>();
        data.subscribe(value => {
            if (value.totalnb > 0) {
                value.elements.forEach(element => {
                    dataTab.push({ key: element.key, value: element.count });
                });
            }
            this.chartData.next(dataTab);
        },
            error => { this.collaborativeSearcheService.collaborationErrorBus.next(error); });
    }
}
