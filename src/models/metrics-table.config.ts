
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

import { Metric, Aggregation } from 'arlas-api';

export interface MetricsTableConfig {
    [collection: string]: MetricsVectorConfig;
}

export interface MetricsVectorConfig {
    termfield: string;
    metrics: MetricConfig[];
}

export interface MetricConfig {
    field: string;
    metric: Metric.CollectFctEnum | 'count';
}

export class MetricsVectors {
    public collections: Set<string> = new Set();
    public vectors: MetricsVector[] = [];
    public constructor(config: MetricsTableConfig, nbTerms: number) {
        Object.keys(config).forEach(collection => {
            this.collections.add(collection);
            this.vectors.push(new MetricsVector(collection, config[collection], nbTerms));
        });

    }
}

export class MetricsVector {
    public collection: string;
    public configuration: MetricsVectorConfig;
    public nbTerms: number;

    public constructor(collection: string, configuration: MetricsVectorConfig, nbTerms: number) {
        this.collection = collection;
        this.configuration = configuration;
        this.nbTerms = nbTerms;
    }

    public getAggregation(): Aggregation {
        return {
            field: this.configuration.termfield,
            size: this.nbTerms.toString(),
            metrics: this.configuration.metrics.filter(m => m.metric !== 'count').map(m => ({
                collect_fct: m.metric as Metric.CollectFctEnum,
                collect_field: m.field
            })),
            type: Aggregation.TypeEnum.Term
        };
    }
}

export interface MetricsTable {
    header: MetricsTableHeader[];
    data: MetricsTableRow[];
}

export interface MetricsTableHeader {
    title: string;
    subTitle: string;
    metric: string;
}

export interface MetricsTableData {
    value: number;
    maxValue: number;
}

export interface MetricsTableRow {
    term: string;
    data: MetricsTableData[];
}
