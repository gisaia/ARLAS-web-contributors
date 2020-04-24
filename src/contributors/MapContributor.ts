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

import { Observable, Subject, from, of } from 'rxjs';
import { map, finalize, mergeAll, tap, takeUntil, elementAt } from 'rxjs/operators';

import {
    CollaborativesearchService, Contributor,
    ConfigService, Collaboration,
    projType, GeohashAggregation, TiledSearch, CollaborationEvent
} from 'arlas-web-core';
import {
    Search, Expression, Hits, CollectionReferenceParameters,
    Aggregation, Projection, Filter, FeatureCollection, Feature
} from 'arlas-api';
import { OnMoveResult, ElementIdentifier, PageEnum, FeaturesNormalization,
     LayerClusterSource, LayerTopologySource, LayerFeatureSource, Granularity, SourcesAgg, MetricConfig, SourcesSearch } from '../models/models';
import { appendIdToSort, ASC, fineGranularity, coarseGranularity, finestGranularity, removePageFromIndex } from '../utils/utils';
import { bboxes } from 'ngeohash';
import jsonSchema from '../jsonSchemas/mapContributorConf.schema.json';

import bboxPolygon from '@turf/bbox-polygon';
import booleanContains from '@turf/boolean-contains';
import { getBounds, truncate, isClockwise, tileToString, stringToTile, xyz } from './../utils/mapUtils';

import * as helpers from '@turf/helpers';
import { stringify, parse } from 'wellknown';
import { mix } from 'tinycolor2';
import moment from 'moment';


export enum DataMode {
    simple,
    dynamic
}

