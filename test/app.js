/*
 * Licensed to Gisaïa under one or more contributor
 * license agreements. See the NOTICE.txt file distributed with
 * this work for additional information regarding copyright
 * ownership. Gisaïa licenses this file to you under
 * the Apache License, Version 2.0 (the 'License'); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * 'AS IS' BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
*/

import { MetricsTableContributor, processPassesAllowList } from '../dist/index.js';
import { of } from 'rxjs';

const metricsTableConfig = {
  'collection_toto' : {
    'termfield': 'constellation',
    'metrics': [
      {
        'field': 'cloudcoverage',
        'metric': 'avg'
      }
    ]
  }
};

const css = {
  defaultCollection: 'test_collection',
  register: () => {},
  collaborationBus: of()
};

const configService = {
  getValue: () => []
};

// todo update test
/**const metricTableContributor = new MetricsTableContributor('id', css, configService);
metricTableContributor.configuration = metricsTableConfig;
metricTableContributor.computeData(undefined);**/


const testString1 = "new Date().getFullYear() === 2024;";
const testString2 = "Math.abs(-5) + 10;";
const testString3 = "\"\" + (new Date()).getTime() + ''";
const testString4 = "'alphanumeric' + 123;";
const testString5 = "test === \"example\";"; 
const invalidTestString = "test === 'example';";  // This should fail because 'test' is not quoted
const invalidTestString2 = "document.write('toto')";  // This should fail because 'test' is not quoted
const invalidTestString3 = "window";  // This should fail because 'test' is not quoted


console.log(processPassesAllowList(testString1, ''));
console.log(processPassesAllowList(testString2, ''));
console.log(processPassesAllowList(testString3, ''));
console.log(processPassesAllowList(testString4, ''));
console.log(processPassesAllowList(testString5, 'test'));
console.log(processPassesAllowList(invalidTestString, ''));
console.log(processPassesAllowList(invalidTestString2, ''));
console.log(processPassesAllowList(invalidTestString3, ''));