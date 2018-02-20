import { PowerbarsContributor } from './contributors/PowerbarsContributor';
import { HistogramContributor } from './contributors/HistogramContributor';
import { SwimLaneContributor } from './contributors/SwimLaneContributor';
import { ChipsSearchContributor } from './contributors/ChipsSearchContributor';
import { MapContributor } from './contributors/MapContributor';
import { ResultListContributor } from './contributors/ResultListContributor';
import { DonutContributor } from './contributors/DonutContributor';

import { Contributor } from 'arlas-web-core';
export { PowerbarsContributor } from './contributors/PowerbarsContributor';
export { HistogramContributor } from './contributors/HistogramContributor';
export { ResultListContributor } from './contributors/ResultListContributor';
export { MapContributor } from './contributors/MapContributor';
export { ChipsSearchContributor } from './contributors/ChipsSearchContributor';
export { SwimLaneContributor } from './contributors/SwimLaneContributor';
export { DonutContributor } from './contributors/DonutContributor';

export { Action, ElementIdentifier, triggerType } from './models/models';

const contributors = new Map<string, any>();
contributors.set('histogram', HistogramContributor);
contributors.set('powerbars', PowerbarsContributor);
contributors.set('resultlist', ResultListContributor);
contributors.set('map', MapContributor);
contributors.set('swimlane', SwimLaneContributor);
contributors.set('chipsearch', ChipsSearchContributor);
contributors.set('donut', DonutContributor);

export {contributors};




