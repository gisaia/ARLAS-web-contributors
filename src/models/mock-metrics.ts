
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

import { MetricsTableResponse, MetricsVector } from './metrics-table.config';

export const aggResponse1 = {
    'query_time': 7,
    'total_time': 8,
    'totalnb': 210464,
    'name': 'Term aggregation',
    'sumotherdoccounts': 0,
    'elements': [
        {
            'count': 5399,
            'key': 'PLEIADES',
            'key_as_string': 'PLEIADES',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 37.83978514539729
                },
                {
                    'type': 'sum',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 37.83978514539729
                }
            ]
        },
        {
            'count': 20104,
            'key': 'AIRBUS-SPOT',
            'key_as_string': 'AIRBUS-SPOT',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 42.817200557103064
                },
                {
                    'type': 'sum',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 37.83978514539729
                }
            ]
        },
        {
            'count': 108728,
            'key': 'SENTINEL 2',
            'key_as_string': 'SENTINEL 2',
            'elements': [],
            'metrics': [
                {
                    'type': 'sum',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 37.83978514539729
                }
            ]
        },
        {
            'count': 23728,
            'key': 'AIRBUS-PLEIADES',
            'key_as_string': 'AIRBUS-PLEIADES',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 500
                },
                {
                    'type': 'sum',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 37.83978514539729
                }
            ]
        },
        {
            'count': 15363,
            'key': 'GEOSUD',
            'key_as_string': 'GEOSUD',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 4.640448240619069
                },
                {
                    'type': 'sum',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 800
                }
            ]
        },
        {
            'count': 13022,
            'key': 'SPOTWORLDHERITAGE',
            'key_as_string': 'SPOTWORLDHERITAGE',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 3.133981172246967
                },
                {
                    'type': 'sum',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 100
                }
            ]
        },
        {
            'count': 17909,
            'key': 'CNES-PLEIADES',
            'key_as_string': 'CNES-PLEIADES',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 0.0
                }
            ]
        }
    ]
};

export const aggResponse2 = {
    'query_time': 7,
    'total_time': 8,
    'totalnb': 210464,
    'name': 'Term aggregation',
    'sumotherdoccounts': 0,
    'elements': [
        {
            'count': 108728,
            'key': 'SENTINEL 2',
            'key_as_string': 'SENTINEL 2',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 33.53524605018058
                },
                {
                    'type': 'avg',
                    'field': 'metadata_tristesse',
                    'value': 37.83978514539729
                }
            ]
        },
        {
            'count': 15363,
            'key': 'GEOSUD',
            'key_as_string': 'GEOSUD',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 4.640448240619069
                },
                {
                    'type': 'avg',
                    'field': 'metadata_tristesse',
                    'value': 37.83978514539729
                }
            ]
        },
        {
            'count': 13022,
            'key': 'SPOTWORLDHERITAGE',
            'key_as_string': 'SPOTWORLDHERITAGE',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_tristesse',
                    'value': 37.83978514539729
                }
            ]
        },
        {
            'count': 17909,
            'key': 'CNES-PLEIADES',
            'key_as_string': 'CNES-PLEIADES',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 0.0
                },
                {
                    'type': 'avg',
                    'field': 'metadata_tristesse',
                    'value': 37.83978514539729
                }
            ]
        },
        {
            'count': 3554,
            'key': 'KALCNES',
            'key_as_string': 'KALCNES',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 0.0
                },
                {
                    'type': 'avg',
                    'field': 'metadata_tristesse',
                    'value': 37.83978514539729
                }
            ]
        },
        {
            'count': 484,
            'key': 'PLEIADES',
            'key_as_string': 'PLEIADES',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 0.0
                },
                {
                    'type': 'sum',
                    'field': 'metadata_heureux',
                    'value': 37.83978514539729
                }
            ]
        },
        {
            'count': 2162,
            'key': 'IGN-PLEIADES',
            'key_as_string': 'IGN-PLEIADES',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 10
                }
            ]
        },
        {
            'count': 2162,
            'key': 'IGN-PLEIADES',
            'key_as_string': 'IGN-PLEIADES',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 10
                }
            ]
        }
    ]
};

const aggregationResponseList: MetricsTableResponse[] = [{
    collection: 'toto',
    aggregationResponse: aggResponse1,
    keys: new Set(),
    missingKeys: new Set(),
    vector: {} as MetricsVector
}, {
    collection: 'titi',
    aggregationResponse: aggResponse2,
    keys: new Set(),
    missingKeys: new Set(),
    vector: {} as MetricsVector

}];
