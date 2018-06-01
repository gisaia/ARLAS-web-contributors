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

import { PowerbarsContributor } from './contributors/PowerbarsContributor';
import { HistogramContributor } from './contributors/HistogramContributor';
import { SwimLaneContributor } from './contributors/SwimLaneContributor';
import { ChipsSearchContributor } from './contributors/ChipsSearchContributor';
import { MapContributor } from './contributors/MapContributor';
import { ResultListContributor } from './contributors/ResultListContributor';
import { DonutContributor } from './contributors/DonutContributor';
import { TimeShortcutsContributor } from './contributors/TimeShortcutsContributor';

import { Contributor } from 'arlas-web-core';
export { PowerbarsContributor } from './contributors/PowerbarsContributor';
export { HistogramContributor } from './contributors/HistogramContributor';
export { ResultListContributor } from './contributors/ResultListContributor';
export { MapContributor } from './contributors/MapContributor';
export { ChipsSearchContributor } from './contributors/ChipsSearchContributor';
export { SwimLaneContributor } from './contributors/SwimLaneContributor';
export { DonutContributor } from './contributors/DonutContributor';
export { TimeShortcutsContributor } from './contributors/TimeShortcutsContributor';


export { Action, ElementIdentifier, triggerType, DateExpression, DateUnitEnum } from './models/models';

const contributors = new Map<string, any>();
contributors.set('histogram', HistogramContributor);
contributors.set('powerbars', PowerbarsContributor);
contributors.set('resultlist', ResultListContributor);
contributors.set('map', MapContributor);
contributors.set('swimlane', SwimLaneContributor);
contributors.set('chipsearch', ChipsSearchContributor);
contributors.set('donut', DonutContributor);

export {contributors};




