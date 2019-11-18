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

import { Observable, Subject, generate, from } from 'rxjs';
import { map, finalize, flatMap, mergeAll } from 'rxjs/operators';

import {
    CollaborativesearchService, Contributor,
    ConfigService, Collaboration, OperationEnum,
    projType, GeohashAggregation, TiledSearch, CollaborationEvent
} from 'arlas-web-core';
import {
    Search, Expression, Hits,
    Aggregation, Projection,
    Filter, FeatureCollection, Feature
} from 'arlas-api';
import { OnMoveResult, ElementIdentifier, PageEnum } from '../models/models';
import { appendIdToSort, removePageFromIndex, ASC } from '../utils/utils';
import { bboxes } from 'ngeohash';
import jsonSchema from '../jsonSchemas/mapContributorConf.schema.json';

import bboxPolygon from '@turf/bbox-polygon';
import booleanContains from '@turf/boolean-contains';
import { getBounds, tileToString, truncate, isClockwise } from './../utils/mapUtils';

import * as helpers from '@turf/helpers';
import { stringify, parse } from 'wellknown';
import { mix } from 'tinycolor2';


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

export enum dataMode {
    simple,
    dynamic
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
    public geojsondraw: { type: string, features: Array<any> } = {
        'type': 'FeatureCollection',
        'features': []
    };

    /** Additional Arlas filter to add the BBOX and filter comming from Collaborations*/
    protected additionalFilter: Filter;
    public includeFeaturesFields: Array<string> = this.getConfigValue('includeFeaturesFields');
    public generateFeaturesColors: boolean = this.getConfigValue('generateFeatureColors');
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
    public mapExtend = [90, -180, -90, 180];
    public zoomLevelFullData = this.getConfigValue('zoomLevelFullData');
    public zoomLevelForTestCount = this.getConfigValue('zoomLevelForTestCount');
    public nbMaxFeatureForCluster = this.getConfigValue('nbMaxDefautFeatureForCluster');
    public idFieldName: string = this.getConfigValue('idFieldName');
    public geomStrategy = this.getConfigValue('geomStrategy');
    public isFlat = this.getConfigValue('isFlat') !== undefined ? this.getConfigValue('isFlat') : true;
    public drawPrecision = this.getConfigValue('drawPrecision') !== undefined ? this.getConfigValue('drawPrecision') : 6;

    public geoQueryOperation: Expression.OpEnum = Expression.OpEnum.Within;
    public geoQueryField: string;
    public returned_geometries = '';

    public geoPointFields = new Array<string>();
    public geoShapeFields = new Array<string>();
    public strategyEnum = geomStrategyEnum;

    public countExtendBus = new Subject<{ count: number, threshold: number }>();
    public saturationWeight = 0.5;
    /**
     * By default the contributor computes the data in a dynamic way (`Dynamic mode`): it switches between
     * `clusters` and `features` mode according to the zoom level and the number of features.
     * In the `Simple mode` the contributor returns just the features (with a given sort and size and an optional filter)
     */
    public dataMode: dataMode = dataMode.dynamic;
    /**
     * A filter that is taken into account when fetching features and that is not included in the global collaboration.
     * It's used in `Simple mode` only.
     */
    public expressionFilter: Expression;
    /**
     * Number of features fetched in a geosearch request. It's used in `Simple mode` only. Default to 100.
     */
    public searchSize = 100;
    /**
     * comma seperated field names that sort the features. Order matters. It's used in `Simple mode` only.
    */
    public searchSort = '';
    /**
     * ARLAS Server Aggregation used to aggregate features and display them in `clusters` mode. Defined in configuration
     */
    public aggregation: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    public precision;

    public defaultCentroidField: string;
    public aggregationField: string;

    public redrawTile: Subject<boolean> = new Subject<boolean>();

