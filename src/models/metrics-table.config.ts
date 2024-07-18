
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

import { Metric as ArlasApiMetric, Aggregation, AggregationResponse } from 'arlas-api';

export interface MetricsTableResponse {
    collection: string;
    aggregationResponse: AggregationResponse;
    keys: Set<string>;
    missingKeys: Set<string>;
    vector: MetricsVector;
}

export class ComputableResponse {
    public columns: MetricsTableColumn[] = [];
    public metricsResponse: Array<MetricsTableResponse> = [];

    public getMetricResponse(collection): MetricsTableResponse {
        return this.metricsResponse.find(mr => mr.collection === collection);
    }

    public static mergeKeys(keys1: Set<string>, keys2: Set<string>): Set<string> {
        const mergedKeys = new Set<string>();
        if (keys1) {
            keys1.forEach(k => mergedKeys.add(k));
        }
        if (keys2) {
            keys2.forEach(k => mergedKeys.add(k));
        }
        return mergedKeys;
    }

    public static disjointValues(wholeKeys: Set<string>, keysToCheck: Set<string>): string[] {
        const disjointValues = [];
        keysToCheck.forEach(k => {
            if (!wholeKeys.has(k)) {
                disjointValues.push(k);
            }
        });
        return disjointValues;
    }

    /** Create term elements with count = 0. */
    public static createEmptyArlasElements(keys: Array<string>): AggregationResponse[] {
        const elements: AggregationResponse[] = [];
        keys.forEach(k => {
            const ar: AggregationResponse = {
                key: k,
                key_as_string: k,
                count: 0
            };
            elements.push(ar);
        });
        return elements;
    }
}

export interface MetricsTableColumn {
    collection: string;
    termfield: string;
    metric: ArlasApiMetric.CollectFctEnum | 'count';
    field?: string;
}

export interface MetricsVectorConfig {
    termfield: string;
    collection: string;
    metrics: MetricConfig[];
}

export interface MetricConfig {
    field: string;
    metric: ArlasApiMetric.CollectFctEnum | 'count';
}

export interface MetricsTableSortConfig {
    collection: string;
    termfield: string;
    order: 'asc' | 'desc';
    on: 'alphabetical' | 'count' | 'metric';
    metric?: MetricConfig;
}


/**
 * |                             MetricsVectors                            |
 * |        |      MetricVector 1        |          MetricVector 2         |
 * |        | (c1,f1,m1)  |  (c1,f2,m2)  |  (c2,f'1,m'2)  |  (c2,f'2,m'2)  |
 * | term 1 |      x      |      x       |      x         |      x         |
 * | term 2 |      x      |      x       |      x         |      x         |
 */

export class MetricsVectors {
    public ids: Set<string> = new Set();
    /** A vector represents a collection */
    public vectors: MetricsVector[] = [];
    public constructor(configs: MetricsVectorConfig[], sortConfig: MetricsTableSortConfig, nbTerms: number) {
        configs.forEach(config => {
            const vectorId = MetricsVector.id(config);
            if (!this.ids.has(vectorId)) {
                this.ids.add(vectorId);
                this.vectors.push(new MetricsVector(
                    config.collection,
                    config.termfield , config, sortConfig, nbTerms));
            }
        });
    }

}

/** @class */
/** A MetricsVector reprensents a collection with all its metrics.
 * It provides `getAggregation`method that returns the arlas-api Aggregation request object.
 * |        |      MetricVector 1        |
 * |        | (c1,f1,m1)  |  (c1,f2,m2)  |
 * | term 1 |      x      |      x       |
 * | term 2 |      x      |      x       |
 */
export class MetricsVector {
    public collection: string;
    public termfield: string;
    public configuration: MetricsVectorConfig;
    public nbTerms: number;
    public sort: MetricsTableSortConfig;

    public constructor(collection: string, termfield: string, configuration: MetricsVectorConfig,
        sortConfig: MetricsTableSortConfig, nbTerms: number) {
        this.collection = collection;
        this.termfield = termfield;
        this.configuration = configuration;
        this.nbTerms = nbTerms;
        this.sort = sortConfig;
    }

    public static id(mvc: MetricsVectorConfig) {
        return mvc.collection + mvc.termfield + mvc.metrics.map(m => m.metric + (!!m.field ? m.field : 'count')).join('__:__');
    }

    public hasCount() {
        return !!this.configuration && !!this.configuration.metrics?.find(m => m.metric === 'count');
    }

