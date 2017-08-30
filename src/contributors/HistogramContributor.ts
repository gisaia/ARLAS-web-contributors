import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { Filter, Aggregation } from 'arlas-api';
import { Expression, AggregationResponse } from 'arlas-api';
import { Contributor, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { projType } from 'arlas-web-core/models/projections';
/**
* Enum of time unit that the timeline mode could draw.
*/
export enum DateUnit {
    second, millisecond
}
/**
* Object of start and end value of the chart selector.
*/
export interface SelectedOutputValues {
    startvalue: Date | number;
    endvalue: Date | number;
}
/**
* This contributor works with the Angular HistogramComponent of the Arlas-web-components project.
* This class make the brigde between the component which displays the data and the
* collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
*/
export class HistogramContributor extends Contributor {
    /**
    * Observable which emits when the range selection changes on the histogram (could be set to
    @Output() valuesChangedEvent of HistogramComponent
    */
    private valueChangedEvent: Subject<SelectedOutputValues>;
    /**
    * Observable which emits when new data need to be draw on the histogram (could be set to
    @Input() data of HistogramComponent
    */
    private chartData: Subject<Array<{ key: number, value: number }>>;
    /**
    * Observable which emits when new selection need to be draw on the histogram (could be set to
    @Input() intervalSelection of HistogramComponent
    */
    private intervalSelection: Subject<SelectedOutputValues>;
    /**
    * ARLAS Server Aggregation used to draw the chart, define in configuration
    */
    private aggregation: Aggregation = this.getConfigValue('aggregationmodel');
    /**
    * ARLAS Server field of aggregation used to draw the chart, retrieve from Aggregation
    */
    private field: string = this.aggregation.field;
    /**
    * Start value of selection use to the display of filterDisplayName
    */
    private startValue: string;
    /**
    * End value of selection use to the display of filterDisplayName
    */
    private endValue: string;
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService);
        // Register the contributor in collaborativeSearcheService registry
        this.collaborativeSearcheService.register(this.identifier, this);
        // Subscribe to the collaborationBus to draw the chart on each changement
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                if (contributorId !== this.identifier) {
                    if (this.chartData !== null && this.chartData !== undefined) {
                        this.plotChart();
                    }
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }
    /**
    * Get valueChangedEvent.
    * @return observable of SelectedOutputValues
    */
    public getValueChangedEvent() {
        return this.valueChangedEvent;
    }
    /**
    * Set valueChangedEvent and subscribe to, to set filter in collaborativeSearcheService.
    * @param valueChangedEvent observable of SelectedOutputValues (@Output() valuesChangedEvent of HistogramComponent)
    * @param dateType DateType enum value
    */
    public setValueChangedEvent(valueChangedEvent: Subject<SelectedOutputValues>, dateType: DateUnit.millisecond | DateUnit.second) {
        if (valueChangedEvent !== null) {
            this.valueChangedEvent = valueChangedEvent;
            this.setFilterFromValueChanged(dateType);
        }
    }
    /**
    * Get chartData.
    * @return observable of Array { key: number, value: number }  to draw the chart
    */
    public getCharData() {
        return this.chartData;
    }
    /**
    * Set chartData and next on to draw the chart
    * @param chartData observable of SelectedOutputValues (@Input() data of HistogramComponent)
    */
    public setCharData(chartData: Subject<Array<{ key: number, value: number }>>) {
        if (chartData !== null) {
            this.chartData = chartData;
            this.plotChart();
        }
    }
    /**
    * Get valueChangedEvent.
    * @return observable of intervalSelection
    */
    public getIntervalSelection() {
        return this.intervalSelection;
    }
    /**
    * Set chartData and next on to draw the chart
    * @param intervalSelection observable of SelectedOutputValues (@Input() intervalSelection of HistogramComponent)
    */
    public setIntervalSelection(intervalSelection: Subject<SelectedOutputValues>) {
        if (intervalSelection !== null) {
            this.intervalSelection = intervalSelection;
        }
    }
    /**
    * @returns Pretty name of contribution based on startValue/endValue properties
    */
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
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'catalog.web.app.components.histogram';
    }
    /**
    * Plot chart data and next intervalSelection to replot selection  .
    */
    private plotChart() {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        const data: Observable<AggregationResponse> = this.collaborativeSearcheService.resolveButNot(
            [projType.aggregate, [this.aggregation]],
            this.identifier
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
                this.collaborativeSearcheService.ongoingSubscribe.next(-1);

            }
        );
    }
    /**
    * Subscribe to valueChangedEvent to set filter on collaborativeSearcheService
    * @param dateType DateType.millisecond | DateType.second
    */
    private setFilterFromValueChanged(dateType: DateUnit.millisecond | DateUnit.second) {
        this.valueChangedEvent.subscribe(
            value => {
                let end = value.endvalue;
                let start = value.startvalue;
                if ((typeof (<Date>end).getMonth === 'function') && (typeof (<Date>start).getMonth === 'function')) {
                    const endDate = new Date(value.endvalue.toString());
                    const startDate = new Date(value.startvalue.toString());
                    this.startValue = startDate.toLocaleString();
                    this.endValue = endDate.toLocaleString();
                    let multiplier = 1;
                    if (dateType === DateUnit.second) {
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
                const data: Collaboration = {
                    filter: filterValue,
                    enabled: true
                };
                this.collaborativeSearcheService.setFilter(this.identifier, data);
            },
            error => { this.collaborativeSearcheService.collaborationErrorBus.next(error); });
    }
}
