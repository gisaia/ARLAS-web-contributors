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

import { Observable, Subject, generate, from, concat, of, interval } from 'rxjs';
import { map, finalize, flatMap, mergeAll, concatAll, debounceTime, retry, catchError, min, tap, takeUntil } from 'rxjs/operators';

import {
    CollaborativesearchService, Contributor,
    ConfigService, Collaboration, OperationEnum,
    projType, GeohashAggregation, TiledSearch, CollaborationEvent
} from 'arlas-web-core';
import {
    Search, Expression, Hits,
    Aggregation, Projection,
    Filter, FeatureCollection, Feature, Metric, AggregationResponse
} from 'arlas-api';
import { OnMoveResult, ElementIdentifier, PageEnum, FeaturesNormalization, NormalizationScope,
     LayerClusterSource, LayerTopologySource, LayerFeatureSource, Granularity } from '../models/models';
import { appendIdToSort, removePageFromIndex, ASC, fineGranularity, coarseGranularity, finestGranularity } from '../utils/utils';
import { bboxes } from 'ngeohash';
import jsonSchema from '../jsonSchemas/mapContributorConf.schema.json';

import bboxPolygon from '@turf/bbox-polygon';
import booleanContains from '@turf/boolean-contains';
import { getBounds, tileToString, truncate, isClockwise } from './../utils/mapUtils';

import * as helpers from '@turf/helpers';
import { stringify, parse } from 'wellknown';
import { mix } from 'tinycolor2';
import moment from 'moment';


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
    geohash,
    topology
}
export interface Style {
    id: string;
    name: string;
    layerIds: Set<string>;
    geomStrategy?: geomStrategyEnum;
    isDefault?: boolean;
}

export enum DataMode {
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
     * By default the contributor computes the data in a dynamic way (`Dynamic mode`): it switches between
     * `clusters` and `features` mode according to the zoom level and the number of features.
     * In the `Simple mode` the contributor returns just the features (with a given sort and size and an optional filter)
     */
    public dataMode: DataMode;
    public geoQueryOperation: Expression.OpEnum;
    public geoQueryField: string;
    /** Number of features fetched in a geosearch request. It's used in `Simple mode` only. Default to 100.*/
    public searchSize: number;
    /** comma seperated field names that sort the features. Order matters. It's used in `Simple mode` only.*/
    public searchSort: string;
    public drawPrecision: number;
    public isFlat: boolean;

    private CLUSTER_SOURCE = 'cluster';
    private TOPOLOGY_SOURCE = 'feature-metric';
    private FEATURE_SOURCE = 'feature';

    private LAYERS_SOURCES_KEY = 'layers_sources';
    private DATA_MODE_KEY = 'data_mode';
    private GEO_QUERY_OP_KEY = 'geo_query_op';
    private GEO_QUERY_FIELD_KEY = 'geo_query_field';
    private SEARCH_SIZE_KEY = 'search_size';
    private SEARCH_SORT_KEY = 'search_sort';
    private DRAW_PRECISION_KEY = 'draw_precision';
    private IS_FLAT_KEY = 'is_flat';

    private DEFAULT_SEARCH_SIZE = 100;
    private DEFAULT_SEARCH_SORT = '';
    private DEFAULT_DRAW_PRECISION = 6;
    private DEFAULT_IS_FLAT = true;

    private clusterLayersIndex: Map<string, LayerClusterSource>;
    private topologyLayersIndex: Map<string, LayerTopologySource>;
    private featureLayersIndex: Map<string, LayerFeatureSource>;

    private visibiltyRulesIndex: Map<string, {type: string, minzoom: number, maxzoom: number, nbfeatures: number}> = new Map();

    private geohashesPerSource: Map<string, Map<string, Feature>> = new Map();
    private parentGeohashesPerSource: Map<string, Set<string>> = new Map();

    private clusterSourcesStats: Map<string, {count: number, sum?: number}> = new Map();
    private clusterSourcesMetrics: Map<string, Set<string>> = new Map();
    private sourcesVisitedTiles: Map<string, Set<string>> = new Map();
    private sourcesPrecisions: Map<string, {tilesPrecision?: number, requestsPrecision?: number}> = new Map();
    private granularityFunctions: Map<Granularity, (zoom: number) => {tilesPrecision: number, requestsPrecision: number}> = new Map();

    /**This map stores for each agg id, a map of call Instant and a Subject;
     * The Subject will be emitted once precision of agg changes ==> all previous calls that are still pending will stop */
    private cancelSubjects: Map<string, Map<string, Subject<void>>> = new Map();
    /**This map stores for each agg id, the instant of the lastest call to this agg. */
    private lastCalls: Map<string, string> = new Map();
     /**This map stores for each agg id, an abort controller. This controller will abort pending calls when precision of
      * the agg changes. */
    private abortControllers: Map<string, AbortController> = new Map();

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
    /**
     * List of fields pattern or names that will be included in features mode as geojson properties.
     */
    public includeFeaturesFields: Array<string> = this.getConfigValue('includeFeaturesFields');
    /**
     * List of numeric or date fields patterns or names which values are normalized.
     * The fields values can be normalized globally considering all the data
     * Or locally considering the data on the current map extent only.
     * Also you can normalize fields values (locally or globally) per a given key:
     * > For instance I want to normalize the speed of boats by boat id.
     * **Note** : Global normalization is only possible per a given key.
     * Depending on the given options in `FeaturesNormalization` :
     * - A property `{field}_locally_normalized` will be included in features mode as geojson properties
     * - A property `{field}_locally_normalized_per_{key}` will be included in features mode as geojson properties
     * - A property `{field}_globally_normalized_per_{key}` will be included in features mode as geojson properties
     */
    public normalizationFields: Array<FeaturesNormalization> = this.getConfigValue('normalizationFields');
    public colorGenerationFields: Array<string> = this.getConfigValue('colorGenerationFields');
    public fetchType: fetchType;

    public zoom = this.getConfigValue('initZoom');
    public tiles: Array<{ x: number, y: number, z: number }> = new Array<{ x: number, y: number, z: number }>();
    public geohashList: Array<string> = bboxes(-90, -180, 90, 180, 1);
    public currentGeohashList: Array<string> = new Array<string>();
    public currentExtentGeohashSet: Set<string> = new Set<string>();
    public currentStringedTilesList: Array<string> = new Array<string>();
    public mapExtend = [90, -180, -90, 180];
    public zoomLevelFullData = this.getConfigValue('zoomLevelFullData');
    public zoomLevelForTestCount = this.getConfigValue('zoomLevelForTestCount');
    public nbMaxFeatureForCluster = this.getConfigValue('nbMaxDefautFeatureForCluster');
    public idFieldName: string = this.getConfigValue('idFieldName');
    public geomStrategy = this.getConfigValue('geomStrategy');

    public returned_geometries = '';

    public geoPointFields = new Array<string>();
    public geoShapeFields = new Array<string>();
    public strategyEnum = geomStrategyEnum;

    public countExtendBus = new Subject<{ count: number, threshold: number }>();
    public saturationWeight = 0.5;

