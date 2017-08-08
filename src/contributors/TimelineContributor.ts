import { DESCRIPTOR_LOCATIONS } from 'tslint/lib/rules/completedDocsRule';

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
    private valueChangedEvent: Subject<any>;
    private chartData: Subject<any>;

    constructor(
        identifier: string,
        private displayName: string,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService);
        const aggregationModel: AggregationModel = this.getConfigValue('aggregationmodel');
        const aggregationsModels = new Array<AggregationModel>();
        aggregationsModels.push(aggregationModel);
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributorId !== this.identifier) {
                if (this.chartData !== null && this.chartData !== undefined) {
                    this.plotChart(aggregationsModels, this.identifier);
                }
            }
        },
            error => { this.collaborativeSearcheService.collaborationErrorBus.next(error); });

    }

    public getValueChangedEvent() {
        return this.valueChangedEvent;
    }

    public setValueChangedEvent(valueChangedEvent: Subject<any>, dateType) {
        if (valueChangedEvent !== null) {
            this.valueChangedEvent = valueChangedEvent;
            this.initValueChangeEvent(dateType);
        } 
    }

    public getCharData() {
        return this.chartData;
    }

    public setCharData(chartData: Subject<any>) {
        if (chartData !== null) {
            this.chartData = chartData;
            this.initChartDataValue();
        } 
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
        const aggregations: Aggregations = { aggregations: aggregationsModels };
        const data = this.collaborativeSearcheService.resolveButNot([eventType.aggregate, aggregations], contributorId);
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

    private initValueChangeEvent(dateType) {
        const aggregationModel: AggregationModel = this.getConfigValue('aggregationmodel');
        const field: string = aggregationModel.field;
        this.valueChangedEvent.subscribe(
            value => {
                let end = value.endvalue;
                let start = value.startvalue;
                if ((typeof end.getMonth === 'function') && (typeof start.getMonth === 'function')) {
                    const endDate = new Date(value.endvalue);
                    const startDate = new Date(value.startvalue);
                    let multiplier = 1;
                    if (dateType === DateType.second) {
                        multiplier = 1000;
                    }
                    end = endDate.valueOf() / 1 * multiplier;
                    start = startDate.valueOf() / 1 * multiplier;
                }
                const gt: string = field + ':gt:' + start;
                const lt: string = field + ':lt:' + end;

                const filterValue: Filter = {
                    f: [gt, lt]

                };
                this.updateAndSetCollaborationEvent(this.identifier, filterValue);
            },
            error => { this.collaborativeSearcheService.collaborationErrorBus.next(error); });
    }

    private initChartDataValue() {
        const aggregationModel: AggregationModel = this.getConfigValue('aggregationmodel');
        const aggregationsModels = new Array<AggregationModel>();
        aggregationsModels.push(aggregationModel);
        this.plotChart(aggregationsModels, this.identifier);
    }
}
