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

import { Collaboration, CollaborativesearchService, projType } from 'arlas-web-core';
import { SelectedOutputValues, DataType, DateExpression } from '../models/models';
import { Expression, Filter, Aggregation, Search, Sort, Interval } from 'arlas-api';
import { Observable } from 'rxjs/Observable';
import { interval } from 'rxjs/observable/interval';


export function getvaluesChanged(values: SelectedOutputValues[],
    field: string,
    identifier: string,
    collaborativeSearcheService: CollaborativesearchService
): any[] {
    let intervalSelection;
    const filterValue: Filter = {
        f: new Array<Array<Expression>>()
    };
    const rangeExpression: Expression = {
        field: field,
        op: Expression.OpEnum.Range,
        value: ''
    };
    let startValue;
    let endValue;
    values.forEach(value => {
        let end = value.endvalue;
        let start = value.startvalue;
        if ((typeof (<Date>end).getMonth === 'function') && (typeof (<Date>start).getMonth === 'function')) {
            const endDate = new Date(value.endvalue.toString());
            const startDate = new Date(value.startvalue.toString());
            startValue = startDate.toLocaleString();
            endValue = endDate.toLocaleString();
            end = endDate.valueOf();
            start = startDate.valueOf();
        } else if (Number(start).toString() !== 'NaN' && Number(end).toString() !== 'NaN') {
            startValue = Math.round(<number>start).toString();
            endValue = Math.round(<number>end).toString();
        } else {
            startValue = start;
            endValue = end;
        }
        rangeExpression.value = rangeExpression.value + '[' + start.toString() + '<' + end.toString() + '],';
    });
    rangeExpression.value = rangeExpression.value.substring(0, rangeExpression.value.length - 1);
    filterValue.f.push([rangeExpression]);
    const collaboration: Collaboration = {
        filter: filterValue,
        enabled: true
    };
    intervalSelection = values[values.length - 1];
    if (Number(intervalSelection.startvalue).toString() === 'NaN') {
        intervalSelection.startvalue = DateExpression.toDateExpression(<string>intervalSelection.startvalue).toMillisecond(false);
        intervalSelection.endvalue = DateExpression.toDateExpression(<string>intervalSelection.endvalue).toMillisecond(true);
    }
    collaborativeSearcheService.setFilter(identifier, collaboration);
    return [intervalSelection, startValue, endValue];
}

export function getSelectionToSet(data: Array<{ key: number, value: number }> | Map<string, Array<{ key: number, value: number }>>,
    collaboration: Collaboration,
    dataType: DataType,
): any[] {
    let intervalListSelection;
    let intervalSelection;
    let startValue;
    let endValue;
    let isArray: boolean;

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
        const f = collaboration.filter;
        if (f === null) {
            if (isArray) {
                if ((<Array<{ key: number, value: number }>>data).length > 0) {
                    currentIntervalSelected.startvalue = <number>data[0].key;
                    currentIntervalSelected.endvalue = <number>data[(<Array<{ key: number, value: number }>>data).length - 1].key;
                    if ((<Array<{ key: number, value: number }>>data).length > 1) {
                        const dataInterval = (<number>data[1].key - <number>data[0].key);
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
                        intervalOfSelection.startvalue = DateExpression.toDateExpression(start).toMillisecond(false);
                        intervalOfSelection.endvalue = DateExpression.toDateExpression(end).toMillisecond(true);
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
                    const dataInterval = (<number>data[1].key - <number>data[0].key);
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

export function getAggregationPrecision(nbBuckets: number, range: number, aggregationType: Aggregation.TypeEnum): Interval {
    const bucketInterval = range / nbBuckets;
    const DAY_IN_MILLISECOND = 86400000;
    const HOUR_IN_MILLISECOND = 3600000;
    const MINUTE_IN_MILLISECOND = 60000;
    const SECOND_IN_MILLISECOND = 1000;
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
        return { value: Math.max(Math.round(bucketInterval), 1)};
    }
}

function roundToNearestMultiple(i, multiple) {
    return ((i % multiple) > multiple / 2) ? i + multiple - i % multiple : i - i % multiple;
}
