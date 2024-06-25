import { ComputableResponse, MetricsTableResponse } from '../contributors/MetricsTableContributor';
import { MetricsVector } from './metrics-table.config';
import { Metric as ArlasApiMetric } from 'arlas-api';

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
        }
    ]
};

const aggregationResponseList: MetricsTableResponse[] =  [{
    collection: 'toto',
    aggregationResponse: aggResponse1,
    keys: new Set(),
    missingKeys:new Set(),
    vector: {} as MetricsVector,
    /** if true, it means the tables terms should be sorted according to this vector. */
    leadsTermsOrder: true
}, {
    collection: 'titi',
    aggregationResponse: aggResponse2,
    keys: new Set(),
    missingKeys:new Set(),
    vector: {} as MetricsVector,

    leadsTermsOrder: false
}];


export const computableResponseMock: ComputableResponse = {
    columns: [
        {collection: 'toto', metric: ArlasApiMetric.CollectFctEnum.AVG, field: 'metadata_ObservationContext_eo_opt_cloudCoverPercentage'},
        {collection: 'toto', metric: ArlasApiMetric.CollectFctEnum.SUM, field: 'metadata_ObservationContext_eo_opt_cloudCoverPercentage'},
        {collection: 'titi', metric: ArlasApiMetric.CollectFctEnum.AVG, field: 'metadata_ObservationContext_eo_opt_cloudCoverPercentage'},
        {collection: 'titi', metric: ArlasApiMetric.CollectFctEnum.AVG, field: 'metadata_tristesse'},
        {collection: 'titi', metric: ArlasApiMetric.CollectFctEnum.SUM, field: 'metadata_heureux'}
    ],
    metricsResponse: aggregationResponseList
};

/**
 * result
 *
 *
 * {
 *     "data": [
 *         {
 *             "data": [
 *                 {
 *                     "maxValue": 0,
 *                     "value": 37.83978514539729,
 *                     "metric": "avg"
 *                 },
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 37.83978514539729,
 *                     "metric": "sum"
 *                 },
 *                 {
 *                     "maxValue": 0,
 *                     "value": 0,
 *                     "metric": "avg"
 *                 },
 *                 null,
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 37.83978514539729,
 *                     "metric": "sum"
 *                 }
 *             ],
 *             "term": "PLEIADES"
 *         },
 *         {
 *             "data": [
 *                 {
 *                     "maxValue": 42.817200557103064,
 *                     "value": 42.817200557103064,
 *                     "metric": "avg"
 *                 },
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 37.83978514539729,
 *                     "metric": "sum"
 *                 },
 *                 null,
 *                 null,
 *                 null
 *             ],
 *             "term": "AIRBUS-SPOT"
 *         },
 *         {
 *             "data": [
 *                 null,
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 37.83978514539729,
 *                     "metric": "sum"
 *                 },
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 33.53524605018058,
 *                     "metric": "avg"
 *                 },
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 37.83978514539729,
 *                     "metric": "avg"
 *                 },
 *                 null
 *             ],
 *             "term": "SENTINEL 2"
 *         },
 *         {
 *             "data": [
 *                 {
 *                     "maxValue": 500,
 *                     "value": 500,
 *                     "metric": "avg"
 *                 },
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 37.83978514539729,
 *                     "metric": "sum"
 *                 },
 *                 null,
 *                 null,
 *                 null
 *             ],
 *             "term": "AIRBUS-PLEIADES"
 *         },
 *         {
 *             "data": [
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 4.640448240619069,
 *                     "metric": "avg"
 *                 },
 *                 {
 *                     "maxValue": 800,
 *                     "value": 800,
 *                     "metric": "sum"
 *                 },
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 4.640448240619069,
 *                     "metric": "avg"
 *                 },
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 37.83978514539729,
 *                     "metric": "avg"
 *                 },
 *                 null
 *             ],
 *             "term": "GEOSUD"
 *         },
 *         {
 *             "data": [
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 3.133981172246967,
 *                     "metric": "avg"
 *                 },
 *                 {
 *                     "maxValue": 100,
 *                     "value": 100,
 *                     "metric": "sum"
 *                 },
 *                 null,
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 37.83978514539729,
 *                     "metric": "avg"
 *                 },
 *                 null
 *             ],
 *             "term": "SPOTWORLDHERITAGE"
 *         },
 *         {
 *             "data": [
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 0,
 *                     "metric": "avg"
 *                 },
 *                 null,
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 0,
 *                     "metric": "avg"
 *                 },
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 37.83978514539729,
 *                     "metric": "avg"
 *                 },
 *                 null
 *             ],
 *             "term": "CNES-PLEIADES"
 *         },
 *         {
 *             "data": [
 *                 null,
 *                 null,
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 0,
 *                     "metric": "avg"
 *                 },
 *                 {
 *                     "maxValue": 37.83978514539729,
 *                     "value": 37.83978514539729,
 *                     "metric": "avg"
 *                 },
 *                 null
 *             ],
 *             "term": "KALCNES"
 *         },
 *         {
 *             "data": [
 *                 null,
 *                 null,
 *                 {
 *                     "maxValue": 10,
 *                     "value": 10,
 *                     "metric": "avg"
 *                 },
 *                 null,
 *                 null
 *             ],
 *             "term": "IGN-PLEIADES"
 *         }
 *     ],
 *     "header": [
 *         {
 *             "title": "toto",
 *             "subTitle": "metadata_ObservationContext_eo_opt_cloudCoverPercentage",
 *             "metric": "AVG"
 *         },
 *         {
 *             "title": "toto",
 *             "subTitle": "metadata_ObservationContext_eo_opt_cloudCoverPercentage",
 *             "metric": "SUM"
 *         },
 *         {
 *             "title": "titi",
 *             "subTitle": "metadata_ObservationContext_eo_opt_cloudCoverPercentage",
 *             "metric": "AVG"
 *         },
 *         {
 *             "title": "titi",
 *             "subTitle": "metadata_tristesse",
 *             "metric": "AVG"
 *         },
 *         {
 *             "title": "titi",
 *             "subTitle": "metadata_heureux",
 *             "metric": "SUM"
 *         }
 *     ]
 * }
 */
