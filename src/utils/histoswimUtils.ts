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

import { Collaboration, CollaborativesearchService } from 'arlas-web-core';
import { SelectedOutputValues, DateExpression } from '../models/models';
import { Expression, Filter, Aggregation, Interval } from 'arlas-api';
import { CollectionAggField } from 'arlas-web-core/utils/utils';
import { filter } from 'rxjs/operators';

export function getvaluesChanged(values: SelectedOutputValues[],
    collections: CollectionAggField[],
    identifier: string,
    collaborativeSearcheService: CollaborativesearchService, useUtc: boolean
): any[] {
    const collabFilters = new Map<string, Filter[]>();
    let startValue;
    let endValue;
    let rangeExpressionValue = '';
    values.forEach(value => {
        let end = value.endvalue;
        let start = value.startvalue;
        if ((typeof (<Date>end).getMonth === 'function') && (typeof (<Date>start).getMonth === 'function')) {
            const endDate = new Date(value.endvalue.toString());
            const startDate = new Date(value.startvalue.toString());
            startValue = startDate.toUTCString().split(',')[1].replace('GMT', '');
            endValue = endDate.toUTCString().split(',')[1].replace('GMT', '');
            end = endDate.valueOf();
            start = startDate.valueOf();
        } else if (Number(start).toString() !== 'NaN' && Number(end).toString() !== 'NaN') {
            startValue = Math.round(<number>start).toString();
            endValue = Math.round(<number>end).toString();
        } else {
            startValue = start;
            endValue = end;
        }
        rangeExpressionValue = rangeExpressionValue + '[' + start.toString() + '<' + end.toString() + '],';
    });
    rangeExpressionValue = rangeExpressionValue.substring(0, rangeExpressionValue.length - 1);
    collections.forEach(c => {
        const filterValue: Filter = {
            f: new Array<Array<Expression>>()
        };
        const rangeExpression: Expression = {
            field: c.field,
            op: Expression.OpEnum.Range,
            value: rangeExpressionValue
        };
        filterValue.f.push([rangeExpression]);
        collabFilters.set(c.collectionName, [filterValue]);
    });
    const collaboration: Collaboration = {
        filters: collabFilters,
        enabled: true
    };
    const intervalSelection = values[values.length - 1];
    if (Number(intervalSelection.startvalue).toString() === 'NaN') {
        intervalSelection.startvalue = DateExpression.toDateExpression(<string>intervalSelection.startvalue).toMillisecond(false, useUtc);
        intervalSelection.endvalue = DateExpression.toDateExpression(<string>intervalSelection.endvalue).toMillisecond(true, useUtc);
    }
    collaborativeSearcheService.setFilter(identifier, collaboration);
    return [intervalSelection, startValue, endValue];
}