export const NORMALIZE = ':normalized';
export const NORMALIZE_PER_KEY = ':normalized:';
export const COUNT = 'count';
export const NORMALIZED_COUNT = 'count_:normalized';
export const AVG = '_avg_';
export const SUM = '_sum_';
export const MIN = '_min_';
export const MAX = '_max_';
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
    public isSimpleModeAccumulative: boolean;
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
    private SIMPLE_MODE_ACCUMULATIVE_KEY = 'simple_mode_accumulative';
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

    private sourcesTypesIndex: Map<string, string> = new Map();
    private layersSourcesIndex: Map<string, string> = new Map();
    private visibiltyRulesIndex: Map<string, {type: string, minzoom: number, maxzoom: number, nbfeatures: number}> = new Map();

    /**Cluster data support */
    private geohashesPerSource: Map<string, Map<string, Feature>> = new Map();
    private parentGeohashesPerSource: Map<string, Set<string>> = new Map();

    /**Topology data support */
    private topologyDataPerSource: Map<string, Array<Feature>> = new Map();

    /**Feature data support */
    private featureDataPerSource: Map<string, Array<Feature>> = new Map();

    private aggSourcesStats: Map<string, {count: number, sum?: number}> = new Map();
    private aggSourcesMetrics: Map<string, Set<string>> = new Map();
    private searchNormalizations: Map<string, Map<string, FeaturesNormalization>> = new Map();
    private searchSourcesMetrics: Map<string, Set<string>> = new Map();
    private sourcesVisitedTiles: Map<string, Set<string>> = new Map();
    private sourcesPrecisions: Map<string, {tilesPrecision?: number, requestsPrecision?: number}> = new Map();
    private granularityFunctions: Map<Granularity, (zoom: number) => {tilesPrecision: number, requestsPrecision: number}> = new Map();
    private collectionParameters: CollectionReferenceParameters;
    private featuresIdsIndex = new Map<string, Set<string>>();
    private featuresOldExtent = new Map<string, any>();

    /**This map stores for each agg id, a map of call Instant and a Subject;
     * The Subject will be emitted once precision of agg changes ==> all previous calls that are still pending will stop */
    private cancelSubjects: Map<string, Map<string, Subject<void>>> = new Map();
    /**This map stores for each agg id, the instant of the lastest call to this agg. */
    private lastCalls: Map<string, string> = new Map();
    /**This map stores for each agg id, an abort controller. This controller will abort pending calls when precision of
      * the agg changes. */
    private abortControllers: Map<string, AbortController> = new Map();

    public geojsondraw: { type: string, features: Array<any> } = {
        'type': 'FeatureCollection',
        'features': []
    };

    /** Additional Arlas filter to add the BBOX and filter comming from Collaborations*/
    protected additionalFilter: Filter;
    /**
     * List of fields pattern or names that will be included in features mode as geojson properties.
     */

    public zoom;
    public mapExtend = [90, -180, -90, 180];
    public mapRawExtent = [90, -180, -90, 180];
    public visibleSources: Set<string> = new Set();
    public geoPointFields = new Array<string>();
    public geoShapeFields = new Array<string>();

    public countExtendBus = new Subject<{ count: number, threshold: number }>();
    public saturationWeight = 0.5;

    /**
     * A filter that is taken into account when fetching features and that is not included in the global collaboration.
     * It's used in `Simple mode` only.
     */
    public expressionFilter: Expression;

    public redrawSource: Subject<any> = new Subject<any>();
    /** CONSTANTS */
    private NEXT_AFTER = '_nextAfter';
    private PREVIOUS_AFTER = '_previousAfter';
    private FLAT_CHAR = '_';

    /** <date field - date format> map */
    private dateFieldFormatMap: Map<string, string> = new Map<string, string>();


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
        const simpleModeAccumulativeConfig = this.getConfigValue(this.SIMPLE_MODE_ACCUMULATIVE_KEY);
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
            if (simpleModeAccumulativeConfig !== undefined) {
                this.isSimpleModeAccumulative = simpleModeAccumulativeConfig;
            } else {
                this.isSimpleModeAccumulative = false;
            }
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
        this.searchSize = searchSizeConfig !== undefined ? searchSizeConfig : this.DEFAULT_SEARCH_SIZE;
        this.searchSort = searchSortConfig !== undefined ? searchSortConfig : this.DEFAULT_SEARCH_SORT;
        this.drawPrecision = drawPrecisionConfig !== undefined ? drawPrecisionConfig : this.DEFAULT_DRAW_PRECISION;
        this.isFlat = isFlatConfig !== undefined ? isFlatConfig : this.DEFAULT_IS_FLAT;
        this.granularityFunctions.set(Granularity.fine, fineGranularity);
        this.granularityFunctions.set(Granularity.coarse, coarseGranularity);
        this.granularityFunctions.set(Granularity.finest, finestGranularity);
        // TODO check if we should include the collection reference in the collobarative search service, to avoid doing a describe
        // in this contributor
        this.collaborativeSearcheService.describe(collaborativeSearcheService.collection)
            .subscribe(collection => {
                const fields = collection.properties;
                Object.keys(fields).forEach(fieldName => {
                    this.getFieldProperties(fields, fieldName);
                });
                this.collectionParameters = collection.params;
                this.geoQueryField = geoQueryFieldConfig !== undefined ? geoQueryFieldConfig : this.collectionParameters.centroid_path;
            }
        );
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
        const wrapExtent = this.mapExtend[1] + ',' + this.mapExtend[2] + ','
          + this.mapExtend[3] + ',' + this.mapExtend[0];
        const rawExtent = this.mapRawExtent[1] + ',' + this.mapRawExtent[2] + ','
            + this.mapRawExtent[3] + ',' + this.mapRawExtent[0];
        this.searchNormalizations.clear();
        this.searchSourcesMetrics.clear();
        this.featureDataPerSource.clear();
        this.featuresIdsIndex.clear();
        this.featuresOldExtent.clear();
        this.getSimpleModeData(wrapExtent, rawExtent, this.searchSort, this.isSimpleModeAccumulative);
        return of();
    }

    public fetchDataDynamicMode(collaborationEvent: CollaborationEvent): Observable<FeatureCollection> {
        const wrapExtent = this.mapExtend[1] + ',' + this.mapExtend[2] + ','
          + this.mapExtend[3] + ',' + this.mapExtend[0];
        const rawExtent = this.mapRawExtent[1] + ',' + this.mapRawExtent[2] + ','
            + this.mapRawExtent[3] + ',' + this.mapRawExtent[0];
        this.aggSourcesMetrics.clear();
        this.aggSourcesStats.clear();
        this.sourcesPrecisions.clear();
        this.sourcesVisitedTiles.clear();
        this.topologyDataPerSource.clear();
        this.geohashesPerSource.clear();
        this.featureDataPerSource.clear();
        this.featuresIdsIndex.clear();
        this.featuresOldExtent.clear();
        this.parentGeohashesPerSource.clear();
        this.searchNormalizations.clear();
        this.searchSourcesMetrics.clear();
        this.getDynamicModeData(rawExtent, wrapExtent, this.mapExtend, this.zoom, this.visibleSources);
        return of();
    }

    public onMoveSimpleMode(newMove: OnMoveResult) {
        this.zoom = newMove.zoom;
        this.mapExtend = newMove.extendForLoad;
        this.mapRawExtent = newMove.rawExtendForLoad;
        const wrapExtent = newMove.extendForLoad[1] + ',' + newMove.extendForLoad[2] + ','
          + newMove.extendForLoad[3] + ',' + newMove.extendForLoad[0];
        const rawExtent = newMove.rawExtendForLoad[1] + ',' + newMove.rawExtendForLoad[2] + ','
            + newMove.rawExtendForLoad[3] + ',' + newMove.rawExtendForLoad[0];
        if (this.updateData) {
            this.getSimpleModeData(wrapExtent, rawExtent, this.searchSort, this.isSimpleModeAccumulative);
        }
    }

    public changeVisualisation(visibleLayers: Set<string>) {
        const visibleSources = new Set<string>();
        visibleLayers.forEach(l => {
         visibleSources.add(this.layersSourcesIndex.get(l))
        });
        this.visibleSources = visibleSources;
        this.fetchDataDynamicMode(null);
    }
    /**
    * Function called on onMove event
    */
    public onMoveDynamicMode(newMove: OnMoveResult) {
        this.zoom = newMove.zoom;
        this.mapExtend = newMove.extendForLoad;
        this.mapRawExtent = newMove.rawExtendForLoad;
        const visibleSources = new Set<string>();
        this.visibleSources.clear();
        newMove.visibleLayers.forEach(l => {
            this.visibleSources.add(this.layersSourcesIndex.get(l)); visibleSources.add(this.layersSourcesIndex.get(l))
        });
        const wrapExtent = newMove.extendForLoad[1] + ',' + newMove.extendForLoad[2] + ','
          + newMove.extendForLoad[3] + ',' + newMove.extendForLoad[0];
        const rawExtent = newMove.rawExtendForLoad[1] + ',' + newMove.rawExtendForLoad[2] + ','
            + newMove.rawExtendForLoad[3] + ',' + newMove.rawExtendForLoad[0];
        if (this.updateData) {
            this.getDynamicModeData(rawExtent, wrapExtent, newMove.extendForLoad, this.zoom, visibleSources);
        }
    }
    public computeData(data: any) {
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
    }

    /**
     * Sets the point field on which geoaggregation is applied
     * @param geoAggregateField
     */
    public setGeoAggregateGeomField(geoAggregateField: string) {

    }

    /**
     * fetches the data, sets it and sets the selection after changing the geometry/path to query
     */
    public onChangeGeometries() {

    }

    /**
     * Fetches the data for the `Simple mode`
     * @param includeFeaturesFields properties to include in geojson features
     * @param sort comma separated field names on which feature are sorted.
     * @param afterParam comma seperated field values from which next/previous data is fetched
     * @param whichPage Whether to fetch next or previous set.
     * @param fromParam (page.from in arlas api) an offset from which fetching hits starts. It's ignored if `afterParam` is set.
     */
    public getSimpleModeData(wrapExtent, rawExtent, sort: string, keepOldData = true,
        afterParam?: string, whichPage?: PageEnum, fromParam?): void {
        const countFilter: Filter = this.getFilterForCount(rawExtent, wrapExtent, this.collectionParameters.centroid_path);
        if (this.expressionFilter !== undefined) {
            countFilter.f.push([this.expressionFilter]);
        }
        this.addFilter(countFilter, this.additionalFilter);
        const dFeatureSources = Array.from(this.featureLayersIndex.keys());
        const featureSearchBuilder = this.prepareFeaturesSearch(dFeatureSources, SearchStrategy.combined);
        const search: Search = featureSearchBuilder.get(this.getSearchId(SearchStrategy.combined)).search;
        if (!keepOldData) {
            const sources = featureSearchBuilder.get(this.getSearchId(SearchStrategy.combined)).sources;
            sources.forEach(s => {
                this.featureDataPerSource.set(s, []);
            });
        }
        search.page.sort = sort;
        let renderStrategy: RenderStrategy;
        if (afterParam) {
            if (whichPage === PageEnum.next) {
                search.page.after = afterParam;
            } else {
                search.page.before = afterParam;
            }
            renderStrategy = RenderStrategy.scroll;
        } else {
            if (fromParam !== undefined) {
                search.page.from = fromParam;
            }
            renderStrategy = RenderStrategy.accumulative;
        }
        featureSearchBuilder.set(this.getSearchId(SearchStrategy.combined), {search, sources: dFeatureSources});
        this.fetchSearchSources(countFilter, featureSearchBuilder, renderStrategy);
    }

    public getDynamicModeData(rawExtent, wrapExtent, mapExtent, zoom: number, visibleSources: Set<string>): void {
        const countFilter = this.getFilterForCount(rawExtent, wrapExtent, this.collectionParameters.centroid_path);
        this.addFilter(countFilter, this.additionalFilter);
        /** Get displayable sources using zoom visibility rules only.
         *  If the precision of a cluster souce changes, it will stop the ongoing http calls */
        let displayableSources = this.getDisplayableSources(zoom, visibleSources);
        let dClusterSources = displayableSources[0];
        let dTopologySources = displayableSources[1];
        let dFeatureSources = displayableSources[2];
        const callOrigin = Date.now() + '';
        this.checkAggPrecision(dClusterSources, zoom, callOrigin);
        this.checkAggPrecision(dTopologySources, zoom, callOrigin);
        this.checkFeatures(dFeatureSources, callOrigin);
        const zoomSourcesToRemove = displayableSources[3];
        zoomSourcesToRemove.forEach(s => {
            this.redrawSource.next({source: s, data: []});
            this.clearData(s);
            this.aggSourcesMetrics.set(s, new Set());
            this.abortRemovedSources(s, callOrigin);
        });
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        const count: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits([projType.count, {}],
            this.collaborativeSearcheService.collaborations, this.identifier, countFilter, false, this.cacheDuration);
        if (count) {        console.log('moove');

            count.subscribe(countResponse => {
                this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                const nbFeatures = countResponse.totalnb;
                displayableSources = this.getDisplayableSources(zoom, visibleSources, nbFeatures);
                dClusterSources = displayableSources[0];
                dTopologySources = displayableSources[1];
                dFeatureSources = displayableSources[2];
                const nbFeaturesSourcesToRemove = displayableSources[3];
                const alreadyRemovedSources = new Set(zoomSourcesToRemove);
                nbFeaturesSourcesToRemove.filter(s => !alreadyRemovedSources.has(s)).forEach(s => {
                    this.redrawSource.next({source: s, data: []});
                    this.clearData(s);
                    this.aggSourcesMetrics.set(s, new Set());
                    this.abortRemovedSources(s, callOrigin);
                });
                const clusterAggsBuilder = this.prepareClusterAggregations(dClusterSources, zoom);
                const topologyAggsBuilder = this.prepareTopologyAggregations(dTopologySources, zoom);
                const featureSearchBuilder = this.prepareFeaturesSearch(dFeatureSources, SearchStrategy.visibility_rules);
                this.fetchAggSources(mapExtent, zoom, clusterAggsBuilder, this.CLUSTER_SOURCE);
                this.fetchAggSources(mapExtent, zoom, topologyAggsBuilder, this.TOPOLOGY_SOURCE);
                this.fetchTiledSearchSources(mapExtent, featureSearchBuilder);
            });
        }
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
    }

    public setSelection(data: any, collaboration: Collaboration): any {
        this.setDrawings(collaboration);
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
                idFieldName: this.collectionParameters.id_path,
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

    /**
     * Renders the data of the given agg sources.
     * @param sources List of sources names (sources must be of the same type : cluster OR topology)
     */
    public renderAggSources(sources: Array<string>): void {
        if (sources && sources.length > 0) {
            const aggType = this.sourcesTypesIndex.get(sources[0]);
            switch (aggType) {
                case this.CLUSTER_SOURCE:
                    this.renderClusterSources(sources);
                    break;
                case this.TOPOLOGY_SOURCE:
                    this.renderTopologySources(sources);
                    break;
            }
        }
    }

    /**
     * Render raw data provided by `feature` mode sources. It's used for both simple and dynamic mode.
     * @param sources List of sources names (sources must be of the same type : feature)
     */
    public renderSearchSources(sources: Array<string>): void {
        sources.forEach(s => {
            this.redrawSource.next({source: s, data: []});
            const featureRawData = this.featureDataPerSource.get(s);
            const sourceData = [];
            if (featureRawData) {
                featureRawData.forEach(f => {
                    const properties = Object.assign({}, f.properties);
                    const feature = Object.assign({}, f);
                    feature.properties = properties;
                    const normalizations = this.searchNormalizations.get(s);
                    if (normalizations) {
                        normalizations.forEach(n => this.normalize(feature, n));
                    }
                    const colorField = this.featureLayersIndex.get(s).colorField;
                    if (colorField) {
                        const flattenColorField = colorField.replace(/\./g, this.FLAT_CHAR);
                        feature.properties[flattenColorField + '_color'] = this.getHexColor(feature.properties[flattenColorField], 0.5);
                    }
                    delete feature.properties.geometry_path;
                    delete feature.properties.feature_type;
                    delete feature.properties.md;
                    const metricsKeys = this.searchSourcesMetrics.get(s);
                    Object.keys(feature.properties).forEach(k => {
                        if (metricsKeys && !metricsKeys.has(k) && k !== 'id') {
                            delete feature.properties[k];
                        }
                    });
                    sourceData.push(feature);
                });
            }
            this.redrawSource.next({source: s, data: sourceData});
        });
    }

    /**
     * Renders the data of the given topology sources.
     * @param sources List of sources names (sources must be of the same type : topology)
     */
    public renderTopologySources(sources: Array<string>): void {
        sources.forEach(s => {
            this.redrawSource.next({source: s, data: []});
            const topologyRawData = this.topologyDataPerSource.get(s);
            const sourceData = [];
            if (topologyRawData) {
                topologyRawData.forEach((f) => {
                    const properties = Object.assign({}, f.properties);
                    const feature = Object.assign({}, f);
                    feature.properties = properties;
                    // feature.properties['point_count_abreviated'] = this.intToString(feature.properties.count);
                    this.cleanRenderedAggFeature(s, feature);
                    sourceData.push(feature);
                });
            }
            this.redrawSource.next({source: s, data: sourceData});
        });
    }

    /**
     * Renders the data of the given cluster sources.
     * @param sources List of sources names (sources must be of the same type : cluster)
     */
    public renderClusterSources(sources: Array<string>): void {
        sources.forEach(s => {
            this.redrawSource.next({source: s, data: []});
            const sourceGeohashes = this.geohashesPerSource.get(s);
            const sourceData = [];
            if (sourceGeohashes) {
                sourceGeohashes.forEach((f, geohash) => {
                    const properties = Object.assign({}, f.properties);
                    const feature = Object.assign({}, f);
                    feature.properties = properties;
                    // feature.properties['point_count_abreviated'] = this.intToString(feature.properties.count);
                    delete feature.properties.geohash;
                    delete feature.properties.parent_geohash;
                    this.cleanRenderedAggFeature(s, feature, true);
                    sourceData.push(feature);
                });
            }
            this.redrawSource.next({source: s, data: sourceData});
        });
    }

    /**
     * Resolves data for features sources (used in dinamic mode only) using tiled geosearch (arlas-api)
     * @param tiles newly visited tiles on which data will be resolved
     * @param searchId identifier of search responsible of fetching this data
     * @param search Search object (from `arlas-api`) that indicates how data will be resolved
     */
    public resolveTiledSearchSources(tiles: Set<string>, searchId: string, search: Search): Observable<FeatureCollection> {
        const tabOfTile: Array<Observable<FeatureCollection>> = [];
        let filter: Filter = {};
        if (this.expressionFilter !== undefined) {
            filter = {
                f: [[this.expressionFilter]]
            };
        }
        const control = this.abortControllers.get(searchId);
        this.addFilter(filter, this.additionalFilter);
        tiles.forEach(stringTile => {
            const tile = stringToTile(stringTile);
            const tiledSearch: TiledSearch = {
                search,
                x: tile.x,
                y: tile.y,
                z: tile.z
            };
            const searchResult: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNotFeatureCollectionWithAbort(
                [projType.tiledgeosearch, tiledSearch], this.collaborativeSearcheService.collaborations, this.isFlat, control.signal,
                null, filter, this.cacheDuration);
            tabOfTile.push(searchResult);
        });
        return from(tabOfTile).pipe(mergeAll());
    }

    /**
     * Resolves data for features sources (used in simple mode only) using geosearch (arlas-api)
     * @param filter Filter object (from `arlas-api`) that requests the data to be resolved
     * @param searchId identifier of search responsible of fetching this data
     * @param search Search object (from `arlas-api`) that indicates how data will be resolved
     */
    public resolveSearchSources(filter: Filter, searchId: string, search: Search): Observable<FeatureCollection> {
        return this.collaborativeSearcheService.resolveButNotFeatureCollection(
            [projType.geosearch, search], this.collaborativeSearcheService.collaborations, this.isFlat,
            null, filter, this.cacheDuration);

    }
    public resolveAggSources(visitedTiles: Set<string>, aggId: string, aggregation: Aggregation):
        Observable<FeatureCollection> {
        const tabOfGeohash: Array<Observable<FeatureCollection>> = [];
        const control = this.abortControllers.get(aggId);
        visitedTiles.forEach(geohash => {
            const geohahsAggregation: GeohashAggregation = {
                geohash: geohash,
                aggregations: [aggregation]
            };
            const geoAggregateData: Observable<FeatureCollection> =
                this.collaborativeSearcheService.resolveButNotFeatureCollectionWithAbort(
                    [projType.geohashgeoaggregate, geohahsAggregation], this.collaborativeSearcheService.collaborations,
                    this.isFlat, control.signal, null, this.additionalFilter, this.cacheDuration);
            tabOfGeohash.push(geoAggregateData);
        });
        return from(tabOfGeohash).pipe(mergeAll());
    }

    public fetchTiledSearchSources(extent: Array<number>, searches: Map<string, SourcesSearch>) {
        searches.forEach((searchSource, searchId) => {
            const newVisitedTiles = this.getVisitedXYZTiles(extent, searchSource.sources);
            let count = 0;
            const totalcount = newVisitedTiles.size;
            if (newVisitedTiles.size > 0 && searchSource.sources.length > 0) {
                this.collaborativeSearcheService.ongoingSubscribe.next(1);
                const start = Date.now();
                const cancelSubjects = this.cancelSubjects.get(searchId);
                const lastCall = this.lastCalls.get(searchId);
                this.resolveTiledSearchSources(newVisitedTiles, searchId, searchSource.search)
                .pipe(
                    takeUntil(cancelSubjects && cancelSubjects.get(lastCall) ? cancelSubjects.get(lastCall) : of()),

                    map(f => this.computeFeatureData(f, searchSource.sources)),
                    tap(() => count++),
                    finalize(() => {
                        this.renderSearchSources(searchSource.sources);
                        this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                    })
                ).subscribe(data => data);
            }

        });
    }

    public fetchSearchSources(filter: Filter, searches: Map<string, SourcesSearch>, renderStrategy: RenderStrategy) {
        searches.forEach((searchSource, searchId) => {
            this.resolveSearchSources(filter, searchId, searchSource.search)
                .pipe(
                    map(f => this.computeSimpleModeFeature(f, searchSource.sources, renderStrategy)),
                    finalize(() => {
                        this.renderSearchSources(searchSource.sources);
                        this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                    })
                ).subscribe(data => data);

        });
    }
    public fetchAggSources(extent: Array<number>, zoom: number, aggs:  Map<string, SourcesAgg>, aggType: string): void {
        aggs.forEach((aggSource, aggId) => {
            let granularity;
            if (aggType === this.CLUSTER_SOURCE) {
                granularity = this.clusterLayersIndex.get(aggSource.sources[0]).granularity;
            } else if (aggType === this.TOPOLOGY_SOURCE) {
                granularity = this.topologyLayersIndex.get(aggSource.sources[0]).granularity;
            }
            const newVisitedTiles = this.getVisitedTiles(extent, zoom, granularity, aggSource, aggType);
            let count = 0;
            const totalcount = newVisitedTiles.size;
            if (newVisitedTiles.size > 0) {
                this.collaborativeSearcheService.ongoingSubscribe.next(1);
                const cancelSubjects = this.cancelSubjects.get(aggId);
                const lastCall = this.lastCalls.get(aggId);
                const renderRetries = [];
                const start = Date.now();
                this.resolveAggSources(newVisitedTiles, aggId, aggSource.agg)
                .pipe(
                    takeUntil(cancelSubjects && cancelSubjects.get(lastCall) ? cancelSubjects.get(lastCall) : of()),
                    map(f => this.computeAggData(f, aggSource, aggType)),
                    tap(() => count++),
                    // todo strategy to render data at some stages
                    tap(() => {
                        const progression = count / totalcount * 100;
                        const consumption = Date.now() - start;
                        if (consumption > 2000) {
                            if (progression > 25 && renderRetries.length === 0) {
                                this.renderAggSources(aggSource.sources);
                                renderRetries.push('1');
                            }
                            if (progression > 50 && renderRetries.length <= 1) {
                                this.renderAggSources(aggSource.sources);
                                renderRetries.push('2');
                            }
                            if (progression > 75 && renderRetries.length <= 2) {
                                this.renderAggSources(aggSource.sources);
                                renderRetries.push('3');
                            }
                        }
                    }),
                    finalize(() => {
                        this.renderAggSources(aggSource.sources);
                        this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                    })
                ).subscribe(data => data);
            }
        });
    }

    public computeAggData(fc: FeatureCollection, aggSource: SourcesAgg, aggType: string): void {
        if (aggType === this.CLUSTER_SOURCE) {
            this.computeClusterData(fc, aggSource);
        } else if (aggType === this.TOPOLOGY_SOURCE) {
            this.computeTopologyData(fc, aggSource);
        }
    }

    public computeFeatureData(featureCollection: FeatureCollection, sources: Array<string>): void {
        const geometry_source_index = new Map();
        const source_geometry_index = new Map();
        sources.forEach(cs => {
            const ls = this.featureLayersIndex.get(cs);
            const geometryPath = ls.returnedGeometry;
            geometry_source_index.set(geometryPath, cs);
            source_geometry_index.set(cs, geometryPath);
        });
        if (featureCollection && featureCollection.features !== undefined) {
            featureCollection.features.forEach(feature => {
                sources.forEach(source => {
                    let featureData = this.featureDataPerSource.get(source);
                    if (!featureData) {
                        featureData = new Array();
                    }
                    let ids = this.featuresIdsIndex.get(source);
                    if (!ids) {
                        ids = new Set();
                    }
                    const idPath = this.isFlat ? this.collectionParameters.id_path.replace(/\./g, this.FLAT_CHAR) :
                     this.collectionParameters.id_path;
                    feature.properties.id = feature.properties[idPath];
                    if (!ids.has(feature.properties.id)) {
                        const normalizations = this.searchNormalizations.get(source);
                        if (normalizations) {
                            normalizations.forEach(n => {
                                this.prepareSearchNormalization(feature, n);
                            });
                            this.searchNormalizations.set(source, normalizations);
                        }
                        if (feature.properties.geometry_path === source_geometry_index.get(source)) {
                            featureData.push(feature);
                        }
                        ids.add(feature.properties.id);
                        this.featuresIdsIndex.set(source, ids);
                    }
                    this.featureDataPerSource.set(source, featureData);
                });
            });
        }
    }
    public computeTopologyData(featureCollection: FeatureCollection, aggSource: SourcesAgg): void {
        if (featureCollection && featureCollection.features !== undefined) {
            featureCollection.features.forEach(feature => {
                delete feature.properties.key;
                delete feature.properties.key_as_string;
                aggSource.sources.forEach(source => {
                    let topologyData = this.topologyDataPerSource.get(source);
                    if (!topologyData) {
                        topologyData = new Array();
                    }
                    this.calculateAggMetricsStats(source, feature);
                    topologyData.push(feature);
                    this.topologyDataPerSource.set(source, topologyData);
                });
            });
        }
    }
    public computeClusterData(featureCollection: FeatureCollection, aggSource: SourcesAgg): void {
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
                        const metricsKeys = this.aggSourcesMetrics.get(source);
                        if (!parentGeohashes.has(feature.properties.parent_geohash)) {
                            /** when this tile (parent_geohash) is requested for the first time we merge the counts */
                            if (metricsKeys) {
                                const countValue = feature.properties.count;
                                metricsKeys.forEach(key => {
                                    const realKey = key.replace(NORMALIZE, '');
                                    if (key.includes(SUM)) {
                                        feature.properties[realKey] += existingGeohash.properties[realKey];
                                    } else if (key.includes(MAX)) {
                                        feature.properties[realKey] = (feature.properties[realKey] > existingGeohash.properties[realKey]) ?
                                            feature.properties[realKey] : existingGeohash.properties[realKey];
                                    } else if (key.includes(MIN)) {
                                        feature.properties[realKey] = (feature.properties[realKey] < existingGeohash.properties[realKey]) ?
                                            feature.properties[realKey] : existingGeohash.properties[realKey];
                                    } else if (key.includes(AVG)) {
                                        /** calculates a weighted average. existing geohash feature is already weighted */
                                        feature.properties[realKey] = feature.properties[realKey] *
                                        countValue + existingGeohash.properties[realKey];
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
                                    const realKey = key.replace(NORMALIZE, '');
                                    feature.properties[realKey] = existingGeohash.properties[realKey];
                                });
                            }
                        }
                    });
                } else {
                    aggSource.sources.forEach(source => {
                        const metricsKeys = this.aggSourcesMetrics.get(source);
                        if (metricsKeys) {
                            const countValue = feature.properties.count;
                            metricsKeys.forEach(key => {
                                if (key.includes(AVG)) {
                                    const realKey = key.replace(NORMALIZE, '');
                                    feature.properties[realKey] = feature.properties[realKey] * countValue;
                                }
                            });
                        }
                    });
                }
                aggSource.sources.forEach(source => {
                    if (geometryRef === source_geometry_index.get(source)) {
                        let geohashesMap = this.geohashesPerSource.get(source);
                        if (!geohashesMap) {
                            geohashesMap = new Map();
                        }
                        geohashesMap.set(feature.properties.geohash, feature);
                        this.geohashesPerSource.set(source, geohashesMap);
                        parentGeohashesPerSource.set(source, feature.properties.parent_geohash);
                        this.calculateAggMetricsStats(source, feature);
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
        const wrapExtent = this.mapExtend[1] + ',' + this.mapExtend[2] + ','
        + this.mapExtend[3] + ',' + this.mapExtend[0];
        const rawExtent = this.mapRawExtent[1] + ',' + this.mapRawExtent[2] + ','
          + this.mapRawExtent[3] + ',' + this.mapRawExtent[0];
        let after;
        if (whichPage === PageEnum.previous) {
            after = reference.get(this.PREVIOUS_AFTER);
        } else {
            after = reference.get(this.NEXT_AFTER);
        }
        const sortWithId = appendIdToSort(sort, ASC, this.collectionParameters.id_path);
        const keepOldData = true;
        if (after !== undefined) {
            this.getSimpleModeData(wrapExtent, rawExtent, sortWithId, keepOldData, after, whichPage);
        }
    }

    public computeSimpleModeFeature(featureCollection: FeatureCollection, sources: Array<string>,
        renderStrategy: RenderStrategy, maxPages?: number, whichPage?: PageEnum) {
        const geometry_source_index = new Map();
        const source_geometry_index = new Map();
        sources.forEach(cs => {
            const ls = this.featureLayersIndex.get(cs);
            const geometryPath = ls.returnedGeometry;
            geometry_source_index.set(geometryPath, cs);
            source_geometry_index.set(cs, geometryPath);
        });
        if (featureCollection && featureCollection.features !== undefined) {
            featureCollection.features.forEach(feature => {
                sources.forEach(source => {
                    const idPath = this.isFlat ? this.collectionParameters.id_path.replace(/\./g, this.FLAT_CHAR) :
                     this.collectionParameters.id_path;
                    feature.properties.id = feature.properties[idPath];
                    const normalizations = this.searchNormalizations.get(source);
                    if (normalizations) {
                        normalizations.forEach(n => {
                            this.prepareSearchNormalization(feature, n);
                        });
                        this.searchNormalizations.set(source, normalizations);
                    }
                });
            });
            const f = featureCollection.features;
            switch (renderStrategy) {
                case RenderStrategy.accumulative:
                    sources.forEach(source => {
                        let sourceData = this.featureDataPerSource.get(source);
                        if (!sourceData) {
                            sourceData = new Array();
                        }
                        sourceData = sourceData.concat(f);
                    });
                    break;
                case RenderStrategy.scroll:
                    if (maxPages !== undefined && maxPages !== null && whichPage !== undefined && whichPage !== null) {
                        sources.forEach(source => {
                            const sourceData = this.featureDataPerSource.get(source);
                            if (maxPages !== -1) {
                                (whichPage === PageEnum.next) ? f.forEach(d => { sourceData.push(d); }) :
                                    f.reverse().forEach(d => { sourceData.unshift(d); });
                                (whichPage === PageEnum.next) ? removePageFromIndex(0, sourceData, this.searchSize, maxPages) :
                                    removePageFromIndex(sourceData.length - this.searchSize, sourceData, this.searchSize, maxPages);
                            } else {
                                if (whichPage === PageEnum.next) {
                                    f.forEach(d => { sourceData.push(d); });
                                }
                            }
                            this.featureDataPerSource.set(source, sourceData);
                        });
                    } else {
                        throw new Error('Can\'t apply scroll render strategy. Need to specify: maxpages, whichPage');
                    }
            }
        }
    }

    /**
     * Cleans all the old data, then it draws new fetched data using `formParam` and `appendId`
     * @param fromParam Index of the search scrolling. Default to 0;
     * @param appendId Whether to append the id field name to the sort string. Default to 'false'
     */
    public drawGeoSearch(fromParam?: number, appendId?: boolean) {
        const wrapExtent = this.mapExtend[1] + ',' + this.mapExtend[2] + ','
          + this.mapExtend[3] + ',' + this.mapExtend[0];
        const rawExtent = this.mapRawExtent[1] + ',' + this.mapRawExtent[2] + ','
            + this.mapRawExtent[3] + ',' + this.mapRawExtent[0];
        const sort = appendId ? appendIdToSort(this.searchSort, ASC, this.collectionParameters.id_path) : this.searchSort;
        const keepOldData = false;
        this.getSimpleModeData(wrapExtent, rawExtent, sort, keepOldData, null, null, fromParam);
    }

    public getFilterForCount(rawExtend: string, wrapExtend: string, countGeoField: string): Filter {
        // west, south, east, north
        const finalExtend = [];
        const wrapExtentTab = wrapExtend.split(',').map(d => parseFloat(d)).map(n => Math.floor(n * 100000) / 100000);
        const rawExtentTab = rawExtend.split(',').map(d => parseFloat(d)).map(n => Math.floor(n * 100000) / 100000);
        const rawExtentForTest = rawExtentTab.join(',');
        const wrapExtentForTest = wrapExtentTab.join(',');
        if (rawExtentTab[0] < -180 && rawExtentTab[2] > 180) {
            finalExtend.push('-180' + ',' + '-90' + ',' + '180' + ',' + '90');
        } else if (rawExtentForTest === wrapExtentForTest) {
            finalExtend.push(wrapExtend.trim());
        } else {
            let west = wrapExtentTab[0];
            let east = wrapExtentTab[2];
            if (west < 0 && east < 0) {
                west = west * -1;
                east = east * -1;
            }
            if (west > east) {
                const firstExtent = wrapExtentTab[0] + ',' + wrapExtentTab[1] + ',' + '180' + ',' + wrapExtentTab[3];
                const secondExtent = '-180' + ',' + wrapExtentTab[1] + ',' + wrapExtentTab[2] + ',' + wrapExtentTab[3];
                finalExtend.push(firstExtent.trim());
                finalExtend.push(secondExtent.trim());
            } else {
                finalExtend.push(wrapExtend.trim());
            }
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
     * includes one or several sources.
     * @param clusterSources List of cluster sources ids
     * @param zoom zoom level. Zoom level is necessary to get the aggregation precision.
     * @param checkPrecisionChanges If true, this function performs a check of precision change.
     * If so, the ongoing http calls of the same aggregation are stopped.
     */
    private prepareClusterAggregations(clusterSources: Array<string>, zoom: number): Map<string, SourcesAgg> {
        const aggregationsMap: Map<string, SourcesAgg> = new Map();
        clusterSources.forEach(cs => {
            const ls = this.clusterLayersIndex.get(cs);
            // const raw_geo = ls.rawGeometry ? ':' + ls.rawGeometry.sort : '';
            const aggId = ls.aggGeoField + ':' + ls.granularity.toString() + ls.minfeatures + ':' + ls.minzoom + ':' + ls.maxzoom ;
            const aggBuilder = aggregationsMap.get(aggId);
            let sources;
            let aggregation: Aggregation;
            /** check if an aggregation that suits this source `cs` exists already */
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
                    this.indexAggSourcesMetrics(cs, aggregation, m);
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
            aggregationsMap.set(aggId, {agg: aggregation, sources});
        });
        return aggregationsMap;
    }

    /**
     * Builds the `metrics` parameter of the passed `aggregation` from `metricConfig`
     * Also keeps track of the metrics asked for the `source` in `aggSourcesMetrics` index
     * @param source
     * @param aggregation
     * @param metricConfig
     */
    private indexAggSourcesMetrics(source: string, aggregation: Aggregation, metricConfig: MetricConfig): void {
        let metrics = this.aggSourcesMetrics.get(source);
        const key = metricConfig.field.replace(/\./g, this.FLAT_CHAR) + '_' + metricConfig.metric.toString().toLowerCase() + '_';
        let normalizeKey = metricConfig.normalize ? key + NORMALIZE : key;
        if (!key.includes('_' + COUNT)) {
            if (!metrics || (!metrics.has(key) && !metrics.has(normalizeKey))) {
                aggregation.metrics.push({
                    collect_field: metricConfig.field,
                    collect_fct: metricConfig.metric
                });
            } else {
                const existingMetric = aggregation.metrics
                    .map(m => m.collect_field.replace(/\./g, this.FLAT_CHAR) + '_' + m.collect_fct.toString().toLowerCase() + '_')
                    .find(k => k === key);
                if (!existingMetric) {
                    aggregation.metrics.push({
                        collect_field: metricConfig.field,
                        collect_fct: metricConfig.metric
                    });
                }
            }
        } else {
            normalizeKey = normalizeKey.includes(NORMALIZED_COUNT) ? NORMALIZED_COUNT : COUNT;
        }
        if (!metrics) { metrics = new Set(); }
        metrics.add(normalizeKey);
        this.aggSourcesMetrics.set(source, metrics);
    }

    /**
     * Prepares normalization by calculating the min and max values of each metrics that are to be normalized
     * Uses `this.aggSourcesMetrics` to get the metrics names & Sets the stats in `this.aggSourcesStats`
     * @param source
     * @param feature
     */
    private calculateAggMetricsStats(source: string, feature: Feature): void {
        const metricsKeys = this.aggSourcesMetrics.get(source);
        let stats = this.aggSourcesStats.get(source);
        if (!stats) {
            stats = {count: 0};
        }
        if (stats.count < feature.properties.count) {
            stats.count = feature.properties.count;
        }
        if (metricsKeys) {
            /** prepare normalization by calculating the min and max values of each metrics that is to be normalized */
            metricsKeys.forEach(key => {
                if (key.includes(SUM) || key.includes(MAX) || key.includes(MIN) || key.includes(AVG)) {
                    if (key.endsWith(NORMALIZE)) {
                        const keyWithoutNormalize = key.replace(NORMALIZE, '');
                        if (!stats[key]) {stats[key] = {min: Number.MAX_VALUE, max: Number.MIN_VALUE}; }
                        if (stats[key].max < feature.properties[keyWithoutNormalize]) {
                            stats[key].max = feature.properties[keyWithoutNormalize];
                        }
                        if (stats[key].min > feature.properties[keyWithoutNormalize]) {
                            stats[key].min = feature.properties[keyWithoutNormalize];
                        }
                    }
                }
            });
        }
        this.aggSourcesStats.set(source, stats);
    }

    private indexSearchSourcesMetrics(source: string, field: string, indexationType: ReturnedField, nkey?: string): void {
        let metrics = this.searchSourcesMetrics.get(source);
        let normalizations = this.searchNormalizations.get(source);
        if (!metrics) { metrics = new Set(); }
        let key: string;
        switch (indexationType) {
            case ReturnedField.flat: {
                key = field.replace(/\./g, this.FLAT_CHAR);
                break;
            }
            case ReturnedField.generatedcolor: {
                key = field.replace(/\./g, this.FLAT_CHAR) + '_color';
                break;
            }
            case ReturnedField.normalized: {
                if (!normalizations) { normalizations = new Map(); }
                key = field.replace(/\./g, this.FLAT_CHAR) + NORMALIZE;
                if (!normalizations.get(field)) {
                    const fn: FeaturesNormalization = {
                        on: field,
                        minMax: [Number.MAX_VALUE, Number.MIN_VALUE]
                    };
                    normalizations.set(field, fn);

                }
                break;
            }
            case ReturnedField.normalizedwithkey: {
                if (!normalizations) { normalizations = new Map(); }
                key = field.replace(/\./g, this.FLAT_CHAR) + NORMALIZE_PER_KEY + nkey.replace(/\./g, this.FLAT_CHAR) ;
                if (!normalizations.get(field + ':' + nkey)) {
                    const fn: FeaturesNormalization = {
                        on: field,
                        per: nkey
                    };
                    normalizations.set(field + ':' + nkey, fn);
                }
                break;
            }
        }
        metrics.add(key);
        this.searchSourcesMetrics.set(source, metrics);
        if (normalizations) {
            this.searchNormalizations.set(source, normalizations);
        }
    }

    /**
     * Search request are splitted according to visibility rules => sources with the same visibility
     * rules will be fetched using the same search requests
     * @param featureSources list of feature sources names
     */
    private prepareFeaturesSearch(featureSources: Array<string>, searchStrategy: SearchStrategy) {
        const searchesMap:  Map<string, SourcesSearch>  = new Map();
        const includePerSearch = new Map<string, Set<string>>();
        const geometriesPerSearch = new Map<string, Set<string>>();
        featureSources.forEach(cs => {
            const ls = this.featureLayersIndex.get(cs);
            /** the split of search requests is done thanks to this id.
             * change the id construction to change the 'granularity' of this split
             */
            const searchId = this.getSearchId(searchStrategy, ls);
            const searchBuilder: SourcesSearch =  searchesMap.get(searchId);
            let sources: Array<string>;
            let search: Search;
            if (searchBuilder) {
                sources = searchBuilder.sources;
                search = searchBuilder.search;
                search.page.size = Math.max(this.getSearchSize(searchStrategy, ls), search.page.size);
            } else {
                sources = [];
                search = {};
                search.page = {
                    size: this.getSearchSize(searchStrategy, ls)
                };
                search.form = {
                    flat: this.isFlat
                };
            }
            let includes = includePerSearch.get(searchId);
            if (!includes) { includes = new Set(); }
            includes.add(this.collectionParameters.id_path);
            if (ls.includeFields) {
                ls.includeFields.forEach(f => {
                    includes.add(f);
                    this.indexSearchSourcesMetrics(cs, f, ReturnedField.flat);
                });
            }
            if (ls.colorField) {
                includes.add(ls.colorField);
                this.indexSearchSourcesMetrics(cs, ls.colorField, ReturnedField.generatedcolor);
            }
            if (ls.normalizationFields) {
                ls.normalizationFields.forEach(nf => {
                    includes.add(nf.on);
                    if (nf.per) {
                        includes.add(nf.per);
                        this.indexSearchSourcesMetrics(cs, nf.on, ReturnedField.normalizedwithkey, nf.per);
                    } else {
                        this.indexSearchSourcesMetrics(cs, nf.on, ReturnedField.normalized);
                    }
                });
            }
            includePerSearch.set(searchId, includes);
            search.projection = {
                includes: Array.from(includes).join(',')
            };
            let geometries = geometriesPerSearch.get(searchId);
            if (!geometries) { geometries = new Set(); }
            geometries.add(ls.returnedGeometry);
            geometriesPerSearch.set(searchId, geometries);
            search.returned_geometries = Array.from(geometries).join(',');
            sources.push(cs);
            searchesMap.set(searchId, {search, sources});
        });
        return searchesMap;
    }
    private prepareTopologyAggregations(topologySources: Array<string>, zoom: number): Map<string, SourcesAgg> {
        const aggregationsMap: Map<string, SourcesAgg> = new Map();
        topologySources.forEach(cs => {
            const ls = this.topologyLayersIndex.get(cs);
            const aggId = ls.geometryId + ':' + ls.granularity.toString();
            const aggBuilder = aggregationsMap.get(aggId);
            let sources;
            let aggregation: Aggregation;
            /** check if an aggregation that suits this source `cs` exists already */
            if (aggBuilder) {
                aggregation = aggBuilder.agg;
                sources = aggBuilder.sources;
            } else {
                aggregation = {
                    type: Aggregation.TypeEnum.Term,
                    field: ls.geometryId,
                    // todo best size
                    size: '' + 10000,
                };
                sources = [];
            }
            if (ls.metrics) {
                if (!aggregation.metrics) { aggregation.metrics = []; }
                ls.metrics.forEach(m => {
                    this.indexAggSourcesMetrics(cs, aggregation, m);
                });
            }
            if (ls.geometrySupport) {
                if (!aggregation.raw_geometries) {
                    aggregation.raw_geometries = [];
                }
                aggregation.raw_geometries.push({geometry: ls.geometrySupport});
            }
            sources.push(cs);
            aggregationsMap.set(aggId, {agg: aggregation, sources});
        });
        return aggregationsMap;
    }

    private checkAggPrecision(aggSources: Array<string>, zoom: number, callOrigin: string): void {

        aggSources.forEach(cs => {
            const aggType = this.sourcesTypesIndex.get(cs);
            const ls = aggType === this.TOPOLOGY_SOURCE ? this.topologyLayersIndex.get(cs) : this.clusterLayersIndex.get(cs);
            const aggId = aggType === this.TOPOLOGY_SOURCE ? (ls as LayerTopologySource).geometryId + ':' + ls.granularity.toString() :
                (ls as LayerClusterSource).aggGeoField + ':' + ls.granularity.toString() + (ls as LayerClusterSource).minfeatures +
                ':' + ls.minzoom + ':' + ls.maxzoom;
            const control = this.abortControllers.get(aggId);
            this.abortOldPendingCalls(aggId, cs, ls.granularity, zoom, callOrigin);
            if (!control || control.signal.aborted) {
                const controller = new AbortController();
                this.abortControllers.set(aggId, controller);
            }
        });
    }

    private checkFeatures(featuresSources: Array<string>, callOrigin: string): void {
        featuresSources.forEach(cs => {
            const ls = this.featureLayersIndex.get(cs);
            const searchId = ls.maxfeatures + ':' + ls.minzoom + ':' + ls.maxzoom;
            const control = this.abortControllers.get(searchId);
            if (!control || control.signal.aborted) {
                const controller = new AbortController();
                this.abortControllers.set(searchId, controller);
            }
            let cancelSubjects = this.cancelSubjects.get(searchId);
            if (!cancelSubjects) { cancelSubjects = new Map(); }
            cancelSubjects.set(callOrigin, new Subject());
            this.lastCalls.set(searchId, callOrigin);
            this.cancelSubjects.set(searchId, cancelSubjects);
        });
    }

    private abortRemovedSources(s: string, callOrigin: string) {
        const aggType = this.sourcesTypesIndex.get(s);
        let ls;
        let fetchId;
        switch (aggType) {
            case this.CLUSTER_SOURCE:
                ls = this.clusterLayersIndex.get(s);
                fetchId = ls.aggGeoField + ':' + ls.granularity.toString() + ls.minfeatures + ':' + ls.minzoom + ':' + ls.maxzoom;
                break;
            case this.TOPOLOGY_SOURCE:
                ls = this.topologyLayersIndex.get(s);
                fetchId = ls.geometryId + ':' + ls.granularity.toString();
                break;
            case this.FEATURE_SOURCE:
                ls = this.featureLayersIndex.get(s);
                fetchId = ls.maxfeatures + ':' + ls.minzoom + ':' + ls.maxzoom;
                break;
        }

        if (fetchId) {
            const cancelSubjects = this.cancelSubjects.get(fetchId);
            if (cancelSubjects) {
                cancelSubjects.forEach((subject, k) => { if (+k < +callOrigin) { subject.next(); subject.complete(); }});
                cancelSubjects.clear();
            }
            const abortController = this.abortControllers.get(fetchId);
            if (abortController && !abortController.signal.aborted) {
                /** abort pending calls of this agg id because precision changed or source is removed */
                abortController.abort();
            }
        }
    }
    private abortOldPendingCalls(aggId: string, s: string, granularity: Granularity, zoom: number, callOrigin: string) {
        const precisions = Object.assign({}, this.granularityFunctions.get(granularity)(zoom));
        let oldPrecisions;
        const p = Object.assign({}, this.sourcesPrecisions.get(s));
        if (p && p.requestsPrecision && p.tilesPrecision) {
            oldPrecisions = p;
        }
        if (!oldPrecisions) {oldPrecisions = {}; }
        if (oldPrecisions.tilesPrecision !== precisions.tilesPrecision ||
            oldPrecisions.requestsPrecision !== precisions.requestsPrecision) {
            /** precision changed, need to stop consumption of current http calls using the old precision */
            console.log('precision change id    ' + aggId);
            let cancelSubjects = this.cancelSubjects.get(aggId);
            if (!cancelSubjects) { cancelSubjects = new Map(); }
            cancelSubjects.forEach((subject, k) => { if (+k < +callOrigin) { subject.next(); subject.complete(); }});
            cancelSubjects.clear();
            cancelSubjects.set(callOrigin, new Subject());
            this.cancelSubjects.set(aggId, cancelSubjects);
            this.lastCalls.set(aggId, callOrigin);

            const abortController = this.abortControllers.get(aggId);
            if (abortController && !abortController.signal.aborted) {
                /** abort pending calls of this agg id because precision changed. */
                abortController.abort();
            } else {
                const controller = new AbortController();
                this.abortControllers.set(aggId, controller);
            }
        }
    }

    private cleanRenderedAggFeature(s: string, feature: Feature, isWeightedAverage = false): void {
        delete feature.properties.geometry_ref;
        delete feature.properties.geometry_type;
        delete feature.properties.feature_type;
        const metricsKeys = this.aggSourcesMetrics.get(s);
        const sourceStats = this.aggSourcesStats.get(s);
        if (metricsKeys) {
            metricsKeys.forEach(mk => {
                if (mk.endsWith(NORMALIZE)) {
                    const kWithoutN = mk.replace(NORMALIZE, '');
                    feature.properties[mk] = feature.properties[kWithoutN];
                    if (mk === NORMALIZED_COUNT) {
                        feature.properties[mk] = Math.round(feature.properties.count / sourceStats.count * 100);
                    }
                }
            });
        }
        Object.keys(feature.properties).forEach(k => {
            const metricStats = Object.assign({}, sourceStats[k]);
            if (k.includes(AVG) && isWeightedAverage) {
                /** completes the weighted average calculus by dividing by the total count */
                feature.properties[k] = feature.properties[k] / feature.properties.count;
                if (metricStats) {
                    metricStats.min = metricStats.min / feature.properties.count;
                    metricStats.max = metricStats.max / feature.properties.count;
                }
            }
            if (metricsKeys) {
                /** normalize */
                if (k.endsWith(NORMALIZE) && k !== NORMALIZED_COUNT) {
                    if (metricStats.min === metricStats.max) {
                        feature.properties[k] = 0;
                    } else {
                        feature.properties[k] = (feature.properties[k] - metricStats.min) / (metricStats.max - metricStats.min);
                    }
                }
            } else {
                delete feature.properties[k];
            }
        });
        if (metricsKeys) {
            metricsKeys.forEach(k => {
                if (!metricsKeys.has(k)) {
                    delete feature.properties[k];
                }
            });
        }
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
            this.layersSourcesIndex.set(ls.id, ls.source);
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
            /** extends rules visibility */
            const existingClusterLayer = clusterLayers.get(clusterLayer.source);
            if (existingClusterLayer) {
                if (existingClusterLayer.minzoom < clusterLayer.minzoom) {
                    clusterLayer.minzoom = existingClusterLayer.minzoom;
                }
                if (existingClusterLayer.maxzoom > clusterLayer.maxzoom) {
                    clusterLayer.maxzoom = existingClusterLayer.maxzoom;
                }
                if (existingClusterLayer.minfeatures < clusterLayer.minfeatures) {
                    clusterLayer.minfeatures = existingClusterLayer.minfeatures;
                }
            }
            clusterLayers.set(clusterLayer.source, clusterLayer);
            this.dataSources.add(ls.source);
            this.indexVisibilityRules(ls.minzoom, ls.maxzoom, ls.minfeatures, this.CLUSTER_SOURCE, ls.source);
            this.sourcesTypesIndex.set(ls.source, this.CLUSTER_SOURCE);
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
            this.layersSourcesIndex.set(ls.id, ls.source);
            topologyLayer.maxzoom = ls.maxzoom;
            topologyLayer.minzoom = ls.minzoom;
            topologyLayer.maxfeatures = ls.maxfeatures;
            topologyLayer.geometrySupport = ls.geometry_support;
            topologyLayer.geometryId = ls.geometry_id;
            topologyLayer.metrics = ls.metrics;
            topologyLayer.granularity = ls.granularity;
            /** extends rules visibility */
            const existingTopologyLayer = topologyLayers.get(topologyLayer.source);
            if (existingTopologyLayer) {
                if (existingTopologyLayer.minzoom < topologyLayer.minzoom) {
                    topologyLayer.minzoom = existingTopologyLayer.minzoom;
                }
                if (existingTopologyLayer.maxzoom > topologyLayer.maxzoom) {
                    topologyLayer.maxzoom = existingTopologyLayer.maxzoom;
                }
                if (existingTopologyLayer.maxfeatures > topologyLayer.maxfeatures) {
                    topologyLayer.maxfeatures = existingTopologyLayer.maxfeatures;
                }
            }
            topologyLayers.set(topologyLayer.source, topologyLayer);
            this.dataSources.add(ls.source);
            this.indexVisibilityRules(ls.minzoom, ls.maxzoom, ls.maxfeatures, this.TOPOLOGY_SOURCE, ls.source);
            this.sourcesTypesIndex.set(ls.source, this.TOPOLOGY_SOURCE);

        });
        return topologyLayers;
    }

/**
     * Parses the layers_sources config and returns the feature layers index
     * @param layersSourcesConfig layers_sources configuration object
     */
    private getFeatureLayersIndex(layersSourcesConfig): Map<string, LayerFeatureSource> {
        const featureLayers = new Map<string, LayerFeatureSource>();
        layersSourcesConfig.filter(ls => ls.source.startsWith(this.FEATURE_SOURCE) &&
         !ls.source.startsWith(this.TOPOLOGY_SOURCE)).forEach(ls => {
            const featureLayer = new LayerFeatureSource();
            featureLayer.id = ls.id;
            featureLayer.source = ls.source;
            this.layersSourcesIndex.set(ls.id, ls.source);
            featureLayer.maxzoom = ls.maxzoom;
            featureLayer.minzoom = ls.minzoom;
            featureLayer.maxfeatures = ls.maxfeatures;
            featureLayer.normalizationFields = ls.normalization_fields;
            featureLayer.includeFields = new Set(ls.include_fields);
            featureLayer.colorField = ls.metrics;
            featureLayer.returnedGeometry = ls.returned_geometry;
            /** extends rules visibility */
            const existingFeatureLayer = featureLayers.get(featureLayer.source);
            if (existingFeatureLayer) {
                if (existingFeatureLayer.minzoom < featureLayer.minzoom) {
                    featureLayer.minzoom = existingFeatureLayer.minzoom;
                }
                if (existingFeatureLayer.maxzoom > featureLayer.maxzoom) {
                    featureLayer.maxzoom = existingFeatureLayer.maxzoom;
                }
                if (existingFeatureLayer.maxfeatures > featureLayer.maxfeatures) {
                    featureLayer.maxfeatures = existingFeatureLayer.maxfeatures;
                }
            }
            featureLayers.set(featureLayer.source, featureLayer);
            this.dataSources.add(ls.source);
            this.indexVisibilityRules(ls.minzoom, ls.maxzoom, ls.maxfeatures, this.FEATURE_SOURCE, ls.source);
            this.sourcesTypesIndex.set(ls.source, this.FEATURE_SOURCE);

        });
        return featureLayers;
    }


    private getSearchId(searchStrategy: SearchStrategy, ls?: LayerFeatureSource): string {
        switch (searchStrategy) {
            case SearchStrategy.combined:
                return 'combined_search';
            case SearchStrategy.visibility_rules:
                return ls.maxfeatures + ':' + ls.minzoom + ':' + ls.maxzoom;
        }
    }

    private getSearchSize(searchStrategy: SearchStrategy, ls?: LayerFeatureSource): number {
        switch (searchStrategy) {
            case SearchStrategy.combined:
                return this.searchSize;
            case SearchStrategy.visibility_rules:
                return ls.maxfeatures;
        }
    }
    /**
     * Returns sources to be displayed on the map
     * @param zoom
     * @param nbFeatures
     */
    private getDisplayableSources(zoom: number,
        visibleSources: Set<string>, nbFeatures?: number): [Array<string>, Array<string>, Array<string>, Array<string>] {
        const clusterSources = [];
        const topologySources = [];
        const featureSources = [];
        const sourcesToRemove = [];
        this.visibiltyRulesIndex.forEach((v, k) => {
            if (v.maxzoom >= zoom && v.minzoom <= zoom && visibleSources.has(k)) {
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

    private prepareSearchNormalization(f: Feature, n: FeaturesNormalization): void {
        const normalizeField = (this.isFlat && n.on) ? n.on.replace(/\./g, this.FLAT_CHAR) : n.on;
        const perField = (this.isFlat && n.per) ? n.per.replace(/\./g, this.FLAT_CHAR) : n.per;
        if (perField) {
            if (!n.minMaxPerKey) {
                n.minMaxPerKey = new Map();
            }
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
    }

    private normalize(f: Feature, n: FeaturesNormalization): void {
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
            f.properties[normalizeField + NORMALIZE_PER_KEY + perField] = normalizedValue;
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
            f.properties[normalizeField + NORMALIZE] = normalizedValue;
        }
    }

    private clearData(s: string) {
        const sourceType = this.sourcesTypesIndex.get(s);
        switch (sourceType) {
            case this.CLUSTER_SOURCE:
                this.parentGeohashesPerSource.set(s, new Set());
                this.geohashesPerSource.set(s, new Map());
                this.aggSourcesStats.set(s, {count: 0});
                this.sourcesPrecisions.set(s, {});
                break;
            case this.TOPOLOGY_SOURCE:
                this.topologyDataPerSource.set(s, new Array());
                this.aggSourcesStats.set(s, {count: 0});
                this.sourcesPrecisions.set(s, {});
                break;
            case this.FEATURE_SOURCE:
                this.featureDataPerSource.set(s, []);
                this.featuresIdsIndex.set(s, new Set());
                this.featuresOldExtent.set(s, undefined);
                this.searchNormalizations.set(s, new Map());
                this.searchSourcesMetrics.set(s, new Set());
                break;
        }
        this.sourcesVisitedTiles.set(s, new Set());
    }

    private getVisitedXYZTiles(extent, sources: Array<string>): Set<string> {
        /** we will check if in the given sources, there a source with 0 visited tiles
         * this means a new geometry is requested ==> we clean all the visited tiles and re fetch data from scratch
         *
         * Otherwise, if no new source is added while naviguing, we fetch data in the newly visited tiles
         * If the tiles are within an extent within whom the precedent extent, it means data has already been fetched in this area
         */
        sources.forEach(s => {
            if (!this.sourcesVisitedTiles.get(s)) {
                this.sourcesVisitedTiles.set(s, new Set());
            }
        });
        const emptyTiles = sources.find(s => this.sourcesVisitedTiles.get(s) && this.sourcesVisitedTiles.get(s).size === 0);
        if (emptyTiles) {
            sources.forEach(s => {
                this.sourcesVisitedTiles.set(s, new Set());
                this.featuresOldExtent.set(s, undefined);
            });
        }

        const newVisitedTiles: Set<string> = new Set();
        const visitedTiles = xyz([[extent[1], extent[2]], [extent[3], extent[0]]], Math.ceil((this.zoom) - 1));
        let tiles = new Set<string>();
        let start = true;
        sources.forEach(s => {
            // this loop aims to take the smallest already visited tiles list
            if (start) {
                start = false; tiles = this.sourcesVisitedTiles.get(s);
            } else { if (this.sourcesVisitedTiles.get(s).size < tiles.size) {
                tiles = this.sourcesVisitedTiles.get(s);
            }}
        });
        visitedTiles.forEach(vt => {
            const stringVT = tileToString(vt);
            if (!tiles.has(stringVT)) {
                newVisitedTiles.add(stringVT);
                tiles.add(stringVT);
            }
        });
        sources.forEach(s => {
            this.sourcesVisitedTiles.set(s, tiles);
        });
        const oldMapExtent = this.featuresOldExtent.get(sources[0]);
        if (oldMapExtent) {
            if (extent[0] > oldMapExtent[0]
                || extent[2] < oldMapExtent[2]
                || extent[1] < oldMapExtent[1]
                || extent[3] > oldMapExtent[3]
            ) {
                sources.forEach(s => {
                    this.featuresOldExtent.set(s, extent);
                });
                return newVisitedTiles;
            }
            sources.forEach(s => {
                this.featuresOldExtent.set(s, extent);
            });
            return new Set();
        }
        sources.forEach(s => {
            this.featuresOldExtent.set(s, extent);
        });
        return newVisitedTiles;
    }

    private getVisitedTiles(extent, zoom, granularity, aggSource, aggType) {
        const visitedTiles = this.extentToGeohashes(extent, zoom, this.granularityFunctions.get(granularity));
        const precisions = Object.assign({}, this.granularityFunctions.get(granularity)(zoom));
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
                this.clearData(s);
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
        return newVisitedTiles;
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
    private extentToGeohashes(extent: Array<number>, zoom: number,
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
}


export enum ReturnedField {
    flat, generatedcolor, normalized, normalizedwithkey
}

export enum SearchStrategy {
    /** ALL FEATURE SOURCES WILL BE FETCHED WITH ONE SEARCH */
    combined,
    /** FEATURES SOURCES ARE ORGANIZED WITH VISIBILITY RULES. SOURCES WITH SAME V. RULES WILL BE FETCHED WITH THE SAME SEARCH REQUEST */
    visibility_rules
}

/** Render strategy enum for simple mode */
export enum RenderStrategy {
    /** append new arrived data to existing data*/
    accumulative,
    /** Apply a scroll by removing oldest data when maxPages is exceeded */
    scroll
}