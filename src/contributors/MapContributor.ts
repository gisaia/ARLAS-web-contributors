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

import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';

import {
    CollaborativesearchService, Contributor,
    ConfigService, Collaboration, OperationEnum,
    projType, GeohashAggregation, TiledSearch, CollaborationEvent
} from 'arlas-web-core';
import {
    Search, Expression, Hits,
    AggregationResponse, Aggregation, Projection,
    Filter, FeatureCollection, Size
} from 'arlas-api';
import { Action, OnMoveResult, ElementIdentifier, triggerType } from '../models/models';
import { getElementFromJsonObject } from '../utils/utils';
import { decode_bbox, bboxes } from 'ngeohash';
import * as jsonSchema from '../jsonSchemas/mapContributorConf.schema.json';
import { polygon } from '@turf/helpers';
import bbox from '@turf/bbox';

export enum drawType {
    RECTANGLE,
    CIRCLE
}
export enum fetchType {
    tile,
    geohash
}
/**
 * This contributor works with the Angular MapComponent of the Arlas-web-components project.
 * This class make the brigde between the component which displays the data and the
 * collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
 */
export class MapContributor extends Contributor {
    /**
    * Data to display geoaggregate data or search Data, use in MapComponent @Input
    */
    public geojsondata: { type: string, features: Array<any> } = {
        'type': 'FeatureCollection',
        'features': []
    };
    public geojsonbbox: { type: string, features: Array<any> };