export function getSelectionToSet(data: Array<{ key: number, value: number }> | Map<string, Array<{ key: number, value: number }>>,
    collection: string, collaboration: Collaboration, useUtc: boolean
): any[] {
    let intervalListSelection;
    let intervalSelection;
    let startValue;
    let endValue;
    let isArray: boolean;
    data = !!data ? data : [];
    if (data instanceof Array) {
        isArray = true;
    } else {
        isArray = false;
    }
    let currentIntervalSelected = {
        startvalue: null,
        endvalue: null
    };
    if (collaboration) {
        let f: Filter;
        if (collaboration.filters && collaboration.filters.get(collection)) {
            f = collaboration.filters.get(collection)[0];
        }
        if (!f) {
            if (isArray) {
                if ((<Array<{ key: number, value: number }>>data).length > 0) {
                    currentIntervalSelected.startvalue = <number>data[0].key;
                    currentIntervalSelected.endvalue = <number>data[(<Array<{ key: number, value: number }>>data).length - 1].key;
                    if ((<Array<{ key: number, value: number }>>data).length > 1) {
                        const dataInterval = getDataInterval(<Array<{ key: number, value: number }>>data);
                        currentIntervalSelected.endvalue += dataInterval;
                    }
                }
            } else {
                const minMax = getMinMax(<Map<string, Array<{ key: number, value: number }>>>data);
                currentIntervalSelected.startvalue = minMax[0];
                currentIntervalSelected.endvalue = minMax[1];
            }
            intervalListSelection = [];
        } else {
            const intervals = [];
            const invtervalFilterList = f.f[0];
            let d = 0;
            invtervalFilterList.forEach(k => {
                let c = 0;
                d++;
                k.value.split(',').forEach(i => {
                    c++;
                    const start = i.split('<')[0].substring(1);
                    const end = i.split('<')[1].substring(0, i.split('<')[1].length - 1);
                    const intervalOfSelection = {
                        startvalue: null,
                        endvalue: null
                    };
                    if (Number(start).toString() !== 'NaN' && Number(end).toString() !== 'NaN') {
                        intervalOfSelection.startvalue = <number>parseFloat(start);
                        intervalOfSelection.endvalue = <number>parseFloat(end);
                    } else {
                        intervalOfSelection.startvalue = DateExpression.toDateExpression(start).toMillisecond(false, useUtc);
                        intervalOfSelection.endvalue = DateExpression.toDateExpression(end).toMillisecond(true, useUtc);
                        startValue = start;
                        endValue = end;
                    }
                    if (k.value.split(',').length > c) {
                        intervals.push(intervalOfSelection);
                    } else {
                        if (d < invtervalFilterList.length) {
                            intervals.push(intervalOfSelection);
                        } else {
                            currentIntervalSelected = intervalOfSelection;
                        }
                    }
                });
            });
            if (intervals.length > 0) {
                intervalListSelection = intervals;
            } else {
                intervalListSelection = [];
            }
        }
    } else {
        if (isArray) {
            if ((<Array<{ key: number, value: number }>>data).length > 0) {
                currentIntervalSelected.startvalue = <number>data[0].key;
                currentIntervalSelected.endvalue = <number>data[(<Array<{ key: number, value: number }>>data).length - 1].key;
                if ((<Array<{ key: number, value: number }>>data).length > 1) {
                    const dataInterval = getDataInterval(<Array<{ key: number, value: number }>>data);
                    currentIntervalSelected.endvalue += dataInterval;
                }
            }
        } else {
            const minMax = getMinMax(<Map<string, Array<{ key: number, value: number }>>>data);
            currentIntervalSelected.startvalue = minMax[0];
            currentIntervalSelected.endvalue = minMax[1];

        }
        intervalListSelection = [];
    }
    if (currentIntervalSelected.endvalue !== null && currentIntervalSelected.startvalue !== null) {
        intervalSelection = currentIntervalSelected;
        if (!startValue && ! endValue) {
            startValue = Math.round(<number>currentIntervalSelected.startvalue).toString();
            endValue = Math.round(<number>currentIntervalSelected.endvalue).toString();
        }
    }

    return [intervalListSelection, intervalSelection, startValue, endValue];
}

function getMinMax(data: Map<string, Array<{ key: number, value: number }>>): Array<number> {
    let min;
    let max;
    let dataInterval;
    data = !!data ? data : new Map();
    data.forEach((k, v) => {
        if (min === undefined) {
            min = k.map(kv => kv.key).sort()[0];
        } else {
            if (k.map(kv => kv.key).sort()[0] < min) {
                min = k.map(kv => kv.key).sort()[0];
            }
        }
        if (max === undefined) {
            max = k.map(kv => kv.key).sort()[k.length - 1];
        } else {
            if (k.map(kv => kv.key).sort()[k.length - 1] > max) {
                max = k.map(kv => kv.key).sort()[k.length - 1];
            }
        }
        if (k.length > 1 && dataInterval === undefined) {
            dataInterval = <number>k[1].key - <number>k[0].key;
        }
    });
    if (dataInterval !== undefined) {
        max += dataInterval;
    }
    return [min, max];
}

function getDataInterval(data: Array<{ key: number, value: number }>): number {
    let interval = Number.MAX_VALUE;
    if (data.length > 1) {
      /** We need to get the smallest difference between 2 buckets that is different from 0 */
      for (let i = 0; i < data.length - 1; i++) {
        const diff = +data[i + 1].key - +data[i].key;
        if (diff > 0) {
          interval = Math.min(interval, diff);
        }
      }
      /** this means that all the buckets have the same key (with different chart ids) */
      if (interval === Number.MAX_VALUE) {
        interval = 0;
      }
    } else {
      interval = 0;
    }
    return interval;
  }

  /**
   *
   * @param nbBuckets Preferred number of buckets to be displayed on the histogram
   * @param range The range of x-axis values
   * @param aggregationType Datehistgram or Histogram
   * @returns Given the desired number of buckets and the range of data, the function calculates the best histogram Interval in order
   * to generate the closest number of buckets to `nbBuckets`
   */
