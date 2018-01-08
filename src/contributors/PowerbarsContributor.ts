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

/**
* This contributor works with the Angular PowerbarsComponent of the Arlas-web-components project.
* This class make the brigde between the component which displays the data and the
* collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
*/
export class PowerbarsContributor extends Contributor {

    /**
     * data retrieved from Server response and to be returned for the component as input
     * @Input() inputData
     */
    public powerbarsData: Array<[string, number]>;

    /**
     * selectedBar is term selected in the component. Used for the display of filterDisplayName
     */
    public selectedBars: Set<string>;

    /**
     * Title given to the aggregation result
     */
    public powerbarsTitle: string;

    /**
    * ARLAS Server Aggregation used to draw the chart, define in configuration
    */
    private aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    /**
    * ARLAS Server field of aggregation used to draw the chart, retrieve from Aggregation
    */
    private field: string = (this.aggregations !== undefined) ? (this.aggregations[this.aggregations.length - 1].field) : (undefined);

    /**
    * Build a new contributor.
    * @param identifier  Identifier of the contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        title: string

    ) {
        super(identifier, configService, collaborativeSearcheService);
        this.powerbarsTitle = title;
    }

    /**
    * @returns Pretty name of contribution based on selected bar
    */
    public getFilterDisplayName(): string {
        return this.powerbarsTitle;
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.powerbars';
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<AggregationResponse> {
        const aggregationObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, this.aggregations],
            this.identifier
        );
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return aggregationObservable;
        } else {
            return Observable.from([]);
        }
    }

    public computeData(aggregationResonse: AggregationResponse): Array<[string, number]> {
        const powerbarsTab = new Array<[string, number]>();
        if (aggregationResonse.elements !== undefined) {
            aggregationResonse.elements.forEach(element => {
                powerbarsTab.push([element.key, element.count]);
            });
            this.sortPowerBarsTab(powerbarsTab);
        }
        return powerbarsTab;
    }

    public setData(data: Array<[string, number]>): Array<[string, number]> {
        this.powerbarsData = data;
        return this.powerbarsData;
    }

    public setSelection(data: Array<[string, number]>, collaboration: Collaboration): any {
        if (collaboration) {
            const f = collaboration.filter;
            if (f === null) {
                this.selectedBars = new Set();
            } else {
                const selectedBarsAsArray = f.f[0];
                this.selectedBars = new Set();
                selectedBarsAsArray.forEach(term => this.selectedBars.add(term.value));
            }
        } else {
            this.selectedBars = new Set();
        }
        return Observable.from([]);
    }

    public selectedBarsChanged(selectedBars: Set<string>) {
        const filterValue: Filter = { f: [] };
        const equalExpression: Expression = {
            field: this.field,
            op: Expression.OpEnum.Eq,
            value: ''
        };
        if (selectedBars.size > 0) {
            selectedBars.forEach(selectedBar => {
                equalExpression.value += selectedBar + ',';
            });
            equalExpression.value = equalExpression.value.substring(0, equalExpression.value.length - 1);
            filterValue.f.push([equalExpression]);
            const collaboration: Collaboration = {
                filter: filterValue,
                enabled: true
            };
            this.collaborativeSearcheService.setFilter(this.identifier, collaboration);
        } else {
            this.collaborativeSearcheService.removeFilter(this.identifier);
        }
        this.selectedBars = selectedBars;
    }

    /**
     * Sorts the powerbarsTab from the biggest term count to the lower
     */
    private sortPowerBarsTab(powerbarsTab: Array<[string, number]>): void {
        powerbarsTab.sort((a: [string, number], b: [string, number]) => b[1] - a[1]);
    }

}

