import { MetricsTableResponse } from "../contributors/MetricsTableContributor";

export const aggResponse1 = {
    'query_time': 7,
    'total_time': 8,
    'totalnb': 210464,
    'name': 'Term aggregation',
    'sumotherdoccounts': 0,
    'elements': [
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
                }
            ]
        },
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
                    'value': 35.53750842886042
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
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 33.53524605018058
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
                }
            ]
        },
        {
            'count': 484,
            'key': 'Pleiades',
            'key_as_string': 'Pleiades',
            'elements': [],
            'metrics': [
                {
                    'type': 'avg',
                    'field': 'metadata_ObservationContext_eo_opt_cloudCoverPercentage',
                    'value': 0.0
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

export const aggregationResponseList: MetricsTableResponse[] =  [{
    collection: 'toto',
    aggregationResponse: aggResponse1
}, {
    collection: 'titi',
    aggregationResponse: aggResponse2
}]