    protected geohashesMap: Map<string, Feature> = new Map();
    protected parentGeohashesSet: Set<string> = new Set();
    /**
     * A filter that is taken into account when fetching features and that is not included in the global collaboration.
     * It's used in `Simple mode` only.
     */
    public expressionFilter: Expression;
    /**
     * ARLAS Server Aggregation used to aggregate features and display them in `clusters` mode. Defined in configuration
     */
    public aggregation: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    public precision;

    public aggregationField: string;

    public redrawTile: Subject<boolean> = new Subject<boolean>();

    public redrawSource: Subject<any> = new Subject<any>();
    /** CONSTANTS */
    private NEXT_AFTER = '_nextAfter';
    private PREVIOUS_AFTER = '_previousAfter';
    private FLAT_CHAR = '_';

    private allIncludedFeatures: Set<string>;
    private includeFeaturesFieldsSet: Set<string> = this.getConfigValue('includeFeaturesFields');
    /** <date field - date format> map */
    private dateFieldFormatMap: Map<string, string> = new Map<string, string>();
    private collectionParams: Set<string> = new Set<string>();
    private globalNormalisation: Array<FeaturesNormalization> = new Array();

    public dataSources = new Set<string>();
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(public identifier, public collaborativeSearcheService: CollaborativesearchService, public configService: ConfigService) {
        super(identifier, configService, collaborativeSearcheService);

        const layersSourcesConfig = this.getConfigValue(this.LAYERS_SOURCES_KEY);
        const dataModeConfig = this.getConfigValue(this.DATA_MODE_KEY);
        const geoQueryOpConfig = this.getConfigValue(this.GEO_QUERY_OP_KEY);
        const geoQueryFieldConfig = this.getConfigValue(this.GEO_QUERY_FIELD_KEY);
        const searchSizeConfig = this.getConfigValue(this.SEARCH_SIZE_KEY);
        const searchSortConfig = this.getConfigValue(this.SEARCH_SORT_KEY);
        const drawPrecisionConfig = this.getConfigValue(this.DRAW_PRECISION_KEY);
        const isFlatConfig = this.getConfigValue(this.IS_FLAT_KEY);

        if (layersSourcesConfig) {
            this.clusterLayersIndex = this.getClusterLayersIndex(layersSourcesConfig);
            this.topologyLayersIndex = this.getTopologyLayersIndex(layersSourcesConfig);
            this.featureLayersIndex = this.getFeatureLayersIndex(layersSourcesConfig);
        }
        if (dataModeConfig !== undefined && DataMode[dataModeConfig].toString() === DataMode.simple.toString()) {
            this.dataMode = DataMode.simple;
        } else {
            this.dataMode = DataMode.dynamic;
        }
        if (geoQueryOpConfig !== undefined) {
            if (Expression.OpEnum[geoQueryOpConfig].toString() === Expression.OpEnum.Within.toString()) {
                this.geoQueryOperation = Expression.OpEnum.Within;
            } else if (Expression.OpEnum[geoQueryOpConfig].toString() === Expression.OpEnum.Notwithin.toString()) {
                this.geoQueryOperation = Expression.OpEnum.Notwithin;
            } else if (Expression.OpEnum[geoQueryOpConfig].toString() === Expression.OpEnum.Intersects.toString()) {
                this.geoQueryOperation = Expression.OpEnum.Intersects;
            } else if (Expression.OpEnum[geoQueryOpConfig].toString() === Expression.OpEnum.Notwithin.toString()) {
                this.geoQueryOperation = Expression.OpEnum.Notwithin;
            }
        } else {
            this.geoQueryOperation = Expression.OpEnum.Within;
        }
        // TODO check if we should do a describe on the collection to get the geometry_path
        this.geoQueryField = geoQueryFieldConfig;
        this.searchSize = searchSizeConfig !== undefined ? searchSizeConfig : this.DEFAULT_SEARCH_SIZE;
        this.searchSort = searchSortConfig !== undefined ? searchSortConfig : this.DEFAULT_SEARCH_SORT;
        this.drawPrecision = drawPrecisionConfig !== undefined ? drawPrecisionConfig : this.DEFAULT_DRAW_PRECISION;
        this.isFlat = isFlatConfig !== undefined ? isFlatConfig : this.DEFAULT_IS_FLAT;
        this.granularityFunctions.set(Granularity.fine, fineGranularity);
        this.granularityFunctions.set(Granularity.coarse, coarseGranularity);
        this.granularityFunctions.set(Granularity.finest, finestGranularity);
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
            case DataMode.simple: {
                return this.fetchDataSimpleMode(collaborationEvent);
            }
            case DataMode.dynamic: {
                return this.fetchDataDynamicMode(collaborationEvent);
            }
        }
    }

    public fetchDataSimpleMode(collaborationEvent: CollaborationEvent): Observable<FeatureCollection> {
        this.geojsondata.features = [];
        return this.fetchDataGeoSearch(this.allIncludedFeatures, this.searchSort);
    }

    public fetchDataDynamicMode(collaborationEvent: CollaborationEvent): Observable<FeatureCollection> {
        // this.currentStringedTilesList = [];
        // this.currentGeohashList = [];
        // this.maxValueGeoHash = 0;
        // if (this.zoom < this.zoomLevelForTestCount) {
        //     this.fetchType = fetchType.geohash;
        //     this.geojsondata.features = [];
        //     this.geohashesMap = new Map();
        //     this.parentGeohashesSet = new Set();
        //     return this.fetchDataGeohashGeoaggregate(this.geohashList);
        // } else if (this.zoom >= this.zoomLevelForTestCount) {
        //     const pwithin = this.mapExtend[1] + ',' + this.mapExtend[2] + ',' + this.mapExtend[3] + ',' + this.mapExtend[0];
        //     const countFilter = this.getFilterForCount(pwithin);
        //     this.addFilter(countFilter, this.additionalFilter);
        //     const count: Observable<Hits> = this.collaborativeSearcheService
        //         .resolveButNotHits([projType.count, {}], this.collaborativeSearcheService.collaborations,
        //             this.identifier, countFilter, true, this.cacheDuration);
        //     if (count) {
        //         return count.pipe(flatMap(c => {
        //             this.countExtendBus.next({
        //                 count: c.totalnb,
        //                 threshold: this.nbMaxFeatureForCluster
        //             });
        //             if (c.totalnb <= this.nbMaxFeatureForCluster) {
        //                 this.geojsondata.features = [];
        //                 this.fetchType = fetchType.tile;
        //                 return this.fetchDataTileSearch(this.tiles);
        //             } else {
        //                 this.fetchType = fetchType.geohash;
        //                 this.geojsondata.features = [];
        //                 this.geohashesMap = new Map();
        //                 this.parentGeohashesSet = new Set();
        //                 return this.fetchDataGeohashGeoaggregate(this.geohashList);
        //             }
        //         }));
        //     } else {
        //         this.countExtendBus.next({
        //             count: 0,
        //             threshold: this.nbMaxFeatureForCluster
        //         });
        //     }
        // }

        return of();
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
        return from([]);
    }

    public setDrawings(collaboration: Collaboration): void {
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
            if (aois && aois.length > 0) {
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
    }
    public getBoundsToFit(elementidentifier: ElementIdentifier): Observable<Array<Array<number>>> {
        const bounddsToFit = getBounds(elementidentifier, this.collaborativeSearcheService);
        return bounddsToFit;
    }

    public switchLayerCluster(style: Style) {
        // if (this.strategyEnum[style.geomStrategy].toString() !== this.geomStrategy.toString()) {
        //     this.updateData = true;
        //     this.geomStrategy = style.geomStrategy;
        //     if (this.isGeoaggregateCluster) {
        //         this.fetchType = fetchType.geohash;
        //         this.clearData();
        //         this.drawGeoaggregateGeohash(this.geohashList, 'SWITCHER');
        //         const collaboration = this.collaborativeSearcheService.getCollaboration(this.identifier);
        //         this.setDrawings(collaboration);
        //     }
        // }
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

    public wrap(n: number, minimum: number, maximum: number): number {
        const d = maximum - minimum;
        const w = ((n - minimum) % d + d) % d + minimum;
        const factor = Math.pow(10, this.drawPrecision);
        return (w === minimum) ? maximum : Math.round(w * factor) / factor;
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
        console.log('moove');
        switch (this.dataMode) {
            case DataMode.simple: {
                this.onMoveSimpleMode(newMove);
                break;
            }
            case DataMode.dynamic: {
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
    * Function called on onMove event
    */
    public onMoveDynamicMode(newMove: OnMoveResult) {
        this.tiles = newMove.tiles;
        this.zoom = newMove.zoom;
        const pwithin = newMove.extendForLoad[1] + ',' + newMove.extendForLoad[2] + ',' + newMove.extendForLoad[3] + ','
            + newMove.extendForLoad[0];
        // todo collection.centroid_path
        const countFilter = this.getFilterForCount(pwithin, 'track.location');
        this.addFilter(countFilter, this.additionalFilter);

        /** Get displayable sources using zoom visibility rules only.
         *  If the precision of a cluster souce changes, it will stop the ongoing http calls */
        let displayableSources = this.getDisplayableSources(this.zoom);
        let dClusterSources = displayableSources[0];
        this.prepareClusterAggregations(dClusterSources, this.zoom, true);
        const sourcesToRemove = displayableSources[3];
        sourcesToRemove.forEach(s => {
            // todo clear the correct type
            this.redrawSource.next({source: s, data: []});
            this.parentGeohashesPerSource.set(s, new Set());
            this.geohashesPerSource.set(s, new Map());
            this.clusterSourcesStats.set(s, {count: 0});
            this.sourcesVisitedTiles.set(s, new Set());
            this.sourcesPrecisions.set(s, {});
        });
        const count: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits([projType.count, {}],
            this.collaborativeSearcheService.collaborations, this.identifier, countFilter, false, this.cacheDuration);
        if (count) {
            count.subscribe(countResponse => {
                const nbFeatures = countResponse.totalnb;
                displayableSources = this.getDisplayableSources(this.zoom, nbFeatures);
                dClusterSources = displayableSources[0];
                const dTopologySources = displayableSources[1];
                const dFeatureSources = displayableSources[2];
                this.prepareTopologyAggregations(dTopologySources);
                this.prepareFeaturesReturnedGeomtries(dFeatureSources);
                const aggregationsBuilder = this.prepareClusterAggregations(dClusterSources, this.zoom);
                this.drawClustersSources(newMove.extendForLoad, this.zoom, aggregationsBuilder, Date.now() + '');
            });
        }
    }

    public drawGeoSearch(fromParam?: number, appendId?: boolean) {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        const sort = appendId ? appendIdToSort(this.searchSort, ASC, this.idFieldName) : this.searchSort;
        this.fetchDataGeoSearch(this.allIncludedFeatures, sort, null, null, fromParam)
            .pipe(
                map(f => this.computeDataTileSearch(f)),
                map(f => this.setDataTileSearch(f)),
                finalize(() => {
                    /** redrawTile event is emitted whether there is normalization or not */
                    this.normalizeFeatures();
                    this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                })
            )
            .subscribe(data => data);
    }

    public renderClusterSources(sources: Array<string>): void {
        sources.forEach(s => {
            this.redrawSource.next({source: s, data: []});
            const sourceGeohashes = this.geohashesPerSource.get(s);
            const sourceStats = this.clusterSourcesStats.get(s);
            const sourceData = [];
            sourceGeohashes.forEach((f, geohash) => {
                const properties = Object.assign({}, f.properties);
                const feature = Object.assign({}, f);
                feature.properties = properties;
                // feature.properties['point_count'] = feature.properties.count;
                // feature.properties['point_count_abreviated'] = this.intToString(feature.properties.count);
                feature.properties['point_count_normalize'] = Math.round(feature.properties.count / sourceStats.count * 100);
                delete feature.properties.geohash;
                delete feature.properties.parent_geohash;
                delete feature.properties.geometry_ref;
                delete feature.properties.geometry_type;
                delete feature.properties.feature_type;
                Object.keys(feature.properties).forEach(k => {
                    if (this.clusterSourcesMetrics.get(s)) {
                        if (!this.clusterSourcesMetrics.get(s).has(k) && k !== 'point_count_normalize') {
                          delete feature.properties[k];
                        } else if (k.includes('_avg_')) {
                            /** completes the weighted average calculus by dividing by the total count */
                            feature.properties[k] = feature.properties[k] / feature.properties.count;
                        }
                    } else if (k !== 'point_count_normalize') {
                      delete feature.properties[k];
                    }
                });
                sourceData.push(feature);
            });
            this.redrawSource.next({source: s, data: sourceData});
        });
    }
    public drawSearchTiles(tiles: Array<{ x: number, y: number, z: number }>) {
        this.updateData = true;
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        this.fetchDataTileSearch(tiles)
            .pipe(
                map(f => this.computeDataTileSearch(f)),
                map(f => this.setDataTileSearch(f)),
                finalize(() => {
                    if (tiles.length > 0) {
                        /** redrawTile event is emitted whether there is normalization or not */
                        this.normalizeFeatures();
                    }
                    this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                })
            )
            .subscribe(data => data);
    }

    public fetchClusterSource(visitedTiles: Set<string>, aggId, aggSources: {agg: Aggregation, sources: Array<string>}):
        Observable<FeatureCollection> {
        const tabOfGeohash: Array<Observable<FeatureCollection>> = [];
        const control = this.abortControllers.get(aggId);
        visitedTiles.forEach(geohash => {
            const geohahsAggregation: GeohashAggregation = {
                geohash: geohash,
                aggregations: [aggSources.agg]
            };
            const geoAggregateData: Observable<FeatureCollection> =
                this.collaborativeSearcheService.resolveButNotFeatureCollectionWithAbort(
                    [projType.geohashgeoaggregate, geohahsAggregation], this.collaborativeSearcheService.collaborations,
                    this.isFlat, control.signal, null, this.additionalFilter, this.cacheDuration);
            tabOfGeohash.push(geoAggregateData);
        });
        return from(tabOfGeohash).pipe(mergeAll());
    }

    public drawClustersSources(extent: Array<number>, zoom: number, aggregations:  Map<string, {agg: Aggregation, sources: Array<string>}>,
        callOrigin?: string) {
        aggregations.forEach((aggSource, id) => {
            const granularity = this.clusterLayersIndex.get(aggSource.sources[0]).granularity;
            const visitedTiles = this.extentToGeohashes(extent, zoom, this.granularityFunctions.get(granularity));
            const precisions = Object.assign({}, this.granularityFunctions.get(granularity)(this.zoom));
            let oldPrecisions;
            aggSource.sources.forEach(s => {
                const p = Object.assign({}, this.sourcesPrecisions.get(s));
                if (p && p.requestsPrecision && p.tilesPrecision) {
                    oldPrecisions = p;
                }
            });
            if (!oldPrecisions) {
                oldPrecisions = {};
            }
            let newVisitedTiles: Set<string> = new Set();
            if (oldPrecisions.tilesPrecision !== precisions.tilesPrecision ||
                oldPrecisions.requestsPrecision !== precisions.requestsPrecision) {
                /** precision changed, need to clean tiles index */
                newVisitedTiles = visitedTiles;
                aggSource.sources.forEach(s => {
                    this.parentGeohashesPerSource.set(s, new Set());
                    this.geohashesPerSource.set(s, new Map());
                    this.clusterSourcesStats.set(s, {count: 0});
                    this.sourcesVisitedTiles.set(s, visitedTiles);
                    this.sourcesPrecisions.set(s, precisions);
                });
            } else {
                let tiles = new Set<string>();
                let start = true;
                aggSource.sources.forEach(s => {
                    if (start) {
                        start = false; tiles = this.sourcesVisitedTiles.get(s);
                    } else { if (this.sourcesVisitedTiles.get(s).size < tiles.size) {
                        tiles = this.sourcesVisitedTiles.get(s);
                    }}
                });
                visitedTiles.forEach(vt => {
                    if (!tiles.has(vt)) {
                        newVisitedTiles.add(vt);
                        tiles.add(vt);
                    }
                });
                aggSource.sources.forEach(s => {
                    this.sourcesVisitedTiles.set(s, tiles);
                    this.sourcesPrecisions.set(s, precisions);
                });
            }
            let count = 0;
            const totalcount = newVisitedTiles.size;
            if (newVisitedTiles.size > 0) {
                this.collaborativeSearcheService.ongoingSubscribe.next(1);
                const cancelSubjects = this.cancelSubjects.get(id);
                const lastCall = this.lastCalls.get(id);
                const renderRetries = [];
                const start = Date.now();
                this.fetchClusterSource(newVisitedTiles, id, aggSource)
                .pipe(
                    takeUntil(cancelSubjects && cancelSubjects.get(lastCall) ? cancelSubjects.get(lastCall) : of()),
                    map(f => this.computeClusterData(f, aggSource)),
                    tap(() => count++),
                    // todo strategy to render data at some stages
                    tap(() => {
                        const progression = count / totalcount * 100;
                        const consumption = Date.now() - start;
                        if (consumption > 2000) {
                            if (progression > 25 && renderRetries.length === 0) {
                                this.renderClusterSources(aggSource.sources);
                                renderRetries.push('1');
                            }
                            if (progression > 50 && renderRetries.length <= 1) {
                                this.renderClusterSources(aggSource.sources);
                                renderRetries.push('2');
                            }
                            if (progression > 75 && renderRetries.length <= 2) {
                                this.renderClusterSources(aggSource.sources);
                                renderRetries.push('3');
                            }
                        }
                        console.log(count / totalcount * 100 + '   ' + callOrigin   + '  ' + id);
                    }),
                    finalize(() => {
                        this.renderClusterSources(aggSource.sources);
                        this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                    })
                ).subscribe(data => data);
            }
        });
    }

    public extentToGeohashes(extent: Array<number>, zoom: number,
        granularityFunction: (zoom: number) => {tilesPrecision: number, requestsPrecision: number}): Set<string> {
        let geohashList = [];
        const west = extent[1];
        const east = extent[3];
        const south = extent[2];
        const north = extent[0];
        if (west < -180 && east > 180) {
          geohashList = bboxes(Math.min(south, north),
            -180,
            Math.max(south, north),
            180, Math.max(granularityFunction(zoom).tilesPrecision, 1));
        } else if (west < -180 && east < 180) {
          const geohashList_1: Array<string> = bboxes(Math.min(south, north),
            Math.min(-180, west + 360),
            Math.max(south, north),
            Math.max(-180, west + 360), Math.max(granularityFunction(zoom).tilesPrecision, 1));
          const geohashList_2: Array<string> = bboxes(Math.min(south, north),
            Math.min(east, 180),
            Math.max(south, north),
            Math.max(east, 180), Math.max(granularityFunction(zoom).tilesPrecision, 1));
          geohashList = geohashList_1.concat(geohashList_2);
        } else if (east > 180 && west > -180) {
          const geohashList_1: Array<string> = bboxes(Math.min(south, north),
            Math.min(180, east - 360),
            Math.max(south, north),
            Math.max(180, east - 360), Math.max(granularityFunction(zoom).tilesPrecision, 1));
          const geohashList_2: Array<string> = bboxes(Math.min(south, north),
            Math.min(west, -180),
            Math.max(south, north),
            Math.max(west, -180), Math.max(granularityFunction(zoom).tilesPrecision, 1));
          geohashList = geohashList_1.concat(geohashList_2);
        } else {
          geohashList = bboxes(Math.min(south, north),
            Math.min(east, west),
            Math.max(south, north),
            Math.max(east, west), Math.max(granularityFunction(zoom).tilesPrecision, 1));
        }
        return new Set(geohashList);
      }
    /**
     *
     * @param featureCollection featureCollection returned by a geoaggregation query
     */
    public computeDataGeohashGeoaggregate(featureCollection: FeatureCollection): Array<any> {
        return [];
    }

    public computeClusterData(featureCollection: FeatureCollection, aggSource: {agg: Aggregation, sources: Array<string>}): Array<any> {
        const geometry_source_index = new Map();
        const source_geometry_index = new Map();
        aggSource.sources.forEach(cs => {
            const ls = this.clusterLayersIndex.get(cs);
            const geometryRef = ls.aggregatedGeometry ? ls.aggregatedGeometry : ls.rawGeometry.geometry + '-' + ls.rawGeometry.sort;
            geometry_source_index.set(geometryRef, cs);
            source_geometry_index.set(cs, geometryRef);
        });
        const parentGeohashesPerSource = new Map();
        if (featureCollection && featureCollection.features !== undefined) {
            featureCollection.features.forEach(feature => {
                delete feature.properties.key;
                delete feature.properties.key_as_string;
                const geometryRef = feature.properties.geometry_sort ?
                    feature.properties.geometry_ref + '-' + feature.properties.geometry_sort : feature.properties.geometry_ref;
                /** Here a feature is a geohash. */
                /** We check if the geohash is already displayed in the map */
                const gmap = this.geohashesPerSource.get(geometry_source_index.get(geometryRef));
                const existingGeohash = gmap ? gmap.get(feature.properties.geohash) : null;
                if (existingGeohash) {
                    /** parent_geohash corresponds to the geohash tile on which we applied the geoaggregation */
                    aggSource.sources.forEach(source => {
                        const parentGeohashes = this.parentGeohashesPerSource.get(source);
                        const metricsKeys = this.clusterSourcesMetrics.get(source);
                        if (!parentGeohashes.has(feature.properties.parent_geohash)) {
                            /** when this tile (parent_geohash) is requested for the first time we merge the counts */
                            if (metricsKeys) {
                                const countValue = feature.properties.count;
                                metricsKeys.forEach(key => {
                                    if (key.includes('_sum_')) {
                                        feature.properties[key] += existingGeohash.properties[key];
                                    } else if (key.includes('_max_')) {
                                        feature.properties[key] = (feature.properties[key] > existingGeohash.properties[key]) ?
                                            feature.properties[key] : existingGeohash.properties[key];
                                    } else if (key.includes('_min_')) {
                                        feature.properties[key] = (feature.properties[key] < existingGeohash.properties[key]) ?
                                            feature.properties[key] : existingGeohash.properties[key];
                                    } else if (key.includes('_avg_')) {
                                        /** calculates a weighted average. existing geohash feature is already weighted */
                                        feature.properties[key] = feature.properties[key] * countValue + existingGeohash.properties[key];
                                    }
                                });
                            }
                            feature.properties.count = feature.properties.count + existingGeohash.properties.count;
                        } else {
                            /** when the tile has already been visited. (This can happen when we load the app for the first time),
                             * then we don't merge */
                            feature.properties.count = existingGeohash.properties.count;
                            if (metricsKeys) {
                                metricsKeys.forEach(key => {
                                    feature.properties[key] = existingGeohash.properties[key];
                                });
                            }
                        }
                    });
                } else {
                    aggSource.sources.forEach(source => {
                        const metricsKeys = this.clusterSourcesMetrics.get(source);
                        if (metricsKeys) {
                            const countValue = feature.properties.count;
                            metricsKeys.forEach(key => {
                                if (key.includes('_avg_')) {
                                    feature.properties[key] = feature.properties[key] * countValue;
                                }
                            });
                        }
                    });
                }
                aggSource.sources.forEach(source => {
                    const metricsKeys = this.clusterSourcesMetrics.get(source);
                    if (geometryRef === source_geometry_index.get(source)) {
                        let geohashesMap = this.geohashesPerSource.get(source);
                        if (!geohashesMap) {
                            geohashesMap = new Map();
                        }
                        geohashesMap.set(feature.properties.geohash, feature);
                        this.geohashesPerSource.set(source, geohashesMap);
                        parentGeohashesPerSource.set(source, feature.properties.parent_geohash);
                        let stats = this.clusterSourcesStats.get(source);
                        if (!stats) {
                            stats = { count: 0, sum: 0 };
                        }
                        if (stats.count < feature.properties.count) {
                            stats.count = feature.properties.count;
                        }
                        if (metricsKeys) {
                            metricsKeys.forEach(key => {
                                if (key.includes('_sum_')) {
                                    if (!stats[key]) {stats[key] = 0; }
                                    if (stats[key] < feature.properties[key]) {
                                        stats[key] = feature.properties[key];
                                    }
                                } else if (key.includes('_max_')) {
                                    if (!stats[key]) {stats[key] = 0; }
                                    if (stats[key] < feature.properties[key]) {
                                        stats[key] = feature.properties[key];
                                    }
                                }
                            });
                        }
                        this.clusterSourcesStats.set(source, stats);
                    }
                });
            });
        }
        if (parentGeohashesPerSource.size > 0) {
            parentGeohashesPerSource.forEach((pgh, source) => {
                let parentGeohashes = this.parentGeohashesPerSource.get(source);
                if (!parentGeohashes) {
                    parentGeohashes = new Set();
                }
                parentGeohashes.add(pgh);
                this.parentGeohashesPerSource.set(source, parentGeohashes);
            });
        }
        return [];
    }
    public setDataGeohashGeoaggregate(features: Array<any>): any {
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
            this.fetchDataGeoSearch(this.allIncludedFeatures, sortWithId, after, whichPage)
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
    public fetchDataGeoSearch(includeFeaturesFields: Set<string>, sort: string,
        afterParam?: string, whichPage?: PageEnum, fromParam?): Observable<FeatureCollection> {
        const pwithin = this.mapExtend[1] + ',' + this.mapExtend[2]
            + ',' + this.mapExtend[3] + ',' + this.mapExtend[0];
            // todo collection.centroid_path
        const filter: Filter = this.getFilterForCount(pwithin, 'track.location');
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
            null, filter, this.cacheDuration);

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
        if (this.allIncludedFeatures !== undefined) {
            this.allIncludedFeatures.forEach(field => {
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
                null, filter, this.cacheDuration);
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
        return features;
    }

    public getFilterForCount(extent: string, countGeoField: string): Filter {
        // west, south, east, north
        const extentTab = extent.trim().split(',');
        const west = extentTab[0];
        const east = extentTab[2];
        let finalExtend = [extent.trim()];
        if (parseFloat(west) > parseFloat(east)) {
            finalExtend = [];
            const firstExtent = extentTab[0] + ',' + extentTab[1] + ',' + '180' + ',' + extentTab[3];
            const secondExtent = '-180' + ',' + extentTab[1] + ',' + extentTab[2] + ',' + extentTab[3];
            finalExtend.push(firstExtent.trim());
            finalExtend.push(secondExtent.trim());
        }
        let filter: Filter = {};
        const collaboration = this.collaborativeSearcheService.getCollaboration(this.identifier);
        const defaultQueryExpressions: Array<Expression> = [];
        defaultQueryExpressions.push({
            field: countGeoField,
            op: Expression.OpEnum.Within,
            value: finalExtend[0]
        });
        if (finalExtend[1]) {
            defaultQueryExpressions.push({
                field: countGeoField,
                op: Expression.OpEnum.Within,
                value: finalExtend[1]
            });
        }
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
                        const extendForCountExpressions: Array<Expression> = [];
                        extendForCountExpressions.push({
                            field: this.geoQueryField,
                            op: geoQueryOperationForCount,
                            value: finalExtend[0]
                        });
                        if (finalExtend[1]) {
                            extendForCountExpressions.push({
                                field: this.geoQueryField,
                                op: geoQueryOperationForCount,
                                value: finalExtend[1]
                            });
                        }
                        andFilter.push(extendForCountExpressions);
                        filter = {
                            f: andFilter
                        };
                        break;
                    case Expression.OpEnum.Intersects:
                    case Expression.OpEnum.Within:
                        const queryExpressions: Array<Expression> = [];
                        queryExpressions.push({
                            field: this.geoQueryField,
                            op: this.geoQueryOperation,
                            value: finalExtend[0]
                        });
                        if (finalExtend[1]) {
                            queryExpressions.push({
                                field: this.geoQueryField,
                                op: this.geoQueryOperation,
                                value: finalExtend[1]
                            });
                        }
                        filter = {
                            f: [aois.map(p => {
                                return {
                                    field: this.geoQueryField,
                                    op: this.geoQueryOperation,
                                    value: p
                                };
                            }), queryExpressions]
                        };
                }
            } else {
                filter = {
                    f: [defaultQueryExpressions]
                };
            }
        } else {
            filter = {
                f: [defaultQueryExpressions]
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


    /**
     * @description Parses the cluster sources. Prepares the corresponding aggregation. Number of aggregation is optimized. One aggregation
     * represents one or several sources.
     * @param clusterSources List of cluster sources ids
     * @param zoom zoom level. Zoom level is necessary to get the aggregation precision.
     * @param checkPrecisionChanges If true, this function performs a check of precision change.
     * If so, the ongoing http calls of the same aggregation are stopped.
     */
    private prepareClusterAggregations(clusterSources: Array<string>, zoom: number, checkPrecisionChanges?: boolean):
        Map<string, {agg: Aggregation, sources: Array<string>}> {
        const aggregationsMap: Map<string, {agg: Aggregation, sources: Array<string>}> = new Map();
        clusterSources.forEach(cs => {
            const ls = this.clusterLayersIndex.get(cs);
            const raw_geo = ls.rawGeometry ? ':' + ls.rawGeometry.sort : '';
            const id = ls.aggGeoField + ':' + ls.granularity.toString();
            const aggBuilder = aggregationsMap.get(id);
            let sources;
            let aggregation: Aggregation;
            /** check if an aggregation that suits tis source `cs` exists already */
            if (aggBuilder) {
                aggregation = aggBuilder.agg;
                sources = aggBuilder.sources;
            } else {
                aggregation = {
                    type: Aggregation.TypeEnum.Geohash,
                    field: ls.aggGeoField,
                    interval: { value: this.getPrecision(ls.granularity, zoom) }
                };
                sources = [];
            }
            if (ls.metrics) {
                if (!aggregation.metrics) { aggregation.metrics = []; }
                ls.metrics.forEach(m => {
                    aggregation.metrics.push({
                        collect_field: m.field,
                        collect_fct: m.metric
                    });
                    let metrics = this.clusterSourcesMetrics.get(cs);
                    if (!metrics) { metrics = new Set(); }
                    metrics.add(m.field.replace(/\./g, this.FLAT_CHAR) + '_' + m.metric.toString().toLowerCase() + '_');
                    this.clusterSourcesMetrics.set(cs, metrics);
                });
            }
            if (ls.aggregatedGeometry) {
                if (!aggregation.aggregated_geometries) { aggregation.aggregated_geometries = []; }
                aggregation.aggregated_geometries.push(ls.aggregatedGeometry);
            }
            if (ls.rawGeometry) {
                if (!aggregation.raw_geometries) {
                    aggregation.raw_geometries = [];
                }
                aggregation.raw_geometries.push(ls.rawGeometry);
            }
            sources.push(cs);
            aggregationsMap.set(id, {agg: aggregation, sources});
            if (checkPrecisionChanges) {
                const precisions = Object.assign({}, this.granularityFunctions.get(ls.granularity)(zoom));
                let oldPrecisions;
                sources.forEach(s => {
                    const p = Object.assign({}, this.sourcesPrecisions.get(s));
                    if (p && p.requestsPrecision && p.tilesPrecision) {
                        oldPrecisions = p;
                    }
                });                if (!oldPrecisions) {oldPrecisions = {}; }
                if (oldPrecisions.tilesPrecision !== precisions.tilesPrecision ||
                    oldPrecisions.requestsPrecision !== precisions.requestsPrecision) {
                    /** precision changed, need to stop consumption of current http calls using the old precision */
                    console.log('precision change id    ' + id);
                    let cancelSubjects = this.cancelSubjects.get(id);
                    if (!cancelSubjects) { cancelSubjects = new Map(); }
                    const callOrigin = Date.now() + '';
                    cancelSubjects.forEach((subject, k) => { if (+k < +callOrigin) { subject.next(); subject.complete(); }});
                    cancelSubjects.clear();
                    cancelSubjects.set(callOrigin, new Subject());
                    this.cancelSubjects.set(id, cancelSubjects);
                    this.lastCalls.set(id, callOrigin);

                    const abortController = this.abortControllers.get(id);
                    if (abortController && !abortController.signal.aborted) {
                        /** abort pending calls of this agg id because precision changed. */
                        abortController.abort();
                    } else {
                        const controller = new AbortController();
                        this.abortControllers.set(id, controller);
                    }
                }
            }
            // set abort controller that will be sent with fetching data requests
            const control = this.abortControllers.get(id);
            if (!control || control.signal.aborted) {
                const controller = new AbortController();
                this.abortControllers.set(id, controller);
            }
        });
        return aggregationsMap;
    }

    private prepareTopologyAggregations(topologySources: Array<string>): Array<Aggregation> {
        const aggregations = [];
        // TODO optimize aggregations
        // TODO 'collection.timestamp_path'
        topologySources.forEach(cs => {
            const ls = this.topologyLayersIndex.get(cs);
            const aggregation: Aggregation = {
                type: Aggregation.TypeEnum.Geohash,
                field: ls.geometryId,
                metrics: ls.metrics.map(m => {
                    return {
                        collect_field: m.field,
                        coleect_fct: m.metric
                    };
                }),
                size: '' + ls.maxfeatures,
                raw_geometries: [{geometry: ls.geometrySupport}]
            };
            aggregations.push(aggregation);
        });
        return aggregations;
    }

    private prepareFeaturesReturnedGeomtries(featureSources: Array<string>): string {
        const geometries = new Set();
        featureSources.forEach(cs => {
            const ls = this.featureLayersIndex.get(cs);
            geometries.add(ls.returnedGeometry);
        });
        return Array.from(geometries).join(',');
    }

    private getPrecision(g: Granularity, zoom: number): number {
        return this.granularityFunctions.get(g)(zoom).requestsPrecision;
    }
    /**
     * This method indexes all the minimum zooms configured. For each minzoom value, we set the list of layers that have it.
     * This index will be used to get which layers to display
     * @param minZoom
     * @param source
     */
    private indexVisibilityRules(minzoom: number, maxzoom: number, nbfeatures: number, type: string, source: string): void {
        this.visibiltyRulesIndex.set(source, {
            minzoom,
            maxzoom,
            nbfeatures,
            type
        });
    }

    /**
     * Parses the layers_sources config and returns the clusters layers index
     * @param layersSourcesConfig layers_sources configuration object
     */
    private getClusterLayersIndex(layersSourcesConfig): Map<string, LayerClusterSource> {
        const clusterLayers = new Map<string, LayerClusterSource>();
        layersSourcesConfig.filter(ls => ls.source.startsWith(this.CLUSTER_SOURCE)).forEach(ls => {
            const clusterLayer = new LayerClusterSource();
            clusterLayer.id = ls.id;
            clusterLayer.source = ls.source;
            clusterLayer.maxzoom = ls.maxzoom;
            clusterLayer.minzoom = ls.minzoom;
            clusterLayer.minfeatures = ls.minfeatures;
            clusterLayer.aggGeoField = ls.agg_geo_field;
            clusterLayer.granularity = ls.granularity;
            if (ls.raw_geometry) {
                clusterLayer.rawGeometry = ls.raw_geometry;
            }
            if (ls.aggregated_geometry) {
                clusterLayer.aggregatedGeometry = ls.aggregated_geometry;
            }
            clusterLayer.metrics = ls.metrics;
            clusterLayers.set(clusterLayer.source, clusterLayer);
            this.dataSources.add(ls.source);
            this.indexVisibilityRules(ls.minzoom, ls.maxzoom, ls.minfeatures, this.CLUSTER_SOURCE, ls.source);
        });
        return clusterLayers;
    }

    /**
     * Parses the layers_sources config and returns the topology layers index
     * @param layersSourcesConfig layers_sources configuration object
     */
    private getTopologyLayersIndex(layersSourcesConfig): Map<string, LayerTopologySource> {
        const topologyLayers = new Map<string, LayerTopologySource>();
        layersSourcesConfig.filter(ls => ls.source.startsWith(this.TOPOLOGY_SOURCE)).forEach(ls => {
            const topologyLayer = new LayerTopologySource();
            topologyLayer.id = ls.id;
            topologyLayer.source = ls.source;
            topologyLayer.maxzoom = ls.maxzoom;
            topologyLayer.minzoom = ls.minzoom;
            topologyLayer.maxfeatures = ls.maxfeatures;
            topologyLayer.geometrySupport = ls.geometry_support;
            topologyLayer.geometryId = ls.geometry_id;
            topologyLayer.metrics = ls.metrics;
            topologyLayers.set(topologyLayer.source, topologyLayer);
            this.dataSources.add(ls.source);
            this.indexVisibilityRules(ls.minzoom, ls.maxzoom, ls.maxfeatures, this.TOPOLOGY_SOURCE, ls.source);

        });
        return topologyLayers;
    }

/**
     * Parses the layers_sources config and returns the feature layers index
     * @param layersSourcesConfig layers_sources configuration object
     */
    private getFeatureLayersIndex(layersSourcesConfig): Map<string, LayerFeatureSource> {
        const featureLayers = new Map<string, LayerFeatureSource>();
        layersSourcesConfig.filter(ls => ls.source.startsWith(this.FEATURE_SOURCE)).forEach(ls => {
            const featureLayer = new LayerFeatureSource();
            featureLayer.id = ls.id;
            featureLayer.source = ls.source;
            featureLayer.maxzoom = ls.maxzoom;
            featureLayer.minzoom = ls.minzoom;
            featureLayer.maxfeatures = ls.maxfeatures;
            featureLayer.normalizationFields = ls.normalization_fields;
            featureLayer.includeFields = new Set(ls.include_fields);
            featureLayer.colorField = ls.metrics;
            featureLayer.returnedGeometry = ls.returned_geometry;
            featureLayers.set(featureLayer.source, featureLayer);
            this.dataSources.add(ls.source);
            this.indexVisibilityRules(ls.minzoom, ls.maxzoom, ls.maxfeatures, this.FEATURE_SOURCE, ls.source);

        });
        return featureLayers;
    }


    /**
     * Returns sources to be displayed on the map
     * @param zoom
     * @param nbFeatures
     */
    private getDisplayableSources(zoom: number, nbFeatures?: number): [Array<string>, Array<string>, Array<string>, Array<string>] {
        const clusterSources = [];
        const topologySources = [];
        const featureSources = [];
        const sourcesToRemove = [];
        this.visibiltyRulesIndex.forEach((v, k) => {
            if (v.maxzoom >= zoom && v.minzoom <= zoom) {
                switch (v.type) {
                    case this.CLUSTER_SOURCE: {
                        if (nbFeatures === undefined || v.nbfeatures <= nbFeatures) {
                            clusterSources.push(k);
                        } else {
                            sourcesToRemove.push(k);
                        }
                        break;
                    }
                    case this.TOPOLOGY_SOURCE: {
                        if (nbFeatures === undefined || v.nbfeatures >= nbFeatures) {
                            topologySources.push(k);
                        } else {
                            sourcesToRemove.push(k);
                        }
                        break;
                    }
                    case this.FEATURE_SOURCE: {
                        if (nbFeatures === undefined || v.nbfeatures >= nbFeatures) {
                            featureSources.push(k);
                        } else {
                            sourcesToRemove.push(k);
                        }
                        break;
                    }
                }
            } else {
                sourcesToRemove.push(k);
            }
        });
        return [clusterSources, topologySources, featureSources, sourcesToRemove];
    }
    /**
     * Normalizes the values of the configured features fields
     * Emits a redrawTile event
     */
    private normalizeFeatures(): void {
        if (this.normalizationFields) {
            this.normalizeFeaturesLocally();
            const nbGlobalNormalizationPerKey = this.normalizationFields.filter(f => f.scope === NormalizationScope.global && f.per).length;
            const nbGlobalNormalization = this.normalizationFields.filter(f => f.scope === NormalizationScope.global && !f.per).length;
            if (nbGlobalNormalizationPerKey > 0) {
                this.globalNormalisation = new Array();
                const tabOfTermAggregations = new Array<Observable<AggregationResponse>>();
                const tabOfFeaturesNormalizations = new Array<FeaturesNormalization>();
                this.normalizationFields.filter(f => f.scope === NormalizationScope.global && f.per).forEach(f => {
                    tabOfFeaturesNormalizations.push(f);
                    const termAggregation: Aggregation = {
                        type: Aggregation.TypeEnum.Term,
                        field: f.per,
                        metrics: [
                            {
                                collect_fct: Metric.CollectFctEnum.MIN,
                                collect_field: f.on
                            },
                            {
                                collect_fct: Metric.CollectFctEnum.MAX,
                                collect_field: f.on
                            }
                        ],
                        size: '' + f.keysSize
                    };
                    const t = this.collaborativeSearcheService.resolveButNotAggregation(
                        [projType.aggregate, [termAggregation]], this.collaborativeSearcheService.collaborations,
                        null, this.additionalFilter);
                    tabOfTermAggregations.push(t);
                });
                let i = 0;
                from(tabOfTermAggregations).pipe(
                    concatAll(),
                    finalize(() => {
                        this.normalizeFeaturesGlobally();
                        this.redrawTile.next(true);
                    })).subscribe(agg => {
                        const n: FeaturesNormalization = tabOfFeaturesNormalizations[i];
                        i++;
                        n.minMaxPerKey = new Map();
                        if (agg && agg.elements) {
                            agg.elements.forEach(e => {
                                const key = e.key;
                                const minMax: [number, number] =
                                    [e.metrics.filter(m => m.type === Metric.CollectFctEnum.MIN.toString().toLowerCase())[0].value,
                                    e.metrics.filter(m => m.type === Metric.CollectFctEnum.MAX.toString().toLowerCase())[0].value];
                                n.minMaxPerKey.set(key, minMax);
                            });
                        }
                        this.globalNormalisation.push(n);
                    });
            } else {
                this.redrawTile.next(true);
            }
            if (nbGlobalNormalization > 0) {
                console.warn(' #### Global normalization without a `per` field is not supported yet. ####');
                this.normalizationFields.filter(f => f.scope === NormalizationScope.global && !f.per).forEach(element => {
                    console.warn(element.on + ' field global normalization is not supported yet. Please specify a `per` field.');
                });
            }
        } else {
            this.redrawTile.next(true);
        }
    }
    private normalizeFeaturesLocally() {
        this.normalizationFields.forEach((n) => { n.minMaxPerKey = new Map(); n.minMax = [Number.MAX_VALUE, Number.MIN_VALUE]; });
        this.geojsondata.features.forEach(f => {
            this.normalizationFields.filter(n => n.scope === NormalizationScope.local).forEach((n) => {
                const normalizeField = (this.isFlat && n.on) ? n.on.replace(/\./g, this.FLAT_CHAR) : n.on;
                const perField = (this.isFlat && n.per) ? n.per.replace(/\./g, this.FLAT_CHAR) : n.per;
                if (perField) {
                    if (!n.minMaxPerKey.get(f.properties[perField])) {
                        n.minMaxPerKey.set(f.properties[perField], [Number.MAX_VALUE, Number.MIN_VALUE]);
                    }
                    const minMax = n.minMaxPerKey.get(f.properties[perField]);
                    const value = this.getValueFromFeature(f, n.on, normalizeField);
                    if (minMax[0] > value) {
                        minMax[0] = value;
                    }
                    if (minMax[1] < value) {
                        minMax[1] = value;
                    }
                    n.minMaxPerKey.set(f.properties[perField], minMax);
                } else {
                    if (!n.minMax) {
                        n.minMax = [Number.MAX_VALUE, Number.MIN_VALUE];
                    }
                    const minMax = n.minMax;
                    const value = this.getValueFromFeature(f, n.on, normalizeField);
                    if (minMax[0] > value) {
                        minMax[0] = value;
                    }
                    if (minMax[1] < value) {
                        minMax[1] = value;
                    }
                }
            });
        });

        this.geojsondata.features.forEach(f => {
            this.normalizationFields.filter(n => n.scope === NormalizationScope.local).forEach((n) => {
                const normalizeField = (this.isFlat && n.on) ? n.on.replace(/\./g, this.FLAT_CHAR) : n.on;
                const perField = (this.isFlat && n.per) ? n.per.replace(/\./g, this.FLAT_CHAR) : n.per;
                if (perField) {
                    const minMax = n.minMaxPerKey.get(f.properties[perField]);
                    const value = this.getValueFromFeature(f, n.on, normalizeField);
                    const minimum = minMax[0];
                    const max = minMax[1];
                    let normalizedValue;
                    if (minimum === max) {
                        normalizedValue = 1;
                    } else {
                        normalizedValue = (value - minimum) / (max - minimum);
                    }
                    f.properties[normalizeField + '_locally_normalized_per_' + perField] = normalizedValue;
                } else {
                    const minMax = n.minMax;
                    const value = this.getValueFromFeature(f, n.on, normalizeField);
                    const minimum = minMax[0];
                    const max = minMax[1];
                    let normalizedValue;
                    if (minimum === max) {
                        normalizedValue = 1;
                    } else {
                        normalizedValue = (value - minimum) / (max - minimum);
                    }
                    f.properties[normalizeField + '_locally_normalized'] = normalizedValue;
                }
                /** DELETING PROPERTIES THAT WERE NOT INCLUDED IN includeFeaturesFields */
            });
        });
    }

    private normalizeFeaturesGlobally() {
        this.geojsondata.features.forEach(f => {
            const fieldsToCleanSet = new Set();
            this.globalNormalisation.filter(n => n.scope === NormalizationScope.global).forEach((n) => {
                const normalizeField = (this.isFlat && n.on) ? n.on.replace(/\./g, this.FLAT_CHAR) : n.on;
                const perField = (this.isFlat && n.per) ? n.per.replace(/\./g, this.FLAT_CHAR) : n.per;
                if (perField) {
                    if (f.properties[perField] && f.properties[normalizeField]) {
                        const minMax = n.minMaxPerKey.get(f.properties[perField]);
                        const value = this.getValueFromFeature(f, n.on, normalizeField);
                        const minimum = minMax[0];
                        const max = minMax[1];
                        let normalizedValue;
                        if (minimum === max) {
                            normalizedValue = 1;
                        } else {
                            normalizedValue = (value - minimum) / (max - minimum);
                        }
                        f.properties[normalizeField + '_globally_normalized_per_' + perField] = normalizedValue;
                    }
                } else {
                    // TODO : Support global normalization
                }
                if (n.on) {
                    fieldsToCleanSet.add(n.on);
                }
                if (n.per) {
                    fieldsToCleanSet.add(n.per);
                }

            });
            fieldsToCleanSet.forEach((field: string) => {
                if (field && !this.includeFeaturesFieldsSet.has(field) && !this.collectionParams.has(field)) {
                    delete f.properties[(this.isFlat && field) ? field.replace(/\./g, this.FLAT_CHAR) : field];
                }
            });
            /** clean the fields used for color generation but not included in includeFeaturesFields */
            if (this.colorGenerationFields) {
                this.colorGenerationFields.forEach(cf => {
                    if (cf && !this.includeFeaturesFieldsSet.has(cf) && !this.collectionParams.has(cf)) {
                        delete f.properties[this.isFlat ? cf.replace(/\./g, this.FLAT_CHAR) : cf];
                    }
                });
            }
        });
    }
    private getValueFromFeature(f: Feature, field: string, flattenedField): number {
        let value = +f.properties[flattenedField];
        if (isNaN(value)) {
            if (this.dateFieldFormatMap.has(field)) {
                /** Moment Format character for days is `D` while the one given by ARLAS-server is `d`
                 * Thus, we replace the `d` with `D` to adapt to Moment library.
                */
                const dateFormat = this.dateFieldFormatMap.get(field).replace('dd', 'DD');
                value = moment.utc(f.properties[flattenedField], dateFormat).valueOf();
            }
        }
        return value;
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
            } else if (fieldList[fieldName].type === 'GEO_SHAPE') {
                this.geoShapeFields.push((parentPrefix ? parentPrefix : '') + fieldName);
            } else if (fieldList[fieldName].type === 'DATE') {
                this.dateFieldFormatMap.set((parentPrefix ? parentPrefix : '') + fieldName, fieldList[fieldName].format);
            }
        }
    }

    private setFeatureColor(feature: Feature): Feature {
        if (this.colorGenerationFields) {
            this.colorGenerationFields.forEach((field: string) => {
                const featureField = this.isFlat ? field.replace(/\./g, this.FLAT_CHAR) : field;
                feature.properties[featureField + '_color'] = this.getHexColor(feature.properties[featureField], 0.5);
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
        hex = '00000'.substring(0, 6 - hex.length) + hex;
        const color = mix(hex, hex);
        color.saturate(color.toHsv().s * saturationWeight + ((1 - saturationWeight) * 100));
        return color.toHexString();
    }
}

