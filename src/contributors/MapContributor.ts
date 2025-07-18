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

import bboxPolygon from '@turf/bbox-polygon';
import booleanContains from '@turf/boolean-contains';
import * as helpers from '@turf/helpers';
import {
    Aggregation, CollectionReferenceParameters, ComputationRequest, ComputationResponse,
    Expression, Feature, FeatureCollection, Filter, Hits, Metric, Search
} from 'arlas-api';
import {
    Collaboration, CollaborationEvent, CollaborativesearchService, ConfigService,
    Contributor, GeoTileAggregation, GeohashAggregation, TiledSearch, projType
} from 'arlas-web-core';
import * as FileSaver from 'file-saver';
import moment from 'moment';
import { Observable, Subject, from, of } from 'rxjs';
import { finalize, map, mergeAll, takeUntil, tap } from 'rxjs/operators';
import { parse, stringify } from 'wellknown';
import jsonSchema from '../jsonSchemas/mapContributorConf.schema.json';
import {
    ClusterAggType, ColorConfig, ElementIdentifier, ExtentFilterGeometry, FeatureRenderMode,
    FeaturesNormalization, Granularity, ItemDataType, LayerClusterSource, LayerFeatureSource,
    LayerSourceConfig, LayerTopologySource, MetricConfig, OnMoveResult, PageEnum, SourcesAgg, SourcesSearch
} from '../models/models';
import { numToString, stringToExtent } from '../utils/mapUtils';
import {
    ASC, ColorGeneratorLoader, appendIdToSort, coarseGranularity, coarseTopoGranularity, fineGranularity,
    fineTopoGranularity, finestGranularity, finestTopoGranularity, mediumGranularity, mediumTopoGranularity,
    networkFetchingLevelGranularity, notInfinity, removePageFromIndex, rgbToHex
} from '../utils/utils';
import {
    extentToGeohashes, extentToString, fix180thMeridian, getBounds, getCanonicalExtents, isClockwise, stringToTile, tileToString, truncate, xyz
} from './../utils/mapUtils';

export enum DataMode {
    simple,
    dynamic
}

export const NORMALIZE = ':normalized';
export const SHORT_VALUE = ':_arlas__short_format';
export const COUNT_SHORT_VALUE = 'count_:_arlas__short_format';
export const NORMALIZE_PER_KEY = ':normalized:';
export const COUNT = 'count';
export const NORMALIZED_COUNT = 'count_:normalized';
export const AVG = '_avg_';
export const SUM = '_sum_';
export const MIN = '_min_';
export const MAX = '_max_';
export const DEFAULT_FETCH_NETWORK_LEVEL = 3;
export const ARLAS_TIMESTAMP = '_arlas-timestamp_';
/**
 * This contributor works with the Angular MapComponent of the Arlas-web-components project.
 * This class make the brigde between the component which displays the data and the
 * collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
 */
export class MapContributor extends Contributor {

    public isSimpleModeAccumulative: boolean;
    public geoQueryOperation: Expression.OpEnum;
    public geoQueryField: string;
    /** Number of features fetched in a geosearch request. It's used in `Simple mode` only. Default to 100.*/
    public searchSize: number;
    /** comma seperated field names that sort the features. Order matters. It's used in `Simple mode` only.*/
    public searchSort: string;
    public drawPrecision: number;
    public isFlat: boolean;

    private readonly CLUSTER_SOURCE = 'cluster';
    private readonly TOPOLOGY_SOURCE = 'feature-metric';
    private readonly FEATURE_SOURCE = 'feature';

    private readonly LAYERS_SOURCES_KEY = 'layers_sources';
    private readonly SIMPLE_MODE_ACCUMULATIVE_KEY = 'simple_mode_accumulative';
    private readonly GEO_QUERY_OP_KEY = 'geo_query_op';
    private readonly GEO_QUERY_FIELD_KEY = 'geo_query_field';
    private readonly SEARCH_SIZE_KEY = 'search_size';
    private readonly SEARCH_SORT_KEY = 'search_sort';
    private readonly DRAW_PRECISION_KEY = 'draw_precision';
    private readonly IS_FLAT_KEY = 'is_flat';


    private readonly DEFAULT_SEARCH_SIZE = 100;
    private readonly DEFAULT_SEARCH_SORT = '';
    private readonly DEFAULT_DRAW_PRECISION = 6;
    private readonly DEFAULT_IS_FLAT = true;

    private readonly WINDOW_EXTENT_GEOMETRY = 'window_extent_geometry';
    public windowExtentGeometry: ExtentFilterGeometry;

    private clusterLayersIndex: Map<string, LayerClusterSource>;
    private topologyLayersIndex: Map<string, LayerTopologySource>;
    private featureLayerSourcesIndex: Map<string, LayerFeatureSource>;

    private sourcesTypesIndex: Map<string, string> = new Map();
    private layerToSourceIndex: Map<string, string> = new Map();
    private sourceToLayerIndex: Map<string, Set<string>> = new Map();
    private visibilityRulesIndex: Map<string, {
        type: string; minzoom: number; maxzoom: number;
        nbfeatures: number; rendermode: FeatureRenderMode;
    }> = new Map();
    private layersVisibilityRulesIndex: Map<string, { minzoom: number; maxzoom: number; nbfeatures: number; }> = new Map();

    /** Cluster data support */
    private cellsPerSource: Map<string, Map<string, Feature>> = new Map();
    private parentCellsPerSource: Map<string, Set<string>> = new Map();

    /** Topology data support */
    private topologyDataPerSource: Map<string, Array<Feature>> = new Map();

    /** Feature data support */
    private featureDataPerSource: Map<string, Array<Feature>> = new Map();

    private aggSourcesStats: Map<string, { count: number; }> = new Map();
    private aggSourcesMetrics: Map<string, Set<string>> = new Map();
    private searchNormalizations: Map<string, Map<string, FeaturesNormalization>> = new Map();
    private searchSourcesMetrics: Map<string, Set<string>> = new Map();
    private sourcesVisitedTiles: Map<string, Set<string>> = new Map();
    private sourcesPrecisions: Map<string, { tilesPrecision?: number; requestsPrecision?: number; }> = new Map();
    private granularityClusterFunctions: Map<Granularity, (zoom: number, type: Aggregation.TypeEnum) =>
        { tilesPrecision: number; requestsPrecision: number; }> = new Map();
    private granularityTopologyFunctions: Map<Granularity, (zoom: number) =>
        { tilesPrecision: number; requestsPrecision: number; }> = new Map();
    private collectionParameters: CollectionReferenceParameters;
    private featuresIdsIndex = new Map<string, Set<string>>();
    private featuresOldExtent = new Map<string, any>();

    /** This map stores for each agg id, a map of call Instant and a Subject;
     * The Subject will be emitted once precision of agg changes ==> all previous calls that are still pending will stop */
    private cancelSubjects: Map<string, Map<string, Subject<void>>> = new Map();
    /** This map stores for each agg id, the instant of the lastest call to this agg. */
    private lastCalls: Map<string, string> = new Map();
    /** This map stores for each agg id, an abort controller. This controller will abort pending calls when precision of
      * the agg changes. */
    private abortControllers: Map<string, AbortController> = new Map();

    public geojsondraw: { type: string; features: Array<helpers.Feature<helpers.Geometry>>; } = {
        'type': 'FeatureCollection',
        'features': []
    };

    /** Additional Arlas filter to add the BBOX and filter comming from Collaborations*/
    protected additionalFilter: Filter;
    /**
     * List of fields pattern or names that will be included in features mode as geojson properties.
     */

    public zoom: number;
    public center: Array<number>;
    public mapLoadWrappedExtent = [90, -180, -90, 180];
    public mapLoadRawExtent = [90, -180, -90, 180];
    public mapTestWrappedExtent = [90, -180, -90, 180];
    public mapTestRawExtent = [90, -180, -90, 180];
    public visibleSources: Set<string> = new Set();
    public geoPointFields = new Array<string>();
    public geoShapeFields = new Array<string>();

    public countExtendBus = new Subject<{ count: number; threshold: number; }>();
    public saturationWeight = 0.5;

    /**
     * A filter that is taken into account when fetching features and that is not included in the global collaboration.
     * It's used in `Simple mode` only.
     */
    public expressionFilter: Expression;

    public redrawSource: Subject<{ source: string; data: helpers.Feature[]; }> = new Subject();
    public legendUpdater: Subject<Map<string, LegendData>> = new Subject();
    public legendData: Map<string, LegendData> = new Map();
    public visibilityUpdater: Subject<Map<string, boolean>> = new Subject();
    public visibilityStatus: Map<string, boolean> = new Map();
    public drawingsUpdate: Subject<{ type: string; features: Array<any>; }> = new Subject();

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
    public constructor(
        public identifier: string,
        public collaborativeSearcheService: CollaborativesearchService,
        public configService: ConfigService,
        public collection: string,
        public colorGenerator?: ColorGeneratorLoader
    ) {
        super(identifier, configService, collaborativeSearcheService, collection);
        this.collections = [];
        this.collections.push({
            collectionName: collection
        });
        const layersSourcesConfig: Array<LayerSourceConfig> = this.getConfigValue(this.LAYERS_SOURCES_KEY);
        const simpleModeAccumulativeConfig = this.getConfigValue(this.SIMPLE_MODE_ACCUMULATIVE_KEY);
        const geoQueryOpConfig = this.getConfigValue(this.GEO_QUERY_OP_KEY);
        const geoQueryFieldConfig = this.getConfigValue(this.GEO_QUERY_FIELD_KEY);
        const searchSizeConfig = this.getConfigValue(this.SEARCH_SIZE_KEY);
        const searchSortConfig = this.getConfigValue(this.SEARCH_SORT_KEY);
        const drawPrecisionConfig = this.getConfigValue(this.DRAW_PRECISION_KEY);
        const isFlatConfig = this.getConfigValue(this.IS_FLAT_KEY);
        const windowExtentGeometryConfig = this.getConfigValue(this.WINDOW_EXTENT_GEOMETRY);
        if (!colorGenerator) {
            this.colorGenerator = new ColorGeneratorLoader();
        }

        if (layersSourcesConfig) {
            this.clusterLayersIndex = this.getClusterLayersIndex(layersSourcesConfig);
            this.topologyLayersIndex = this.getTopologyLayersIndex(layersSourcesConfig);
            this.featureLayerSourcesIndex = this.getFeatureLayersIndex(layersSourcesConfig);
        }
        if (simpleModeAccumulativeConfig !== undefined) {
            this.isSimpleModeAccumulative = simpleModeAccumulativeConfig;
        } else {
            this.isSimpleModeAccumulative = true;
        }
        this.initGeoQueryOperation(geoQueryOpConfig);
        this.searchSize = searchSizeConfig !== undefined ? searchSizeConfig : this.DEFAULT_SEARCH_SIZE;
        this.searchSort = searchSortConfig ?? this.DEFAULT_SEARCH_SORT;
        this.windowExtentGeometry = windowExtentGeometryConfig ?? ExtentFilterGeometry.geometry_path;
        this.drawPrecision = drawPrecisionConfig !== undefined ? drawPrecisionConfig : this.DEFAULT_DRAW_PRECISION;
        this.isFlat = isFlatConfig ?? this.DEFAULT_IS_FLAT;
        this.granularityClusterFunctions.set(Granularity.coarse, coarseGranularity);
        this.granularityClusterFunctions.set(Granularity.medium, mediumGranularity);
        this.granularityClusterFunctions.set(Granularity.fine, fineGranularity);
        this.granularityClusterFunctions.set(Granularity.finest, finestGranularity);

        this.granularityTopologyFunctions.set(Granularity.coarse, coarseTopoGranularity);
        this.granularityTopologyFunctions.set(Granularity.medium, mediumTopoGranularity);
        this.granularityTopologyFunctions.set(Granularity.fine, fineTopoGranularity);
        this.granularityTopologyFunctions.set(Granularity.finest, finestTopoGranularity);
        // TODO check if we should include the collection reference in the collobarative search service, to avoid doing a describe
        // in this contributor
        this.collaborativeSearcheService.describe(this.collection)
            .subscribe(c => {
                const fields = c.properties;
                Object.keys(fields).forEach(fieldName => {
                    this.getFieldProperties(fields, fieldName);
                });
                this.collectionParameters = c.params;
                this.geoQueryField = geoQueryFieldConfig !== undefined ? geoQueryFieldConfig : this.collectionParameters.centroid_path;
            }
            );
    }

    /**
     * Inits the default geoquery operation to apply in this contributor collaborations.
     * @param geoQueryOpConfig Configuration value of the geoquery.
     */
    private initGeoQueryOperation(geoQueryOpConfig: any): void {
        if (geoQueryOpConfig !== undefined) {
            if (Expression.OpEnum[geoQueryOpConfig].toString() === Expression.OpEnum.Within.toString()) {
                this.geoQueryOperation = Expression.OpEnum.Within;
            } else if (Expression.OpEnum[geoQueryOpConfig].toString() === Expression.OpEnum.Notwithin.toString()) {
                this.geoQueryOperation = Expression.OpEnum.Notwithin;
            } else if (Expression.OpEnum[geoQueryOpConfig].toString() === Expression.OpEnum.Intersects.toString()) {
                this.geoQueryOperation = Expression.OpEnum.Intersects;
            } else if (Expression.OpEnum[geoQueryOpConfig].toString() === Expression.OpEnum.Notintersects.toString()) {
                this.geoQueryOperation = Expression.OpEnum.Notintersects;
            }
        } else {
            this.geoQueryOperation = Expression.OpEnum.Within;
        }
    }

    public isUpdateEnabledOnOwnCollaboration() {
        return true;
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
        this.aggSourcesMetrics.clear();
        this.aggSourcesStats.clear();
        this.sourcesPrecisions.clear();
        this.sourcesVisitedTiles.clear();
        this.topologyDataPerSource.clear();
        this.cellsPerSource.clear();
        this.featureDataPerSource.clear();
        this.featuresIdsIndex.clear();
        this.featuresOldExtent.clear();
        this.parentCellsPerSource.clear();
        this.searchNormalizations.clear();
        this.searchSourcesMetrics.clear();
        const wrappedTestExtent = extentToString(this.mapTestWrappedExtent);
        const rawTestExtent = extentToString(this.mapTestRawExtent);
        const windowVisibleSources = new Set<string>();
        const wideVisibleSources = new Set<string>();
        this.visibleSources.forEach(visibleSource => {
            if (this.featureLayerSourcesIndex.has(visibleSource)
                && this.featureLayerSourcesIndex.get(visibleSource).renderMode === FeatureRenderMode.window) {
                windowVisibleSources.add(visibleSource);
            } else {
                wideVisibleSources.add(visibleSource);
            }
        });

        this.getWindowModeData(wrappedTestExtent, rawTestExtent, windowVisibleSources, this.searchSort, this.isSimpleModeAccumulative);
        this.getWideModeData(rawTestExtent, wrappedTestExtent, this.mapLoadWrappedExtent,
            this.mapLoadRawExtent, this.zoom, wideVisibleSources);
        return of();
    }



    /** This method is triggered after the map has been moved by the user. Its aim is
     * - Verify if there new data to fetch on the new map extent
     * - Verify if the zoom has changed and therefore verify if there is a need to fetch more/less precise data
     * - Update the state variables of this contributor instance used for: zoom, center, loadextent, testextent,...
     */
    public onMapMoved(moveParams: OnMoveResult, recalculateWindow: boolean): void {
        this.zoom = moveParams.zoom;
        this.center = moveParams.center;
        this.mapLoadWrappedExtent = moveParams.extendForLoad;
        this.mapTestWrappedExtent = moveParams.extendForTest;
        this.mapTestRawExtent = moveParams.rawExtendForTest;
        this.mapLoadRawExtent = moveParams.rawExtendForLoad;
        const wrappedTestExtent = extentToString(this.mapTestWrappedExtent);
        const rawTestExtent = extentToString(this.mapTestRawExtent);
        this.visibleSources.clear();
        const windowVisibleSources = new Set<string>();
        const wideVisibleSources = new Set<string>();
        moveParams.visibleLayers.forEach(l => {
            const visibleSource = this.layerToSourceIndex.get(l);
            if (visibleSource) {
                this.visibleSources.add(visibleSource);
                if (this.featureLayerSourcesIndex.has(visibleSource)
                    && this.featureLayerSourcesIndex.get(visibleSource).renderMode === FeatureRenderMode.window) {
                    windowVisibleSources.add(visibleSource);
                } else {
                    wideVisibleSources.add(visibleSource);
                }

            }
        });
        if (this.updateData) {
            if (recalculateWindow) {
                this.getWindowModeData(wrappedTestExtent, rawTestExtent, windowVisibleSources,
                    this.searchSort, this.isSimpleModeAccumulative);
            }
            this.getWideModeData(rawTestExtent, wrappedTestExtent, this.mapLoadWrappedExtent,
                this.mapLoadRawExtent, this.zoom, wideVisibleSources);
        }
    }