    /** CONSTANTS */
    private NEXT_AFTER = '_nextAfter';
    private PREVIOUS_AFTER = '_previousAfter';
    private FLAT_CHAR = '_';

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
        public configService: ConfigService
    ) {
        super(identifier, configService, collaborativeSearcheService);

        this.collaborativeSearcheService.describe(collaborativeSearcheService.collection)
            .subscribe(collection => {
                const fields = collection.properties;
                Object.keys(fields).forEach(fieldName => {
                    this.getFieldProperties(fields, fieldName);
                });
                this.geoQueryField = collection.params.centroid_path;
                this.defaultCentroidField = collection.params.centroid_path;
                this.returned_geometries = collection.params.geometry_path;
                if (this.aggregation !== undefined) {
                    this.aggregation.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => this.precision = a.interval.value);
                    this.aggregation.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => this.aggregationField = a.field);
                } else {
                    this.aggregationField = collection.params.centroid_path;
                }
            });
    }
    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    public getAdditionalFilter(): Filter {
        return this.additionalFilter;
    }
    public setAdditionalFilter(value: Filter) {
        this.additionalFilter = value;
    }

    public fetchData(collaborationEvent?: CollaborationEvent): Observable<any> {
        switch (this.dataMode) {
            case dataMode.simple: {
                return this.fetchDataSimpleMode(collaborationEvent);
            }
            case dataMode.dynamic: {
                return this.fetchDataDynamicMode(collaborationEvent);
            }
        }
    }

    public fetchDataSimpleMode(collaborationEvent: CollaborationEvent): Observable<FeatureCollection> {
        this.geojsondata.features = [];
        return this.fetchDataGeoSearch(this.includeFeaturesFields, this.searchSort);
    }

    public fetchDataDynamicMode(collaborationEvent: CollaborationEvent): Observable<FeatureCollection> {
        this.currentStringedTilesList = [];
        this.currentGeohashList = [];
        this.maxValueGeoHash = 0;
        if (this.zoom < this.zoomLevelForTestCount) {
            this.fetchType = fetchType.geohash;
            this.geojsondata.features = [];
            return this.fetchDataGeohashGeoaggregate(this.geohashList);
        } else if (this.zoom >= this.zoomLevelForTestCount) {
            const pwithin = this.mapExtend[1] + ',' + this.mapExtend[2] + ',' + this.mapExtend[3] + ',' + this.mapExtend[0];
            const countFilter = this.getFilterForCount(pwithin);
            this.addFilter(countFilter, this.additionalFilter);
            const count: Observable<Hits> = this.collaborativeSearcheService
                .resolveButNotHits([projType.count, {}], this.collaborativeSearcheService.collaborations,
                    this.identifier, countFilter);
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

    /**
     * Sets the query operation to apply (`within`, `intersects`, `notintersects`, `notwithin`)
     * @param geoQueryOperation
     */
    public setGeoQueryOperation(geoQueryOperation: string) {
        switch (geoQueryOperation.toLowerCase()) {
            case 'within':
                this.geoQueryOperation = Expression.OpEnum.Within;
                break;
            case 'intersects':
                this.geoQueryOperation = Expression.OpEnum.Intersects;
                break;
            case 'notwithin':
                this.geoQueryOperation = Expression.OpEnum.Notwithin;
                break;
            case 'notintersects':
                this.geoQueryOperation = Expression.OpEnum.Notintersects;
                break;
        }
    }

    /**
     * Sets the geometry/point field to query
     * @param geoQueryField
     */
    public setGeoQueryField(geoQueryField: string) {
        this.geoQueryField = geoQueryField;
    }

    /**
     * Sets the geometries to render on the map
     * @param returned_geometries comma separated geometry/point fields paths
     */
    public setReturnedGeometries(returned_geometries: string) {
        this.returned_geometries = returned_geometries;
    }

    /**
     * Sets the point field on which geoaggregation is applied
     * @param geoAggregateField
     */
    public setGeoAggregateGeomField(geoAggregateField: string) {
        const aggregations = this.aggregation;
        aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => a.field = geoAggregateField);
        this.aggregation = aggregations;
        this.aggregationField = geoAggregateField;
    }

    /**
     * Sets the strategy of geoaggregation (`bbox`, `centroid`, `first`, `last`, `byDefault`, `geohash`)
     * @param geomStrategy
     */
    public setGeomStrategy(geomStrategy: geomStrategyEnum) {
        this.geomStrategy = geomStrategy;
    }

    /**
     * fetches the data, sets it and sets the selection after changing the geometry/path to query
     */
    public onChangeGeometries() {
        this.geojsondata = {
            'type': 'FeatureCollection',
            'features': []
        };
        this.updateFromCollaboration(null);
    }

    /**
     * Applies the geoQueryOperation
     */
    public onChangeGeoQuery() {
        const collaboration: Collaboration = this.collaborativeSearcheService.getCollaboration(this.identifier);
        if (collaboration !== null) {
            switch (this.geoQueryOperation) {
                case Expression.OpEnum.Notintersects:
                case Expression.OpEnum.Notwithin:
                    const andFilter: Expression[][] = [];
                    collaboration.filter.f.forEach((expressions: Expression[]) => {
                        expressions.forEach((exp: Expression) => {
                            exp.field = this.geoQueryField;
                            exp.op = this.geoQueryOperation;
                            andFilter.push([exp]);
                        });
                    });
                    const andCollaboration: Collaboration = {
                        filter: {
                            f: andFilter
                        },
                        enabled: collaboration.enabled
                    };
                    this.collaborativeSearcheService.setFilter(this.identifier, andCollaboration);
                    break;
                case Expression.OpEnum.Intersects:
                case Expression.OpEnum.Within:
                    const orFilter: Expression[][] = [];
                    const multiExpressions: Expression[] = [];
                    collaboration.filter.f.forEach((expressions: Expression[]) => {
                        expressions.forEach((exp: Expression) => {
                            exp.field = this.geoQueryField;
                            exp.op = this.geoQueryOperation;
                            multiExpressions.push(exp);
                        });
                    });
                    orFilter.push(multiExpressions);
                    const orCollaboration: Collaboration = {
                        filter: {
                            f: orFilter
                        },
                        enabled: collaboration.enabled
                    };
                    this.collaborativeSearcheService.setFilter(this.identifier, orCollaboration);
                    break;
            }
        }
    }

    public getReturnedGeometries(returnedGeometries: string): Set<string> {
        const returnedGeometriesSet = new Set<string>(returnedGeometries.split(','));
        return returnedGeometriesSet;
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
            this.geojsondata.features.forEach(f => {
                f.properties['point_count_normalize'] = f.properties.point_count / this.maxValueGeoHash * 100;
            });
        }
        this.redrawTile.next(true);
        if (collaboration !== null) {
            if (collaboration.filter && collaboration.filter.f) {
                const operation = collaboration.filter.f[0][0].op;
                const field = collaboration.filter.f[0][0].field;
                this.setGeoQueryField(field);
                this.setGeoQueryOperation(operation.toString());
            }
            const polygonGeojsons = [];
            const aois: string[] = [];
            collaboration.filter.f.forEach(exprs => {
                exprs.forEach(expr => {
                    if (expr.op === this.geoQueryOperation) {
                        aois.push(expr.value);
                    }
                });
            });
            if (aois.length > 0) {
                let index = 1;
                aois.forEach(aoi => {
                    if (aoi.indexOf('POLYGON') < 0) {
                        /** BBOX mode */
                        const box = aoi.split(',');
                        let coordinates = [];
                        if (parseFloat(box[0]) < parseFloat(box[2])) {
                            coordinates = [[
                                [parseFloat(box[2]), parseFloat(box[1])],
                                [parseFloat(box[2]), parseFloat(box[3])],
                                [parseFloat(box[0]), parseFloat(box[3])],
                                [parseFloat(box[0]), parseFloat(box[1])],
                                [parseFloat(box[2]), parseFloat(box[1])]
                            ]];
                        } else {
                            coordinates = [[
                                [(parseFloat(box[2]) + 360), parseFloat(box[1])],
                                [(parseFloat(box[2]) + 360), parseFloat(box[3])],
                                [(parseFloat(box[0])), parseFloat(box[3])],
                                [(parseFloat(box[0])), parseFloat(box[1])],
                                [(parseFloat(box[2]) + 360), parseFloat(box[1])]
                            ]];
                        }
                        const polygonGeojson = {
                            type: 'Feature',
                            properties: {
                                source: 'bbox',
                                arlas_id: index
                            },
                            geometry: {
                                type: 'Polygon',
                                coordinates: coordinates
                            }
                        };
                        polygonGeojsons.push(polygonGeojson);
                    } else {
                        /** WKT mode */
                        const geojsonWKT = parse(aoi);
                        const feature = {
                            type: 'Feature',
                            geometry: geojsonWKT,
                            properties: {
                                source: 'wkt',
                                arlas_id: index
                            }
                        };
                        polygonGeojsons.push(feature);
                    }
                    index = index + 1;
                });
                this.geojsondraw = {
                    'type': 'FeatureCollection',
                    'features': polygonGeojsons
                };
            } else {
                this.geojsondraw = {
                    'type': 'FeatureCollection',
                    'features': []
                };
            }
        } else {
            this.geojsondraw = {
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
                this.fetchType = fetchType.geohash;
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
        return 'Area Of Interest';
    }

    public wrap(n: number, min: number, max: number): number {
        const d = max - min;
        const w = ((n - min) % d + d) % d + min;
        const factor = Math.pow(10, this.drawPrecision);
        return (w === min) ? max : Math.round(w * factor) / factor;
    }

    /**
     * Runs when a geometry (bbox, polygon, ...) is drawn, removed or changed
     * @beta This method is being tested. It will replace `onChangeBbox` and `onRemoveBbox`
     * @param fc FeatureCollection object
     */
    public onChangeAoi(fc: helpers.FeatureCollection) {
        let filters: Filter;
        const geoFilter: Array<string> = new Array();
        fc = truncate(fc, { precision: this.drawPrecision });
        if (fc.features.length > 0) {
            if (fc.features.filter(f => f.properties.source === 'bbox').length > 0) {
                const bboxs: Array<string> = this.getBboxsForQuery(fc.features
                    .filter(f => f.properties.source === 'bbox'));
                bboxs.forEach(f => geoFilter.push(f));
            }
            const features = new Array<any>();
            fc.features.filter(f => f.properties.source !== 'bbox').forEach(f => {
                if (isClockwise((<any>(f.geometry)).coordinates[0])) {
                    features.push(f);
                } else {
                    const list = [];
                    (<any>(f.geometry)).coordinates[0]
                        .forEach((c) => list.push(c));
                    const reverseList = list.reverse();
                    (<any>(f.geometry)).coordinates[0] = reverseList;
                    features.push(f);
                }
            });
            features.map(f => stringify(f.geometry)).forEach(wkt => geoFilter.push(wkt));
            switch (this.geoQueryOperation) {
                case Expression.OpEnum.Notintersects:
                case Expression.OpEnum.Notwithin:
                    const andFilter = [];
                    geoFilter.map(p => {
                        return {
                            field: this.geoQueryField,
                            op: this.geoQueryOperation,
                            value: p
                        };
                    }).forEach(exp => {
                        andFilter.push([exp]);
                    });
                    filters = {
                        f: andFilter
                    };
                    break;
                case Expression.OpEnum.Intersects:
                case Expression.OpEnum.Within:
                    filters = {
                        f: [geoFilter.map(p => {
                            return {
                                field: this.geoQueryField,
                                op: this.geoQueryOperation,
                                value: p
                            };
                        })]
                    };
                    break;
            }
            const data: Collaboration = {
                filter: filters,
                enabled: true
            };
            this.collaborativeSearcheService.setFilter(this.identifier, data);

        } else {
            if (this.collaborativeSearcheService.getCollaboration(this.identifier) !== null) {
                this.collaborativeSearcheService.removeFilter(this.identifier);
            }
        }
    }

    public onMove(newMove: OnMoveResult) {
        switch (this.dataMode) {
            case dataMode.simple: {
                this.onMoveSimpleMode(newMove);
                break;
            }
            case dataMode.dynamic: {
                this.onMoveDynamicMode(newMove);
                break;
            }
        }
    }

    public onMoveSimpleMode(newMove: OnMoveResult) {
        this.mapExtend = newMove.extendForLoad;
        this.drawGeoSearch();
    }

    /**
    * Function called on onMove event output component
    */
    public onMoveDynamicMode(newMove: OnMoveResult) {

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
            const countFilter = this.getFilterForCount(pwithin);
            this.addFilter(countFilter, this.additionalFilter);
            const count: Observable<Hits> = this.collaborativeSearcheService
                .resolveButNotHits([projType.count, {}], this.collaborativeSearcheService.collaborations,
                    this.identifier, countFilter);
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


    public drawGeoSearch(fromParam?: number, appendId?: boolean) {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        const sort = appendId ? appendIdToSort(this.searchSort, ASC, this.idFieldName) : this.searchSort;
        this.fetchDataGeoSearch(this.includeFeaturesFields, sort, null, null, fromParam)
            .pipe(
                map(f => this.computeDataTileSearch(f)),
                map(f => this.setDataTileSearch(f)),
                finalize(() => {
                    this.redrawTile.next(true);
                    this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                })
            )
            .subscribe(data => data);
    }

    public drawSearchTiles(tiles: Array<{ x: number, y: number, z: number }>) {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        this.fetchDataTileSearch(tiles)
            .pipe(
                map(f => this.computeDataTileSearch(f)),
                map(f => this.setDataTileSearch(f)),
                finalize(() => {
                    if (tiles.length > 0) {
                        this.redrawTile.next(true);
                    }
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
                [projType.geohashgeoaggregate, geohahsAggregation], this.collaborativeSearcheService.collaborations,
                this.isFlat, null, this.additionalFilter);
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
    /**
     * Get the previous/following set of data.
     * @param reference the last/first feature returned  and from which next/previous data is fetched.
     * @param sort comma separated field names on which feature are sorted.
     * @param whichPage Whether to fetch next or previous set.
     * @param maxPages The maxumum number of set features.
     */
    public getPage(reference: Map<string, string | number | Date>, sort: string, whichPage: PageEnum, maxPages: number): void {
        let after;
        if (whichPage === PageEnum.previous) {
            after = reference.get(this.PREVIOUS_AFTER);
        } else {
            after = reference.get(this.NEXT_AFTER);
        }
        const sortWithId = appendIdToSort(sort, ASC, this.idFieldName);
        if (after !== undefined) {
            this.fetchDataGeoSearch(this.includeFeaturesFields, sortWithId, after, whichPage)
                .pipe(
                    map(f => (f && f.features) ? f.features : []),
                    map(f => {
                        if (maxPages !== -1) {
                            (whichPage === PageEnum.next) ? f.forEach(d => { this.geojsondata.features.push(d); })
                                : f.reverse().forEach(d => { this.geojsondata.features.unshift(d); });
                            (whichPage === PageEnum.next) ? removePageFromIndex(0, this.geojsondata.features, this.searchSize, maxPages) :
                                removePageFromIndex(this.geojsondata.features.length - this.searchSize, this.geojsondata.features,
                                    this.searchSize, maxPages);
                        } else {
                            if (whichPage === PageEnum.next) {
                                f.forEach(d => { this.geojsondata.features.push(d); });
                            }
                        }
                        this.redrawTile.next(true);
                    })
                ).subscribe(data => data);
        }
    }
    /**
     * Fetches the data for the `Simple mode`
     * @param includeFeaturesFields properties to include in geojson features
     * @param sort comma separated field names on which feature are sorted.
     * @param afterParam comma seperated field values from which next/previous data is fetched
     * @param whichPage Whether to fetch next or previous set.
     * @param fromParam (page.from in arlas api) an offset from which fetching hits starts. It's ignored if `afterParam` is set.
     */
    public fetchDataGeoSearch(includeFeaturesFields: Array<string>, sort: string,
        afterParam?: string, whichPage?: PageEnum, fromParam?): Observable<FeatureCollection> {
        const pwithin = this.mapExtend[1] + ',' + this.mapExtend[2]
            + ',' + this.mapExtend[3] + ',' + this.mapExtend[0];
        const filter: Filter = this.getFilterForCount(pwithin);
        if (this.expressionFilter !== undefined) {
            filter.f.push([this.expressionFilter]);
        }
        this.addFilter(filter, this.additionalFilter);
        const search: Search = { page: { size: this.searchSize, sort: sort }, form: { flat: this.isFlat } };
        if (afterParam) {
            if (whichPage === PageEnum.next) {
                search.page.after = afterParam;
            } else {
                search.page.before = afterParam;
            }
        } else {
            if (fromParam !== undefined) {
                search.page.from = fromParam;
            }
        }

        const projection: Projection = {};
        let includes = '';
        let separator = '';
        if (includeFeaturesFields !== undefined) {
            includeFeaturesFields.forEach(field => {
                if (field !== this.idFieldName) {
                    includes += separator + field;
                    separator = ',';
                }
            });
        }
        projection.includes = this.idFieldName + ',' + includes;
        search.projection = projection;
        separator = '';
        search.returned_geometries = this.returned_geometries;
        return this.collaborativeSearcheService.resolveButNotFeatureCollection(
            [projType.geosearch, search], this.collaborativeSearcheService.collaborations, this.isFlat,
            null, filter);

    }

    public fetchDataTileSearch(tiles: Array<{ x: number, y: number, z: number }>): Observable<FeatureCollection> {
        const tabOfTile: Array<Observable<FeatureCollection>> = [];
        let filter: Filter = {};
        if (this.expressionFilter !== undefined) {
            filter = {
                f: [[this.expressionFilter]]
            };
        }
        this.addFilter(filter, this.additionalFilter);
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
        separator = '';
        search.returned_geometries = this.returned_geometries;
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
        const idProperty = this.isFlat ? this.idFieldName.replace(/\./g, this.FLAT_CHAR) : this.idFieldName;
        const dataSet = new Set(this.geojsondata.features.map(f => {
            if (f.properties !== undefined) {
                return f.properties[idProperty].concat('_').concat(f.properties['geometry_path']);
            }
        }));
        if (featureCollection.features !== undefined) {
            return featureCollection.features
                .map(f => this.setFeatureColor(f))
                .map(f => [f.properties[idProperty].concat('_').concat(f.properties['geometry_path']), f])
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

    public getFilterForCount(extent: string): Filter {
        // west, south, east, north
        const extentTab = extent.trim().split(',');
        const west = extentTab[0];
        const east = extentTab[2];
        let finalExtent = [extent.trim()];
        if (parseFloat(west) > parseFloat(east)) {
            finalExtent = [];
            const firstExtent = extentTab[0] + ',' + extentTab[1] + ',' + '180' + ',' + extentTab[3];
            const secondExtent = '-180' + ',' + extentTab[1] + ',' + extentTab[2] + ',' + extentTab[3];
            finalExtent.push(firstExtent.trim());
            finalExtent.push(secondExtent.trim());
        }
        let filter: Filter = {};
        const collaboration = this.collaborativeSearcheService.getCollaboration(this.identifier);
        if (collaboration !== null && collaboration !== undefined) {
            if (collaboration.enabled) {
                const aois: string[] = [];
                collaboration.filter.f.forEach(exprs => {
                    exprs.forEach(expr => {
                        if (expr.op === this.geoQueryOperation) {
                            aois.push(expr.value);
                        }
                    });
                });
                let geoQueryOperationForCount;
                switch (this.geoQueryOperation) {
                    case Expression.OpEnum.Notintersects:
                    case Expression.OpEnum.Notwithin:
                        if (this.geoQueryOperation === Expression.OpEnum.Intersects
                            || this.geoQueryOperation === Expression.OpEnum.Notintersects) {
                            geoQueryOperationForCount = Expression.OpEnum.Intersects;
                        }
                        if (this.geoQueryOperation === Expression.OpEnum.Within || this.geoQueryOperation === Expression.OpEnum.Notwithin) {
                            geoQueryOperationForCount = Expression.OpEnum.Within;
                        }
                        const andFilter: Array<Array<Expression>> = [];
                        aois.map(p => {
                            return {
                                field: this.geoQueryField,
                                op: this.geoQueryOperation,
                                value: p
                            };
                        }).forEach(exp => {
                            andFilter.push([exp]);
                        });
                        andFilter.push([{
                            field: this.geoQueryField,
                            op: geoQueryOperationForCount,
                            value: finalExtent[0]
                        }, {
                            field: this.geoQueryField,
                            op: geoQueryOperationForCount,
                            value: finalExtent[1]
                        }]);
                        filter = {
                            f: andFilter
                        };
                        break;
                    case Expression.OpEnum.Intersects:
                    case Expression.OpEnum.Within:
                        filter = {
                            f: [aois.map(p => {
                                return {
                                    field: this.geoQueryField,
                                    op: this.geoQueryOperation,
                                    value: p
                                };
                            }), [{
                                field: this.geoQueryField,
                                op: this.geoQueryOperation,
                                value: finalExtent[0]
                            }, {
                                field: this.geoQueryField,
                                op: this.geoQueryOperation,
                                value: finalExtent[1]
                            }
                            ]]
                        };
                }
            } else {
                filter = {
                    f: [[{
                        field: this.defaultCentroidField,
                        op: Expression.OpEnum.Within,
                        value: finalExtent[0]
                    }, {
                        field: this.defaultCentroidField,
                        op: Expression.OpEnum.Within,
                        value: finalExtent[1]
                    }]]
                };
            }
        } else {
            filter = {
                f: [[{
                    field: this.defaultCentroidField,
                    op: Expression.OpEnum.Within,
                    value: finalExtent[0]
                }, {
                    field: this.defaultCentroidField,
                    op: Expression.OpEnum.Within,
                    value: finalExtent[1]
                }
                ]]
            };
        }
        return filter;
    }

    /**
     * adds the second filter to the first filter
     * @param filter filter to enrich
     * @param additionalFilter filter to add to the first filter
     */
    protected addFilter(filter: Filter, additionalFilter: Filter): void {
        if (additionalFilter) {
            if (additionalFilter.f) {
                if (!filter.f) {
                    filter.f = [];
                }
                additionalFilter.f.forEach(additionalF => {
                    filter.f.push(additionalF);
                });
            }
            if (additionalFilter.q) {
                if (!filter.q) {
                    filter.q = [];
                }
                additionalFilter.q.forEach(additionalQ => {
                    filter.q.push(additionalQ);
                });
            }
        }
    }

    private getBboxsForQuery(newBbox: Array<Object>) {
        const bboxArray: Array<string> = [];
        const numberOfBbox = newBbox.length;
        const lastBbox = newBbox[numberOfBbox - 1];
        const lastCoord = lastBbox['geometry']['coordinates'][0];
        const north = lastCoord[1][1];
        const west = this.wrap(lastCoord[2][0], -180, 180);
        const south = lastCoord[0][1];
        const east = this.wrap(lastCoord[0][0], -180, 180);
        const last_bbox = west + ',' + south + ',' + east + ',' + north;
        const lastBboxFeature = bboxPolygon([west, south, east, north]);
        for (let _i = 0; _i < numberOfBbox - 1; _i++) {
            const v = newBbox[_i];
            const coord = v['geometry']['coordinates'][0];
            const n = coord[1][1];
            const w = this.wrap(coord[2][0], -180, 180);
            const s = coord[0][1];
            const e = this.wrap(coord[0][0], -180, 180);
            const box = w + ',' + s + ',' + e + ',' + n;
            const bboxFeature = bboxPolygon([w, s, e, n]);
            const isbboxInclude = booleanContains(lastBboxFeature, bboxFeature);
            const isLastBboxInclude = booleanContains(bboxFeature, lastBboxFeature);
            if (!isbboxInclude && !isLastBboxInclude) {
                bboxArray.push(box.trim().toLocaleLowerCase());
            }
        }
        bboxArray.push(last_bbox.trim().toLocaleLowerCase());
        return bboxArray;
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

    private getFieldProperties(fieldList: any, fieldName: string, parentPrefix?: string) {
        if (fieldList[fieldName].type === 'OBJECT') {
            const subFields = fieldList[fieldName].properties;
            if (subFields) {
                Object.keys(subFields).forEach(subFieldName => {
                    this.getFieldProperties(subFields, subFieldName, (parentPrefix ? parentPrefix : '') + fieldName + '.');
                });
            }
        } else {
            if (fieldList[fieldName].type === 'GEO_POINT') {
                this.geoPointFields.push((parentPrefix ? parentPrefix : '') + fieldName);
            }
            if (fieldList[fieldName].type === 'GEO_SHAPE') {
                this.geoShapeFields.push((parentPrefix ? parentPrefix : '') + fieldName);
            }
        }
    }

    private setFeatureColor(feature: Feature): Feature {
        if (this.includeFeaturesFields && this.generateFeaturesColors) {
            this.includeFeaturesFields.forEach((field: string) => {
                feature.properties[field + '_color'] = this.getHexColor(feature.properties[field], 0.5);
            });
        }
        return feature;
    }

    private getHexColor(key: string, saturationWeight: number): string {
        const text = key + ':' + key;
        // string to int
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
          hash = text.charCodeAt(i) + ((hash << 5) - hash);
        }
        // int to rgb
        let hex = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        hex =  '00000'.substring(0, 6 - hex.length) + hex;
        const color = mix(hex, hex);
        color.saturate(color.toHsv().s * saturationWeight + ((1 - saturationWeight) * 100));
        return color.toHexString();
    }
}