export function getAggregationPrecision(nbBuckets: number, range: number, aggregationType: Aggregation.TypeEnum): Interval {
    const bucketInterval = range / nbBuckets;
    const DAY_IN_MILLISECOND = 86400000;
    const HOUR_IN_MILLISECOND = 3600000;
    const MINUTE_IN_MILLISECOND = 60000;
    const SECOND_IN_MILLISECOND = 1000;
    if (range > 0) {
        if (aggregationType === Aggregation.TypeEnum.Datehistogram) {
            let intervalValue = bucketInterval / DAY_IN_MILLISECOND;
            if (intervalValue > 1) {
                if (intervalValue >= 1 && intervalValue <= 3) {
                    /**Nb days between 1 and 3 => aggregation in hours (multiple of 24) */
                    intervalValue = Math.round(bucketInterval / HOUR_IN_MILLISECOND);
                    intervalValue = roundToNearestMultiple(intervalValue, 24);
                    return { value: intervalValue, unit: Interval.UnitEnum.Hour };
                } else if (intervalValue > 3 && intervalValue <= 15) {
                    /**Nb days between 4 and 15 => aggregation in days */
                    intervalValue = Math.round(intervalValue);
                    return { value: intervalValue, unit: Interval.UnitEnum.Day };
                } else {
                    /**Nb days greater than 15 => aggregation in days (multiple of 15) */
                    intervalValue = Math.round(intervalValue);
                    intervalValue = roundToNearestMultiple(intervalValue, 15);
                    return { value: intervalValue, unit: Interval.UnitEnum.Day };
                }
            } else {
                intervalValue = bucketInterval / HOUR_IN_MILLISECOND;
                if (intervalValue > 6 && intervalValue < 24) {
                    /**Nb hours between 6 than 24 => aggregation in hours */
                    intervalValue = Math.round(intervalValue);
                    return { value: intervalValue, unit: Interval.UnitEnum.Hour };
                } else if (intervalValue > 1 && intervalValue <= 6) {
                    /**Nb hours between 1 than 6 => aggregation in minutes (multiple of 60) */
                    intervalValue = bucketInterval / MINUTE_IN_MILLISECOND;
                    intervalValue = Math.round(intervalValue);
                    intervalValue = roundToNearestMultiple(intervalValue, 60);
                    return { value: intervalValue, unit: Interval.UnitEnum.Minute };
                } else {
                    intervalValue = bucketInterval / MINUTE_IN_MILLISECOND;
                    /**Nb minutes between 5 than 60 => aggregation in minutes (multiple of 5) */
                    if (intervalValue > 5) {
                        intervalValue = Math.round(intervalValue);
                        intervalValue = roundToNearestMultiple(intervalValue, 5);
                        return { value: intervalValue, unit: Interval.UnitEnum.Minute };
                    } else if (intervalValue > 1 && intervalValue < 5) {
                        /**Nb minutes less than 5 => aggregation in minutes */
                        intervalValue = Math.round(intervalValue);
                        return { value: intervalValue, unit: Interval.UnitEnum.Minute };
                    } else {
                        /**Nb seconds less than or equal 60 => aggregation in seconds */
                        intervalValue = bucketInterval / SECOND_IN_MILLISECOND;
                        intervalValue = Math.max(1, Math.round(intervalValue));
                        return { value: intervalValue, unit: Interval.UnitEnum.Second };
                    }
                }
            }
        } else {
            // Apply log10 on bucketInterval to get the power order
            const order = Math.log10(bucketInterval);
            let intervalValue = Math.round(bucketInterval);
            if (order >= 2) {
                // If bucketInterval power order is n >= 2, then it will be rounded to the nearest multiple of [5 * 10^(n-1)]
                intervalValue = roundToNearestMultiple(intervalValue, 5 * Math.pow(10, Math.trunc(order) - 1));
            } else if (order > 1 && order < 2) {
                // If bucketInterval power order is n = 1 (bucketInterval between 10 and 99),
                // then it will be rounded to the nearest multiple of 20 if bucketInterval > 20
                // and rouned to the nearest multiple of 5 if bucketInterval is between 10 and 20
                if (intervalValue > 20) {
                    intervalValue = roundToNearestMultiple(intervalValue, 20);
                } else {
                    intervalValue = roundToNearestMultiple(intervalValue, 5);
                }
            } else if (order > 0 && order < 1) {
                // If bucketInterval power order is n = 0 (bucketInterval between 1 and 10)),
                if (bucketInterval < 1.5) {
                    intervalValue = 1;
                } else if (bucketInterval >= 1.5 && bucketInterval < 3.5)  {
                    intervalValue = 2;
                } else if (bucketInterval >= 3.5 && bucketInterval < 7.5) {
                    intervalValue = 5;
                } else {
                    intervalValue = 10;
                }
            } else if (order < 0) { // which means bucketInterval between 0 and 1
                const absoluteOrder = -Math.trunc(order) + 1;
                const scientificDecimal = Math.round(bucketInterval * Math.pow(10, absoluteOrder));
                // bucketInterval =  (scienctificDecimal) * 10^(-absoluteOrder) where 1<=scienctificDecimal<=9
                if (scientificDecimal <= 3) {
                    intervalValue = scientificDecimal * 1 / Math.pow(10, absoluteOrder);
                } else if (scientificDecimal > 3 && scientificDecimal <= 7 ) {
                    intervalValue = 5 / Math.pow(10, absoluteOrder);
                } else {
                    intervalValue = 1 / Math.pow(10, absoluteOrder - 1);
                }
            }
            return { value: intervalValue};
        }
    } else {
        if (aggregationType === Aggregation.TypeEnum.Datehistogram) {
            return {value: 1, unit: Interval.UnitEnum.Day };
        } else {
            return {value: 1};
        }
    }
}

