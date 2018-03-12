import { Collaboration, CollaborativesearchService } from 'arlas-web-core';
import { SelectedOutputValues, DataType } from '../models/models';
import { Expression, Filter } from 'arlas-api';
import { Observable } from 'rxjs/Observable';
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
    if (values.length === 0 ) {
        collaborativeSearcheService.removeFilter(identifier);
        return [null, null, null];
    } else {
        values.forEach(value => {
            if (value !== null) {
                let end = value.endvalue;
                let start = value.startvalue;
                if ((typeof (<Date>end).getMonth === 'function') && (typeof (<Date>start).getMonth === 'function')) {
                    const endDate = new Date(value.endvalue.toString());
                    const startDate = new Date(value.startvalue.toString());
                    startValue = startDate.toLocaleString();
                    endValue = endDate.toLocaleString();
                    end = endDate.valueOf();
                    start = startDate.valueOf();
                } else {
                    startValue = Math.round(<number>start).toString();
                    endValue = Math.round(<number>end).toString();
                }
                rangeExpression.value = rangeExpression.value + '[' + start.toString() + '<' + end.toString() + '],';
            }
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
}

export function getSelectionToSet(data: Array<{ key: number, value: number }> | Map<string, Array<{ key: number, value: number }>>,
    collaboration: Collaboration,
    dataType: DataType,
    hasCurrentSelection: boolean
): any[] {
    let intervalListSelection;
    let intervalSelection;
    let startValue = Number.MAX_VALUE;
    let endValue = Number.MIN_VALUE;
    let currentIntervalSelected = {
        startvalue: null,
        endvalue: null
    };
    if (collaboration) {
        const f = collaboration.filter;
        const intervals = [];
        const filtersList = f.f[0];
        let d = 0;
        filtersList.forEach(filter => {
            let c = 0;
            if (hasCurrentSelection) {
                d++;
            }
            filter.value.split(',').forEach(range => {
                c++;
                const start = range.split('<')[0].substring(1);
                const end = range.split('<')[1].substring(0, range.split('<')[1].length - 1);
                const interval = {startvalue: null, endvalue: null };
                interval.startvalue = <number>parseFloat(start);
                interval.endvalue = <number>parseFloat(end);
                if (filter.value.split(',').length > c) {
                    intervals.push(interval);
                } else {
                    if (d < filtersList.length) {
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
        if (hasCurrentSelection) {
            intervalSelection = currentIntervalSelected;
        } else {
            intervalSelection = null;
        }
    } else {
        intervalListSelection = [];
        intervalSelection = null;
    }
    if (intervalSelection !== null) {
        startValue = intervalSelection.startvalue;
        endValue = intervalSelection.endvalue;
    } else {
        intervalListSelection.forEach(interval => {
            if (startValue > interval.startvalue) {
                startValue = interval.startvalue;
            }
            if (endValue < interval.endvalue) {
                endValue = interval.endvalue;
            }
        });
    }
    startValue = Math.round(<number>startValue);
    endValue = Math.round(<number>endValue);

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
