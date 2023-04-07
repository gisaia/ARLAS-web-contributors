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

import { Aggregation, AggregationResponse, Filter } from 'arlas-api';
import { Collaboration, CollaborationEvent, OperationEnum } from 'arlas-web-core';
import jsonSchema from '../jsonSchemas/detailedHistogramContributorConf.schema.json';
import { getPredefinedTimeShortcuts } from '../utils/timeShortcutsUtils';
import { getAggregationPrecision, adjustHistogramInterval } from '../utils/histoswimUtils';
import { HistogramContributor } from './HistogramContributor';

import { CollectionAggField } from 'arlas-web-core/utils/utils';
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

    public fetchData(collaborationEvent?: CollaborationEvent): Observable<AggregationResponse[]> {
        this.maxValue = 0;
        let additionalFilters;

        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            const annexedContributorCollaboration = this.collaborativeSearcheService.collaborations.get(this.annexedContributorId);
            if (this.annexedContributorId && annexedContributorCollaboration) {
                additionalFilters = this.cloneAnnexedContributorFilter(annexedContributorCollaboration);
                if (!!additionalFilters) {
                    additionalFilters.forEach((additionalFilter, collection) => {
                        if (additionalFilter && additionalFilter.f && additionalFilter.f.length === 1) {
                            // IN HISTOGRAM CONTRIBUTOR, THERE IS ONLY ONE F FILTER
                            // FOR THIS F, THERE IS ONE EXPRESSION
                            const expression = additionalFilter.f[0][0];
                            // THE EXPRESSION VALUE CONTAINS COMMA SEPARATED RANGES '[MIN1<MAX1],[MIN2<MAX2]'
                            const valuesList = expression.value.split(',');
                            const lastValue: string = valuesList[valuesList.length - 1];
                            const lastValueWithoutBrackets = lastValue.substring(1).slice(0, -1);
                            const intervals = lastValueWithoutBrackets.split('<');
                            if (!!intervals && intervals.length === 2) {
                                let min;
                                let max;
                                if (Number(intervals[0]).toString() !== 'NaN' && Number(intervals[1]).toString() !== 'NaN') {
                                    min = Number(intervals[0]);
                                    max = Number(intervals[1]);
                                } else {
                                    min = DateExpression.toDateExpression(intervals[0]).toMillisecond(false, this.useUtc);
                                    max = DateExpression.toDateExpression(intervals[1]).toMillisecond(true, this.useUtc);
                                }

                                // Compute the bucket interval to truncate the filter with the desired offset
                                let histogramBucketInterval;
                                /** if nbBuckets is defined, we calculate the needed bucket interval to obtain this number. */
                                if (this.nbBuckets) {
                                    histogramBucketInterval = getAggregationPrecision(
                                        this.nbBuckets, max - min, this.aggregations[0].type).value;
                                } else {
                                    /** Otherwise we use the interval; that we adjust in case it generates more than `maxBuckets` buckets */
                                    const initialInterval = this.aggregations[0].interval;
                                    histogramBucketInterval = adjustHistogramInterval(
                                        this.aggregations[0].type, this.maxBuckets, initialInterval, max - min).value;
                                }

                                const offset = this.selectionExtentPercentage ? (max - min) * this.selectionExtentPercentage : 0;
                                const minOffset = Math.floor((min - offset) / histogramBucketInterval) * histogramBucketInterval;
                                const maxOffset = Math.ceil((max + offset) / histogramBucketInterval) * histogramBucketInterval;
                                expression.value = '[' + minOffset + '<' + maxOffset + ']';
                                // ONLY THE LAST EXPRESSION (CURRENT SELECTION) IS KEPT
                                additionalFilter.f = [additionalFilter.f[0]];
                                this.currentSelectedInterval = { startvalue: min, endvalue: max };
                            }
                        }
                    });
                }
            }
            return this.fetchDataGivenFilter(this.annexedContributorId, additionalFilters);
        } else {
            return from([]);
        }
    }

    public init(aggregations: Array<Aggregation>, field: string, jsonPath: string, additionalCollections: CollectionAggField[]) {
        const aggs = [];
        aggregations.forEach(agg => {
            const aggregationCopy: Aggregation = {
                field: agg.field,
                metrics: agg.metrics,
                type: agg.type
            };
            if (agg.interval) {
                aggregationCopy.interval = {
                   value: agg.interval.value
                };
                if (agg.interval.unit) {
                    aggregationCopy.interval.unit = agg.interval.unit;
                }
            }
            aggs.push(aggregationCopy);
        });
        this.aggregations = aggs;
        this.field = field;
        this.json_path = jsonPath;
        if (!!additionalCollections) {
            if (!!this.collections) {
                this.collections = this.collections.concat(additionalCollections);
            }
        }
        this.collections.forEach(c => {
            if (c.collectionName === this.collection && !c.field) {
                c.field = field;
            }
        });
    }

    private cloneAnnexedContributorFilter(annexedContributorColloaboration: Collaboration): Map<string, Filter> {
        const filters = new Map<string, Filter>();
        if (!!annexedContributorColloaboration.filters) {
            this.collections.forEach(c => {
                let collabFilter: Filter;
                const collabFilters = annexedContributorColloaboration.filters.get(c.collectionName);
                if (!!collabFilters && collabFilters.length > 0) {
                    collabFilter = annexedContributorColloaboration.filters.get(c.collectionName)[0];
                    if (collabFilter && collabFilter.f) {
                        const filter = { f: [] };
                        const temporaryF = collabFilter.f;
                        temporaryF.forEach(f => {
                            const expressionsList = [];
                            f.forEach(expression => {
                                expressionsList.push({ field: expression.field, op: expression.op, value: expression.value });
                            });
                            filter.f.push(expressionsList);
                        });
                        filters.set(c.collectionName, filter);
                    }
                }
            });
        }
        return filters;
    }

}
