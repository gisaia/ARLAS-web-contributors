import { MetricsTableContributor } from '../dist/index.js';
import { Observable, of } from 'rxjs';

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


const metricTableContributor = new MetricsTableContributor('id', css, configService, 10, metricsTableConfig);
metricTableContributor.configuration = metricsTableConfig;
metricTableContributor.computeData(undefined);
