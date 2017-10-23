import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';
import {
    Collaboration,
    CollaborativesearchService,
    ConfigService,
    Contributor,
    OperationEnum,
    projType, CollaborationEvent
} from 'arlas-web-core';
import {
    Hits, Filter, Aggregation,
    Expression, AggregationResponse
} from 'arlas-api';
import { SelectedOutputValues, DateUnit, DataType } from '../models/models';

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
        private dateUnit: DateUnit.millisecond | DateUnit.second,
        private dataTpye: DataType.numeric | DataType.time,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService, private isOneDimension?: boolean
    ) {
        super(identifier, configService, collaborativeSearcheService);
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
            end = endDate.valueOf() / multiplier;
            start = startDate.valueOf() / multiplier;
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

    public fetchData(collaborationEvent?: CollaborationEvent): Observable<AggregationResponse> {
        this.maxCount = 0;
        const aggObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, [this.aggregation]],
            this.identifier
        );
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return aggObservable;
        } else {
            return Observable.from([]);
        }
    }
    public computeData(aggResonse: AggregationResponse): Array<{ key: number, value: number }> {
        const dataTab = new Array<{ key: number, value: number }>();
        if (aggResonse.totalnb > 0) {
            aggResonse.elements.forEach(element => {
                if (this.maxCount <= element.count) {
                    this.maxCount = element.count;
                }
                dataTab.push({ key: element.key, value: element.count });
            });
        }
        return dataTab;
    }

    public setData(data: Array<{ key: number, value: number }>): Array<{ key: number, value: number }> {
        if (!this.isOneDimension || this.isOneDimension === undefined) {
            this.chartData = data;
        } else {
            data.forEach(obj => {
                obj.value = obj.value / this.maxCount;
            });
            this.chartData = data;
        }
        return this.chartData;
    }
    public setSelection(data: Array<{ key: number, value: number }>, collaboration: Collaboration): any {
        const interval = {
            startvalue: null,
            endvalue: null
        };
        if (collaboration) {
            const f = collaboration.filter;
            if (f === null) {
                if (data.length > 0) {
                    interval.startvalue = <number>data[0].key;
                    interval.endvalue = <number>data[data.length - 1].key;
                }
            } else {
                if (this.dataTpye === DataType.time) {
                    if (this.dateUnit === DateUnit.second) {
                        interval.startvalue = <number>parseFloat(f.f[0].value) * 1000;
                        interval.endvalue = <number>parseFloat(f.f[1].value) * 1000;
                    } else {
                        interval.startvalue = <number>parseFloat(f.f[0].value);
                        interval.endvalue = <number>parseFloat(f.f[1].value);
                    }
                } else {
                    interval.startvalue = <number>parseFloat(f.f[0].value);
                    interval.endvalue = <number>parseFloat(f.f[1].value);
                }
            }
        } else {
            if (data.length > 0) {
                interval.startvalue = <number>data[0].key;
                interval.endvalue = <number>data[data.length - 1].key;
            }
        }
        if (interval.endvalue !== null && interval.startvalue !== null) {
            this.intervalSelection = interval;
            this.startValue = Math.round(<number>interval.startvalue).toString();
            this.endValue = Math.round(<number>interval.endvalue).toString();
        }
        return Observable.from([]);
    }
}
