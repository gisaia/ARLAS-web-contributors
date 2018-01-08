import { Collaboration, CollaborativesearchService } from 'arlas-web-core';
import { SelectedOutputValues, DateUnit, DataType } from '../models/models';
import { Expression, Filter } from 'arlas-api';
import { Observable } from 'rxjs/Observable';
export function getvaluesChanged(values: SelectedOutputValues[],
    field: string,
    dateUnit: DateUnit,
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
            let multiplier = 1;
            if (dateUnit.toString() === DateUnit.second.toString()) {
                multiplier = 1000;
            }
            end = endDate.valueOf() / multiplier;
            start = startDate.valueOf() / multiplier;
        } else {
            startValue = Math.round(<number>start).toString();
            endValue = Math.round(<number>end).toString();
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
    collaborativeSearcheService.setFilter(identifier, collaboration);
    return [intervalSelection, startValue, endValue];
}

export function getSelectionToSet(data: Array<{ key: number, value: number }> | Map<string, Array<{ key: number, value: number }>>,
    collaboration: Collaboration,
    dataType: DataType, dateUnit: DateUnit,
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
                    const interval = {
                        startvalue: null,
                        endvalue: null
                    };
                    if (dataType === DataType.time) {
                        if (dateUnit === DateUnit.second) {
                            interval.startvalue = <number>parseFloat(start) * 1000;
                            interval.endvalue = <number>parseFloat(end) * 1000;
                        } else {
                            interval.startvalue = <number>parseFloat(start);
                            interval.endvalue = <number>parseFloat(end);
                        }
                    } else {
                        interval.startvalue = <number>parseFloat(start);
                        interval.endvalue = <number>parseFloat(end);
                    }
                    if (k.value.split(',').length > c) {
                        intervals.push(interval);
                    } else {
                        if (d < invtervalFilterList.length) {
                            intervals.push(interval);
                        } else {
                            currentIntervalSelected = interval;
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
        startValue = Math.round(<number>currentIntervalSelected.startvalue).toString();
        endValue = Math.round(<number>currentIntervalSelected.endvalue).toString();
    }

    return [intervalListSelection, intervalSelection, startValue, endValue];
}

function getMinMax(data: Map<string, Array<{ key: number, value: number }>>): Array<number> {
    let min;
    let max;
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
    });
    return [min, max];
}
