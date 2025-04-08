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

import { AnalyticsContributor } from './contributors/AnalyticsContributor';
import { ChipsSearchContributor } from './contributors/ChipsSearchContributor';
import { ComputeContributor } from './contributors/ComputeContributor';
import { DetailedHistogramContributor } from './contributors/DetailedHistogramContributor';
import { HistogramContributor } from './contributors/HistogramContributor';
import { MapContributor } from './contributors/MapContributor';
import { MetricsTableContributor } from './contributors/MetricsTableContributor';
import { ResultListContributor } from './contributors/ResultListContributor';
import { SearchContributor } from './contributors/SearchContributor';
import { SwimLaneContributor } from './contributors/SwimLaneContributor';
import { TreeContributor } from './contributors/TreeContributor';

export { AnalyticsContributor } from './contributors/AnalyticsContributor';
export { ChipsSearchContributor } from './contributors/ChipsSearchContributor';
export { ComputeContributor } from './contributors/ComputeContributor';
export { DetailedHistogramContributor } from './contributors/DetailedHistogramContributor';
export { HistogramContributor } from './contributors/HistogramContributor';
export { DEFAULT_FETCH_NETWORK_LEVEL, MapContributor } from './contributors/MapContributor';
export { MetricsTableContributor } from './contributors/MetricsTableContributor';
export { MatchInfo, ResultListContributor } from './contributors/ResultListContributor';
export { SearchContributor } from './contributors/SearchContributor';
export { SwimLaneContributor } from './contributors/SwimLaneContributor';
export { TreeContributor } from './contributors/TreeContributor';
export {
    MetricsTable, MetricsTableCell, MetricsTableHeader, MetricsTableRow, MetricsVector, MetricsVectorConfig
} from './models/metrics-table.config';
export {
    Action, ColorConfig, Column, ComputeConfig, DateExpression, DateUnitEnum, Detail, ElementIdentifier,
    ExtentFilterGeometry, FeatureRenderMode, FieldsConfiguration, LayerSourceConfig, MetricConfig, triggerType
} from './models/models';
export { fix180thMeridian, isClockwise } from './utils/mapUtils';
export { getSourceName, processPassesAllowList, validProcess } from './utils/utils';

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

export { contributors };
