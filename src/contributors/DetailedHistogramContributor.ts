/*
 * Licensed to Gisaïa under one or more contributor
 * license agreements. See the NOTICE.txt file distributed with
 * this work for additional information regarding copyright
 * ownership. Gisaïa licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { HistogramContributor } from './HistogramContributor';
import { CollaborationEvent, OperationEnum, Collaboration } from 'arlas-web-core';
import { AggregationResponse, Filter } from 'arlas-api';
import jsonSchema from '../jsonSchemas/detailedHistogramContributorConf.schema.json';

import { Observable, from } from 'rxjs';
import { DateExpression, SelectedOutputValues } from '../models/models';

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
     * The current selection on the main histogram
     */
    public currentSelectedInterval: SelectedOutputValues;

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
                    const expression = additionalFilter.f[0][0];
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
                        min = DateExpression.toDateExpression(intervals[0]).toMillisecond(false, this.useUtc);
                        max = DateExpression.toDateExpression(intervals[1]).toMillisecond(true, this.useUtc);
                    }
                    const offset = this.selectionExtentPercentage ? (max - min) * this.selectionExtentPercentage : 0;
                    const minOffset = Math.trunc(min - offset);
                    const maxOffset = Math.trunc(max + offset);
                    expression.value = '[' + minOffset + '<' + maxOffset + ']';
                    // ONLY THE LAST EXPRESSION (CURRENT SELECTION) IS KEPT
                    additionalFilter.f = [additionalFilter.f[0]];
                    this.currentSelectedInterval = { startvalue: min, endvalue: max };
                }
            }
            return this.fetchDataGivenFilter(this.annexedContributorId, additionalFilter);
        } else {
            return from([]);
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
                    expressionsList.push({ field: expression.field, op: expression.op, value: expression.value });
                });
                filter.f.push(expressionsList);
            });
        }
        return filter;
    }

}
