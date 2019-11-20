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
    Expression, Aggregation,
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
    private field_geometry: string = this.getConfigValue('field_geometry');
    private size = 1000;
    private METRICS_FLAT_CHAR = '_';
    private AGGREGATION_MODELS = 'aggregationmodels';

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
        this.currentGeohashList = [];
        this.maxValueGeoHash = 0;
        if (this.zoom < this.zoomLevelForTestCount) {
            this.aggregation = this.getConfigValue(this.AGGREGATION_MODELS);
            this.geojsondata.features = [];
            return this.fetchDataGeohashGeoaggregate(this.geohashList);
        } else if (this.zoom >= this.zoomLevelForTestCount) {
            const pwithin = this.mapExtend[1] + ',' + this.mapExtend[2] + ',' + this.mapExtend[3] + ',' + this.mapExtend[0];
            // test for count with aggregation geoagreate interval 1 metrics cadinalitty sur le champs
            const countFilter = this.getFilterForCount(pwithin);
            this.addFilter(countFilter, this.additionalFilter);
            const newCount = this.getTopoCardinality(this.field_cardinality, this.field_geometry, countFilter);
            if (newCount) {
                return newCount.pipe(flatMap(
                    feat => {
                        const flattenedFieldCardinality = this.field_cardinality.replace('.', this.METRICS_FLAT_CHAR);
                        this.size = feat.map(f => <number>f.properties[flattenedFieldCardinality + '_cardinality_'])
                            .reduce((a, b) => a + b, 0);
                        if (this.size <= this.nbMaxFeatureForCluster) {
                            // AGG TOPO
                            this.geojsondata.features = [];
                            this.aggregation = this.topoAggregation;
                            const topoGeohashGeoFilter: Filter = {
                                f: [[{
                                    field: this.aggregationField,
                                    op: Expression.OpEnum.Within,
                                    value: pwithin.trim()
                                }]]
                            };
                            this.addFilter(topoGeohashGeoFilter, this.additionalFilter);
                            return this.fetchTopoDataGeohashGeoaggregate(this.geohashList, topoGeohashGeoFilter);
                        } else {
                            // Classique AGG geohash
                            this.geojsondata.features = [];
                            this.aggregation = this.getConfigValue(this.AGGREGATION_MODELS);
                            return this.fetchDataGeohashGeoaggregate(this.geohashList);
                        }
                    }));
            }
        }
    }
    public computeData(data: any): any[] {
        return this.computeDataGeohashGeoaggregate(data);
    }

    public setData(data: any) {
        return this.setDataGeohashGeoaggregate(data);
    }

    public fetchDataGeohashGeoaggregate(geohashList: Array<string>): Observable<FeatureCollection> {
        return this.fetchTopoDataGeohashGeoaggregate(geohashList, this.additionalFilter);
    }

    public fetchTopoDataGeohashGeoaggregate(geohashList: Array<string>, filter: Filter): Observable<FeatureCollection> {
        const tabOfGeohash: Array<Observable<FeatureCollection>> = [];
        const aggregations = this.aggregation;
        aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => a.interval.value = this.precision);
        aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Term).map(a => a.size = this.size.toString());
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
                this.isFlat, null, filter);
            tabOfGeohash.push(geoAggregateData);
        });
        return from(tabOfGeohash).pipe(mergeAll());
    }


    /**
    * Function called on onMove event emitted by the mapcomponent output
    */
    public onMove(newMove: OnMoveResult) {
        this.geohashList = newMove.geohash;
        this.zoom = newMove.zoom;
        this.getNbMaxFeatureFromZoom(newMove.zoom);
        const precision = this.getPrecisionFromZoom(newMove.zoom);
        let precisionChanged = false;
        if (precision !== this.precision && this.isGeoaggregateCluster) {
            precisionChanged = true;
            this.precision = precision;
            this.maxValueGeoHash = 0;
            this.geojsondata.features = [];
            this.currentGeohashList = [];
        }
        if (newMove.zoom < this.zoomLevelForTestCount) {
            this.aggregation = this.getConfigValue(this.AGGREGATION_MODELS);
            if (!this.isGeoaggregateCluster) {
                this.geojsondata.features = [];
                this.currentGeohashList = [];
            }
            if (precisionChanged) {
                this.drawGeoaggregateGeohash(this.geohashList);
            } else {
                const newGeohashList = new Array<string>();
                this.geohashList.forEach(geohash => {
                    if (this.currentGeohashList.indexOf(geohash) < 0) {
                        newGeohashList.push(geohash);
                        this.currentGeohashList.push(geohash);
                    }
                });
                if (newGeohashList.length > 0) {
                    this.drawGeoaggregateGeohash(newGeohashList);
                }
            }
            this.mapExtend = newMove.extendForLoad;
        } else if (newMove.zoom >= this.zoomLevelForTestCount) {
            const pwithin = newMove.extendForLoad[1] + ',' + newMove.extendForLoad[2]
                + ',' + newMove.extendForLoad[3] + ',' + newMove.extendForLoad[0];
            // Test for count with aggregation geoagreate interval 1 metrics cadinalitty sur le champs
            const countFilter = this.getFilterForCount(pwithin);
            this.addFilter(countFilter, this.additionalFilter);
            const count = this.getTopoCardinality(this.field_cardinality, this.field_geometry, countFilter);
            if (count) {
                count
                    .subscribe(feat => {
                        const flattenedFieldCardinality = this.field_cardinality.replace('.', this.METRICS_FLAT_CHAR);
                        this.size = feat.map(f => <number>f.properties[flattenedFieldCardinality + '_cardinality_'])
                            .reduce((a, b) => a + b, 0);
                        if (this.size <= this.nbMaxFeatureForCluster) {
                            this.aggregation = this.topoAggregation;
                            this.currentGeohashList = [];
                            if (this.isGeoaggregateCluster) {
                                this.geojsondata.features = [];
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
                                const topoGeoaggregateGeohashFilter: Filter = {
                                    f: [[{
                                        field: this.aggregationField,
                                        op: Expression.OpEnum.Within,
                                        value: pwithin.trim()
                                    }]]
                                };
                                this.addFilter(topoGeoaggregateGeohashFilter, this.additionalFilter);
                                this.drawTopoGeoaggregateGeohash(newGeohashList, topoGeoaggregateGeohashFilter);
                            }
                        } else {
                            this.aggregation = this.getConfigValue(this.AGGREGATION_MODELS);
                            if (!this.isGeoaggregateCluster) {
                                this.geojsondata.features = [];
                                this.currentGeohashList = [];
                            }
                            if (precisionChanged) {
                                this.drawGeoaggregateGeohash(this.geohashList);

                            } else {
                                const newGeohashList = new Array<string>();
                                this.geohashList.forEach(geohash => {
                                    if (this.currentGeohashList.indexOf(geohash) < 0) {
                                        newGeohashList.push(geohash);
                                        this.currentGeohashList.push(geohash);
                                    }
                                });
                                if (newGeohashList.length > 0) {
                                    this.drawGeoaggregateGeohash(newGeohashList);
                                }
                            }
                        }
                        this.mapExtend = newMove.extendForLoad;
                    });
            }
        }
    }

    public drawTopoGeoaggregateGeohash(geohashList: Array<string>, filter: Filter) {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        this.fetchTopoDataGeohashGeoaggregate(geohashList, filter)
            .pipe(
                map(f => this.computeDataGeohashGeoaggregate(f)),
                map(f => this.setDataGeohashGeoaggregate(f)),
                finalize(() => {
                    if (this.fetchType === fetchType.geohash) {
                        this.geojsondata.features.forEach(f => {
                            f.properties['point_count_normalize'] = f.properties.point_count / this.maxValueGeoHash * 100;
                        });
                    }
                    this.redrawTile.next(true);
                    this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                })
            )
            .subscribe(data => data);
    }

    public computeDataGeohashGeoaggregate(featureCollection: FeatureCollection): Array<any> {
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
    public setDataGeohashGeoaggregate(features: Array<any>): any {
        features.forEach(f => this.geojsondata.features.push(f));
        this.aggregation.filter(agg => agg.type === Aggregation.TypeEnum.Term).map(a => this.isGeoaggregateCluster = false);
        this.aggregation.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => this.isGeoaggregateCluster = true);
        return features;
    }

    private getTopoCardinality(collectField: string, geometryField: string, filter: Filter): Observable<Feature[]> {
        const aggregationsMetrics = new Array<Aggregation>();
        const metrics = new Array<Metric>();
        const metric: Metric = {
            collect_field: collectField,
            collect_fct: Metric.CollectFctEnum.CARDINALITY
        };
        metrics.push(metric);
        const aggregationMetric: Aggregation = {
            type: Aggregation.TypeEnum.Geohash,
            field: geometryField,
            interval: {
                value: 1
            },
            metrics
        };
        aggregationsMetrics.push(aggregationMetric);
        const features: Observable<Feature[]> = this.collaborativeSearcheService
            .resolveButNotFeatureCollection([projType.geoaggregate, aggregationsMetrics],
                this.collaborativeSearcheService.collaborations, true, '',
                filter)
            .pipe(map(data => data.features));
        return features;
    }
}