    public changeVisualisation(visibleLayers: Set<string>) {
        const wrappedTestExtent = extentToString(this.mapTestWrappedExtent);
        const rawTestExtent = extentToString(this.mapTestRawExtent);
        const visibleSources = new Set<string>();
        const windowVisibleSources = new Set<string>();
        const wideVisibleSources = new Set<string>();
        visibleLayers.forEach(l => {
            const visibleSource = this.layerToSourceIndex.get(l);
            if (visibleSource) {
                visibleSources.add(visibleSource);
                if (this.featureLayerSourcesIndex.has(visibleSource)
                    && this.featureLayerSourcesIndex.get(visibleSource).renderMode === FeatureRenderMode.window) {
                    windowVisibleSources.add(visibleSource);
                } else {
                    wideVisibleSources.add(visibleSource);
                }
            }
        });
        this.visibleSources = visibleSources;
        this.getWindowModeData(wrappedTestExtent, rawTestExtent, windowVisibleSources, this.searchSort, this.isSimpleModeAccumulative);
        this.getWideModeData(rawTestExtent, wrappedTestExtent, this.mapLoadWrappedExtent,
            this.mapLoadRawExtent, this.zoom, wideVisibleSources);
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
     * Fetches the data for the Window-render-mode. The data will be fetched taking into account the current collaboration
     * of this map contributor + the given extent. The windowExtentGeometry will defines the operation to apply between the
     * given raw extent and the data geometry to use.
     *
     * @param wrapExtent Wrapped format of the rawExtent (wrapped to the range [-180, 180]).
     * @param rawExtent The extent of the map. The data will be fetched using this extent.
     * @param visibleSources Set of visible source identifiers.
     * @param sort comma separated field names on which feature are sorted.
     * @param keepOldData Whether to keep already fetched data or to clean them.
     * @param afterParam comma seperated field values from which next/previous data is fetched.
     * @param whichPage Whether to fetch next or previous set of data.
     * @param maxPages Maximum number of pages to keep on the map. A page being the size of a single geosearch request.
     * @param fromParam The offset from which the data will be fetched. It is to be used alternatively, if afterParam is not set.
     * Otherwise, the priority is always to afterParam.
     */
    public getWindowModeData(wrapExtent: string, rawExtent: string, visibleSources: Set<string>, sort: string, keepOldData = true,
        afterParam?: string, whichPage?: PageEnum, maxPages?: number, fromParam?: number): void {
        if (!!visibleSources && visibleSources.size > 0) {
            let operation = Expression.OpEnum.Within;
            let geometryField = this.collectionParameters.centroid_path;
            /** If the windowExtentGeometry is geometry_path, then we fetch data whose geometry_path intersect the given rawExtent. */
            if (this.windowExtentGeometry === ExtentFilterGeometry.geometry_path) {
                operation = Expression.OpEnum.Intersects;
                geometryField = this.collectionParameters.geometry_path;
            }
            const countFilter: Filter = this.getExtentFilter(rawExtent, wrapExtent, geometryField, operation);
            if (this.expressionFilter !== undefined) {
                countFilter.f.push([this.expressionFilter]);
            }
            this.addFilter(countFilter, this.additionalFilter);
            /** Retrieve the list of all window sources to apply ONE search request to the server
             * This search request will contain all the geometries, and additional info needed for each window source
             * to be properly displayed
            */
            const allWindowSources = [];
            this.featureLayerSourcesIndex.forEach((ls, s) => {
                if (ls.renderMode === FeatureRenderMode.window) {
                    allWindowSources.push(s);
                }
            });
            const featureSearchBuilder = this.prepareFeaturesSearch(allWindowSources, SearchStrategy.combined);
            const search: Search = featureSearchBuilder.get(this.getSearchId(SearchStrategy.combined)).search;
            if (!keepOldData) {
                const sources = featureSearchBuilder.get(this.getSearchId(SearchStrategy.combined)).sources;
                sources.forEach(s => {
                    // todo: check if we should clear all data
                    this.featureDataPerSource.set(s, []);
                    this.featuresIdsIndex.set(s, new Set());
                });
            }
            if (sort && sort.length > 0) {
                search.page.sort = sort;
            } else {
                search.page.sort = 'geodistance:' + this.center[1].toString() + ' ' + this.center[0].toString() + ',' +
                    this.collectionParameters.id_path;
            }
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
            featureSearchBuilder.set(this.getSearchId(SearchStrategy.combined), { search, sources: allWindowSources });
            this.fetchSearchSources(countFilter, featureSearchBuilder, renderStrategy, maxPages, whichPage);
        } else {
            this.featureLayerSourcesIndex.forEach((ls, s) => {
                if (ls.renderMode === FeatureRenderMode.window) {
                    this.sourceToLayerIndex.get(s).forEach(l => {
                        this.visibilityStatus.set(l, false);
                    });
                }
            });
            this.visibilityUpdater.next(this.visibilityStatus);
        }
    }

    public getWideModeData(rawTestExtent: string, wrapTestExtent: string, mapLoadExtent: number[],
        mapLoadRawExtent: number[], zoom: number, visibleSources: Set<string>): void {
        const countFilter = this.getFilterForCount(rawTestExtent, wrapTestExtent, this.collectionParameters.centroid_path);
        this.addFilter(countFilter, this.additionalFilter);
        /** Get displayable sources using zoom visibility rules only.
         *  If the precision of a cluster souce changes, it will stop the ongoing http calls */
        let displayableSources = this.getDisplayableSources(zoom, visibleSources);
        let dClusterSources = displayableSources[0];
        const dTopologySources = displayableSources[1];
        let dFeatureSources = displayableSources[2];
        const callOrigin = Date.now() + '';
        this.checkAggPrecision(dClusterSources, zoom, callOrigin);
        this.checkAggPrecision(dTopologySources, zoom, callOrigin);
        this.checkFeatures(dFeatureSources, callOrigin);
        const zoomSourcesToRemove = displayableSources[3];
        zoomSourcesToRemove.forEach(s => {
            /** Removes the sources (topo,cluster & features) from mapcomponent that don't respect zoom rule visibility */
            this.redrawSource.next({ source: s, data: [] });
            /** sources are kept in the contributor to avoid recalling arlas-server.
             * The sources are only cleaned if filters change
             */
        });
        const geoIds = new Set(dTopologySources.map(s => this.topologyLayersIndex.get(s).geometryId));
        const topoCounts: Array<Observable<ComputationResponse>> = [];
        geoIds.forEach(geo_id => {
            const topoCount = this.getTopoCardinality(geo_id, countFilter);
            topoCounts.push(topoCount);
        });
        const displayableTopoSources = new Set<string>();
        const removableTopoSources = new Set<string>();
        from(topoCounts).pipe(mergeAll()).pipe(
            map(computationResponse => {
                const nbFeatures = computationResponse.value;
                const topoVisbleSources = new Set(dTopologySources.filter(s =>
                    this.topologyLayersIndex.get(s).geometryId === computationResponse.field));
                const topoSources = this.getDisplayableTopologySources(zoom, topoVisbleSources, nbFeatures);
                topoSources[0].forEach(s => displayableTopoSources.add(s));
                topoSources[1].forEach(s => removableTopoSources.add(s));
                const topologyAggsBuilder = this.prepareTopologyAggregations(topoSources[0], zoom);
                /** renders visible sources */
                topologyAggsBuilder.forEach((aggSource, aggId) => {
                    this.renderAggSources(aggSource.sources);
                });
                this.fetchAggSources(mapLoadExtent, mapLoadRawExtent, zoom, topologyAggsBuilder, this.TOPOLOGY_SOURCE);
            }),
            finalize(() => {
                if (!!topoCounts && topoCounts.length > 0) {
                    this.topologyLayersIndex.forEach((v, k) => {
                        if (!displayableTopoSources.has(k)) {
                            removableTopoSources.add(k);
                            this.sourceToLayerIndex.get(k).forEach(l => this.visibilityStatus.set(l, false));
                        }
                    });
                    removableTopoSources.forEach(s => {
                        /** Removes the topo source from mapcomponent that don't respect nbfeatures rule visibility */
                        this.redrawSource.next({ source: s, data: [] });
                        /** sources are kept in the contributor to avoid recalling arlas-server.
                         * The sources are only cleaned if filters change
                         */
                    });
                    this.visibilityUpdater.next(this.visibilityStatus);
                }
            })
        ).subscribe(d => d);
        if (visibleSources.size >= 0) {
            this.collaborativeSearcheService.ongoingSubscribe.next(1);
            const count: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits([projType.count, {}],
                this.collaborativeSearcheService.collaborations, this.collection, this.identifier, countFilter, false, this.cacheDuration);
            if (count) {
                count.subscribe(countResponse => {
                    this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                    const nbFeatures = countResponse.totalnb;
                    const nottopoVisbleSources = new Set(Array.from(visibleSources).filter(s => !this.topologyLayersIndex.has(s)));
                    displayableSources = this.getDisplayableSources(zoom, nottopoVisbleSources, nbFeatures);
                    this.visibilityUpdater.next(this.visibilityStatus);
                    dClusterSources = displayableSources[0];
                    dFeatureSources = displayableSources[2];
                    const nbFeaturesSourcesToRemove = displayableSources[3];
                    const alreadyRemovedSources = new Set(zoomSourcesToRemove);
                    nbFeaturesSourcesToRemove.filter(s => !this.topologyLayersIndex.has(s) && !alreadyRemovedSources.has(s)).forEach(s => {
                        /** Removes the sources (cluster, feature) from mapcomponent that don't respect nbfeatures rule visibility*/
                        this.redrawSource.next({ source: s, data: [] });
                        /** sources are kept in the contributor to avoid recalling arlas-server.
                         * The sources are only cleaned if filters change
                         */
                    });
                    const clusterAggsBuilder = this.prepareClusterAggregations(dClusterSources, zoom);
                    const featureSearchBuilder = this.prepareFeaturesSearch(dFeatureSources, SearchStrategy.visibility_rules);
                    /** renders visible sources */
                    clusterAggsBuilder.forEach((aggSource, aggId) => {
                        this.renderAggSources(aggSource.sources, true);
                    });
                    featureSearchBuilder.forEach((searchSource, f) => {
                        this.renderSearchSources(searchSource.sources);
                    });
                    this.fetchAggSources(mapLoadExtent, mapLoadRawExtent, zoom, clusterAggsBuilder, this.CLUSTER_SOURCE);
                    this.fetchTiledSearchSources(mapLoadExtent, mapLoadRawExtent, featureSearchBuilder);
                });
            }
        }
    }

    /**
     * Applies the geoQueryOperation
     */
    public onChangeGeoQuery() {
        const collaboration: Collaboration = this.collaborativeSearcheService.getCollaboration(this.identifier);
        if (collaboration !== null) {
            let filter: Filter;
            if (collaboration.filters && collaboration.filters.get(this.collection)) {
                filter = collaboration.filters.get(this.collection)[0];
            }
            const collabFilters = new Map<string, Filter[]>();
            switch (this.geoQueryOperation) {
                case Expression.OpEnum.Notintersects:
                case Expression.OpEnum.Notwithin:
                    const andFilter: Expression[][] = [];
                    filter.f.forEach((expressions: Expression[]) => {
                        expressions.forEach((exp: Expression) => {
                            exp.field = this.geoQueryField;
                            exp.op = this.geoQueryOperation;
                            andFilter.push([exp]);
                        });
                    });
                    collabFilters.set(this.collection, [{
                        f: andFilter
                    }]);
                    const andCollaboration: Collaboration = {
                        filters: collabFilters,
                        enabled: collaboration.enabled
                    };
                    this.collaborativeSearcheService.setFilter(this.identifier, andCollaboration);
                    break;
                case Expression.OpEnum.Intersects:
                case Expression.OpEnum.Within:
                    const orFilter: Expression[][] = [];
                    const multiExpressions: Expression[] = [];
                    filter.f.forEach((expressions: Expression[]) => {
                        expressions.forEach((exp: Expression) => {
                            exp.field = this.geoQueryField;
                            exp.op = this.geoQueryOperation;
                            multiExpressions.push(exp);
                        });
                    });
                    orFilter.push(multiExpressions);
                    collabFilters.set(this.collection, [{
                        f: orFilter
                    }]);
                    const orCollaboration: Collaboration = {
                        filters: collabFilters,
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
            let filter: Filter;
            if (collaboration.filters?.get(this.collection)) {
                filter = collaboration.filters.get(this.collection)[0];
            }
            const polygonGeojsons = [];
            const aois: string[] = [];
            if (filter?.f) {
                const operation = filter.f[0][0].op;
                const field = filter.f[0][0].field;
                this.setGeoQueryField(field);
                this.setGeoQueryOperation(operation.toString());
                filter.f.forEach(exprs => {
                    exprs.forEach(expr => {
                        if (expr.op === this.geoQueryOperation) {
                            aois.push(expr.value);
                        }
                    });
                });
            }
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
        this.drawingsUpdate.next(this.geojsondraw);
    }
    public getBoundsToFit(elementidentifier: ElementIdentifier, collection?: string): Observable<Array<Array<number>>> {
        if (!collection) {
            collection = this.collaborativeSearcheService.defaultCollection;
        }
        const bounddsToFit = getBounds(elementidentifier, this.collaborativeSearcheService, collection);
        return bounddsToFit;
    }

    public getFeatureToHightLight(elementidentifier: ElementIdentifier) {
        let isleaving = false;
        let id = elementidentifier.idValue;
        if (id.split('-')[0] === 'leave') {
            id = id.split('leave-', 2)[1];
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
     * @param fc FeatureCollection object
     */
    public onChangeAoi(fc: helpers.FeatureCollection<helpers.Geometry>) {
        let filters: Filter;
        const geoFilter: Array<string> = new Array();
        fc = truncate(fc, { precision: this.drawPrecision });
        if (fc.features.length > 0) {
            this.getGeometriesForQuery(fc.features).forEach(f => geoFilter.push(f));

            switch (this.geoQueryOperation) {
                case Expression.OpEnum.Notintersects:
                case Expression.OpEnum.Notwithin:
                    const andFilter = [];
                    geoFilter.map(p => ({
                        field: this.geoQueryField,
                        op: this.geoQueryOperation,
                        value: p
                    })).forEach(exp => {
                        andFilter.push([exp]);
                    });
                    filters = {
                        f: andFilter
                    };
                    break;
                case Expression.OpEnum.Intersects:
                case Expression.OpEnum.Within:
                    filters = {
                        f: [geoFilter.map(p => ({
                            field: this.geoQueryField,
                            op: this.geoQueryOperation,
                            value: p
                        }))]
                    };
                    break;
            }
            const collabFilters = new Map<string, Filter[]>();
            collabFilters.set(this.collection, [filters]);
            const data: Collaboration = {
                filters: collabFilters,
                enabled: true
            };
            this.collaborativeSearcheService.setFilter(this.identifier, data);
        } else {
            if (this.collaborativeSearcheService.getCollaboration(this.identifier) !== null) {
                this.collaborativeSearcheService.removeFilter(this.identifier);
            }
        }
    }

    public onMove(newMove: OnMoveResult, recalculateWindow: boolean) {
        this.onMapMoved(newMove, recalculateWindow);
    }

    /**
     * Renders the data of the given agg sources.
     * @param sources List of sources names (sources must be of the same type : cluster OR topology)
     */
    public renderAggSources(sources: Array<string>, isLastCall = false): void {
        if (sources && sources.length > 0) {
            const aggType = this.sourcesTypesIndex.get(sources[0]);
            switch (aggType) {
                case this.CLUSTER_SOURCE:
                    this.renderClusterSources(sources, isLastCall);
                    break;
                case this.TOPOLOGY_SOURCE:
                    this.renderTopologySources(sources);
                    break;
            }
        }
    }
    public setLegendSearchData(s: string): void {
        if (this.searchNormalizations) {
            const featuresNormalization = this.searchNormalizations.get(s);
            if (featuresNormalization) {
                featuresNormalization.forEach(n => {
                    const normalizeField = (this.isFlat && n.on) ? n.on.replace(/\./g, this.FLAT_CHAR) : n.on;
                    const perField = (this.isFlat && n.per) ? n.per.replace(/\./g, this.FLAT_CHAR) : n.per;
                    if (n.per) {
                        let legendData = { minValue: '', maxValue: '' };
                        if (this.dateFieldFormatMap.has(n.on)) {
                            legendData = { minValue: 'Old', maxValue: 'Recent' };
                        } else {
                            legendData = { minValue: 'Small', maxValue: 'High' };
                        }
                        this.legendData.set(normalizeField + NORMALIZE_PER_KEY + perField, legendData);
                    } else {
                        const minMax = n.minMax;
                        const featureData = this.featureDataPerSource.get(s);
                        let minValue = '';
                        let maxValue = '';
                        if (!!featureData && featureData.length > 0) {
                            minValue = this.getAbreviatedNumber(minMax[0]);
                            maxValue = this.getAbreviatedNumber(minMax[1]);
                        }
                        const legendData = { minValue, maxValue };
                        this.legendData.set(normalizeField + NORMALIZE, legendData);
                    }
                });
                this.legendUpdater.next(this.legendData);
            }
        }
    }
    /**
     * Render raw data provided by `feature` mode sources. It's used for both simple and dynamic mode.
     * @param sources List of sources names (sources must be of the same type : feature)
     */
    public renderSearchSources(sources: Array<string>): void {
        sources.forEach(s => {
            this.redrawSource.next({ source: s, data: [] });
            this.setLegendSearchData(s);
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

                    this.processSearchFeature(s, feature, true);
                    delete feature.properties.geometry_path;
                    delete feature.properties.feature_type;

                    const metricsKeys = this.searchSourcesMetrics.get(s);
                    const idPath = this.isFlat ? this.collectionParameters.id_path.replace(/\./g, this.FLAT_CHAR) :
                        this.collectionParameters.id_path;

                    const arlasTimestamp = this.getTimestampFromMD(feature.properties.md);
                    if (arlasTimestamp) {
                        feature.properties[ARLAS_TIMESTAMP] = arlasTimestamp;
                    }
                    delete feature.properties.md;
                    Object.keys(feature.properties).forEach(k => {
                        if (metricsKeys && !this.isBeginingOfKeyInValues(k, metricsKeys) &&
                            k !== 'id' && k !== idPath && k !== ARLAS_TIMESTAMP) {
                            delete feature.properties[k];
                        }
                    });
                    this.fix180thMeridianGeom(feature);
                    sourceData.push(feature);
                });
            }
            this.redrawSource.next({ source: s, data: sourceData });
        });
        this.legendUpdater.next(this.legendData);
    }


    private getTimestampFromMD(mdValue: string): number {
        // Define a regular expression pattern to match the timestamp
        const pattern = /timestamp=(\d+)/;
        // Use the match method to extract the timestamp value
        const match = mdValue?.match(pattern);
        if (match && match[1]) {
            const timestampValue = +match[1];
            return timestampValue;
        } else {
            return undefined;
        }
    }

    private fix180thMeridianGeom(feature: Feature) {
        switch ((feature.geometry as any).type) {
            case 'LineString':
                (feature.geometry as any).coordinates = fix180thMeridian((feature.geometry as any).coordinates, 'LineString');
                break;
            case 'Polygon':
                (feature.geometry as any).coordinates[0] = fix180thMeridian((feature.geometry as any).coordinates[0], 'Polygon');
                break;
            case 'MultiPolygon':
                (feature.geometry as any).coordinates.forEach(c => {
                    c[0] = fix180thMeridian(c[0], 'Polygon');
                });
                break;
        }
    }

    public downloadLayerSource(source: string, layerName: string, downloadType: string, displayFieldNameMap?: Map<string, string>) {
        let sourceData = [];
        if (this.cellsPerSource.has(source)) {
            sourceData = this.downloadClusterSource(source);
        } else if (this.topologyDataPerSource.has(source)) {
            sourceData = this.downloadTopologySource(source);
        } else {
            sourceData = this.downloadSearchSource(source);
        }

        if (downloadType === 'csv') {
            const contentType = 'text/csv';
            const a = document.createElement('a');
            a.download = layerName
                .concat(new Date().getTime().toString())
                .concat('.csv');
            a.href = window.URL.createObjectURL(this.exportSourceAsCSV(sourceData, displayFieldNameMap));
            a.dataset.downloadurl = [contentType, a.download, a.href].join(':');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } else {
            const geojson = {
                type: 'FeatureCollection',
                features: sourceData
            };

            this.saveJson(geojson, layerName
                .concat(new Date().getTime().toString())
                .concat('-geojson.json'));

        }
    }

    /**
     * Renders the data of the given topology sources.
     * @param sources List of sources names (sources must be of the same type : topology)
     */
    public renderTopologySources(sources: Array<string>): void {
        sources.forEach(s => {
            this.redrawSource.next({ source: s, data: [] });
            const topologyRawData = this.topologyDataPerSource.get(s);
            const stats = this.aggSourcesStats.get(s);
            const sourceData = [];
            if (topologyRawData) {
                topologyRawData.forEach((f) => {
                    const properties = Object.assign({}, f.properties);
                    const feature = Object.assign({}, f);
                    feature.properties = properties;

                    const fieldsToKeep = this.processTopologyFeature(s, feature, true);

                    this.fix180thMeridianGeom(feature);
                    this.cleanRenderedAggFeature(s, feature, fieldsToKeep);
                    this.normalizeAvgForTopology(s, feature);
                    sourceData.push(feature);
                });
            }
            this.redrawSource.next({ source: s, data: sourceData });
            if (!!stats) {
                this.legendData.set('count', {
                    minValue: '0',
                    maxValue: stats.count + ''
                });
            }
        });
        this.legendUpdater.next(this.legendData);
    }

    public exportSourceAsCSV(features: any[], displayFieldNameMap?: Map<string, string>): Blob {
        const csvData = new Array<Array<string>>();
        const header = new Array<string>();
        /** Header */
        const f = features[0];
        Array.from(Object.keys(f.properties)).sort().forEach(k => {
            if (displayFieldNameMap) {
                const nameFromMap = displayFieldNameMap.get(k.replace(/\./g, this.FLAT_CHAR));
                const title = nameFromMap ? nameFromMap : k;
                header.push(title);
            } else {
                header.push(k);
            }
        });
        header.push('geometry');
        csvData.push(header);
        features.forEach(feature => {
            const csvLine = new Array<string>();
            Array.from(Object.keys(feature.properties)).sort().forEach(k => csvLine.push(feature.properties[k]));
            csvLine.push(JSON.stringify(feature.geometry));
            csvData.push(csvLine);
        });
        const CSV = csvData.map(l => l.join(';')).join('\n');
        const contentType = 'text/csv';
        const csvFile = new Blob([CSV], { type: contentType });
        return csvFile;
    }

    public saveJson(json: any, filename: string, separator?: string) {
        const blob = new Blob([JSON.stringify(json, (key, value) => {
            if (!!separator && value && typeof value === 'object' && !Array.isArray(value)) {
                // convert keys to snake- or kebab-case (eventually other) according to the separator.
                // In fact we cannot declare a property with a snake-cased name,
                // (so in models interfaces properties are are camel case)
                const replacement = {};
                for (const k in value) {
                    if (Object.hasOwn(value, k)) {
                        replacement[
                            k.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
                                .map(x => x.toLowerCase())
                                .join(separator)
                        ] = value[k];
                    }
                }
                return replacement;
            }
            return value;
        }, 2)], { type: 'application/json;charset=utf-8' });
        FileSaver.saveAs(blob, filename);
    }

    /**
     * Renders the data of the given cluster sources.
     * @param sources List of sources names (sources must be of the same type : cluster)
     */
    public renderClusterSources(sources: Array<string>, isLastCall = false): void {
        sources.forEach(s => {
            this.redrawSource.next({ source: s, data: [] });
            const sourceCells = this.cellsPerSource.get(s);
            const stats = this.aggSourcesStats.get(s);
            const metricsKeys = this.aggSourcesMetrics.get(s);
            const sourceData = [];
            if (sourceCells) {
                sourceCells.forEach((f, key) => {
                    const fieldsToKeep = new Set<string>();
                    /** cloning features in order to keep the original features intact */
                    const properties = Object.assign({}, f.properties);
                    const feature = Object.assign({}, f);
                    feature.properties = properties;
                    delete feature.properties.geohash;
                    delete feature.properties.parent_geohash;
                    delete feature.properties.tile;
                    delete feature.properties.parent_tile;
                    const fetchHits = this.clusterLayersIndex.get(s).fetchedHits;

                    if (fetchHits) {
                        fetchHits.fields.forEach(field => {
                            const flattenField = field.replace(/\./g, this.FLAT_CHAR);
                            feature.properties[flattenField] = feature.properties['hits_0_' + flattenField];
                            fieldsToKeep.add(flattenField);
                        });
                        if (fetchHits.short_form_fields) {
                            fetchHits.short_form_fields.forEach(field => {
                                const flattenField = field.replace(/\./g, this.FLAT_CHAR);
                                feature.properties[flattenField + SHORT_VALUE] = numToString(feature.properties[flattenField]);
                                fieldsToKeep.add(flattenField + SHORT_VALUE);
                            });
                        }
                    }
                    this.fix180thMeridianGeom(feature);
                    this.cleanRenderedAggFeature(s, feature, fieldsToKeep, true);
                    sourceData.push(feature);
                });
                if (metricsKeys && isLastCall) {
                    const hasAvg = Array.from(metricsKeys).find(key => key.endsWith(AVG));
                    const hasAvgNormalized = Array.from(metricsKeys).find(key => key.endsWith(AVG + NORMALIZE));
                    /** prepare normalization of average by calculating the min and max values of each metrics that is to be normalized */
                    if (hasAvgNormalized || hasAvg) {
                        metricsKeys.forEach(key => {
                            if (key.endsWith(AVG + NORMALIZE)) {
                                stats[key] = { min: Number.MAX_VALUE, max: -Number.MAX_VALUE };
                                /** getting the min max average values of all cells */
                                /** looping on sourceData that contains cloned features and not original ones in order to keep orignal
                                 * values intact
                                 */
                                sourceData.forEach((feature, k) => {
                                    const keyWithoutNormalize = key.replace(NORMALIZE, '');
                                    if (notInfinity(feature.properties[keyWithoutNormalize])) {
                                        feature.properties[key] = feature.properties[keyWithoutNormalize];
                                        /** division of the avg by the count. Should not be re-devided */
                                        feature.properties[keyWithoutNormalize] = feature.properties[keyWithoutNormalize]
                                            / feature.properties.count;
                                        feature.properties[key] = feature.properties[key] / feature.properties.count;
                                        if (stats[key].max < feature.properties[keyWithoutNormalize]) {
                                            stats[key].max = feature.properties[keyWithoutNormalize];
                                        }
                                        if (stats[key].min > feature.properties[keyWithoutNormalize]) {
                                            stats[key].min = feature.properties[keyWithoutNormalize];
                                        }
                                    } else {
                                        /** nothing is done, the feature will not be displayed */
                                    }
                                });
                                /** normalizing */
                                sourceData.forEach((feature, k) => {
                                    const metricStats = stats[key];
                                    if (notInfinity(feature.properties[key])) {
                                        if (metricStats.min === metricStats.max) {
                                            feature.properties[key] = 1;
                                        } else {
                                            feature.properties[key] = (feature.properties[key] - metricStats.min)
                                                / (metricStats.max - metricStats.min);
                                        }
                                    }
                                });
                            } else if (key.endsWith(AVG)) {
                                const hasAlsoNormalisation = !!Array.from(metricsKeys).find(mk => mk === key + NORMALIZE);
                                /** if the same avg metric is also demanded as normalised, the division by
                                 * the count is done at normalisation phase and should not be done again here.
                                 * The division by count should be done here if the normalisation of the same
                                 * avg metric has not been demanded.
                                 */
                                if (!hasAlsoNormalisation) {
                                    sourceData.forEach((feature, k) => {
                                        if (notInfinity(feature.properties[key])) {
                                            feature.properties[key] = feature.properties[key] / feature.properties.count;
                                        }
                                    });
                                }
                            }
                        });
                    }
                }
            }
            /** set minValue and maxValue foreach metric to be sent to the legend */
            this.redrawSource.next({ source: s, data: sourceData });
            if (!!stats) {
                this.legendData.set('count', {
                    minValue: '0',
                    maxValue: stats.count + ''
                });
            }
        });
        this.legendUpdater.next(this.legendData);
    }

    public downloadClusterSource(source: string) {
        const sourceCells = this.cellsPerSource.get(source);
        const sourceData = [];
        const metricsKeys = this.aggSourcesMetrics.get(source);
        if (sourceCells) {
            sourceCells.forEach((f, key) => {
                /** cloning features in order to keep the original features intact */
                const properties = Object.assign({}, f.properties);
                const feature = Object.assign({}, f);
                feature.properties = properties;
                // feature.properties['point_count_abreviated'] = this.intToString(feature.properties.count);
                // delete feature.properties.geohash;
                delete feature.properties.parent_geohash;
                // delete feature.properties.tile;
                delete feature.properties.parent_tile;
                const fetchHits = this.clusterLayersIndex.get(source).fetchedHits;

                if (fetchHits) {
                    fetchHits.fields.forEach(field => {
                        const flattenField = field.replace(/\./g, this.FLAT_CHAR);
                        feature.properties[flattenField] = feature.properties['hits_0_' + flattenField];
                    });
                    if (fetchHits.short_form_fields) {
                        fetchHits.short_form_fields.forEach(field => {
                            const flattenField = field.replace(/\./g, this.FLAT_CHAR);
                            feature.properties[flattenField + SHORT_VALUE] = numToString(feature.properties[flattenField]);
                        });
                    }
                }
                sourceData.push(feature);
            });
            if (metricsKeys) {
                const avgKeys = Array.from(metricsKeys).filter(key => key.endsWith(AVG));
                /** prepare normalization of average by calculating the min and max values of each metrics that is to be normalized */
                if (!!avgKeys) {
                    avgKeys.forEach(key => {
                        sourceData.forEach((feature, k) => {
                            if (notInfinity(feature.properties[key])) {
                                feature.properties[key] = feature.properties[key] / feature.properties.count;
                            }
                        });
                    });
                }
            }
        }
        return sourceData;
    }

    public downloadTopologySource(s: string) {
        const topologyRawData = this.topologyDataPerSource.get(s);
        const sourceData = [];
        if (topologyRawData) {
            topologyRawData.forEach((f) => {
                const properties = Object.assign({}, f.properties);
                const feature = Object.assign({}, f);
                feature.properties = properties;

                this.processTopologyFeature(s, feature, false);
                sourceData.push(feature);
            });
        }
        return sourceData;
    }


    public downloadSearchSource(s: string) {
        const featureRawData = this.featureDataPerSource.get(s);
        const sourceData = [];
        if (featureRawData) {
            featureRawData.forEach(f => {
                const properties = Object.assign({}, f.properties);
                const feature = Object.assign({}, f);
                feature.properties = properties;

                this.processSearchFeature(s, feature, false);
                delete feature.properties.md;

                sourceData.push(feature);
            });
        }
        return sourceData;
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
                [projType.tiledgeosearch, tiledSearch], this.collaborativeSearcheService.collaborations,
                this.collection, this.isFlat, control.signal,
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
            [projType.geosearch, search], this.collaborativeSearcheService.collaborations, this.collection, this.isFlat,
            null, filter, this.cacheDuration);

    }
    public resolveAggSources(visitedTiles: Set<string>, aggId: string, aggregation: Aggregation):
        Observable<FeatureCollection> {
        const tabOfCells: Array<Observable<FeatureCollection>> = [];
        const control = this.abortControllers.get(aggId);
        if (aggregation.type === Aggregation.TypeEnum.Geohash) {
            visitedTiles.forEach(geohash => {
                const geohahsAggregation: GeohashAggregation = {
                    geohash: geohash,
                    aggregations: [aggregation]
                };
                const geoAggregateData: Observable<FeatureCollection> =
                    this.collaborativeSearcheService.resolveButNotFeatureCollectionWithAbort(
                        [projType.geohashgeoaggregate, geohahsAggregation], this.collaborativeSearcheService.collaborations,
                        this.collection, this.isFlat, control.signal, null, this.additionalFilter, this.cacheDuration);
                tabOfCells.push(geoAggregateData);
            });
        } else {
            visitedTiles.forEach(x_y_z => {
                const geotileAggregation: GeoTileAggregation = {
                    x: Number.parseFloat(x_y_z.split('_')[0]),
                    y: Number.parseFloat(x_y_z.split('_')[1]),
                    z: Number.parseFloat(x_y_z.split('_')[2]),
                    aggregations: [aggregation]
                };
                const geoAggregateData: Observable<FeatureCollection> =
                    this.collaborativeSearcheService.resolveButNotFeatureCollectionWithAbort(
                        [projType.geotilegeoaggregate, geotileAggregation], this.collaborativeSearcheService.collaborations,
                        this.collection, this.isFlat, control.signal, null, this.additionalFilter, this.cacheDuration);
                tabOfCells.push(geoAggregateData);
            });
        }

        return from(tabOfCells).pipe(mergeAll());
    }

    public fetchTiledSearchSources(extent: Array<number>, rawExtent: Array<number>, searches: Map<string, SourcesSearch>) {
        searches.forEach((searchSource, searchId) => {
            const newVisitedTiles = this.getVisitedXYZTiles(extent, rawExtent, searchSource.sources);
            let count = 0;
            const totalcount = newVisitedTiles.size;
            if (newVisitedTiles.size > 0 && searchSource.sources.length > 0) {
                this.collaborativeSearcheService.ongoingSubscribe.next(1);
                const start = Date.now();
                const lastCall = this.lastCalls.get(searchId);
                this.setCallCancellers(searchId, lastCall);
                const cancelSubjects = this.cancelSubjects.get(searchId);
                const renderRetries = [];
                this.resolveTiledSearchSources(newVisitedTiles, searchId, searchSource.search)
                    .pipe(
                        takeUntil(cancelSubjects.get(lastCall)),
                        map(f => this.computeFeatureData(f, searchSource.sources)),
                        tap(() => count++),
                        tap(() => {
                            const progression = count / totalcount * 100;
                            const consumption = Date.now() - start;
                            if (consumption > 2000) {
                                if (progression > 25 && renderRetries.length === 0) {
                                    this.renderSearchSources(searchSource.sources);
                                    renderRetries.push('1');
                                } else if (progression > 50 && renderRetries.length <= 1) {
                                    this.renderSearchSources(searchSource.sources);
                                    renderRetries.push('2');
                                } else if (progression > 75 && renderRetries.length <= 2) {
                                    this.renderSearchSources(searchSource.sources);
                                    renderRetries.push('3');
                                }
                            }
                        }),
                        finalize(() => {
                            this.renderSearchSources(searchSource.sources);
                            this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                        })
                    ).subscribe(data => data);
            }

        });
    }

    public fetchSearchSources(filter: Filter, searches: Map<string, SourcesSearch>, renderStrategy: RenderStrategy,
        maxPages?: number, whichPage?: PageEnum) {
        searches.forEach((searchSource, searchId) => {
            this.collaborativeSearcheService.ongoingSubscribe.next(1);
            this.resolveSearchSources(filter, searchId, searchSource.search)
                .pipe(
                    map(f => this.computeSimpleModeFeature(f, searchSource.sources, renderStrategy, maxPages, whichPage)),
                    finalize(() => {
                        // todo manage same source but in different visualisation set
                        searchSource.sources.forEach(s => {
                            this.sourceToLayerIndex.get(s).forEach(
                                l => {
                                    this.visibilityStatus.set(l, true);
                                }
                            );
                        });
                        this.visibilityUpdater.next(this.visibilityStatus);
                        this.renderSearchSources(searchSource.sources);
                        this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                    })
                ).subscribe(data => data);

        });
    }
    public fetchAggSources(extent: Array<number>, rawExtent: Array<number>,
        zoom: number, aggs: Map<string, SourcesAgg>, aggType: string): void {
        aggs.forEach((aggSource, aggId) => {
            let granularity: Granularity;
            let networkFetchingLevel: number;
            if (aggType === this.CLUSTER_SOURCE) {
                granularity = this.clusterLayersIndex.get(aggSource.sources[0]).granularity;
            } else if (aggType === this.TOPOLOGY_SOURCE) {
                networkFetchingLevel = this.topologyLayersIndex.get(aggSource.sources[0]).networkFetchingLevel;
            }
            let count = 0;
            const newVisitedTiles = this.getVisitedTiles(extent, rawExtent, zoom, granularity, networkFetchingLevel, aggSource, aggType);
            const totalcount = newVisitedTiles.size;
            if (totalcount > 0) {
                this.collaborativeSearcheService.ongoingSubscribe.next(1);
                const lastCall = this.lastCalls.get(aggId);
                const renderRetries = [];
                const start = Date.now();
                this.setCallCancellers(aggId, lastCall);
                const cancelSubjects = this.cancelSubjects.get(aggId);
                this.resolveAggSources(newVisitedTiles, aggId, aggSource.agg)
                    .pipe(
                        takeUntil(cancelSubjects.get(lastCall)),
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
                                } else if (progression > 50 && renderRetries.length <= 1) {
                                    this.renderAggSources(aggSource.sources);
                                    renderRetries.push('2');
                                } else if (progression > 75 && renderRetries.length <= 2) {
                                    this.renderAggSources(aggSource.sources);
                                    renderRetries.push('3');
                                }
                            }
                        }),
                        finalize(() => {
                            this.renderAggSources(aggSource.sources, true);
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
        const geometrySourceIndex = new Map();
        const sourceGeometryIndex = new Map();
        sources.forEach(cs => {
            const ls = this.featureLayerSourcesIndex.get(cs);
            const geometryPath = ls.returnedGeometry;
            geometrySourceIndex.set(geometryPath, cs);
            sourceGeometryIndex.set(cs, geometryPath);
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
                    let idValue = feature.properties[idPath];
                    if (idValue !== undefined) {
                        idValue = idValue.toString();
                    }
                    feature.properties.id = idValue;
                    if (!ids.has(feature.properties.id + '-' + feature.properties.geometry_path)) {
                        const normalizations = this.searchNormalizations.get(source);
                        if (normalizations) {
                            normalizations.forEach(n => {
                                this.prepareSearchNormalization(feature, n);
                            });
                            this.searchNormalizations.set(source, normalizations);
                        }
                        if (feature.properties.geometry_path === sourceGeometryIndex.get(source)) {
                            featureData.push(feature);
                        }
                        ids.add(feature.properties.id + '-' + feature.properties.geometry_path);
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
                aggSource.sources.filter(source => {
                    const topologySource = this.topologyLayersIndex.get(source);
                    return !!topologySource && !!topologySource.rawGeometry &&
                        topologySource.rawGeometry.geometry === feature.properties.geometry_ref;

                }).forEach(source => {
                    let topologyData = this.topologyDataPerSource.get(source);
                    if (!topologyData) {
                        topologyData = new Array();
                    }
                    this.calculateAggMetricsStatsExceptAvg(source, feature);
                    this.calculatesAvgStatsForTopology(source, feature);
                    topologyData.push(feature);
                    this.topologyDataPerSource.set(source, topologyData);
                });
            });
        }
    }
    public computeClusterData(featureCollection: FeatureCollection, aggSource: SourcesAgg): void {
        const geometrySourceIndex = new Map();
        const sourceGeometryIndex = new Map();
        aggSource.sources.forEach(cs => {
            const ls = this.clusterLayersIndex.get(cs);
            const aggType = ls.type ?? ClusterAggType.geohash;
            const geometryRef = ls.aggregatedGeometry ? ls.aggregatedGeometry + '-' + aggType.toString() :
                ls.rawGeometry.geometry + '-' + ls.rawGeometry.sort + '-' + aggType.toString();
            geometrySourceIndex.set(geometryRef, cs);
            sourceGeometryIndex.set(cs, geometryRef);
        });
        const parentCellsPerSource = new Map();
        if (featureCollection && featureCollection.features !== undefined) {
            featureCollection.features.forEach(feature => {
                delete feature.properties.key;
                delete feature.properties.key_as_string;
                let aggType: ClusterAggType;
                if (!!feature.properties.geohash) {
                    aggType = ClusterAggType.geohash;
                }
                if (!!feature.properties.tile) {
                    aggType = ClusterAggType.tile;
                }
                if (!!feature.properties.geohex) {
                    aggType = ClusterAggType.h3;
                }
                const geometryRef = feature.properties.geometry_sort ?
                    feature.properties.geometry_ref + '-' + feature.properties.geometry_sort + '-'
                    + aggType : feature.properties.geometry_ref + '-' + aggType;
                /** Here a feature is a geohash or tile. */
                /** We check if the geohash or tile is already displayed in the map */
                const gmap = this.cellsPerSource.get(geometrySourceIndex.get(geometryRef));
                let existingCell;
                if (!!feature.properties.geohash) {
                    existingCell = gmap ? gmap.get(feature.properties.geohash) : null;
                }
                if (!!feature.properties.tile) {
                    existingCell = gmap ? gmap.get(feature.properties.tile) : null;
                }
                if (!!feature.properties.geohex) {
                    existingCell = gmap ? gmap.get(feature.properties.geohex) : null;
                }
                if (existingCell) {
                    /** parent_geohash or parent_tile corresponds to the geohash or tile on which we applied the geoaggregation */
                    aggSource.sources.forEach(source => {
                        const parentCells = this.parentCellsPerSource.get(source);
                        const metricsKeys = this.aggSourcesMetrics.get(source);
                        let parentCellsTest;
                        if (!!feature.properties.geohash) {
                            parentCellsTest = !parentCells.has(feature.properties.parent_geohash);
                        }
                        if (!!feature.properties.tile) {
                            parentCellsTest = !parentCells.has(feature.properties.parent_tile);
                        }
                        if (!!feature.properties.geohex) {
                            parentCellsTest = !parentCells.has(feature.properties.parent_cell);
                        }
                        if (parentCellsTest) {
                            /** when this tile (parent_geohash or parent_tile) is requested for the first time we merge the counts */
                            if (metricsKeys) {
                                const countValue = feature.properties.count;
                                // filter keys to merge once : for example if we have SUM & SUM + NORMALIZE; we should merge one time
                                const uniqueMetrics = new Set(Array.from(metricsKeys).map(key => key.replace(NORMALIZE, '')));
                                uniqueMetrics.forEach(realKey => {
                                    if (realKey.endsWith(SUM)) {
                                        feature.properties[realKey] += existingCell.properties[realKey];
                                    } else if (realKey.endsWith(MAX)) {
                                        feature.properties[realKey] = (feature.properties[realKey] > existingCell.properties[realKey]) ?
                                            feature.properties[realKey] : existingCell.properties[realKey];
                                    } else if (realKey.endsWith(MIN)) {
                                        feature.properties[realKey] = (feature.properties[realKey] < existingCell.properties[realKey]) ?
                                            feature.properties[realKey] : existingCell.properties[realKey];
                                    } else if (realKey.endsWith(AVG)) {
                                        /** calculates a weighted average. existing geohash feature is already weighted */
                                        feature.properties[realKey] = feature.properties[realKey] *
                                            countValue + existingCell.properties[realKey];
                                    }
                                });
                            }
                            feature.properties.count = feature.properties.count + existingCell.properties.count;
                        } else {
                            /** when the tile has already been visited. (This can happen when we load the app for the first time),
                             * then we don't merge */
                            feature.properties.count = existingCell.properties.count;
                            if (metricsKeys) {
                                metricsKeys.forEach(key => {
                                    const realKey = key.replace(NORMALIZE, '');
                                    feature.properties[realKey] = existingCell.properties[realKey];
                                });
                            }
                        }
                    });
                } else {
                    aggSource.sources.forEach(source => {
                        const metricsKeys = this.aggSourcesMetrics.get(source);
                        if (metricsKeys) {
                            const countValue = feature.properties.count;
                            // filter keys to merge once : for example if we have SUM & SUM + NORMALIZE; we should merge one time
                            const uniqueMetrics = new Set(Array.from(metricsKeys).map(key => key.replace(NORMALIZE, '')));
                            uniqueMetrics.forEach(key => {
                                if (key.endsWith(AVG)) {
                                    feature.properties[key] = feature.properties[key] * countValue;
                                }
                            });
                        }
                    });
                }
                aggSource.sources.forEach(source => {
                    if (geometryRef === sourceGeometryIndex.get(source)) {
                        let cellsMap = this.cellsPerSource.get(source);
                        if (!cellsMap) {
                            cellsMap = new Map();
                        }
                        if (!!feature.properties.geohash) {
                            cellsMap.set(feature.properties.geohash, feature);
                        }
                        if (!!feature.properties.tile) {
                            cellsMap.set(feature.properties.tile, feature);
                        }
                        if (!!feature.properties.geohex) {
                            cellsMap.set(feature.properties.geohex, feature);
                        }
                        this.cellsPerSource.set(source, cellsMap);
                        if (!!feature.properties.geohash) {
                            parentCellsPerSource.set(source, feature.properties.parent_geohash);
                        }
                        if (!!feature.properties.tile) {
                            parentCellsPerSource.set(source, feature.properties.parent_tile);
                        }
                        if (!!feature.properties.geohex) {
                            parentCellsPerSource.set(source, feature.properties.parent_cell);
                        }
                        this.calculateAggMetricsStatsExceptAvg(source, feature);
                    }
                });
            });
        }
        if (parentCellsPerSource.size > 0) {
            parentCellsPerSource.forEach((pgh, source) => {
                let parentCells = this.parentCellsPerSource.get(source);
                if (!parentCells) {
                    parentCells = new Set();
                }
                parentCells.add(pgh);
                this.parentCellsPerSource.set(source, parentCells);
            });
        }
    }

    public setDataCellGeoaggregate(features: Array<any>): any {
        return features;
    }
    /**
     * Get the previous/following set of data.
     * @param reference the last/first feature returned  and from which next/previous data is fetched.
     * @param sort comma separated field names on which feature are sorted.
     * @param whichPage Whether to fetch next or previous set.
     * @param maxPages The maxumum number of set features.
     */
    public getPage(reference: Map<string, ItemDataType>, sort: string, whichPage: PageEnum, maxPages: number): void {
        const wrapExtent = extentToString(this.mapTestWrappedExtent);
        const rawExtent = extentToString(this.mapTestRawExtent);
        let after;
        if (whichPage === PageEnum.previous) {
            after = reference.get(this.PREVIOUS_AFTER);
        } else {
            after = reference.get(this.NEXT_AFTER);
        }
        const sortWithId = appendIdToSort(sort, ASC, this.collectionParameters.id_path);
        const keepOldData = true;
        if (after !== undefined) {
            const windowVisibleSources = new Set<string>();
            this.visibleSources.forEach(visibleSource => {
                if (this.featureLayerSourcesIndex.has(visibleSource)
                    && this.featureLayerSourcesIndex.get(visibleSource).renderMode === FeatureRenderMode.window) {
                    windowVisibleSources.add(visibleSource);
                }
            });
            this.getWindowModeData(wrapExtent, rawExtent, windowVisibleSources, sortWithId, keepOldData, after, whichPage, maxPages);
        }
    }

    public computeSimpleModeFeature(featureCollection: FeatureCollection, sources: Array<string>,
        renderStrategy: RenderStrategy, maxPages?: number, whichPage?: PageEnum) {
        const geometrySourceIndex = new Map();
        const sourceGeometryIndex = new Map();
        sources.forEach(cs => {
            const ls = this.featureLayerSourcesIndex.get(cs);
            const geometryPath = ls.returnedGeometry;
            geometrySourceIndex.set(geometryPath, cs);
            sourceGeometryIndex.set(cs, geometryPath);
        });
        if (featureCollection && featureCollection.features !== undefined) {
            featureCollection.features.forEach(feature => {
                sources.forEach(source => {
                    const idPath = this.isFlat ? this.collectionParameters.id_path.replace(/\./g, this.FLAT_CHAR) :
                        this.collectionParameters.id_path;
                    let idValue = feature.properties[idPath];
                    if (idValue !== undefined) {
                        idValue = idValue.toString();
                    }
                    feature.properties.id = idValue;
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
                        const sourcesFeatures = f.filter(feature => feature.properties.geometry_path === sourceGeometryIndex.get(source));
                        let ids = this.featuresIdsIndex.get(source);
                        if (!ids) {
                            ids = new Set();
                        }
                        const features = sourcesFeatures.filter(feature => !ids.has(feature.properties.id));
                        features.forEach(feature => ids.add(feature.properties.id));
                        sourceData = sourceData.concat(features);
                        this.featureDataPerSource.set(source, sourceData);
                        this.featuresIdsIndex.set(source, ids);
                    });
                    break;
                case RenderStrategy.scroll:
                    if (maxPages !== undefined && maxPages !== null && whichPage !== undefined && whichPage !== null) {
                        sources.forEach(source => {
                            const sourceData = this.featureDataPerSource.get(source) ?? [];
                            if (maxPages !== -1) {
                                if (whichPage === PageEnum.next) {
                                    f.forEach(d => {
                                        sourceData.push(d);
                                    });
                                } else {
                                    f.reverse().forEach(d => {
                                        sourceData.unshift(d);
                                    });
                                }
                                if (whichPage === PageEnum.next) {
                                    removePageFromIndex(0, sourceData, this.searchSize, maxPages);
                                } else {
                                    removePageFromIndex(sourceData.length - this.searchSize, sourceData, this.searchSize, maxPages);
                                }
                            } else {
                                if (whichPage === PageEnum.next) {
                                    f.forEach(d => {
                                        sourceData.push(d);
                                    });
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
        const wrappedTestExtent = extentToString(this.mapTestWrappedExtent);
        const rawTestExtent = extentToString(this.mapTestRawExtent);
        const sort = appendId ? appendIdToSort(this.searchSort, ASC, this.collectionParameters.id_path) : this.searchSort;
        const keepOldData = false;
        const windowVisibleSources = new Set<string>();
        this.visibleSources.forEach(visibleSource => {
            if (this.featureLayerSourcesIndex.has(visibleSource)
                && this.featureLayerSourcesIndex.get(visibleSource).renderMode === FeatureRenderMode.window) {
                windowVisibleSources.add(visibleSource);
            }
        });
        this.getWindowModeData(wrappedTestExtent, rawTestExtent, windowVisibleSources, sort, keepOldData, null, null, null, fromParam);
    }


    /**
     * Static method that returns an ARLAS geographical filter, given the map extent and the geo_query field
     */
    public static getFilterFromExtent(rawExtent: string, wrappedExtent: string, geoQueryField: string): Filter {
        const finalExtends = getCanonicalExtents(rawExtent, wrappedExtent);
        const defaultQueryExpressions: Array<Expression> = [];
        defaultQueryExpressions.push({
            field: geoQueryField,
            op: Expression.OpEnum.Within,
            value: finalExtends[0]
        });
        if (finalExtends[1]) {
            defaultQueryExpressions.push({
                field: geoQueryField,
                op: Expression.OpEnum.Within,
                value: finalExtends[1]
            });
        }

        return {
            f: [defaultQueryExpressions]
        };
    }

    /**
     * Returns an arlas filter that includes the expression: the geoOp operation will be performed between the geoField and the rawExtent.
     * This filter will optionnaly contain the collaboration of this contributor.
     * @param rawExtent The extent of the map.
     * @param wrappedExtent Wrapped format of the rawExtent (wrapped to the range [-180, 180]).
     * @param geoField The geometry field to use for the geoOp with rawExtent.
     * @param geoOp The geographical operation to perform.
     * @param ignoreCollab Whether to ignore the collaboration of this contributor or to add it to the returned filter.
     * @returns Arlas Filter
     */
    public getExtentFilter(rawExtent: string, wrappedExtent: string, geoField: string, geoOp: Expression.OpEnum, ignoreCollab = false): Filter {
        // west, south, east, north
        const finalExtends = getCanonicalExtents(rawExtent, wrappedExtent);
        let filter: Filter = {};
        const collaboration = this.collaborativeSearcheService.getCollaboration(this.identifier);
        const defaultQueryExpressions: Array<Expression> = [];
        defaultQueryExpressions.push({
            field: geoField,
            op: geoOp,
            value: finalExtends[0]
        });
        if (finalExtends[1]) {
            defaultQueryExpressions.push({
                field: geoField,
                op: geoOp,
                value: finalExtends[1]
            });
        }
        if (collaboration !== null && collaboration !== undefined && !ignoreCollab) {
            if (collaboration.enabled) {
                const aois: string[] = [];
                let mapFilter: Filter;
                if (collaboration.filters && collaboration.filters.get(this.collection)) {
                    mapFilter = collaboration.filters.get(this.collection)[0];
                }
                mapFilter.f.forEach(exprs => {
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
                        if (this.geoQueryOperation === Expression.OpEnum.Notintersects) {
                            geoQueryOperationForCount = Expression.OpEnum.Intersects;
                        }
                        if (this.geoQueryOperation === Expression.OpEnum.Notwithin) {
                            geoQueryOperationForCount = Expression.OpEnum.Within;
                        }
                        const andFilter: Array<Array<Expression>> = [];
                        aois.map(p => ({
                            field: this.geoQueryField,
                            op: this.geoQueryOperation,
                            value: p
                        })).forEach(exp => {
                            andFilter.push([exp]);
                        });
                        const extendForCountExpressions: Array<Expression> = [];
                        extendForCountExpressions.push({
                            field: this.geoQueryField,
                            op: geoQueryOperationForCount,
                            value: finalExtends[0]
                        });
                        if (finalExtends[1]) {
                            extendForCountExpressions.push({
                                field: this.geoQueryField,
                                op: geoQueryOperationForCount,
                                value: finalExtends[1]
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
                            value: finalExtends[0]
                        });
                        if (finalExtends[1]) {
                            queryExpressions.push({
                                field: this.geoQueryField,
                                op: this.geoQueryOperation,
                                value: finalExtends[1]
                            });
                        }
                        filter = {
                            f: [
                                aois.map(p => ({
                                    field: this.geoQueryField,
                                    op: this.geoQueryOperation,
                                    value: p
                                })),
                                queryExpressions
                            ]
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
     * This filter is used to count how many features are within the given extent using the geoField.
     * Returns an arlas filter that includes the expression: the geoField is WITHIN the rawExtent.
     * This filter will optionnaly contain the collaboration of this contributor.
     * @param rawExtent The extent of the map.
     * @param wrappedExtent Wrapped format of the rawExtent (wrapped to the range [-180, 180]).
     * @param geoField The geometry field to use for the WITHIN operation with the rawExtent
     * @param ignoreCollab Whether to ignore the collaboration of this contributor or to add it to the returned filter.
     * @returns Arlas Filter
     */
    public getFilterForCount(rawExtent: string, wrappedExtent: string, countGeoField: string, ignoreCollab = false): Filter {
        return this.getExtentFilter(rawExtent, wrappedExtent, countGeoField, Expression.OpEnum.Within, ignoreCollab);
    }

    public clearData(s: string) {
        const sourceType = this.sourcesTypesIndex.get(s);
        switch (sourceType) {
            case this.CLUSTER_SOURCE:
                this.parentCellsPerSource.set(s, new Set());
                this.cellsPerSource.set(s, new Map());
                this.aggSourcesStats.set(s, { count: 0 });
                this.sourcesPrecisions.set(s, {});
                break;
            case this.TOPOLOGY_SOURCE:
                this.topologyDataPerSource.set(s, new Array());
                this.aggSourcesStats.set(s, { count: 0 });
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

    public static getClusterSource(ls: LayerSourceConfig): LayerClusterSource {
        const clusterLayer = new LayerClusterSource();
        clusterLayer.id = ls.id;
        clusterLayer.source = ls.source;
        clusterLayer.layerMaxzoom = ls.maxzoom;
        clusterLayer.layerMinzoom = ls.minzoom;
        clusterLayer.sourceMaxzoom = ls.maxzoom;
        clusterLayer.sourceMinzoom = ls.minzoom;
        clusterLayer.minfeatures = ls.minfeatures;
        clusterLayer.sourceMinFeatures = ls.minfeatures;
        clusterLayer.aggGeoField = ls.agg_geo_field;
        clusterLayer.granularity = <any>ls.granularity;
        clusterLayer.type = ls.aggType;
        if (ls.raw_geometry) {
            clusterLayer.rawGeometry = ls.raw_geometry;
        }
        if (ls.aggregated_geometry) {
            clusterLayer.aggregatedGeometry = <any>ls.aggregated_geometry;
        }
        clusterLayer.metrics = ls.metrics;
        clusterLayer.fetchedHits = ls.fetched_hits;
        return clusterLayer;
    }

    public static getTopologySource(ls: LayerSourceConfig): LayerTopologySource {
        const topologyLayer = new LayerTopologySource();
        topologyLayer.id = ls.id;
        topologyLayer.source = ls.source;
        topologyLayer.layerMaxzoom = ls.maxzoom;
        topologyLayer.layerMinzoom = ls.minzoom;
        topologyLayer.sourceMaxzoom = ls.maxzoom;
        topologyLayer.sourceMinzoom = ls.minzoom;
        topologyLayer.sourceMaxFeatures = ls.maxfeatures;
        topologyLayer.maxfeatures = ls.maxfeatures;
        /** retrocompatibility of Networks analytics geometry */
        if (!ls.raw_geometry && ls.geometry_support) {
            ls.raw_geometry = { geometry: ls.geometry_support, sort: '' };
        }
        topologyLayer.rawGeometry = ls.raw_geometry;
        topologyLayer.geometryId = ls.geometry_id;
        topologyLayer.metrics = ls.metrics;
        topologyLayer.granularity = <any>ls.granularity;
        topologyLayer.includeFields = new Set(ls.include_fields ?? []);
        topologyLayer.providedFields = ls.provided_fields;
        topologyLayer.colorFields = new Set(ls.colors_from_fields ?? []);
        topologyLayer.networkFetchingLevel = ls.network_fetching_level;
        if (topologyLayer.networkFetchingLevel === undefined) {
            topologyLayer.networkFetchingLevel = DEFAULT_FETCH_NETWORK_LEVEL;
        }
        topologyLayer.fetchedHits = ls.fetched_hits;
        return topologyLayer;
    }

    public static getFeatureSource(ls: LayerSourceConfig): LayerFeatureSource {
        const featureLayerSource = new LayerFeatureSource();
        featureLayerSource.id = ls.id;
        featureLayerSource.source = ls.source;
        featureLayerSource.renderMode = ls.render_mode;
        featureLayerSource.layerMaxzoom = ls.maxzoom;
        featureLayerSource.layerMinzoom = ls.minzoom;
        featureLayerSource.sourceMaxzoom = ls.maxzoom;
        featureLayerSource.sourceMinzoom = ls.minzoom;
        featureLayerSource.maxfeatures = ls.maxfeatures;
        featureLayerSource.sourceMaxFeatures = ls.maxfeatures;
        featureLayerSource.normalizationFields = ls.normalization_fields;
        featureLayerSource.shortFormLabels = ls.short_form_fields;
        featureLayerSource.includeFields = new Set(ls.include_fields ?? []);
        featureLayerSource.returnedGeometry = ls.returned_geometry;
        featureLayerSource.providedFields = ls.provided_fields;
        featureLayerSource.colorFields = new Set(ls.colors_from_fields ?? []);
        return featureLayerSource;
    }

    public static getClusterAggregration(source: LayerSourceConfig): Aggregation {
        const ls = this.getClusterSource(source);
        const aggregation: Aggregation = {
            type: Aggregation.TypeEnum.Geohash,
            field: ls.aggGeoField,
            interval: { value: 1 }
        };
        if (ls.metrics) {
            if (!aggregation.metrics) {
                aggregation.metrics = [];
            }
            ls.metrics.forEach(m => {

                // Same value as FLAT_CHAR but in a static method
                // BTW FLAT_CHAR could be configurable in the server side, so it should not be hardcoded..in theory
                const flatChar = '_';
                const key = m.field.replace(/\./g, flatChar) + '_' + m.metric.toString().toLowerCase() + '_';
                const existingMetric = aggregation.metrics
                    .map(me => me.collect_field.replace(/\./g, flatChar) + '_' + me.collect_fct.toString().toLowerCase() + '_')
                    .find(k => k === key);
                if (!existingMetric) {
                    aggregation.metrics.push({
                        collect_field: m.field,
                        collect_fct: <Metric.CollectFctEnum>m.metric
                    });
                }
            });
        }
        if (ls.aggregatedGeometry) {
            if (!aggregation.aggregated_geometries) {
                aggregation.aggregated_geometries = [];
            }
            aggregation.aggregated_geometries.push(ls.aggregatedGeometry);
        }
        if (ls.rawGeometry) {
            if (!aggregation.raw_geometries) {
                aggregation.raw_geometries = [];
            }
            aggregation.raw_geometries.push(ls.rawGeometry);
        }
        return aggregation;
    }

    public static getTopologyAggregration(source: LayerSourceConfig): Aggregation {
        const ls = this.getTopologySource(source);
        const aggregation: Aggregation = {
            type: Aggregation.TypeEnum.Term,
            field: ls.geometryId,
            size: '' + 10000,
        };
        if (ls.metrics) {
            if (!aggregation.metrics) {
                aggregation.metrics = [];
            }
            ls.metrics.forEach(m => {
                // Same value as FLAT_CHAR but in a static method
                // BTW FLAT_CHAR could be configurable in the server side, so it should not be hardcoded..in theory
                const flatChar = '_';
                const key = m.field.replace(/\./g, flatChar) + '_' + m.metric.toString().toLowerCase() + '_';
                const existingMetric = aggregation.metrics
                    .map(me => me.collect_field.replace(/\./g, flatChar) + '_' + me.collect_fct.toString().toLowerCase() + '_')
                    .find(k => k === key);
                if (!existingMetric) {
                    aggregation.metrics.push({
                        collect_field: m.field,
                        collect_fct: <Metric.CollectFctEnum>m.metric
                    });
                }
            });
        }
        if (ls.rawGeometry) {
            if (!aggregation.raw_geometries) {
                aggregation.raw_geometries = [];
            }
            aggregation.raw_geometries.push(ls.rawGeometry);
        }
        let fetchSet = new Set<string>();
        if (aggregation.fetch_hits && aggregation.fetch_hits.include) {
            fetchSet = new Set(aggregation.fetch_hits.include.filter(i => !i.includes('+') && !i.includes('-')));
        }
        if (!ls.fetchedHits) {
            ls.fetchedHits = {
                sorts: [],
                fields: []
            };
        }
        if (!!ls.fetchedHits && !!ls.fetchedHits.fields) {
            ls.fetchedHits.fields.forEach(f => fetchSet.add(f));
        }
        if (ls.providedFields && ls.providedFields.length > 0) {
            ls.providedFields.forEach(pf => {
                fetchSet.add(pf.color);
                if (pf.label && pf.label.length > 0) {
                    fetchSet.add(pf.label);
                }
            });
        }
        if (ls.colorFields && ls.colorFields.size > 0) {
            ls.colorFields.forEach(cf => {
                fetchSet.add(cf);
            });
        }
        if (ls.includeFields && ls.includeFields.size > 0) {
            ls.includeFields.forEach(cf => {
                fetchSet.add(cf);
            });
        }
        if (fetchSet.size > 0) {
            if (!aggregation.fetch_hits) {
                aggregation.fetch_hits = { size: 1 };
                aggregation.fetch_hits.include = [];
            }
            if (!!aggregation.fetch_hits) {
                aggregation.fetch_hits.include = ls.fetchedHits.sorts.concat(Array.from(fetchSet));
            }
        }
        return aggregation;
    }

    public static getFeatureSearch(source: LayerSourceConfig): Search {
        const ls = MapContributor.getFeatureSource(source);
        const search: Search = {};
        search.page = {
            size: 10
        };
        search.form = {
            flat: false
        };
        const includes = new Set<string>();
        if (ls.includeFields) {
            ls.includeFields.forEach(f => {
                includes.add(f);
            });
        }
        if (ls.colorFields) {
            ls.colorFields.forEach(cf => includes.add(cf));
        }
        if (ls.normalizationFields) {
            ls.normalizationFields.forEach(nf => {
                includes.add(nf.on);
                if (nf.per) {
                    includes.add(nf.per);
                }
            });
        }
        if (ls.shortFormLabels) {
            ls.shortFormLabels.forEach(sfl => includes.add(sfl));
        }
        search.projection = {
            includes: Array.from(includes).join(',')
        };
        const geometries = new Set<string>();
        geometries.add(ls.returnedGeometry);
        search.returned_geometries = Array.from(geometries).join(',');
        return search;
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
     * Sets the legend data relative to layers that use a color generated from a field value
     * @param colorField field which value will be used to generate a hex color using `ColorGenerator` service
     * @param feature geojson feature that contains the colorField property
     * @param fieldsToKeep list of fields to keep in the geojson feature and that will be enriched with this method
     */
    private setColorFieldLegend(colorField: string, feature: Feature, fieldsToKeep: Set<string>) {
        const flattenColorField = colorField.replace(/\./g, this.FLAT_CHAR);
        /** retrocompatibility of generated colors */
        feature.properties[flattenColorField + '_arlas__color'] =
            this.colorGenerator.getColor(feature.properties[flattenColorField]);
        feature.properties[flattenColorField + '_color'] = this.colorGenerator.getColor(feature.properties[flattenColorField]);
        /** set the key-to-color map to be displayed on the legend. */
        let colorLegend: LegendData = this.legendData.get(flattenColorField + '_arlas__color');
        if (!colorLegend) {
            colorLegend = {};
            colorLegend.keysColorsMap = new Map();
        } else if (!colorLegend.keysColorsMap) {
            colorLegend.keysColorsMap = new Map();
        }
        colorLegend.keysColorsMap.set(feature.properties[flattenColorField],
            feature.properties[flattenColorField + '_arlas__color']);
        /** retrocompatibility of generated colors */
        fieldsToKeep.add(flattenColorField + '_arlas__color');
        fieldsToKeep.add(flattenColorField + '_color');
        this.legendData.set(flattenColorField + '_arlas__color', colorLegend);
        this.legendData.set(flattenColorField + '_color', colorLegend);
    }


    private setProvidedFieldLegend(providedField: ColorConfig, feature: Feature, fieldsToKeep: Set<string>) {
        const flattenColorField = providedField.color.replace(/\./g, this.FLAT_CHAR);
        /** set the key-to-color map to be displayed on the legend. */
        let colorLegend: LegendData = this.legendData.get(flattenColorField);
        if (!colorLegend) {
            colorLegend = {};
            colorLegend.keysColorsMap = new Map();
        } else if (!colorLegend.keysColorsMap) {
            colorLegend.keysColorsMap = new Map();
        }
        fieldsToKeep.add(flattenColorField);
        if (feature.properties[flattenColorField] && !feature.properties[flattenColorField].startsWith('#')
            && !feature.properties[flattenColorField].startsWith('rgb')) {
            feature.properties[flattenColorField] = '#' + feature.properties[flattenColorField];
        } else if (feature.properties[flattenColorField].startsWith('rgb')) {
            feature.properties[flattenColorField] = rgbToHex(feature.properties[flattenColorField]);
        }
        if (providedField.label && providedField.label.length > 0) {
            const flattenLabelField = providedField.label.replace(/\./g, this.FLAT_CHAR);
            fieldsToKeep.add(flattenLabelField);
            colorLegend.keysColorsMap.set(feature.properties[flattenLabelField],
                feature.properties[flattenColorField]);
            this.legendData.set(flattenColorField, colorLegend);
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
            const aggType = ls.type ?? ClusterAggType.geohash;
            const hasHitsToFetch = !!ls.fetchedHits && !!ls.fetchedHits.sorts && ls.fetchedHits.sorts.length > 0;
            const fetchHitsId = hasHitsToFetch ? `:${ls.fetchedHits.sorts.join('_')}` : '';
            const aggId = ls.aggGeoField + ':' + ls.granularity.toString() + ':' + ls.minfeatures + ':' +
                ls.sourceMinzoom + ':' + ls.sourceMaxzoom
                + ':' + aggType + fetchHitsId;
            const aggBuilder = aggregationsMap.get(aggId);
            let sources;
            let aggregation: Aggregation;
            /** check if an aggregation that suits this source `cs` exists already */
            if (aggBuilder) {
                aggregation = aggBuilder.agg;
                sources = aggBuilder.sources;
            } else {
                let type: Aggregation.TypeEnum;
                if (aggType === ClusterAggType.geohash) {
                    type = Aggregation.TypeEnum.Geohash;
                } else if (aggType === ClusterAggType.tile) {
                    type = Aggregation.TypeEnum.Geotile;
                } else {
                    type = Aggregation.TypeEnum.Geohex;
                }
                aggregation = {
                    type: type,
                    field: ls.aggGeoField,
                    interval: { value: this.getPrecision(ls.granularity, zoom, this.CLUSTER_SOURCE, type) }
                };
                sources = [];
            }
            let fetchSet = new Set<string>();
            if (aggregation.fetch_hits && aggregation.fetch_hits.include) {
                fetchSet = new Set(aggregation.fetch_hits.include.filter(i => !i.includes('+') && !i.includes('-')));
            }
            if (ls.metrics) {
                if (!aggregation.metrics) {
                    aggregation.metrics = [];
                }
                ls.metrics.forEach(m => {
                    this.indexAggSourcesMetrics(cs, aggregation, m);
                });
            }
            if (ls.aggregatedGeometry) {
                if (!aggregation.aggregated_geometries) {
                    aggregation.aggregated_geometries = [];
                }
                const setAggGeometries = new Set(aggregation.aggregated_geometries);
                setAggGeometries.add(ls.aggregatedGeometry);
                aggregation.aggregated_geometries = Array.from(setAggGeometries);
            }
            if (ls.rawGeometry) {
                if (!aggregation.raw_geometries) {
                    aggregation.raw_geometries = [];
                }
                aggregation.raw_geometries.push(ls.rawGeometry);
            }
            if (ls.fetchedHits) {
                ls.fetchedHits.fields.forEach(f => fetchSet.add(f));
            }
            if (fetchSet.size > 0) {
                if (!aggregation.fetch_hits) {
                    aggregation.fetch_hits = { size: 1 };
                    aggregation.fetch_hits.include = [];
                }
                if (!!aggregation.fetch_hits) {
                    aggregation.fetch_hits.include = ls.fetchedHits.sorts.concat(Array.from(fetchSet));
                }
            }
            sources.push(cs);
            aggregationsMap.set(aggId, { agg: aggregation, sources });
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
        if (!metrics) {
            metrics = new Set();
        }

        const key = metricConfig.field.replace(/\./g, this.FLAT_CHAR) + '_' + metricConfig.metric.toString().toLowerCase() + '_';
        let normalizeKey = metricConfig.normalize ? key + NORMALIZE : key;
        if (!key.endsWith('_' + COUNT + '_')) {
            const existingMetric = aggregation.metrics
                .map(m => m.collect_field.replace(/\./g, this.FLAT_CHAR) + '_' + m.collect_fct.toString().toLowerCase() + '_')
                .find(k => k === key);
            if (!existingMetric) {
                aggregation.metrics.push({
                    collect_field: metricConfig.field,
                    collect_fct: <Metric.CollectFctEnum>metricConfig.metric
                });
            }
            if (metricConfig.short_format) {
                metrics.add(key + SHORT_VALUE);
            }
        } else {
            normalizeKey = normalizeKey.endsWith(NORMALIZED_COUNT) ? NORMALIZED_COUNT : COUNT;
            metrics.add(COUNT_SHORT_VALUE);
        }
        metrics.add(normalizeKey);
        this.aggSourcesMetrics.set(source, metrics);
    }

    /**
     * Prepares normalization by calculating the min and max values of each metrics that are to be normalized
     * Uses `this.aggSourcesMetrics` to get the metrics names & Sets the stats in `this.aggSourcesStats`
     * @param source
     * @param feature
     */
    private calculateAggMetricsStatsExceptAvg(source: string, feature: Feature): void {
        const metricsKeys = this.aggSourcesMetrics.get(source);
        let stats = this.aggSourcesStats.get(source);
        if (!stats) {
            stats = { count: 0 };
        }
        if (stats.count < feature.properties.count) {
            stats.count = feature.properties.count;
        }
        if (metricsKeys) {
            /** prepare normalization by calculating the min and max values of each metrics that is to be normalized */
            metricsKeys.forEach(key => {
                if (key.endsWith(SUM + NORMALIZE) || key.endsWith(MAX + NORMALIZE) || key.endsWith(MIN + NORMALIZE)) {
                    const keyWithoutNormalize = key.replace(NORMALIZE, '');
                    if (!stats[key]) {
                        stats[key] = { min: Number.MAX_VALUE, max: -Number.MAX_VALUE };
                    }
                    if (notInfinity(feature.properties[keyWithoutNormalize])) {
                        if (stats[key].max < feature.properties[keyWithoutNormalize]) {
                            stats[key].max = feature.properties[keyWithoutNormalize];
                        }
                        if (stats[key].min > feature.properties[keyWithoutNormalize]) {
                            stats[key].min = feature.properties[keyWithoutNormalize];
                        }
                    }
                }
                /** !!!! Because AVG calculation has a weight, the min & max should be calculated at the end */
            });
        }
        this.aggSourcesStats.set(source, stats);
    }

    private calculatesAvgStatsForTopology(source: string, feature: Feature): void {
        const metricsKeys = this.aggSourcesMetrics.get(source);
        let stats = this.aggSourcesStats.get(source);
        if (!stats) {
            stats = { count: 0 };
        }
        if (stats.count < feature.properties.count) {
            stats.count = feature.properties.count;
        }
        if (metricsKeys) {
            /** prepare normalization by calculating the min and max values of each metrics that is to be normalized */
            metricsKeys.forEach(key => {
                if (key.endsWith(AVG + NORMALIZE)) {
                    const keyWithoutNormalize = key.replace(NORMALIZE, '');
                    if (!stats[key]) {
                        stats[key] = { min: Number.MAX_VALUE, max: -Number.MAX_VALUE };
                    }
                    if (notInfinity(feature.properties[keyWithoutNormalize])) {
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
        if (!metrics) {
            metrics = new Set();
        }
        let key: string;
        switch (indexationType) {
            case ReturnedField.flat:
            case ReturnedField.providedcolor: {
                key = field.replace(/\./g, this.FLAT_CHAR);
                break;
            }
            case ReturnedField.generatedcolor: {
                key = field.replace(/\./g, this.FLAT_CHAR) + '_arlas__color';
                /** retrocompatibility of generated colors */
                metrics.add(field.replace(/\./g, this.FLAT_CHAR) + '_color');
                break;
            }
            case ReturnedField.normalized: {
                if (!normalizations) {
                    normalizations = new Map();
                }
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
                if (!normalizations) {
                    normalizations = new Map();
                }
                key = field.replace(/\./g, this.FLAT_CHAR) + NORMALIZE_PER_KEY + nkey.replace(/\./g, this.FLAT_CHAR);
                if (!normalizations.get(field + ':' + nkey)) {
                    const fn: FeaturesNormalization = {
                        on: field,
                        per: nkey
                    };
                    normalizations.set(field + ':' + nkey, fn);
                }
                break;
            }
            case ReturnedField.shortform: {
                key = field.replace(/\./g, this.FLAT_CHAR) + SHORT_VALUE;
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
        const searchesMap: Map<string, SourcesSearch> = new Map();
        const includePerSearch = new Map<string, Set<string>>();
        const geometriesPerSearch = new Map<string, Set<string>>();
        featureSources.forEach(cs => {
            const ls = this.featureLayerSourcesIndex.get(cs);
            /** the split of search requests is done thanks to this id.
             * change the id construction to change the 'granularity' of this split
             */
            const searchId = this.getSearchId(searchStrategy, ls);
            const searchBuilder: SourcesSearch = searchesMap.get(searchId);
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
            if (!includes) {
                includes = new Set();
            }
            includes.add(this.collectionParameters.id_path);
            if (ls.includeFields) {
                ls.includeFields.forEach(f => {
                    includes.add(f);
                    this.indexSearchSourcesMetrics(cs, f, ReturnedField.flat);
                });
            }
            if (ls.colorFields) {
                ls.colorFields.forEach(cf => {
                    includes.add(cf);
                    this.indexSearchSourcesMetrics(cs, cf, ReturnedField.generatedcolor);
                });
            }
            if (ls.providedFields) {
                ls.providedFields.forEach(pf => {
                    includes.add(pf.color);
                    this.indexSearchSourcesMetrics(cs, pf.color, ReturnedField.providedcolor);
                    if (pf.label && pf.label.length > 0) {
                        includes.add(pf.label);
                        this.indexSearchSourcesMetrics(cs, pf.label, ReturnedField.providedcolor);
                    }

                });
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
            if (ls.shortFormLabels) {
                ls.shortFormLabels.forEach(sfl => {
                    includes.add(sfl);
                    this.indexSearchSourcesMetrics(cs, sfl, ReturnedField.shortform);
                });
            }
            includePerSearch.set(searchId, includes);
            search.projection = {
                includes: Array.from(includes).join(',')
            };
            let geometries = geometriesPerSearch.get(searchId);
            if (!geometries) {
                geometries = new Set();
            }
            geometries.add(ls.returnedGeometry);
            geometriesPerSearch.set(searchId, geometries);
            search.returned_geometries = Array.from(geometries).join(',');
            sources.push(cs);
            searchesMap.set(searchId, { search, sources });
        });
        return searchesMap;
    }
    private prepareTopologyAggregations(topologySources: Array<string>, zoom: number): Map<string, SourcesAgg> {
        const aggregationsMap: Map<string, SourcesAgg> = new Map();
        topologySources.forEach(cs => {
            const ls = this.topologyLayersIndex.get(cs);
            const hasHitsToFetch = !!ls.fetchedHits && !!ls.fetchedHits.sorts && ls.fetchedHits.sorts.length > 0;
            const fetchHitsId = hasHitsToFetch ? `:${ls.fetchedHits.sorts.join('_')}` : '';
            const aggId = ls.geometryId + ':' + ls.networkFetchingLevel + fetchHitsId;
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
                if (!aggregation.metrics) {
                    aggregation.metrics = [];
                }
                ls.metrics.forEach(m => {
                    this.indexAggSourcesMetrics(cs, aggregation, m);
                });
            }
            if (ls.rawGeometry) {
                if (!aggregation.raw_geometries) {
                    aggregation.raw_geometries = [];
                }
                const sort = ls.rawGeometry.sort;
                if (!sort || sort === undefined || sort === null || sort === '') {
                    ls.rawGeometry.sort = '-' + this.collectionParameters.timestamp_path;
                }
                aggregation.raw_geometries.push(ls.rawGeometry);
            }
            let fetchSet = new Set<string>();
            if (aggregation.fetch_hits && aggregation.fetch_hits.include) {
                fetchSet = new Set(aggregation.fetch_hits.include.filter(i => !i.includes('+') && !i.includes('-')));
            }
            if (!ls.fetchedHits) {
                ls.fetchedHits = {
                    sorts: [],
                    fields: []
                };
            }
            if (!!ls.fetchedHits && !!ls.fetchedHits.fields) {
                ls.fetchedHits.fields.forEach(f => fetchSet.add(f));
            }
            if (ls.providedFields && ls.providedFields.length > 0) {
                ls.providedFields.forEach(pf => {
                    fetchSet.add(pf.color);
                    if (pf.label && pf.label.length > 0) {
                        fetchSet.add(pf.label);
                    }
                });
            }
            if (ls.colorFields && ls.colorFields.size > 0) {
                ls.colorFields.forEach(cf => {
                    fetchSet.add(cf);
                });
            }
            if (ls.includeFields && ls.includeFields.size > 0) {
                ls.includeFields.forEach(cf => {
                    fetchSet.add(cf);
                });
            }
            if (fetchSet.size > 0) {
                if (!aggregation.fetch_hits) {
                    aggregation.fetch_hits = { size: 1 };
                    aggregation.fetch_hits.include = [];
                }
                if (!!aggregation.fetch_hits) {
                    aggregation.fetch_hits.include = ls.fetchedHits.sorts.concat(Array.from(fetchSet));
                }
            }
            sources.push(cs);
            aggregationsMap.set(aggId, { agg: aggregation, sources });
        });
        return aggregationsMap;
    }

    private checkAggPrecision(aggSources: Array<string>, zoom: number, callOrigin: string): void {

        aggSources.forEach(cs => {
            const aggType = this.sourcesTypesIndex.get(cs);
            const ls = aggType === this.TOPOLOGY_SOURCE ? this.topologyLayersIndex.get(cs) : this.clusterLayersIndex.get(cs);
            const type = !!(ls as LayerClusterSource).type ? (ls as LayerClusterSource).type : ClusterAggType.geohash;
            const aggId = aggType === this.TOPOLOGY_SOURCE ? (ls as LayerTopologySource).geometryId + ':'
                + (ls as LayerTopologySource).networkFetchingLevel :
                (ls as LayerClusterSource).aggGeoField + ':' + ls.granularity.toString() + ':' + (ls as LayerClusterSource).minfeatures +
                ':' + ls.sourceMinzoom + ':' + ls.sourceMaxzoom + ':' + type.toString();
            const control = this.abortControllers.get(aggId);
            const networkFetchingLevel = aggType === this.TOPOLOGY_SOURCE ?
                (ls as LayerTopologySource).networkFetchingLevel : undefined;
            this.abortOldPendingCalls(aggId, cs, ls.granularity, networkFetchingLevel, zoom, callOrigin, aggType, type);
        });
    }

    private checkFeatures(featuresSources: Array<string>, callOrigin: string): void {
        featuresSources.forEach(cs => {
            const ls = this.featureLayerSourcesIndex.get(cs);
            const searchId = ls.maxfeatures + ':' + ls.sourceMinzoom + ':' + ls.sourceMaxzoom;
            let cancelSubjects = this.cancelSubjects.get(searchId);
            if (!cancelSubjects) {
                cancelSubjects = new Map();
            }
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
                fetchId = ls.aggGeoField + ':' + ls.granularity.toString() + ls.minfeatures + ':' + ':' + ls.minzoom + ':' + ls.maxzoom;
                break;
            case this.TOPOLOGY_SOURCE:
                ls = this.topologyLayersIndex.get(s);
                fetchId = ls.geometryId + ':' + ls.networkFetchingLevel;
                break;
            case this.FEATURE_SOURCE:
                ls = this.featureLayerSourcesIndex.get(s);
                fetchId = ls.maxfeatures + ':' + ls.minzoom + ':' + ls.maxzoom;
                break;
        }

        if (fetchId) {
            const cancelSubjects = this.cancelSubjects.get(fetchId);
            if (cancelSubjects) {
                cancelSubjects.forEach((subject, k) => {
                    if (+k < +callOrigin) {
                        subject.next(); subject.complete();
                    }
                });
                cancelSubjects.clear();
            }
            const abortController = this.abortControllers.get(fetchId);
            if (abortController && !abortController.signal.aborted) {
                /** abort pending calls of this agg id because precision changed or source is removed */
                abortController.abort();
            }
        }
    }

    private abortOldPendingCalls(aggId: string, s: string, granularity: Granularity, networkFetchingLevel: number,
        zoom: number, callOrigin: string, aggType: string,
        clusterType: ClusterAggType) {
        let aggClusterType;
        if (clusterType === ClusterAggType.geohash) {
            aggClusterType = Aggregation.TypeEnum.Geohash;
        } else if (clusterType === ClusterAggType.tile) {
            aggClusterType = Aggregation.TypeEnum.Geotile;
        } else {
            aggClusterType = Aggregation.TypeEnum.Geohex;
        }
        let precisions;
        if (aggType === this.TOPOLOGY_SOURCE) {
            precisions = Object.assign({}, networkFetchingLevelGranularity(networkFetchingLevel));
        } else {
            precisions = Object.assign({}, this.granularityClusterFunctions.get(granularity)(zoom, aggClusterType));
        }
        let oldPrecisions;
        const p = Object.assign({}, this.sourcesPrecisions.get(s));
        if (p && p.requestsPrecision && p.tilesPrecision) {
            oldPrecisions = p;
        }
        if (!oldPrecisions) {
            oldPrecisions = {};
        }
        if (oldPrecisions.tilesPrecision !== precisions.tilesPrecision ||
            oldPrecisions.requestsPrecision !== precisions.requestsPrecision) {
            /** precision changed, need to stop consumption of current http calls using the old precision */
            let cancelSubjects = this.cancelSubjects.get(aggId);
            if (!cancelSubjects) {
                cancelSubjects = new Map();
            }
            cancelSubjects.forEach((subject, k) => {
                if (+k < +callOrigin) {
                    subject.next(); subject.complete();
                }
            });
            cancelSubjects.clear();
            cancelSubjects.set(callOrigin, new Subject());
            this.cancelSubjects.set(aggId, cancelSubjects);
            this.lastCalls.set(aggId, callOrigin);
            const abortController = this.abortControllers.get(aggId);
            if (abortController && !abortController.signal.aborted) {
                /** abort pending calls of this agg id because precision changed. */
                abortController.abort();
            }
        }
    }

    private cleanRenderedAggFeature(s: string, feature: Feature, providedFields: Set<string>, isWeightedAverage = false): void {
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
                        feature.properties[mk] = Math.round(feature.properties.count / sourceStats.count * 100000) / 100000;
                    }
                }
                if (mk.endsWith(SHORT_VALUE)) {
                    if (mk === COUNT_SHORT_VALUE) {
                        feature.properties[mk] = numToString(feature.properties.count);
                    } else {
                        const kWithoutN = mk.replace(SHORT_VALUE, '');
                        feature.properties[mk] = numToString(feature.properties[kWithoutN]);
                    }

                }
            });
        }
        Object.keys(feature.properties).forEach(k => {
            const metricStats = Object.assign({}, sourceStats[k]);
            if (metricsKeys) {
                /** normalizing; the avg, should not be normalized at this stage, because of the weight */
                if (k.endsWith(NORMALIZE) && k !== NORMALIZED_COUNT && !k.endsWith(AVG + NORMALIZE)) {
                    if (metricStats.min === metricStats.max) {
                        feature.properties[k] = 1;
                    } else {
                        feature.properties[k] = (feature.properties[k] - metricStats.min) / (metricStats.max - metricStats.min);
                    }
                }

                if (k.endsWith(NORMALIZED_COUNT)) {
                    const legendData: LegendData = {
                        minValue: '0',
                        maxValue: sourceStats.count + ''
                    };
                    this.legendData.set(k, legendData);
                } else if (k.endsWith(NORMALIZE) && !k.endsWith(AVG + NORMALIZE)) {
                    const legendData: LegendData = {
                        minValue: metricStats.min,
                        maxValue: metricStats.max
                    };
                    this.legendData.set(k, legendData);
                }
            } else {
                if (!this.isBeginingOfKeyInValues(k, providedFields)) {
                    delete feature.properties[k];
                }
            }
        });
        if (metricsKeys) {
            const hasAvg = Array.from(metricsKeys).find(key => key.endsWith(AVG));
            const hasAvgNormalized = Array.from(metricsKeys).find(key => key.endsWith(AVG + NORMALIZE));
            if (!hasAvg && !hasAvgNormalized) {
                Object.keys(feature.properties).forEach(k => {
                    if (!metricsKeys.has(k) && !this.isBeginingOfKeyInValues(k, providedFields)) {
                        delete feature.properties[k];
                    }
                });
            }
        }
    }

    private normalizeAvgForTopology(s: string, feature: Feature) {
        const metricsKeys = this.aggSourcesMetrics.get(s);
        const sourceStats = this.aggSourcesStats.get(s);
        Object.keys(feature.properties).forEach(k => {
            const metricStats = Object.assign({}, sourceStats[k]);
            if (metricsKeys) {
                /** normalizing; the avg, should not be normalized at this stage, because of the weight */
                if (k.endsWith(AVG + NORMALIZE)) {
                    if (metricStats.min === metricStats.max) {
                        feature.properties[k] = 1;
                    } else {
                        feature.properties[k] = (feature.properties[k] - metricStats.min) / (metricStats.max - metricStats.min);
                    }
                }
            }
        });
    }

    private getPrecision(g: Granularity, zoom: number, aggType: string, clusterType: Aggregation.TypeEnum): number {
        return aggType === this.TOPOLOGY_SOURCE ? this.granularityTopologyFunctions.get(g)(zoom).requestsPrecision :
            this.granularityClusterFunctions.get(g)(zoom, clusterType).requestsPrecision;
    }

    private getAbreviatedNumber(value: number): string {
        let abbreviatedValue = '';
        if (value >= 10000 || value <= -10000) {
            let m = value;
            if (m < 0) {
                m *= -1;
                abbreviatedValue += '-';
            }
            abbreviatedValue += this.intToString(m);
        } else {
            abbreviatedValue += Math.round(value * 10) / 10;
        }
        return abbreviatedValue;
    }
    /**
     * This method indexes all the visibility rules for a given source and a given layer.
     * This index will be used to get which layers to display
     * @param sourceMinzoom minimum zoom to display the source
     * @param sourceMaxzoom maximum zoom to display the source
     * @param layerMinzoom minimum zoom to display the layer. A shared source can be visible in layer1 but not with layer2
     * @param layerMaxzoom maximum zoom to display the layer. A shared source can be visible in layer1 but not with layer2
     * @param nbfeatures number of features that triggers the display/hide of the source
     * @param type feature, feature-metric, cluster
     * @param source source name
     * @param id id of the layer
     * @param renderMode rendermode for 'feature' layers
     */
    private indexVisibilityRules(sourceMinzoom: number, sourceMaxzoom: number, layerMinzoom: number, layerMaxzoom: number,
        limitNbFeatures: number, nbfeatures: number, type: string, source: string, id: string, renderMode?: FeatureRenderMode): void {
        this.visibilityRulesIndex.set(source, {
            minzoom: sourceMinzoom,
            maxzoom: sourceMaxzoom,
            nbfeatures: limitNbFeatures,
            type,
            rendermode: renderMode
        });
        this.layersVisibilityRulesIndex.set(id, {
            minzoom: layerMinzoom,
            maxzoom: layerMaxzoom,
            nbfeatures
        });
    }

    /**
     * Parses the layers_sources config and returns the clusters layers index
     * @param layersSourcesConfig layers_sources configuration object
     */
    private getClusterLayersIndex(layersSourcesConfig: Array<LayerSourceConfig>): Map<string, LayerClusterSource> {
        const clusterLayers = new Map<string, LayerClusterSource>();
        layersSourcesConfig.filter(ls => ls.source.startsWith(this.CLUSTER_SOURCE)).forEach(ls => {
            const clusterLayer = MapContributor.getClusterSource(ls);
            /** extends rules visibility */
            const existingClusterLayer = clusterLayers.get(clusterLayer.source);
            if (existingClusterLayer) {
                clusterLayer.sourceMinzoom = Math.min(existingClusterLayer.sourceMinzoom, clusterLayer.sourceMinzoom);
                clusterLayer.sourceMaxzoom = Math.max(existingClusterLayer.sourceMaxzoom, clusterLayer.sourceMaxzoom);
                clusterLayer.sourceMinFeatures = Math.min(existingClusterLayer.sourceMinFeatures, clusterLayer.sourceMinFeatures);
                if (existingClusterLayer.metrics) {
                    clusterLayer.metrics = clusterLayer.metrics ? existingClusterLayer.metrics.concat(clusterLayer.metrics) :
                        existingClusterLayer.metrics;
                }
            }
            this.layerToSourceIndex.set(ls.id, ls.source);
            let layers = this.sourceToLayerIndex.get(ls.source);
            if (!layers) {
                layers = new Set();
            }
            layers.add(ls.id);
            this.sourceToLayerIndex.set(ls.source, layers);
            clusterLayers.set(clusterLayer.source, clusterLayer);
            this.dataSources.add(ls.source);
            this.indexVisibilityRules(clusterLayer.sourceMinzoom, clusterLayer.sourceMaxzoom, clusterLayer.layerMinzoom,
                clusterLayer.layerMaxzoom, clusterLayer.sourceMinFeatures, clusterLayer.minfeatures,
                this.CLUSTER_SOURCE, clusterLayer.source, clusterLayer.id);
            this.sourcesTypesIndex.set(ls.source, this.CLUSTER_SOURCE);
        });
        return clusterLayers;
    }

    /**
     * Parses the layers_sources config and returns the topology layers index
     * @param layersSourcesConfig layers_sources configuration object
     */
    private getTopologyLayersIndex(layersSourcesConfig: Array<LayerSourceConfig>): Map<string, LayerTopologySource> {
        const topologyLayers = new Map<string, LayerTopologySource>();
        layersSourcesConfig.filter(ls => ls.source.startsWith(this.TOPOLOGY_SOURCE)).forEach(ls => {
            const topologyLayer = MapContributor.getTopologySource(ls);
            /** extends rules visibility */
            const existingTopologyLayer = topologyLayers.get(topologyLayer.source);
            if (existingTopologyLayer) {
                topologyLayer.sourceMinzoom = Math.min(existingTopologyLayer.sourceMinzoom, topologyLayer.sourceMinzoom);
                topologyLayer.sourceMaxzoom = Math.max(existingTopologyLayer.sourceMaxzoom, topologyLayer.sourceMaxzoom);
                topologyLayer.sourceMaxFeatures = Math.max(existingTopologyLayer.sourceMaxFeatures, topologyLayer.sourceMaxFeatures);
                if (existingTopologyLayer.metrics) {
                    topologyLayer.metrics = topologyLayer.metrics ? existingTopologyLayer.metrics.concat(topologyLayer.metrics) :
                        existingTopologyLayer.metrics;
                }
                if (existingTopologyLayer.providedFields) {
                    topologyLayer.providedFields = topologyLayer.providedFields ?
                        existingTopologyLayer.providedFields.concat(topologyLayer.providedFields) : existingTopologyLayer.providedFields;
                }
                if (existingTopologyLayer.includeFields) {
                    topologyLayer.includeFields = topologyLayer.includeFields ?
                        new Set([...existingTopologyLayer.includeFields].concat([...topologyLayer.includeFields])) :
                        existingTopologyLayer.includeFields;
                }
            }
            topologyLayers.set(topologyLayer.source, topologyLayer);
            this.layerToSourceIndex.set(ls.id, ls.source);
            let layers = this.sourceToLayerIndex.get(ls.source);
            if (!layers) {
                layers = new Set();
            }
            layers.add(ls.id);
            this.sourceToLayerIndex.set(ls.source, layers);
            this.dataSources.add(ls.source);
            this.indexVisibilityRules(topologyLayer.sourceMinzoom, topologyLayer.sourceMaxzoom, topologyLayer.layerMinzoom,
                topologyLayer.layerMaxzoom, topologyLayer.sourceMaxFeatures, topologyLayer.maxfeatures,
                this.TOPOLOGY_SOURCE, topologyLayer.source,
                topologyLayer.id);
            this.sourcesTypesIndex.set(ls.source, this.TOPOLOGY_SOURCE);

        });
        return topologyLayers;
    }

    /**
     * Parses the layers_sources config and returns the feature layers index
     * @param layersSourcesConfig layers_sources configuration object
     */
    private getFeatureLayersIndex(layersSourcesConfig: Array<LayerSourceConfig>): Map<string, LayerFeatureSource> {
        const featureLayers = new Map<string, LayerFeatureSource>();
        layersSourcesConfig.filter(ls => ls.source.startsWith(this.FEATURE_SOURCE) &&
            !ls.source.startsWith(this.TOPOLOGY_SOURCE)).forEach(ls => {
                const featureLayerSource = MapContributor.getFeatureSource(ls);
                /** extends rules visibility */
                const existingFeatureLayer = featureLayers.get(featureLayerSource.source);
                if (existingFeatureLayer) {
                    featureLayerSource.sourceMinzoom = Math.min(existingFeatureLayer.sourceMinzoom, featureLayerSource.sourceMinzoom);
                    featureLayerSource.sourceMaxzoom = Math.max(existingFeatureLayer.sourceMaxzoom, featureLayerSource.sourceMaxzoom);
                    featureLayerSource.sourceMaxFeatures = Math.max(existingFeatureLayer.sourceMaxFeatures,
                        featureLayerSource.sourceMaxFeatures);
                    if (existingFeatureLayer.providedFields) {
                        featureLayerSource.providedFields = featureLayerSource.providedFields ?
                            existingFeatureLayer.providedFields.concat(featureLayerSource.providedFields) :
                            existingFeatureLayer.providedFields;
                    }
                    if (existingFeatureLayer.colorFields) {
                        featureLayerSource.colorFields = featureLayerSource.colorFields ?
                            new Set([...existingFeatureLayer.colorFields].concat([...featureLayerSource.colorFields]))
                            : existingFeatureLayer.colorFields;
                    }
                    if (existingFeatureLayer.includeFields) {
                        featureLayerSource.includeFields = featureLayerSource.includeFields ?
                            new Set([...existingFeatureLayer.includeFields].concat([...featureLayerSource.includeFields])) :
                            existingFeatureLayer.includeFields;
                    }
                    if (existingFeatureLayer.shortFormLabels) {
                        featureLayerSource.shortFormLabels = featureLayerSource.shortFormLabels ?
                            Array.from(new Set([...existingFeatureLayer.shortFormLabels].concat([...featureLayerSource.shortFormLabels]))) :
                            existingFeatureLayer.shortFormLabels;
                    }
                    if (existingFeatureLayer.normalizationFields) {
                        featureLayerSource.normalizationFields = featureLayerSource.normalizationFields ?
                            existingFeatureLayer.normalizationFields.concat(featureLayerSource.normalizationFields) :
                            existingFeatureLayer.normalizationFields;
                    }
                }
                this.layerToSourceIndex.set(ls.id, ls.source);
                let layers = this.sourceToLayerIndex.get(ls.source);
                if (!layers) {
                    layers = new Set();
                }
                layers.add(ls.id);
                this.sourceToLayerIndex.set(ls.source, layers);
                featureLayers.set(featureLayerSource.source, featureLayerSource);
                this.dataSources.add(ls.source);
                this.indexVisibilityRules(featureLayerSource.sourceMinzoom, featureLayerSource.sourceMaxzoom,
                    featureLayerSource.layerMinzoom, featureLayerSource.layerMaxzoom, featureLayerSource.sourceMaxFeatures,
                    featureLayerSource.maxfeatures, this.FEATURE_SOURCE, featureLayerSource.source, featureLayerSource.id,
                    featureLayerSource.renderMode);
                this.sourcesTypesIndex.set(ls.source, this.FEATURE_SOURCE);

            });
        return featureLayers;
    }


    private getSearchId(searchStrategy: SearchStrategy, ls?: LayerFeatureSource): string {
        switch (searchStrategy) {
            case SearchStrategy.combined:
                return 'combined_search';
            case SearchStrategy.visibility_rules:
                return ls.maxfeatures + ':' + ls.sourceMinzoom + ':' + ls.sourceMaxzoom;
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
        this.visibilityRulesIndex.forEach((v, k) => {
            if (v.rendermode !== FeatureRenderMode.window) {
                if (v.maxzoom >= zoom && v.minzoom <= zoom && visibleSources.has(k)) {
                    switch (v.type) {
                        case this.CLUSTER_SOURCE: {
                            if (nbFeatures === undefined || v.nbfeatures <= nbFeatures) {
                                clusterSources.push(k);
                                this.sourceToLayerIndex.get(k).forEach(l => {
                                    const visibilityRule = this.layersVisibilityRulesIndex.get(l);
                                    let visibilityStatus = false;
                                    if (nbFeatures !== undefined) {
                                        visibilityStatus = zoom >= visibilityRule.minzoom && zoom <= visibilityRule.maxzoom &&
                                            nbFeatures >= visibilityRule.nbfeatures;
                                    } else {
                                        visibilityStatus = zoom >= visibilityRule.minzoom && zoom <= visibilityRule.maxzoom;
                                    }
                                    this.visibilityStatus.set(l, visibilityStatus);
                                });
                            } else {
                                sourcesToRemove.push(k);
                                this.sourceToLayerIndex.get(k).forEach(l => this.visibilityStatus.set(l, false));
                            }
                            break;
                        }
                        case this.TOPOLOGY_SOURCE: {
                            if (nbFeatures === undefined || v.nbfeatures >= nbFeatures) {
                                this.sourceToLayerIndex.get(k).forEach(l => {
                                    const visibilityRule = this.layersVisibilityRulesIndex.get(l);
                                    let visibilityStatus = false;
                                    if (nbFeatures !== undefined) {
                                        visibilityStatus = zoom >= visibilityRule.minzoom && zoom <= visibilityRule.maxzoom &&
                                            nbFeatures <= visibilityRule.nbfeatures;
                                    } else {
                                        visibilityStatus = zoom >= visibilityRule.minzoom && zoom <= visibilityRule.maxzoom;
                                    }
                                    this.visibilityStatus.set(l, visibilityStatus);
                                });
                                topologySources.push(k);
                            } else {
                                sourcesToRemove.push(k);
                                this.sourceToLayerIndex.get(k).forEach(l => this.visibilityStatus.set(l, false));
                            }
                            break;
                        }
                        case this.FEATURE_SOURCE: {
                            if (nbFeatures === undefined || v.nbfeatures >= nbFeatures) {
                                featureSources.push(k);
                                this.sourceToLayerIndex.get(k).forEach(l => {
                                    const visibilityRule = this.layersVisibilityRulesIndex.get(l);
                                    let visibilityStatus = false;
                                    if (nbFeatures !== undefined) {
                                        visibilityStatus = zoom >= visibilityRule.minzoom && zoom <= visibilityRule.maxzoom &&
                                            nbFeatures <= visibilityRule.nbfeatures;
                                    } else {
                                        visibilityStatus = zoom >= visibilityRule.minzoom && zoom <= visibilityRule.maxzoom;
                                    }
                                    this.visibilityStatus.set(l, visibilityStatus);
                                });
                            } else {
                                sourcesToRemove.push(k);
                                this.sourceToLayerIndex.get(k).forEach(l => this.visibilityStatus.set(l, false));
                            }
                            break;
                        }
                    }
                } else if (visibleSources.has(k)) {
                    sourcesToRemove.push(k);
                    this.sourceToLayerIndex.get(k).forEach(l => this.visibilityStatus.set(l, false));
                } else {
                    sourcesToRemove.push(k);
                }
            }
        });
        return [clusterSources, topologySources, featureSources, sourcesToRemove];
    }

    private getDisplayableTopologySources(zoom: number,
        visibleSources: Set<string>, nbFeatures?: number): [Array<string>, Array<string>] {
        const topologySources = [];
        const sourcesToRemove = [];
        this.visibilityRulesIndex.forEach((v, k) => {
            if (v.type === this.TOPOLOGY_SOURCE) {
                if (v.maxzoom >= zoom && v.minzoom <= zoom && visibleSources.has(k)) {
                    if (nbFeatures === undefined || v.nbfeatures >= nbFeatures) {
                        this.sourceToLayerIndex.get(k).forEach(l => {
                            const visibilityRule = this.layersVisibilityRulesIndex.get(l);
                            let visibilityStatus = false;
                            if (nbFeatures !== undefined) {
                                visibilityStatus = zoom >= visibilityRule.minzoom && zoom <= visibilityRule.maxzoom &&
                                    nbFeatures <= visibilityRule.nbfeatures;
                            } else {
                                visibilityStatus = zoom >= visibilityRule.minzoom && zoom <= visibilityRule.maxzoom;
                            }
                            this.visibilityStatus.set(l, visibilityStatus);
                        });
                        topologySources.push(k);
                    } else {
                        sourcesToRemove.push(k);
                        this.sourceToLayerIndex.get(k).forEach(l => this.visibilityStatus.set(l, false));
                    }
                } else if (visibleSources.has(k)) {
                    sourcesToRemove.push(k);
                    this.sourceToLayerIndex.get(k).forEach(l => this.visibilityStatus.set(l, false));
                }
            }
        });
        return [topologySources, sourcesToRemove];
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

    private getVisitedXYZTiles(extent: Array<number>, rawExtent: Array<number>, sources: Array<string>): Set<string> {
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
        const finalExtents = getCanonicalExtents(extentToString(rawExtent), extentToString(extent));
        let visitedTiles;
        if (finalExtents.length === 1) {
            visitedTiles = new Set(xyz([[extent[1], extent[2]], [extent[3], extent[0]]], Math.ceil((this.zoom) - 1)));
        } else {
            const e1 = stringToExtent(finalExtents[0]);
            const e2 = stringToExtent(finalExtents[1]);
            const v1 = new Set(xyz([[e1[1], e1[2]], [e1[3], e1[0]]], Math.ceil((this.zoom) - 1)));
            const v2 = new Set(xyz([[e2[1], e2[2]], [e2[3], e2[0]]], Math.ceil((this.zoom) - 1)));
            visitedTiles = new Set([...v1, ...v2]);
        }
        let tiles = new Set<string>();
        let start = true;
        sources.forEach(s => {
            // this loop aims to take the smallest already visited tiles list
            if (start) {
                start = false; tiles = this.sourcesVisitedTiles.get(s);
            } else {
                if (this.sourcesVisitedTiles.get(s).size < tiles.size) {
                    tiles = this.sourcesVisitedTiles.get(s);
                }
            }
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
            if (rawExtent[0] > oldMapExtent[0]
                || rawExtent[2] < oldMapExtent[2]
                || rawExtent[1] < oldMapExtent[1]
                || rawExtent[3] > oldMapExtent[3]
            ) {
                sources.forEach(s => {
                    this.featuresOldExtent.set(s, rawExtent);
                });
                return newVisitedTiles;
            }
            sources.forEach(s => {
                this.featuresOldExtent.set(s, rawExtent);
            });
            return new Set();
        }
        sources.forEach(s => {
            this.featuresOldExtent.set(s, rawExtent);
        });
        return newVisitedTiles;
    }

    private getVisitedTiles(extent, rawExtent, zoom: number, granularity: Granularity,
        networkFetchingLevel: number, aggSource: SourcesAgg, aggType) {
        let visitedTiles;
        let precisions;
        const finalExtents = getCanonicalExtents(extentToString(rawExtent), extentToString(extent));
        if (aggType === this.TOPOLOGY_SOURCE) {
            if (finalExtents.length === 1) {
                visitedTiles = new Set(xyz([[extent[1], extent[2]], [extent[3], extent[0]]], Math.ceil((networkFetchingLevel)))
                    .map(t => t.x + '_' + t.y + '_' + t.z));
            } else {
                const e1 = stringToExtent(finalExtents[0]);
                const e2 = stringToExtent(finalExtents[1]);
                const v1 = new Set(xyz([[e1[1], e1[2]], [e1[3], e1[0]]], Math.ceil((networkFetchingLevel)))
                    .map(t => t.x + '_' + t.y + '_' + t.z));
                const v2 = new Set(xyz([[e2[1], e2[2]], [e2[3], e2[0]]], Math.ceil((networkFetchingLevel)))
                    .map(t => t.x + '_' + t.y + '_' + t.z));
                visitedTiles = new Set([...v1, ...v2]);
            }
            precisions = Object.assign({}, networkFetchingLevelGranularity(networkFetchingLevel));
        } else {
            if (aggSource.agg.type === Aggregation.TypeEnum.Geohash) {
                if (finalExtents.length === 1) {
                    visitedTiles = extentToGeohashes(extent, zoom, this.granularityClusterFunctions.get(granularity));
                } else {
                    const e1 = stringToExtent(finalExtents[0]);
                    const e2 = stringToExtent(finalExtents[1]);
                    const v1 = extentToGeohashes(e1, zoom, this.granularityClusterFunctions.get(granularity));
                    const v2 = extentToGeohashes(e2, zoom, this.granularityClusterFunctions.get(granularity));
                    visitedTiles = new Set([...v1, ...v2]);
                }
            } else {
                if (finalExtents.length === 1) {
                    visitedTiles = new Set(xyz([[extent[1], extent[2]], [extent[3], extent[0]]], Math.ceil((zoom) - 1))
                        .map(t => t.x + '_' + t.y + '_' + t.z));
                } else {
                    const e1 = stringToExtent(finalExtents[0]);
                    const e2 = stringToExtent(finalExtents[1]);
                    const v1 = new Set(xyz([[e1[1], e1[2]], [e1[3], e1[0]]], Math.ceil((zoom) - 1))
                        .map(t => t.x + '_' + t.y + '_' + t.z));
                    const v2 = new Set(xyz([[e2[1], e2[2]], [e2[3], e2[0]]], Math.ceil((zoom) - 1))
                        .map(t => t.x + '_' + t.y + '_' + t.z));
                    visitedTiles = new Set([...v1, ...v2]);
                }
            }
            precisions = Object.assign({}, this.granularityClusterFunctions.get(granularity)(zoom, aggSource.agg.type));

        }
        let oldPrecisions;
        aggSource.sources.forEach(s => {
            const p = Object.assign({}, this.sourcesPrecisions.get(s));
            if (p && p.requestsPrecision && p.tilesPrecision) {
                oldPrecisions = p;
            }
            if (!this.sourcesVisitedTiles.get(s)) {
                this.sourcesVisitedTiles.set(s, new Set());
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
                } else {
                    if (this.sourcesVisitedTiles.get(s).size < tiles.size) {
                        tiles = this.sourcesVisitedTiles.get(s);
                    }
                }
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

    private setCallCancellers(requestId: string, lastCall: string): void {
        let cancelSubjects = this.cancelSubjects.get(requestId);
        if (!cancelSubjects || !cancelSubjects.get(lastCall)) {
            cancelSubjects = new Map();
            cancelSubjects.set(lastCall, new Subject());
            this.cancelSubjects.set(requestId, cancelSubjects);
        }
        const control = this.abortControllers.get(requestId);
        if (!control || control.signal.aborted) {
            const controller = new AbortController();
            this.abortControllers.set(requestId, controller);
        }
    }

    private getValueFromFeature(f: Feature, field: string, flattenedField: string): any {
        let value = +f.properties[flattenedField];
        if (isNaN(value)) {
            if (this.dateFieldFormatMap.get(field)) {
                /** Moment Format character for days is `D` while the one given by ARLAS-server is `d`
                 * Thus, we replace the `d` with `D` to adapt to Moment library.
                */
                const dateFormat = this.dateFieldFormatMap.get(field).replace('dd', 'DD');
                value = moment.utc(f.properties[flattenedField], dateFormat).valueOf();
            } else {
                value = f.properties[flattenedField];
            }
            return value;
        } else {
            if (this.dateFieldFormatMap.has(field)) {
                return value;
            } else {
                return f.properties[flattenedField];
            }
        }
    }

    /**
     * @param f Feature to get the value of the field from
     * @param flattenedField Flattened field
     * @returns Either the value of the field, or the value of the first item of the list of values of the corresponding field
     */
    private getValueOrFirstArrayValueFromFeature(f: Feature, flattenedField: string) {
        return f.properties[flattenedField] ?? f.properties[flattenedField + '_0'];
    }

    private getGeometriesForQuery(features: Array<helpers.Feature<helpers.Geometry>>) {
        const geometries: Array<string> = [];

        const polygonFeatures = features.map(f => {
            if (f.properties.source === 'bbox') {
                // Compute list of anti-meridian fixed bbox features and their string representation
                const coord = f.geometry.coordinates[0];
                const n = coord[1][1];
                const w = this.wrap(coord[2][0], -180, 180);
                const s = coord[0][1];
                const e = this.wrap(coord[0][0], -180, 180);
                const box = w + ',' + s + ',' + e + ',' + n;
                return { f: bboxPolygon([w, s, e, n]), str: box.trim().toLocaleLowerCase() };
            } else {
                // Properly orientate features
                // Internal polygons (rings) are not reversed as they are not supported
                if (!isClockwise((<any>f.geometry).coordinates[0], 'Polygon')) {
                    const list = [];
                    (<any>f.geometry).coordinates[0]
                        .forEach((c) => list.push(c));
                    const reverseList = list.reverse();
                    f.geometry.coordinates[0] = reverseList;
                }
                return { f, str: stringify(f.geometry) };
            }
        });

        // Find all the geometries that are not contained by another bbox
        polygonFeatures.filter((f, idx) => polygonFeatures
            .filter((f2, idx2) => idx !== idx2 && booleanContains(f2.f, f.f)).length === 0)
            .forEach(f => geometries.push(f.str));

        return geometries;
    }

    private intToString(value: number): string {
        value = Math.round(value);
        let newValue = value.toString();
        if (value >= 1000) {
            const suffixes = ['', 'k', 'M', 'b', 't'];
            const suffixNum = Math.floor(('' + value).length / 4);
            let shortValue: number;
            for (let precision = 3; precision >= 1; precision--) {
                shortValue = parseFloat((suffixNum !== 0 ? (value / Math.pow(1000, suffixNum)) : value)
                    .toPrecision(precision));
                const dotLessShortValue = (shortValue + '').replace(/[^a-zA-Z 0-9]+/g, '');
                if (dotLessShortValue.length <= 2) {
                    break;
                }
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

    private getTopoCardinality(collectField: string, filter: Filter): Observable<ComputationResponse> {
        const computationRequest: ComputationRequest = { field: collectField, metric: ComputationRequest.MetricEnum.CARDINALITY };
        return this.collaborativeSearcheService.resolveButNotComputation([projType.compute, computationRequest],
            this.collaborativeSearcheService.collaborations, this.collection, this.identifier, filter, false, this.cacheDuration);

    }

    private isBeginingOfKeyInValues(value: string, values: Set<string>): boolean {
        let isInSet = false;
        values.forEach(v => {
            if (value.startsWith(v)) {
                isInSet = true;
            }
        });
        return isInSet;
    }

    /**
     * From a source and a feature, process the raw data for rendering or download
     * @param s Source id
     * @param feature Feature to process
     * @param setLegend Whether to set the legend while processing
     * @returns The list of fields to keep for further processing
     */
    private processSearchFeature(s: string, feature: Feature, setLegend: boolean) {
        const fieldsToKeep = new Set<string>();

        // Loop through all the feature to transform string date to number date to interpolate colot ticket #410
        Object.keys(feature.properties).forEach(k => {
            feature.properties[k] = this.getValueFromFeature(feature, k.replace(/\_/g, '.'), k);
        });

        const colorFields = this.featureLayerSourcesIndex.get(s).colorFields;
        if (colorFields) {
            colorFields.forEach(colorField => {
                const flattenColorField = colorField.replace(/\./g, this.FLAT_CHAR);
                feature.properties[flattenColorField] = this.getValueOrFirstArrayValueFromFeature(feature, flattenColorField) ?? 'UNKOWN';
                if (setLegend) {
                    this.setColorFieldLegend(colorField, feature, fieldsToKeep);
                }
            });
        }

        const providedFields = this.featureLayerSourcesIndex.get(s).providedFields;
        if (providedFields) {
            providedFields.forEach(pf => {
                const flattenColorField = pf.color.replace(/\./g, this.FLAT_CHAR);
                feature.properties[flattenColorField] = feature.properties[flattenColorField]
                    ?? this.colorGenerator.getColor('UNKNOWN');
                if (pf.label && pf.label.length > 0) {
                    const flattenLabelField = pf.label.replace(/\./g, this.FLAT_CHAR);
                    feature.properties[flattenLabelField] = feature.properties[flattenLabelField]
                        ?? 'UNKNOWN';
                }
                if (setLegend) {
                    this.setProvidedFieldLegend(pf, feature, fieldsToKeep);
                }
            });
        }

        const shortFormatLabels = this.featureLayerSourcesIndex.get(s).shortFormLabels;
        if (shortFormatLabels) {
            shortFormatLabels.forEach(sfl => {
                const flattenShortField = sfl.replace(/\./g, this.FLAT_CHAR);
                feature.properties[flattenShortField + SHORT_VALUE] = numToString(+feature.properties[flattenShortField]);
            });
        }

        // For manual color fields that are lists, the key in properties is {field}_0
        const includedFields = this.featureLayerSourcesIndex.get(s).includeFields;
        if (includedFields) {
            includedFields.forEach(f => {
                const flattenedIncludedField = f.replace(/\./g, this.FLAT_CHAR);
                feature.properties[flattenedIncludedField] =
                    this.getValueOrFirstArrayValueFromFeature(feature, flattenedIncludedField);
            });
        }

        return fieldsToKeep;
    }

    /**
     * From a source and a feature, process the raw data for rendering or download
     * @param s Source id
     * @param feature Feature to process
     * @param setLegend Whether to set the legend while processing
     * @returns The list of fields to keep for further processing
     */
    private processTopologyFeature(s: string, feature: Feature, setLegend: boolean) {
        const fieldsToKeep = new Set<string>();

        const colorFields = this.topologyLayersIndex.get(s).colorFields;
        if (colorFields) {
            colorFields.forEach(colorField => {
                const flattenColorField = colorField.replace(/\./g, this.FLAT_CHAR);
                feature.properties[flattenColorField] = feature.properties['hits_0_' + flattenColorField] ?? 'UNKNOWN';
                if (setLegend) {
                    /** set the key-to-color map to be displayed on the legend. */
                    this.setColorFieldLegend(colorField, feature, fieldsToKeep);
                }
            });
        }

        const providedFields = this.topologyLayersIndex.get(s).providedFields;
        if (providedFields) {
            providedFields.forEach(pf => {
                const flattenColorField = pf.color.replace(/\./g, this.FLAT_CHAR);
                feature.properties[flattenColorField] = feature.properties['hits_0_' + flattenColorField]
                    ?? this.colorGenerator.getColor('UNKNOWN');
                if (pf.label && pf.label.length > 0) {
                    const flattenLabelField = pf.label.replace(/\./g, this.FLAT_CHAR);
                    feature.properties[flattenLabelField] = feature.properties['hits_0_' + flattenLabelField] ?? 'UNKNOWN';
                }
                if (setLegend) {
                    /** set the key-to-color map to be displayed on the legend. */
                    this.setProvidedFieldLegend(pf, feature, fieldsToKeep);
                }
            });
        }

        const includeFields = this.topologyLayersIndex.get(s).includeFields;
        if (includeFields) {
            includeFields.forEach(includeField => {
                const flattenField = includeField.replace(/\./g, this.FLAT_CHAR);
                feature.properties[flattenField] = feature.properties['hits_0_' + flattenField];
                fieldsToKeep.add(flattenField);
            });
        }

        const fetchHits = this.topologyLayersIndex.get(s).fetchedHits;
        if (fetchHits) {
            fetchHits.fields.forEach(field => {
                const flattenField = field.replace(/\./g, this.FLAT_CHAR);
                feature.properties[flattenField] = feature.properties['hits_0_' + flattenField];
                fieldsToKeep.add(flattenField);
            });
            if (fetchHits.short_form_fields) {
                fetchHits.short_form_fields.forEach(field => {
                    const flattenField = field.replace(/\./g, this.FLAT_CHAR);
                    feature.properties[flattenField + SHORT_VALUE] = numToString(+feature.properties[flattenField]);
                    fieldsToKeep.add(flattenField + SHORT_VALUE);
                });
            }
        }

        return fieldsToKeep;
    }
}


export enum ReturnedField {
    flat, generatedcolor, providedcolor, normalized, normalizedwithkey, shortform
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

export interface LegendData {
    minValue?: string;
    maxValue?: string;
    keysColorsMap?: Map<string, string>;
}
