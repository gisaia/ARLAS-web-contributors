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

import { Observable, from, of } from 'rxjs';

import {
    CollaborativesearchService,
    ConfigService,
    projType, GeohashAggregation, CollaborationEvent
} from 'arlas-web-core';
import {
    Aggregation, ComputationRequest, ComputationResponse,
    Filter, FeatureCollection, Metric, Feature
} from 'arlas-api';
import { OnMoveResult } from '../models/models';
import * as jsonSchema from '../jsonSchemas/topomapContributorConf.schema.json';
import { MapContributor } from './MapContributor';
import { flatMap, mergeAll, map, finalize } from 'rxjs/operators';


/**
 * This contributor works with the Angular MapComponent of the Arlas-web-components project.
 * This class make the brigde between the component which displays the data and the
 * collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
 */
export class TopoMapContributor extends MapContributor {

    private topoAggregation: Array<Aggregation> = this.getConfigValue('topo_aggregationmodels');
    private field_cardinality: string = this.getConfigValue('field_cardinality');
    private size = 1000;
    private AGGREGATION_MODELS = 'aggregationmodels';
    private geoIds = new Set<string>();

    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param onRemoveBboxBus  @Output of Angular MapComponent, send true when the rectangle of selection is removed.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        public identifier,
        public collaborativeSearcheService: CollaborativesearchService,
        public configService: ConfigService) {
        super(identifier, collaborativeSearcheService, configService);
    }

    public getPackageName(): string {
        return 'arlas.web.contributors.topomap';
    }
    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<any> {

        return of();
    }
    public computeData(data: any) {
    }

    public setData(data: any) {
    }

    public fetchTopoDataGeohashGeoaggregate(geohashList: Array<string>, filter: Filter): Observable<FeatureCollection> {
        const tabOfGeohash: Array<Observable<FeatureCollection>> = [];
        return from(tabOfGeohash).pipe(mergeAll());
    }



    public drawTopoGeoaggregateGeohash(geohashList: Array<string>, filter: Filter) {
    }

    public computeTopoGeoaggregateData(featureCollection: FeatureCollection): Array<any> {
        const featuresResults = [];
        return featuresResults;
    }
    public setTopoGeoaggregateData(features: Array<any>): any {
        features.forEach(f => {
            if (!this.geoIds.has(f.properties.key)) {
                // this.geojsondata.features.push(f);
                this.geoIds.add(f.properties.key);
            }
        });
        return features;
    }
}
