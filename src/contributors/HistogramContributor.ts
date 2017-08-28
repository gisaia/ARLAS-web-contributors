import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { Filter, Aggregation } from 'arlas-api';
import { Expression, AggregationResponse } from 'arlas-api';
import { Contributor, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { projType } from 'arlas-web-core/models/projections';

export enum DateType {
    second, millisecond
}

export interface SelectedOutputValues {
  startvalue: Date|number;
  endvalue: Date|number;
}

export class HistogramContributor extends Contributor {
    private valueChangedEvent: Subject<SelectedOutputValues>;
    private chartData: Subject<Array<{ key: number, value: number }>>;
    private intervalSelection: Subject<SelectedOutputValues>;
    private aggregation: Aggregation = this.getConfigValue('aggregationmodel');
    private field: string = this.aggregation.field;
    private startValue: string;
    private endValue: string;
    constructor(
        identifier: string,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService);
        this.collaborativeSearcheService.register(this.identifier, this);

        const aggregations = new Array<Aggregation>();
        aggregations.push(this.aggregation);
        this.collaborativeSearcheService.collaborationBus.subscribe(contributorId => {
            if (contributorId !== this.identifier) {
                if (this.chartData !== null && this.chartData !== undefined) {
                    this.plotChart(aggregations, this.identifier);
                }
            }
        },
            error => { this.collaborativeSearcheService.collaborationErrorBus.next(error); });
    }

    public getValueChangedEvent() {
        return this.valueChangedEvent;
    }

    public setValueChangedEvent(valueChangedEvent: Subject<SelectedOutputValues>, dateType) {
        if (valueChangedEvent !== null) {
            this.valueChangedEvent = valueChangedEvent;
            this.initValueChangeEvent(dateType);
        }
    }

    public getCharData() {
        return this.chartData;
    }

    public setCharData(chartData: Subject<Array<{ key: number, value: number }>>) {
        if (chartData !== null) {
            this.chartData = chartData;
            this.initChartDataValue();
        }
    }

    public getIntervalSelection() {
        return this.intervalSelection;
    }

    public setIntervalSelection(intervalSelection: Subject<SelectedOutputValues>) {
        if (intervalSelection !== null) {
            this.intervalSelection = intervalSelection;
        }
    }

    public getFilterDisplayName(): string {
        let displayName = '';
        const name = this.getConfigValue('name');
        if (this.aggregation.type.toString().toLocaleLowerCase() === Aggregation.TypeEnum.Datehistogram.toString().toLocaleLowerCase()) {
            displayName = '[' + this.startValue + '-' + this.endValue + ']';
        } else if (this.aggregation.type.toString().toLocaleLowerCase() === Aggregation.TypeEnum.Histogram.toString().toLocaleLowerCase()) {
            displayName = this.startValue + ' < ' + name + ' < ' + this.endValue;
        } else {
            displayName = name;
        }
        return displayName;
    }

    public getPackageName(): string {
        return 'catalog.web.app.components.histogram';
    }

    private updateAndSetCollaborationEvent(identifier: string, filter: Filter): void {
        const data: Collaboration = {
            filter: filter,
            enabled: true
        };
        this.collaborativeSearcheService.setFilter(this.identifier, data);
    }

    private plotChart(aggregations: Array<Aggregation>, contributorId?: string) {
        const data: Observable<AggregationResponse> = this.collaborativeSearcheService.resolveButNot(
            [projType.aggregate, aggregations],
            contributorId
        );
        const dataTab = new Array<{ key: number, value: number }>();
        data.subscribe(
            value => {
                if (value.totalnb > 0) {
                    value.elements.forEach(element => {
                        dataTab.push({ key: element.key, value: element.count });
                    });
                }
                this.chartData.next(dataTab);
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            },
            () => {
                const f = this.collaborativeSearcheService.getFilter(this.identifier);
                const interval = {
                    startvalue: null,
                    endvalue: null
                };
                if (f === null) {
                    if (dataTab.length > 0) {
                        interval.startvalue = <number>dataTab[0].key;
                        interval.endvalue = <number>dataTab[dataTab.length - 1].key;
                    }
                } else {
                    interval.startvalue = <number>parseFloat(f.f[0].value);
                    interval.endvalue = <number>parseFloat(f.f[1].value);
                }
                if (interval.endvalue !== null && interval.startvalue !== null) {
                    this.intervalSelection.next(interval);
                }
            }
        );
    }
    private initValueChangeEvent(dateType) {

        this.valueChangedEvent.subscribe(
            value => {
                let end = value.endvalue;
                let start = value.startvalue;
                if ((typeof (<Date>end).getMonth === 'function') && (typeof  (<Date>start).getMonth === 'function')) {
                    const endDate = new Date(value.endvalue.toString());
                    const startDate = new Date(value.startvalue.toString());
                    this.startValue = startDate.toLocaleString();
                    this.endValue = endDate.toLocaleString();
                    let multiplier = 1;
                    if (dateType === DateType.second) {
                        multiplier = 1000;
                    }
                    end = endDate.valueOf() / 1 * multiplier;
                    start = startDate.valueOf() / 1 * multiplier;

                } else {
                    this.startValue = Math.round(<number>start).toString();
                    this.endValue = Math.round(<number>end).toString();
                };
                const startExpression: Expression = {
                    field: this.field,
                    op: Expression.OpEnum.Gt,
                    value: start.toString()
                };
                const endExpression: Expression = {
                    field: this.field,
                    op: Expression.OpEnum.Lt,
                    value: end.toString()
                };
                const filterValue: Filter = {
                    f: [startExpression, endExpression]

                };
                this.updateAndSetCollaborationEvent(this.identifier, filterValue);
            },
            error => { this.collaborativeSearcheService.collaborationErrorBus.next(error); });
    }

    private initChartDataValue() {
        const aggregations = new Array<Aggregation>();
        aggregations.push(this.aggregation);
        this.plotChart(aggregations, this.identifier);
    }
}