    /** This method detects if this vector should be sorted by arlas-server */
    public isSortable() {
        if (this.sort) {
            const hasSameCollection = (this.collection === this.sort.collection);
            const hasSameTermfield = (this.termfield === this.sort.termfield);
            if (hasSameCollection && hasSameTermfield) {
                if (this.isSortOnCount()) {
                    return this.hasCount();
                } else {
                    return (!!this.configuration.metrics.find(m => (m.field === this.sort.metric?.field
                        && m.metric === this.sort?.metric?.metric)));
                }
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    public getAggregation(termsToInclude?: string[]): Aggregation {
        const aggregation: Aggregation = {
            field: this.termfield,
            size: this.nbTerms.toString(),
            metrics: this.getMetrics(this.configuration.metrics, this.sort),
            type: Aggregation.TypeEnum.Term
        };
        if (termsToInclude) {
            aggregation.include = termsToInclude.join('|');
            aggregation.size = termsToInclude.length.toString();
        }
        if (this.isSortable()) {
            aggregation.order = this.getSortOrder(this.sort);
            aggregation.on = this.getSortOn(this.sort);
        }
        return aggregation;
    }

    /**
     * Returns list of metrics to calculate.
     * The order of this list matters to apply a sort on the aggregation result.
     * According to arlas-server specs :
     * >>> (3') If 'on' is equal to 'result' and
     *     two or more (collect_field,collect_fct) couples are specified,
     *     then the order is applied on the first collect_fct different from geobbox and geobbox".
     * <<<
     * @param sort
     */
    private getMetrics(metricsConfig: MetricConfig[], sort: MetricsTableSortConfig): ArlasApiMetric[] {
        let arlasMetrics: ArlasApiMetric[] = [];
        if (this.isSortable() && !this.isSortOnCount()) {
            const sortMetric = sort.metric;
            if (sortMetric.metric !== 'count') {
                /** Pushing the sortMetric first so that arlas-server aggregation sort on it. */
                arlasMetrics.push({
                    collect_fct: sortMetric.metric as ArlasApiMetric.CollectFctEnum,
                    collect_field: sortMetric.field
                });
                /** Pushing the remaining metrics (except for count) */
                const remainingMetrics = (m: MetricConfig) => m.metric !== 'count'
                    && (m.metric !== sortMetric.metric && m.field !== sortMetric.field);
                metricsConfig.filter(m => remainingMetrics(m)).forEach(m => {
                    arlasMetrics.push({
                        collect_fct: m.metric as ArlasApiMetric.CollectFctEnum,
                        collect_field: m.field
                    });
                });
                return arlasMetrics;
            }
        } else {
            /** !! Otherwise : Pushing all the metrics (except for count) */
            arlasMetrics = metricsConfig.filter(m => m.metric !== 'count').map(m => ({
                collect_fct: m.metric as ArlasApiMetric.CollectFctEnum,
                collect_field: m.field
            }));
            return arlasMetrics;
        }
    }

    public getColumns(): MetricsTableColumn[] {
        const metricsConfig: MetricConfig[] = this.configuration.metrics;
        const sort: MetricsTableSortConfig = this.sort;
        const columns: MetricsTableColumn[] = [];
        metricsConfig.forEach(m => {
            columns.push({
                metric: m.metric,
                collection: this.collection,
                field: m?.field,
                termfield: this.termfield
            });
        });
        return columns;
    }


    /** Returns the Aggregation.OnEnum to apply to arlas aggregation request object. */
    private getSortOn(sort: MetricsTableSortConfig): Aggregation.OnEnum {
        if (sort && sort.on === 'alphabetical') {
            return Aggregation.OnEnum.Field;
        } else if (sort && sort.on === 'count') {
            return Aggregation.OnEnum.Count;
        } else if (sort && sort.on === 'metric' && !!sort?.metric && sort.metric.metric !== 'count') {
            return Aggregation.OnEnum.Result;
        } else {
            return Aggregation.OnEnum.Count;
        }
    }

    /** Returns the Aggregation.OrderEnum to apply to arlas aggregation request object. */
    private getSortOrder(sort: MetricsTableSortConfig): Aggregation.OrderEnum {
        if (sort.order === 'asc') {
            return Aggregation.OrderEnum.Asc;
        } else if (sort.order === 'desc') {
            return Aggregation.OrderEnum.Desc;
        } else {
            /** sort.order should always be specified. This block is for code safety. */
            return Aggregation.OrderEnum.Desc;
        }
    }

    public mergeResponses(baseResponse: AggregationResponse, complementaryResponse: AggregationResponse): AggregationResponse {
        const mergedResponse = Object.assign({}, baseResponse);
        const baseArray = this.getComparableArray(baseResponse);
        const complementaryArray = this.getComparableArray(complementaryResponse);
        const baseElements = baseResponse.elements;
        const complementarElements = complementaryResponse.elements;
        const mergedElements = [];
        let i = 0, j = 0;
        const compare = (a: number, b: number): boolean => this.getSortOrder(this.sort) === Aggregation.OrderEnum.Asc ? a < b : a > b;
        // Merge arrays until one is exhausted
        while (i < baseElements.length && j < complementarElements.length) {
            if (compare(baseArray[i], complementaryArray[j])) {
                mergedElements.push(baseElements[i]);
                i++;
            } else {
                mergedElements.push(complementarElements[j]);
                j++;
            }
        }

        // Add remaining elements from array1, if any
        while (i < baseElements.length) {
            mergedElements.push(baseElements[i]);
            i++;
        }

        // Add remaining elements from array2, if any
        while (j < complementarElements.length) {
            mergedElements.push(complementarElements[j]);
            j++;
        }
        mergedResponse.elements = mergedElements;
        return mergedResponse;
    }

    private getComparableArray(response: AggregationResponse): number[] {
        if (this.isSortOnCount()) {
            return response.elements.map(e => e.count);
        } else {
            const metricConfig = this.sort.metric;
            return response.elements.map(e => e.metrics?.find(m => (m.field === metricConfig.field.replace(/\./g, '_')
             && m.type === metricConfig.metric))?.value);
        }
    }

    private isSortOnCount() {
        return !this.sort
            ||
            this.sort.collection !== this.collection
            ||
            (this.sort.collection === this.collection
                && (
                    this.sort.on === 'count'
                    || (this.sort.on === 'metric' && this.sort?.metric?.metric === 'count'
                    ))
            );
    }
}

export interface MetricsTable {
    header: MetricsTableHeader[];
    data: MetricsTableRow[];
}

export interface MetricsTableHeader {
    title: string;
    subTitle: string;
    metric: ArlasApiMetric.CollectFctEnum | 'count';
    rowfield: string;
}

export interface MetricsTableCell {
    value: number;
    maxColumnValue: number;
    maxTableValue: number;
    metric: ArlasApiMetric.CollectFctEnum | 'count' | string;
    column: string;
    field: string;
}

export interface MetricsTableRow {
    term: string;
    data: MetricsTableCell[];
}