    public includeFeaturesFields: Array<string> = this.getConfigValue('includeFeaturesFields');
    public isGeoaggregateCluster = true;
    public fetchType: fetchType = fetchType.geohash;
    public zoomToPrecisionCluster: Array<Array<number>> = this.getConfigValue('zoomToPrecisionCluster');
    public maxPrecision: Array<number> = this.getConfigValue('maxPrecision');
    private maxValueGeoHash = 0;
    private zoom = this.getConfigValue('initZoom');
    private tiles: Array<{ x: number, y: number, z: number }> = new Array<{ x: number, y: number, z: number }>();
    private geohashList: Array<string> = bboxes(-90, -180, 90, 180, 1);
    private currentGeohashList: Array<string> = new Array<string>();
    private currentStringedTilesList: Array<string> = new Array<string>();
    private isBbox = false;
    private mapExtend = [90, -180, -90, 180];
    private zoomLevelFullData = this.getConfigValue('zoomLevelFullData');
    private zoomLevelForTestCount = this.getConfigValue('zoomLevelForTestCount');
    private nbMaxFeatureForCluster = this.getConfigValue('nbMaxDefautFeatureForCluster');
    private idFieldName = this.getConfigValue('idFieldName');
    private drawtype = drawType[this.getConfigValue('drawtype')];
    private isGIntersect = false;
    /**
    /**
    * ARLAS Server Aggregation used to draw the data on small zoom level, define in configuration
    */
    private aggregation: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    private precision;

    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param onRemoveBboxBus  @Output of Angular MapComponent, send true when the rectangle of selection is removed.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        public identifier,
        private onRemoveBboxBus: Subject<boolean>,
        private redrawTile: Subject<boolean>,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        gIntersect?: boolean
    ) {
        super(identifier, configService, collaborativeSearcheService);
        if (this.aggregation !== undefined) {
            this.aggregation.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => this.precision = a.interval.value);
        }
        this.isGIntersect = gIntersect;
    }
    public static getJsonSchema(): Object {
        return jsonSchema;
    }
    public fetchData(collaborationEvent: CollaborationEvent): Observable<FeatureCollection> {
        this.currentStringedTilesList = [];
        if (collaborationEvent.operation.toString() === OperationEnum.remove.toString()) {
            if (collaborationEvent.all || collaborationEvent.id === this.identifier) {
                this.onRemoveBboxBus.next(true);
            }
        }
        this.maxValueGeoHash = 0;
        if (this.zoom < this.zoomLevelForTestCount) {
            this.fetchType = fetchType.geohash;
            this.geojsondata.features = [];
            return this.fetchDataGeohashGeoaggregate(this.geohashList);
        } else if (this.zoom >= this.zoomLevelForTestCount) {
            const pwithin = this.mapExtend[1] + ',' + this.mapExtend[2] + ',' + this.mapExtend[3] + ',' + this.mapExtend[0];
            let filter = {};
            if (!this.isBbox) {
                filter = {
                    pwithin: [[pwithin.trim()]],
                };
            }
            const count: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits([projType.count, {}], '', filter);
            if (count) {
                return count.flatMap(c => {
                    if (c.totalnb <= this.nbMaxFeatureForCluster) {
                        this.geojsondata.features = [];
                        this.fetchType = fetchType.tile;
                        return this.fetchDataTileSearch(this.tiles);
                    } else {
                        this.fetchType = fetchType.geohash;
                        this.geojsondata.features = [];
                        return this.fetchDataGeohashGeoaggregate(this.geohashList);
                    }
                });
            }
        }
    }
    public computeData(data: any): any[] {
        switch (this.fetchType) {
            case fetchType.tile: {
                return this.computeDataTileSearch(data);
            }
            case fetchType.geohash: {
                return this.computeDataGeohashGeoaggregate(data);
            }
        }
    }

    public setGIntersect(active: boolean) {
        this.isGIntersect = active;
    }
    public setDrawType(type: string) {
        this.drawtype = drawType[type];
    }

    public setData(data: any) {
        switch (this.fetchType) {
            case fetchType.tile: {
                return this.setDataTileSearch(data);
            }
            case fetchType.geohash: {
                return this.setDataGeohashGeoaggregate(data);
            }
        }

    }

    public setSelection(data: any, collaboration: Collaboration): any {
        if (this.fetchType === fetchType.geohash) {
            this.geojsondata.features.forEach(feature => {
                feature.properties['point_count_normalize'] = feature.properties.point_count / this.maxValueGeoHash * 100;
            });
        }
        this.redrawTile.next(true);
        if (collaboration !== null) {
            const polygonGeojsons = [];
            let bboxs: any;
            if (this.isGIntersect) {
                bboxs = collaboration.filter.gintersect[0];
            } else {
                bboxs = collaboration.filter.pwithin[0];
            }
            bboxs.forEach(b => {
                const box = b.split(',');
                let coordinates = [];
                if (parseFloat(box[0]) < parseFloat(box[2])) {
                    coordinates = [[
                        [box[2], box[1]],
                        [box[2], box[3]],
                        [box[0], box[3]],
                        [box[0], box[1]],
                        [box[2], box[1]],
                    ]];
                } else {
                    coordinates = [[
                        [(parseFloat(box[2]) + 360).toString(), box[1]],
                        [(parseFloat(box[2]) + 360).toString(), box[3]],
                        [(parseFloat(box[0])).toString(), box[3]],
                        [(parseFloat(box[0])).toString(), box[1]],
                        [(parseFloat(box[2]) + 360).toString(), box[1]]

                    ]];
                }
                const polygonGeojson = {
                    type: 'Feature',
                    properties: {

                    },
                    geometry: {
                        type: 'Polygon',
                        coordinates: coordinates
                    }
                };
                polygonGeojsons.push(polygonGeojson);
            });
            this.geojsonbbox = {
                'type': 'FeatureCollection',
                'features': polygonGeojsons
            };
            this.isBbox = true;
        } else {
            this.geojsonbbox = {
                'type': 'FeatureCollection',
                'features': []
            };
        }
        return Observable.from([]);
    }

    public getBoundsToFit(elementidentifier: ElementIdentifier): Observable<Array<Array<number>>> {
        let searchResult: Observable<Hits>;
        const search: Search = { size: { size: 1 } };
        const expression: Expression = {
            field: elementidentifier.idFieldName,
            op: Expression.OpEnum.Eq,
            value: elementidentifier.idValue
        };
        const filter: Filter = {
            f: [[expression]]
        };
        searchResult = this.collaborativeSearcheService.resolveHits([projType.search, search], '', filter);
        return searchResult.map(h => {
            const geojsonData = getElementFromJsonObject(h.hits[0].data, this.getConfigValue('geometry'));
            const rect = polygon(geojsonData.coordinates);
            const box = bbox(rect);
            const minX = box[0];
            const minY = box[1];
            const maxX = box[2];
            const maxY = box[3];
            return [[minX, minY], [maxX, maxY]];
        });
    }

    public getFeatureToHightLight(elementidentifier: ElementIdentifier) {
        let isleaving = false;
        let id = elementidentifier.idValue;
        if (id.split('-')[0] === 'leave') {
            id = id.split('-')[1];
            isleaving = true;
        }
        return {
            isleaving: isleaving,
            elementidentifier: {
                idFieldName: this.idFieldName,
                idValue: id
            }
        };
    }

    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.map';
    }
    /**
    * @returns Pretty name of contribution.
    */
    public getFilterDisplayName(): string {
        return 'GeoBox';
    }

    public wrap(n: number, min: number, max: number): number {
        const d = max - min;
        const w = ((n - min) % d + d) % d + min;
        return (w === min) ? max : w;
    }

    public onChangeBbox(newBbox: Array<Object>) {

        let filters: Filter;
        const pwithinArray: Array<string> = [];
        newBbox.forEach(v => {
            const coord = v['geometry']['coordinates'][0];
            const north = coord[1][1];
            const west = this.wrap(coord[2][0], -180, 180);
            const south = coord[0][1];
            const east = this.wrap(coord[0][0], -180, 180);
            const pwithin = west + ',' + south + ',' + east + ',' + north;
            pwithinArray.push(pwithin.trim().toLocaleLowerCase());
        });
        if (this.isGIntersect) {
            filters = {
                gintersect: [pwithinArray],
            };
        } else {
            filters = {
                pwithin: [pwithinArray],
            };
        }
        const data: Collaboration = {
            filter: filters,
            enabled: true
        };
        this.isBbox = true;
        this.collaborativeSearcheService.setFilter(this.identifier, data);
    }





    /**
    * Function call on onMove event output component
    */
    public onMove(newMove: OnMoveResult) {

        this.tiles = newMove.tiles;
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
            this.fetchType = fetchType.geohash;
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
                this.drawGeoaggregateGeohash(newGeohashList);
            }
            this.mapExtend = newMove.extendForLoad;
        } else if (newMove.zoom >= this.zoomLevelForTestCount) {
            const pwithin = newMove.extendForLoad[1] + ',' + newMove.extendForLoad[2]
                + ',' + newMove.extendForLoad[3] + ',' + newMove.extendForLoad[0];
            let filter = {};
            if (!this.isBbox) {
                filter = {
                    pwithin: [[pwithin.trim()]],
                };
            }
            const count: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits([projType.count, {}], '', filter);
            if (count) {
                count.subscribe(value => {
                    if (value.totalnb <= this.nbMaxFeatureForCluster) {
                        this.fetchType = fetchType.tile;
                        this.currentGeohashList = [];
                        if (this.isGeoaggregateCluster) {
                            this.geojsondata.features = [];
                            this.currentStringedTilesList = [];
                        }
                        const newTilesList = new Array<any>();
                        newMove.tiles.forEach(tile => {
                            if (this.currentStringedTilesList.indexOf(this.tileToString(tile)) < 0) {
                                newTilesList.push(tile);
                                this.currentStringedTilesList.push(this.tileToString(tile));
                            }
                        });
                        // if new extend is not totaly include in old extend
                        if (newMove.extendForLoad[0] > this.mapExtend[0]
                            || newMove.extendForLoad[2] < this.mapExtend[2]
                            || newMove.extendForLoad[1] < this.mapExtend[1]
                            || newMove.extendForLoad[3] > this.mapExtend[3]
                            || this.isGeoaggregateCluster
                        ) {
                            this.drawSearchTiles(newTilesList);
                        }
                    } else {
                        this.fetchType = fetchType.geohash;
                        this.currentStringedTilesList = [];
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
                            this.drawGeoaggregateGeohash(newGeohashList);
                        }
                    }
                    this.mapExtend = newMove.extendForLoad;
                });
            }
        }
    }
    public onRemoveBbox(isBboxRemoved: boolean) {
        if (isBboxRemoved) {
            this.isBbox = false;
            if (this.collaborativeSearcheService.getCollaboration(this.identifier) !== null) {
                this.collaborativeSearcheService.removeFilter(this.identifier);
            }
        }
    }

    private drawSearchTiles(tiles: Array<{ x: number, y: number, z: number }>) {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        this.fetchDataTileSearch(tiles)
            .map(f => this.computeDataTileSearch(f))
            .map(f => this.setDataTileSearch(f))
            .finally(() => {
                this.setSelection(null, this.collaborativeSearcheService.getCollaboration(this.identifier));
                this.collaborativeSearcheService.ongoingSubscribe.next(-1);
            })
            .subscribe(data => data);
    }
    private drawGeoaggregateGeohash(geohashList: Array<string>) {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        this.fetchDataGeohashGeoaggregate(geohashList)
            .map(f => this.computeDataGeohashGeoaggregate(f))
            .map(f => this.setDataGeohashGeoaggregate(f))
            .finally(() => {
                this.setSelection(null, this.collaborativeSearcheService.getCollaboration(this.identifier));
                this.collaborativeSearcheService.ongoingSubscribe.next(-1);
            }).subscribe(data => data);
    }

    private fetchDataGeohashGeoaggregate(geohashList: Array<string>): Observable<FeatureCollection> {
        const tabOfGeohash: Array<Observable<FeatureCollection>> = [];
        const aggregations = this.aggregation;
        aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => a.interval.value = this.precision);
        const geohashSet = new Set(geohashList);
        geohashSet.forEach(geohash => {
            this.currentGeohashList.push(geohash);

        });

        geohashSet.forEach(geohash => {
            const geohahsAggregation: GeohashAggregation = {
                geohash: geohash,
                aggregations: aggregations
            };
            const geoAggregateData: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNotFeatureCollection(
                [projType.geohashgeoaggregate, geohahsAggregation]);
            tabOfGeohash.push(geoAggregateData);
        });
        return Observable.from(tabOfGeohash).mergeAll();
    }

    private computeDataGeohashGeoaggregate(featureCollection: FeatureCollection): Array<any> {
        const featuresResults = [];
        if (featureCollection.features !== undefined) {
            featureCollection.features.forEach(feature => {
                if (this.maxValueGeoHash <= feature.properties.count) {
                    this.maxValueGeoHash = feature.properties.count;
                }
            });
            const allfeatures: Array<any> = [];
            featureCollection.features.forEach(feature => {
                const box: Array<number> = decode_bbox(feature.properties.geohash);
                const coordinates = [[
                    [box[3], box[2]],
                    [box[3], box[0]],
                    [box[1], box[0]],
                    [box[1], box[2]],
                    [box[3], box[2]],
                ]];
                const polygonGeojson = {
                    type: 'Feature',
                    properties:feature.properties,
                    geometry: {
                        type: 'Polygon',
                        coordinates: coordinates
                    }
                };
                polygonGeojson.properties['point_count_normalize'] = feature.properties.count / this.maxValueGeoHash * 100;
                polygonGeojson.properties['point_count'] = feature.properties.count;
                polygonGeojson.properties['geohash'] = feature.properties.geohash;
                
                feature.properties['point_count_normalize'] = feature.properties.count / this.maxValueGeoHash * 100;
                feature.properties['point_count'] = feature.properties.count;
                if (this.drawtype.toString() === drawType.CIRCLE.toString()) {
                    featuresResults.push(feature);
                } else if (this.drawtype.toString() === drawType.RECTANGLE.toString()) {
                    featuresResults.push(polygonGeojson);
                }
            });
        }
        return featuresResults;
    }
    private setDataGeohashGeoaggregate(features: Array<any>): any {
        features.forEach(f => this.geojsondata.features.push(f));
        this.isGeoaggregateCluster = true;
        return features;

    }

    private fetchDataTileSearch(tiles: Array<{ x: number, y: number, z: number }>): Observable<FeatureCollection> {
        const tabOfTile: Array<Observable<FeatureCollection>> = [];
        const filter: Filter = {};
        const search: Search = { size: { size: this.nbMaxFeatureForCluster } };
        const projection: Projection = {};
        let includes = '';
        let separator = '';
        if (this.includeFeaturesFields !== undefined) {
            this.includeFeaturesFields.forEach(field => {
                if (field !== this.idFieldName) {
                    includes += separator + field;
                    separator = ',';
                }
            });
        }
        projection.includes = this.idFieldName + ',' + includes;
        search.projection = projection;
        tiles.forEach(tile => {
            const tiledSearch: TiledSearch = {
                search: search,
                x: tile.x,
                y: tile.y,
                z: tile.z
            };
            const searchResult: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNotFeatureCollection(
                [projType.tiledgeosearch, tiledSearch],
                null, filter);
            tabOfTile.push(searchResult);
        });
        return Observable.from(tabOfTile).mergeAll();
    }

    private computeDataTileSearch(featureCollection: FeatureCollection): Array<any> {
        const dataSet = new Set(this.geojsondata.features.map(f => {
            if (f.properties !== undefined) {
                return f.properties[this.idFieldName];
            }
        }
        ));
        if (featureCollection.features !== undefined) {
            return featureCollection.features
                .map(f => [f.properties[this.idFieldName], f])
                .filter(f => dataSet.has(f[0]) === false)
                .map(f => f[1]);
        } else {
            return [];
        }
    }
    private setDataTileSearch(features: Array<any>): any {
        features.forEach(f => this.geojsondata.features.push(f));
        this.isGeoaggregateCluster = false;
        return features;
    }
    private getPrecisionFromZoom(zoom: number): number {
        const zoomToPrecisionClusterObject = {};
        const zoomToPrecisionCluster = this.zoomToPrecisionCluster;
        zoomToPrecisionCluster.forEach(triplet => {
            zoomToPrecisionClusterObject[triplet[0]] = [triplet[1], triplet[2]];
        });
        if (zoomToPrecisionClusterObject[Math.ceil(zoom) - 1] !== undefined) {
            const precision = zoomToPrecisionClusterObject[Math.ceil(zoom) - 1][0];
            if (precision !== undefined) {
                return precision;
            } else {
                return this.getConfigValue('maxPrecision')[0];
            }
        } else {
            return this.getConfigValue('maxPrecision')[0];
        }
    }
    private isLatLngInBbox(lat, lng, box) {
        const polyPoints = [[box[2], box[3]], [box[0], box[3]],
        [box[0], box[1]], [box[2], box[1]],
        [box[2], box[3]]];
        const x = lat;
        const y = lng;
        let inside = false;
        for (let i = 0, j = polyPoints.length - 1; i < polyPoints.length; j = i++) {
            const xi = polyPoints[i][0], yi = polyPoints[i][1];
            const xj = polyPoints[j][0], yj = polyPoints[j][1];
            const intersect = ((yi > y) !== (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) { inside = !inside; }
        }
        return inside;
    }

    private getNbMaxFeatureFromZoom(zoom: number) {
        const zoomToNbMaxFeatureForClusterObject = {};
        const zoomToNbMaxFeatureForCluster: Array<Array<number>> = this.getConfigValue('zoomToNbMaxFeatureForCluster');
        zoomToNbMaxFeatureForCluster.forEach(couple => {
            zoomToNbMaxFeatureForClusterObject[couple[0]] = couple[1];
        });
        this.nbMaxFeatureForCluster = zoomToNbMaxFeatureForClusterObject[Math.ceil(zoom) - 1];
        if (this.nbMaxFeatureForCluster === undefined) {
            this.nbMaxFeatureForCluster = this.getConfigValue('nbMaxDefautFeatureForCluster');
        }
    }

    private tileToString(tile: { x: number, y: number, z: number }): string {
        return tile.x.toString() + tile.y.toString() + tile.z.toString();
    }
}
