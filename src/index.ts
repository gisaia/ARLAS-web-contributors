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

import { HistogramContributor } from './contributors/HistogramContributor';
import { DetailedHistogramContributor } from './contributors/DetailedHistogramContributor';
import { SwimLaneContributor } from './contributors/SwimLaneContributor';
import { ChipsSearchContributor } from './contributors/ChipsSearchContributor';
import { SearchContributor } from './contributors/SearchContributor';
import { MapContributor } from './contributors/MapContributor';
import { ResultListContributor } from './contributors/ResultListContributor';
import { AnalyticsContributor } from './contributors/AnalyticsContributor';
import { TreeContributor } from './contributors/TreeContributor';
import { ComputeContributor } from './contributors/ComputeContributor';
import { MetricsTableContributor } from './contributors/MetricsTableContributor';
export { TreeContributor } from './contributors/TreeContributor';
export { HistogramContributor } from './contributors/HistogramContributor';
export { ResultListContributor } from './contributors/ResultListContributor';
export { MapContributor, DEFAULT_FETCH_NETWORK_LEVEL } from './contributors/MapContributor';
export { ChipsSearchContributor } from './contributors/ChipsSearchContributor';
export { SearchContributor } from './contributors/SearchContributor';
export { SwimLaneContributor } from './contributors/SwimLaneContributor';
export { DetailedHistogramContributor } from './contributors/DetailedHistogramContributor';
export { AnalyticsContributor } from './contributors/AnalyticsContributor';
export { ComputeContributor } from './contributors/ComputeContributor';
export { Action, FeatureRenderMode, ElementIdentifier, triggerType, DateExpression, DateUnitEnum,
    LayerSourceConfig, ColorConfig, MetricConfig, ExtentFilterGeometry } from './models/models';
export { getSourceName, processPassesAllowList, validProcess } from './utils/utils';
export { FieldsConfiguration, ComputeConfig, Column, Detail } from './models/models';
export { MetricsTableContributor } from './contributors/MetricsTableContributor';
export { MetricsTable, MetricsTableCell,
     MetricsTableHeader, MetricsTableRow, MetricsVector, MetricsVectorConfig } from './models/metrics-table.config';
const contributors = new Map<string, any>();
contributors.set('histogram', HistogramContributor);
contributors.set('detailedhistogram', DetailedHistogramContributor);
contributors.set('resultlist', ResultListContributor);
contributors.set('map', MapContributor);
contributors.set('swimlane', SwimLaneContributor);
contributors.set('chipsearch', ChipsSearchContributor);
contributors.set('search', SearchContributor);
contributors.set('analytics', AnalyticsContributor);
contributors.set('tree', TreeContributor);
contributors.set('metric', ComputeContributor);
contributors.set('metricstable', MetricsTableContributor);

export {contributors};




