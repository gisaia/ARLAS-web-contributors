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

import { Observable, from } from 'rxjs';

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
import { MapContributor, fetchType } from './MapContributor';
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
        this.clearData();
        this.clearTiles();
        if (this.zoom < this.zoomLevelForTestCount) {
            this.aggregation = this.getConfigValue(this.AGGREGATION_MODELS);
            this.fetchType = fetchType.geohash;
            return this.fetchDataGeohashGeoaggregate(this.geohashList);
        } else if (this.zoom >= this.zoomLevelForTestCount) {
            const pwithin = this.mapExtend[1] + ',' + this.mapExtend[2] + ',' + this.mapExtend[3] + ',' + this.mapExtend[0];
            // test for count with aggregation geoagreate interval 1 metrics cadinalitty sur le champs
            const countFilter = this.getFilterForCount(pwithin);
            this.addFilter(countFilter, this.additionalFilter);
            const newCount = this.getTopoCardinality(this.field_cardinality, countFilter);
            if (newCount) {
                return newCount.pipe(flatMap(
                    computationResponse => {
                        this.size = computationResponse.value;
                        if (this.size <= this.nbMaxFeatureForCluster) {
                            // AGG TOPO
                            this.aggregation = this.topoAggregation;
                            this.fetchType = fetchType.topology;
                            return this.fetchTopoDataGeohashGeoaggregate(this.geohashList, this.additionalFilter);
                        } else {
                            // Classique AGG geohash
                            this.aggregation = this.getConfigValue(this.AGGREGATION_MODELS);
                            this.fetchType = fetchType.geohash;
                            return this.fetchDataGeohashGeoaggregate(this.geohashList);
                        }
                    }));
            }
        }
    }
    public computeData(data: any): any[] {
        if (this.fetchType === fetchType.topology) {
            return this.computeTopoGeoaggregateData(data);
        } else {
            return this.computeDataGeohashGeoaggregate(data);
        }
    }

    public setData(data: any) {
        if (this.fetchType === fetchType.topology) {
            return this.setTopoGeoaggregateData(data);
        } else {
            return this.setDataGeohashGeoaggregate(data);
        }
    }

    public fetchTopoDataGeohashGeoaggregate(geohashList: Array<string>, filter: Filter): Observable<FeatureCollection> {
        const tabOfGeohash: Array<Observable<FeatureCollection>> = [];
        if (this.updateData) {
            const aggregations = this.aggregation;
            aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => a.interval.value = this.precision);
            aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Term).map(a => a.size = this.nbMaxFeatureForCluster);
            aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => a.fetch_geometry.strategy = this.geomStrategy);
            const geohashSet = new Set(geohashList);
            geohashSet.forEach(geohash => {
                if (this.currentGeohashList.indexOf(geohash) < 0) {
                    this.currentGeohashList.push(geohash);
                }
                const geohahsAggregation: GeohashAggregation = {
                    geohash: geohash,
                    aggregations: aggregations
                };
                const geoAggregateData: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNotFeatureCollection(
                    [projType.geohashgeoaggregate, geohahsAggregation], this.collaborativeSearcheService.collaborations,
                    this.isFlat, null, filter, this.cacheDuration);
                tabOfGeohash.push(geoAggregateData);
            });
        }
        return from(tabOfGeohash).pipe(mergeAll());
    }


    /**
    * Function called on onMove event emitted by the mapcomponent output
    */
    public onMove(newMove: OnMoveResult) {
        this.geohashList = newMove.geohash;
        this.zoom = newMove.zoom;
        const nbMaxFeatures = this.getNbMaxFeatureFromZoom(newMove.zoom);
        const precision = this.getPrecisionFromZoom(newMove.zoom);
        let precisionChanged = false;
        if (precision !== this.precision) {
            precisionChanged = true;
            this.precision = precision;
        }
        if (newMove.zoom < this.zoomLevelForTestCount) {
            this.aggregation = this.getConfigValue(this.AGGREGATION_MODELS);
            this.onMoveInClusterMode(precisionChanged, newMove);
        } else if (newMove.zoom >= this.zoomLevelForTestCount) {
            if (precisionChanged) {
                this.clearData();
                this.clearTiles();
            }
            const pwithin = newMove.extendForLoad[1] + ',' + newMove.extendForLoad[2]
                + ',' + newMove.extendForLoad[3] + ',' + newMove.extendForLoad[0];
            // Test for count with aggregation geoagreate interval 1 metrics cadinalitty sur le champs
            const countFilter = this.getFilterForCount(pwithin);
            this.addFilter(countFilter, this.additionalFilter);
            const count = this.getTopoCardinality(this.field_cardinality, countFilter);
            if (count) {
                count
                    .subscribe(computationResponse => {
                        this.size = computationResponse.value;
                        if (this.size <= nbMaxFeatures) {
                            this.aggregation = this.topoAggregation;
                            this.fetchType = fetchType.topology;
                            if (this.isGeoaggregateCluster) {
                                this.clearData();
                                this.clearTiles();
                            }
                            const newGeohashList = new Array<string>();
                            this.geohashList.forEach(geohash => {
                                if (this.currentGeohashList.indexOf(geohash) < 0) {
                                    newGeohashList.push(geohash);
                                    this.currentGeohashList.push(geohash);
                                }
                            });
                            // if new extend is not totaly include in old extend
                            if (newGeohashList.length > 0 || newMove.extendForLoad[0] > this.mapExtend[0]
                                || newMove.extendForLoad[2] < this.mapExtend[2]
                                || newMove.extendForLoad[1] < this.mapExtend[1]
                                || newMove.extendForLoad[3] > this.mapExtend[3]
                                || this.isGeoaggregateCluster
                            ) {
                                this.drawTopoGeoaggregateGeohash(newGeohashList, this.additionalFilter);
                            }
                        } else {
                            this.aggregation = this.getConfigValue(this.AGGREGATION_MODELS);
                            this.onMoveInClusterMode(precisionChanged, newMove);
                        }
                        this.mapExtend = newMove.extendForLoad;
                    });
            }
        }
    }

    /**
     * Clears all variables storing the data
     */
    public clearData() {
        this.geojsondata.features = [];
        this.geoIds = new Set();
        this.maxValueGeoHash = 0;
    }

    /**
     * Clears all the variables storing the visited tiles
     */
    public clearTiles() {
        this.currentGeohashList = [];
        this.currentExtentGeohashSet = new Set();
        this.geohashesMap = new Map();
        this.parentGeohashesSet = new Set();
    }

    public drawTopoGeoaggregateGeohash(geohashList: Array<string>, filter: Filter) {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        this.fetchTopoDataGeohashGeoaggregate(geohashList, filter)
            .pipe(
                map(f => this.computeTopoGeoaggregateData(f)),
                map(f => this.setTopoGeoaggregateData(f)),
                finalize(() => {
                    this.redrawTile.next(true);
                    this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                })
            )
            .subscribe(data => data);
    }

    public computeTopoGeoaggregateData(featureCollection: FeatureCollection): Array<any> {
        const featuresResults = [];
        if (featureCollection.features !== undefined) {
            featureCollection.features.forEach(f => {
                if (this.maxValueGeoHash <= f.properties.count) {
                    this.maxValueGeoHash = f.properties.count;
                }
            });
            featureCollection.features.forEach(f => {
                f.properties['point_count_normalize'] = f.properties.count / this.maxValueGeoHash * 100;
                f.properties['point_count'] = f.properties.count;
                featuresResults.push(f);
            });
        }
        return featuresResults;
    }
    public setTopoGeoaggregateData(features: Array<any>): any {
        features.forEach(f => {
            if (!this.geoIds.has(f.properties.key)) {
                this.geojsondata.features.push(f);
                this.geoIds.add(f.properties.key);
            }
        });
        this.isGeoaggregateCluster = false;
        return features;
    }

    private getTopoCardinality(collectField: string, filter: Filter): Observable<ComputationResponse> {
        const computationRequest: ComputationRequest = { field: collectField, metric: ComputationRequest.MetricEnum.CARDINALITY };
        return this.collaborativeSearcheService.resolveButNotComputation([projType.compute, computationRequest],
            this.collaborativeSearcheService.collaborations, null, filter, false, this.cacheDuration);

    }
}