function roundToNearestMultiple(i, multiple) {
    return ((i % multiple) > multiple / 2) ? i + multiple - i % multiple : i - i % multiple;
}

/**
 * Checks if the `initialInterval` won't generate more than `maxBuckets` buckets. If so the function recalculates the interval
 * in order to respect the `maxBuckets` limit
 * @param histogramType Datehistogram or Histogram
 * @param maxBuckets Maximum number of buckets allowed in the histogram
 * @param initialInterval Initial interval of the histogram buckets
 * @param range The range of x-axis values
 * @returns a histogram `Interval` that respects the `maxBuckets` limit.
 */
export function adjustHistogramInterval(histogramType: Aggregation.TypeEnum,
    maxBuckets: number, initialInterval: Interval, range: number): Interval {
        if (histogramType === Aggregation.TypeEnum.Datehistogram) {
            const unitToTimestamp = new Map<Interval.UnitEnum, number>();
            unitToTimestamp.set(Interval.UnitEnum.Second,  1000);
            unitToTimestamp.set(Interval.UnitEnum.Minute,  1000 * 60);
            unitToTimestamp.set(Interval.UnitEnum.Hour,    1000 * 60 * 60);
            unitToTimestamp.set(Interval.UnitEnum.Day,     1000 * 60 * 60 * 24);
            unitToTimestamp.set(Interval.UnitEnum.Week,    1000 * 60 * 60 * 24 * 7);
            unitToTimestamp.set(Interval.UnitEnum.Month,   1000 * 60 * 60 * 24 * 30);
            unitToTimestamp.set(Interval.UnitEnum.Quarter, 1000 * 60 * 60 * 24 * 30 * 3);
            unitToTimestamp.set(Interval.UnitEnum.Year,    1000 * 60 * 60 * 24 * 365);
            const initialTimestampInterval = +initialInterval.value * unitToTimestamp.get(initialInterval.unit);
            const maxTimestampInterval = range / maxBuckets;
            if (initialTimestampInterval > 0.9 * maxTimestampInterval) {
                return initialInterval;
            } else {
                /** the initial interval will generate more than maxBuckets; we need to enlarge it  */
                return getAggregationPrecision(maxBuckets, range, histogramType);
            }
        } else {
            const initialIntervalValue = +initialInterval.value;
            const maxIntervalValue = range / maxBuckets;
            if (initialIntervalValue > 0.9 * maxIntervalValue) {
                return initialInterval;
            } else {
                return getAggregationPrecision(maxBuckets, range, histogramType);
            }
        }
}
