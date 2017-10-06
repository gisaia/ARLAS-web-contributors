import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { Hits } from 'arlas-api/model/Hits';
import { Filter } from 'arlas-api/model/Filter';
import { Aggregation } from 'arlas-api/model/Aggregation';
import { Expression } from 'arlas-api/model/Expression';
import { AggregationResponse } from 'arlas-api/model/AggregationResponse';
import { Contributor, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { projType } from 'arlas-web-core/models/projections';
import { SelectedOutputValues, DateUnit } from '../models/models';

/**
* This contributor works with the Angular HistogramComponent of the Arlas-web-components project.
* This class make the brigde between the component which displays the data and the
* collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
*/
export class HistogramContributor extends Contributor {
    /**
    * New data need to be draw on the histogram (could be set to
    @Input() data of HistogramComponent
    */
    public chartData: Array<{ key: number, value: number }> = new Array<{ key: number, value: number }>();
    /**
    * New selection need to be draw on the histogram (could be set to
    @Input() intervalSelection of HistogramComponent
    */
    public intervalSelection: SelectedOutputValues;
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
    * Max value of all bucketn use for oneDimension histogram palette
    */
    private maxCount = 0;
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param dateUnit  unit of histrogram (for time data).
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        private dateUnit: DateUnit.millisecond | DateUnit.millisecond,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService, private isOneDimension?: boolean
    ) {
        super(identifier, configService);
        // Register the contributor in collaborativeSearcheService registry
        this.collaborativeSearcheService.register(this.identifier, this);
        this.plotChart();
        // Subscribe to the collaborationBus to draw the chart on each changement
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                if (contributorId !== this.identifier) {
                    this.maxCount = 0;
                    this.plotChart();
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }
    /**
    * @returns Pretty name of contribution based on startValue/endValue properties
    */
    public getFilterDisplayName(): string {
        let displayName = '';
        const name = this.getConfigValue('name');
        if (this.aggregation.type.toString().toLocaleLowerCase() === Aggregation.TypeEnum.Datehistogram.toString().toLocaleLowerCase()) {
            displayName = 'Timeline';
        } else if (this.aggregation.type.toString().toLocaleLowerCase() === Aggregation.TypeEnum.Histogram.toString().toLocaleLowerCase()) {
            displayName = this.startValue + ' <= ' + name + ' <= ' + this.endValue;
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
    * Set filter on value change, use in output of component
    * @param value DateType.millisecond | DateType.second
    */
    public valueChanged(value: SelectedOutputValues) {
        let end = value.endvalue;
        let start = value.startvalue;
        if ((typeof (<Date>end).getMonth === 'function') && (typeof (<Date>start).getMonth === 'function')) {
            const endDate = new Date(value.endvalue.toString());
            const startDate = new Date(value.startvalue.toString());
            this.startValue = startDate.toLocaleString();
            this.endValue = endDate.toLocaleString();
            let multiplier = 1;
            if (this.dateUnit.toString() === DateUnit.second.toString()) {
                multiplier = 1000;
            }
            end = endDate.valueOf() / 1 * multiplier;
            start = startDate.valueOf() / 1 * multiplier;
        } else {
            this.startValue = Math.round(<number>start).toString();
            this.endValue = Math.round(<number>end).toString();
        }
        const startExpression: Expression = {
            field: this.field,
            op: Expression.OpEnum.Gte,
            value: start.toString()
        };
        const endExpression: Expression = {
            field: this.field,
            op: Expression.OpEnum.Lte,
            value: end.toString()
        };
        const filterValue: Filter = {
            f: [startExpression, endExpression]
        };
        const data: Collaboration = {
            filter: filterValue,
            enabled: true
        };
        this.intervalSelection = value;
        this.collaborativeSearcheService.setFilter(this.identifier, data);
    }
    /**
    * Plot chart data and next intervalSelection to replot selection .
    */
    private plotChart() {
        const data = this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, [this.aggregation]],
            this.identifier
        );
        const dataTab = new Array<{ key: number, value: number }>();

        data.subscribe(
            value => {
                if (value.totalnb > 0) {
                    value.elements.forEach(element => {
                        if (this.maxCount <= element.count) {
                            this.maxCount = element.count;
                        }
                        dataTab.push({ key: element.key, value: element.count });
                    });
                }
                if (!this.isOneDimension || this.isOneDimension === undefined) {
                    this.chartData = dataTab;
                }
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
                    this.intervalSelection = interval;
                }
                if (this.isOneDimension) {
                    dataTab.forEach(obj => {
                        obj.value = obj.value / this.maxCount;
                    });
                    this.chartData = dataTab;
                }
            }
        );
    }
}
