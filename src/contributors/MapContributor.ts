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

import { Observable, Subject } from 'rxjs';
import { map, finalize, flatMap, mergeAll } from 'rxjs/operators';

import {
    CollaborativesearchService, Contributor,
    ConfigService, Collaboration, OperationEnum,
    projType, GeohashAggregation, TiledSearch, CollaborationEvent
} from 'arlas-web-core';
import {
    Search, Expression, Hits,
    Aggregation, Projection,
    Filter, FeatureCollection
} from 'arlas-api';
import { OnMoveResult, ElementIdentifier, triggerType } from '../models/models';
import { getElementFromJsonObject } from '../utils/utils';
import { decode_bbox, bboxes } from 'ngeohash';
import jsonSchema from '../jsonSchemas/mapContributorConf.schema.json';

import bbox from '@turf/bbox';
import bboxPolygon from '@turf/bbox-polygon';
import booleanContains from '@turf/boolean-contains';
import { getBounds, tileToString } from './../utils/mapUtils';
import { from } from 'rxjs/observable/from';


export enum geomStrategyEnum {
    bbox,
    centroid,
    first,
    last,
    byDefault,
    geohash
}
export enum fetchType {
    tile,
    geohash
}
export interface Style {
    id: string;
    name: string;
    layerIds: Set<string>;
    geomStrategy?: geomStrategyEnum;
    isDefault?: boolean;
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

    public maxValueGeoHash = 0;
    public zoom = this.getConfigValue('initZoom');
    public tiles: Array<{ x: number, y: number, z: number }> = new Array<{ x: number, y: number, z: number }>();
    public geohashList: Array<string> = bboxes(-90, -180, 90, 180, 1);
    public currentGeohashList: Array<string> = new Array<string>();
    public currentStringedTilesList: Array<string> = new Array<string>();
    public isBbox = false;
    public mapExtend = [90, -180, -90, 180];
    public zoomLevelFullData = this.getConfigValue('zoomLevelFullData');
    public zoomLevelForTestCount = this.getConfigValue('zoomLevelForTestCount');
    public nbMaxFeatureForCluster = this.getConfigValue('nbMaxDefautFeatureForCluster');
    public idFieldName = this.getConfigValue('idFieldName');
    public geomStrategy = this.getConfigValue('geomStrategy');
    public isFlat = this.getConfigValue('isFlat') !== undefined ? this.getConfigValue('isFlat') : true;
    public isGIntersect = false;
    public strategyEnum = geomStrategyEnum;

    public countExtendBus = new Subject<{ count: number, threshold: number }>();

