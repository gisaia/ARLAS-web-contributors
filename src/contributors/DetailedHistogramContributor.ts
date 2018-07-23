import { HistogramContributor } from './HistogramContributor';
import { CollaborationEvent, OperationEnum, Collaboration } from 'arlas-web-core';
import { AggregationResponse, Filter } from 'arlas-api';
import * as jsonSchema from '../jsonSchemas/detailedHistogramContributorConf.schema.json';

import { Observable } from 'rxjs/Observable';
import { DateExpression } from '../models/models';

/**
* This contributor works with the Angular HistogramComponent of the Arlas-web-components project.
* This contributor is annexed to a main histogram contributor
* The data returned by this contributor is fetched by applying the last filter of the main contributor in this contributor.
* The objective is fetching the data around the current selection of the main contributor and plot it in a detailed HistogramComponent.
* This contibutor doesn't contribute in the collaborativeSearchService. The main contributor does.
*/
export class DetailedHistogramContributor extends HistogramContributor {
    /**
     * Id of the histogram contributor which fetches data of the main histogram.
     */
    public annexedContributorId = this.getConfigValue('annexedContributorId');
    /**
     * Percentage of current selection extent. This percentage will be used to calculate an offset to add to this extent.
     * offset + selectionextent = data extent
     */
    public selectionExtentPercentage = this.getConfigValue('selectionExtentPercentage');

    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.detailedhistogram';
    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    public fetchData(collaborationEvent?: CollaborationEvent): Observable<AggregationResponse> {
        this.maxValue = 0;
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            let additionalFilter;
            const annexedContributorColloaboration = this.collaborativeSearcheService.collaborations.get(this.annexedContributorId);
            if (this.annexedContributorId && annexedContributorColloaboration) {
                additionalFilter = this.cloneAnnexedContributorFilter(annexedContributorColloaboration);
                if (additionalFilter && additionalFilter.f && additionalFilter.f.length === 1) {
                    // IN HISTOGRAM CONTRIBUTOR, THERE IS ONLY ONE F FILTER
                    // FOR THIS F, THERE IS ONE EXPRESSION
                    const expression  = additionalFilter.f[0][0];
                    // THE EXPRESSION VALUE CONTAINS COMMA SEPARATED RANGES '[MIN1<MAX1],[MIN2<MAX2]'
                    const valuesList = expression.value.split(',');
                    const lastValue: string = valuesList[valuesList.length - 1];
                    const lastValueWithoutBrackets = lastValue.substring(1).slice(0, -1);
                    const intervals = lastValueWithoutBrackets.split('<');
                    let min;
                    let max;
                    if (Number(intervals[0]) && Number(intervals[1])) {
                        min = Number(intervals[0]);
                        max = Number(intervals[1]);
                    } else {
                        min = DateExpression.toDateExpression(intervals[0]).toMillisecond(false);
                        max = DateExpression.toDateExpression(intervals[1]).toMillisecond(true);
                    }
                    const offset = this.selectionExtentPercentage ? (max - min) * this.selectionExtentPercentage : 0;
                    const minOffset = Math.trunc(min - offset);
                    const maxOffset = Math.trunc(max + offset);
                    expression.value = '[' + minOffset + '<' + maxOffset + ']';
                    // ONLY THE LAST EXPRESSION (CURRENT SELECTION) IS KEPT
                    additionalFilter.f = [additionalFilter.f[0]];
                }
            }
            return this.fetchDataGivenFilter(this.annexedContributorId, additionalFilter);
        } else {
            return Observable.from([]);
        }
    }

    private cloneAnnexedContributorFilter(annexedContributorColloaboration: Collaboration): Filter {
        let filter: Filter;
        if (annexedContributorColloaboration.filter && annexedContributorColloaboration.filter.f) {
            filter = { f: [] };
            const temporaryF = annexedContributorColloaboration.filter.f;
            temporaryF.forEach(f => {
                const expressionsList = [];
                f.forEach(expression => {
                    expressionsList.push({field: expression.field, op: expression.op, value: expression.value});
                });
                filter.f.push(expressionsList);
            });
        }
        return filter;
    }

}
