import { CollaborativesearchService, Collaboration, projType } from 'arlas-web-core';
import { AggregationResponse, Filter, Expression, Aggregation } from 'arlas-api';
import jp from 'jsonpath/jsonpath.min';

export class PowerbarsContributorService {

    constructor(
        private identifier: string,
        private collaborativeSearcheService: CollaborativesearchService,
    ) {

    }

    public computeData(aggregationResonse: AggregationResponse, json_path: string): Array<[string, number]> {
        const powerbarsTab = new Array<[string, number]>();
        if (aggregationResonse.elements !== undefined) {
            aggregationResonse.elements.forEach(element => {
                const value = jp.query(element, json_path)[0];
                powerbarsTab.push([element.key, value]);
            });
            this.sortPowerBarsTab(powerbarsTab);
        }
        return powerbarsTab;
    }

    public getSelectedBars(collaboration: Collaboration): Set<string> {
        const selectedBars = new Set();
        if (collaboration) {
            const f = collaboration.filter;
            if (f) {
                const selectedBarsAsArray = f.f[0];
                selectedBarsAsArray.forEach(termsList => {
                    termsList.value.split(',').forEach(term => {
                        selectedBars.add(term);
                    });
                });
            }
        }
        return selectedBars;
    }

    public updateCollaborationOnSelectedBarsChange(selectedBars: Set<string>, field: string): void {
        const filterValue: Filter = { f: [] };
        const equalExpression: Expression = {
            field: field,
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
    }

    public updatePowerbarsData(search: any, aggregations: Array<Aggregation>, json_path: string, powerbarsData: Array<[string, number]>) {
        const filterAgg: Filter = {};
        if (search.length > 0) {
            aggregations[aggregations.length - 1].include = encodeURI(search).concat('.*');
            filterAgg.q = [[aggregations[0].field.concat(':').concat(search).concat('*')]];
        } else {
            delete aggregations[aggregations.length - 1].include;
        }
        const aggregationObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, aggregations], this.collaborativeSearcheService.collaborations,
            this.identifier, filterAgg
        );
        aggregationObservable.subscribe(aggregationResponse => {
            const powerbarsTab = new Array<[string, number]>();
            if (aggregationResponse.elements !== undefined) {
                aggregationResponse.elements.forEach(element => {
                    const value = jp.query(element, json_path)[0];
                    powerbarsTab.push([element.key, value]);
                });
                this.sortPowerBarsTab(powerbarsTab);
            }
            powerbarsData = powerbarsTab;
        });
    }

    /**
     * Sorts the powerbarsTab from the biggest term value to the lower
     */
    private sortPowerBarsTab(powerbarsTab: Array<[string, number]>): void {
        powerbarsTab.sort((a: [string, number], b: [string, number]) => b[1] - a[1]);
    }
}