    /**
    /**
    * ARLAS Server Aggregation used to draw the data on small zoom level, define in configuration
    */
    public aggregation: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    public precision;

    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param onRemoveBboxBus  @Output of Angular MapComponent, send true when the rectangle of selection is removed.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        public identifier,
        public onRemoveBboxBus: Subject<boolean>,
        public redrawTile: Subject<boolean>,
        public collaborativeSearcheService: CollaborativesearchService,
        public configService: ConfigService,
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
        this.currentGeohashList = [];
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
            const count: Observable<Hits> = this.collaborativeSearcheService
                .resolveButNotHits([projType.count, {}], this.collaborativeSearcheService.collaborations,
                    this.identifier, this.getFilterForCount(pwithin));
            if (count) {
                return count.pipe(flatMap(c => {
                    this.countExtendBus.next({
                        count: c.totalnb,
                        threshold: this.nbMaxFeatureForCluster
                    });
                    if (c.totalnb <= this.nbMaxFeatureForCluster) {
                        this.geojsondata.features = [];
                        this.fetchType = fetchType.tile;
                        return this.fetchDataTileSearch(this.tiles);
                    } else {
                        this.fetchType = fetchType.geohash;
                        this.geojsondata.features = [];
                        return this.fetchDataGeohashGeoaggregate(this.geohashList);
                    }
                }));
            } else {
                this.countExtendBus.next({
                    count: 0,
                    threshold: this.nbMaxFeatureForCluster
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
    public setGeomStrategy(geomStrategy: string) {
        this.geomStrategy = this.strategyEnum[geomStrategy];
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
        return from([]);
    }

    public getBoundsToFit(elementidentifier: ElementIdentifier): Observable<Array<Array<number>>> {
        const bounddsToFit = getBounds(elementidentifier, this.collaborativeSearcheService);
        return bounddsToFit;
    }

    public switchLayerCluster(style: Style) {
        if (this.strategyEnum[style.geomStrategy].toString() !== this.geomStrategy.toString()) {
            this.geomStrategy = style.geomStrategy;
            if (this.isGeoaggregateCluster) {
                this.geojsondata.features = [];
                this.drawGeoaggregateGeohash(this.currentGeohashList);
            }
        }
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
        const numberOfBbox = newBbox.length;
        const lastBbox = newBbox[numberOfBbox - 1];
        const lastCoord = lastBbox['geometry']['coordinates'][0];
        const north = lastCoord[1][1];
        const west = this.wrap(lastCoord[2][0], -180, 180);
        const south = lastCoord[0][1];
        const east = this.wrap(lastCoord[0][0], -180, 180);
        const last_pwithin = west + ',' + south + ',' + east + ',' + north;
        const lastBboxFeature = bboxPolygon([west, south, east, north]);
        for (let _i = 0; _i < numberOfBbox - 1; _i++) {
            const v = newBbox[_i];
            const coord = v['geometry']['coordinates'][0];
            const n = coord[1][1];
            const w = this.wrap(coord[2][0], -180, 180);
            const s = coord[0][1];
            const e = this.wrap(coord[0][0], -180, 180);
            const pwithin = w + ',' + s + ',' + e + ',' + n;
            const bboxFeature = bboxPolygon([w, s, e, n]);
            const isbboxInclude = booleanContains(lastBboxFeature, bboxFeature);
            const isLastBboxInclude = booleanContains(bboxFeature, lastBboxFeature);
            if (!isbboxInclude && !isLastBboxInclude) {
                pwithinArray.push(pwithin.trim().toLocaleLowerCase());
            }
        }
        pwithinArray.push(last_pwithin.trim().toLocaleLowerCase());
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
                if (newGeohashList.length > 0) {
                    this.drawGeoaggregateGeohash(newGeohashList);
                }
            }
            this.mapExtend = newMove.extendForLoad;
        } else if (newMove.zoom >= this.zoomLevelForTestCount) {
            const pwithin = newMove.extendForLoad[1] + ',' + newMove.extendForLoad[2]
                + ',' + newMove.extendForLoad[3] + ',' + newMove.extendForLoad[0];
            const count: Observable<Hits> = this.collaborativeSearcheService
                .resolveButNotHits([projType.count, {}], this.collaborativeSearcheService.collaborations,
                    this.identifier, this.getFilterForCount(pwithin));
            if (count) {
                count.subscribe(value => {
                    this.countExtendBus.next({
                        count: value.totalnb,
                        threshold: this.nbMaxFeatureForCluster
                    });
                    if (value.totalnb <= this.nbMaxFeatureForCluster) {
                        this.fetchType = fetchType.tile;
                        this.currentGeohashList = [];
                        if (this.isGeoaggregateCluster) {
                            this.geojsondata.features = [];
                            this.currentStringedTilesList = [];
                        }
                        const newTilesList = new Array<any>();
                        newMove.tiles.forEach(tile => {
                            if (this.currentStringedTilesList.indexOf(tileToString(tile)) < 0) {
                                newTilesList.push(tile);
                                this.currentStringedTilesList.push(tileToString(tile));
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
                            if (newGeohashList.length > 0) {
                                this.drawGeoaggregateGeohash(newGeohashList);
                            }
                        }
                    }
                    this.mapExtend = newMove.extendForLoad;
                });
            } else {
                this.countExtendBus.next({
                    count: 0,
                    threshold: this.nbMaxFeatureForCluster
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

    public drawSearchTiles(tiles: Array<{ x: number, y: number, z: number }>) {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        this.fetchDataTileSearch(tiles)
            .pipe(
                map(f => this.computeDataTileSearch(f)),
                map(f => this.setDataTileSearch(f)),
                finalize(() => {
                    this.setSelection(null, this.collaborativeSearcheService.getCollaboration(this.identifier));
                    this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                })
            )
            .subscribe(data => data);
    }
    public drawGeoaggregateGeohash(geohashList: Array<string>) {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        this.fetchDataGeohashGeoaggregate(geohashList)
            .pipe(
                map(f => this.computeDataGeohashGeoaggregate(f)),
                map(f => this.setDataGeohashGeoaggregate(f)),
                finalize(() => {
                    this.setSelection(null, this.collaborativeSearcheService.getCollaboration(this.identifier));
                    this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                })
            )
            .subscribe(data => data);
    }

    public fetchDataGeohashGeoaggregate(geohashList: Array<string>): Observable<FeatureCollection> {
        const tabOfGeohash: Array<Observable<FeatureCollection>> = [];
        const aggregations = this.aggregation;
        aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => a.interval.value = this.precision);
        aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => a.fetch_geometry.strategy = this.geomStrategy);
        aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Term).map(a => a.fetch_geometry.strategy = this.geomStrategy);
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
                [projType.geohashgeoaggregate, geohahsAggregation], this.collaborativeSearcheService.collaborations, this.isFlat);
            tabOfGeohash.push(geoAggregateData);
        });
        return from(tabOfGeohash).pipe(mergeAll());
    }

    public computeDataGeohashGeoaggregate(featureCollection: FeatureCollection): Array<any> {
        const featuresResults = [];
        if (featureCollection.features !== undefined) {
            featureCollection.features.forEach(feature => {
                if (this.maxValueGeoHash <= feature.properties.count) {
                    this.maxValueGeoHash = feature.properties.count;
                }
            });
            featureCollection.features.forEach(feature => {
                feature.properties['point_count_normalize'] = feature.properties.count / this.maxValueGeoHash * 100;
                feature.properties['point_count'] = feature.properties.count;
                feature.properties['point_count_abreviated'] = this.intToString(feature.properties.count);
                featuresResults.push(feature);
            });
        }
        return featuresResults;
    }
    public setDataGeohashGeoaggregate(features: Array<any>): any {
        features.forEach(f => this.geojsondata.features.push(f));
        this.isGeoaggregateCluster = true;
        return features;

    }

    public fetchDataTileSearch(tiles: Array<{ x: number, y: number, z: number }>): Observable<FeatureCollection> {
        const tabOfTile: Array<Observable<FeatureCollection>> = [];
        const filter: Filter = {};
        const search: Search = { page: { size: this.nbMaxFeatureForCluster }, form: { flat: this.isFlat } };
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
                [projType.tiledgeosearch, tiledSearch], this.collaborativeSearcheService.collaborations, this.isFlat,
                null, filter);
            tabOfTile.push(searchResult);
        });
        return from(tabOfTile).pipe(mergeAll());
    }

    public computeDataTileSearch(featureCollection: FeatureCollection): Array<any> {
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
    public setDataTileSearch(features: Array<any>): any {
        features.forEach(f => this.geojsondata.features.push(f));
        this.isGeoaggregateCluster = false;
        return features;
    }
    public getPrecisionFromZoom(zoom: number): number {
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


    public getNbMaxFeatureFromZoom(zoom: number) {
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

    public getFilterForCount(pwithin: string) {
        let filter = {};
        const collaboration = this.collaborativeSearcheService.getCollaboration(this.identifier);
        if (collaboration !== null && collaboration !== undefined) {
            if (collaboration.enabled) {
                let bboxs = [];
                if (this.isGIntersect) {
                    bboxs = collaboration.filter.gintersect[0];
                } else {
                    bboxs = collaboration.filter.pwithin[0];
                }
                filter = {
                    pwithin: [[pwithin.trim()], bboxs]
                };
            } else {
                filter = {
                    pwithin: [[pwithin.trim()]],
                };
            }
        } else {
            filter = {
                pwithin: [[pwithin.trim()]],
            };
        }
        return filter;
    }

    private tileToString(tile: { x: number, y: number, z: number }): string {
        return tile.x.toString() + tile.y.toString() + tile.z.toString();
    }

    private intToString(value: number): string {
        let newValue = value.toString();
        if (value >= 1000) {
            const suffixes = ['', 'k', 'M', 'b', 't'];
            const suffixNum = Math.floor(('' + value).length / 3);
            let shortValue: number;
            for (let precision = 3; precision >= 1; precision--) {
                shortValue = parseFloat((suffixNum !== 0 ? (value / Math.pow(1000, suffixNum)) : value)
                    .toPrecision(precision));
                const dotLessShortValue = (shortValue + '').replace(/[^a-zA-Z 0-9]+/g, '');
                if (dotLessShortValue.length <= 2) { break; }
            }
            let shortNum = shortValue.toString();
            if (shortValue % 1 !== 0) {
               shortNum = shortValue.toFixed(1);
            }
            newValue = shortNum + suffixes[suffixNum];
        }
        return newValue.toString();
    }
}

