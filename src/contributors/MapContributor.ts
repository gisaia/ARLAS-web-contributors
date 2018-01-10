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
import * as turf from 'turf';
import { decode_bbox, bboxes } from 'ngeohash';
import { Feature } from 'geojson';
import * as jsonSchema from '../jsonSchemas/mapContributorConf.schema.json' ;

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

    public isGeoaggregateCluster = true;
    public fetchType: fetchType = fetchType.geohash;
    public zoomToPrecisionCluster: Array<Array<number>> = this.getConfigValue('zoomToPrecisionCluster');
    public maxPrecision: Array<number> = this.getConfigValue('maxPrecision');
    private maxValueGeoHash = 0;
    private zoom = this.getConfigValue('initZoom');
    private tiles: Array<{ x: number, y: number, z: number }>;
    private geohashList: Array<string> = bboxes(-90, -180, 90, 180, 1);
    private isBbox = false;
    private mapExtend = [90, -180, -90, 180];
    private zoomLevelFullData = this.getConfigValue('zoomLevelFullData');
    private zoomLevelForTestCount = this.getConfigValue('zoomLevelForTestCount');
    private nbMaxFeatureForCluster = this.getConfigValue('nbMaxDefautFeatureForCluster');
    private idFieldName = this.getConfigValue('idFieldName');
    private drawtype = drawType[this.getConfigValue('drawtype')];

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
        configService: ConfigService
    ) {
        super(identifier, configService, collaborativeSearcheService);
        if (this.aggregation !== undefined) {
            this.aggregation.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => this.precision = a.interval.value);
        }
    }
    public static getJsonSchema(): Object {
        return jsonSchema;
    }
    public fetchData(collaborationEvent: CollaborationEvent): Observable<FeatureCollection> {
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
            let pwithin = '';
            this.mapExtend.forEach(v => pwithin = pwithin + ',' + v);
            let filter = {};
            if (!this.isBbox) {
                filter = {
                    pwithin: [[pwithin.substring(1).trim().toLocaleLowerCase()]],
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
            const bboxs = collaboration.filter.pwithin[0];
            bboxs.forEach(b => {
                const bbox = b.split(',');
                const coordinates = [[
                    [bbox[3], bbox[2]],
                    [bbox[3], bbox[0]],
                    [bbox[1], bbox[0]],
                    [bbox[1], bbox[2]],
                    [bbox[3], bbox[2]],
                ]];
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
            const rect = turf.polygon(geojsonData.coordinates);
            const bbox = turf.bbox(rect);
            const minX = bbox[0];
            const minY = bbox[1];
            const maxX = bbox[2];
            const maxY = bbox[3];
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
    public onChangeBbox(newBbox: Array<Object>) {
        const pwithinArray: Array<string> = [];
        newBbox.forEach(v => {
            const coord = v['geometry']['coordinates'][0];
            const north = coord[1][1];
            const west = coord[2][0];
            const south = coord[0][1];
            const east = coord[0][0];
            const pwithin = north + ',' + west + ',' + south + ',' + east;
            pwithinArray.push(pwithin.trim().toLocaleLowerCase());
        });
        const filters: Filter = {
            pwithin: [pwithinArray],
        };
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
        const precision = this.getPrecisionFromZoom(newMove.zoom);
        if (precision !== this.precision) {
            this.maxValueGeoHash = 0;
        }
        this.getNbMaxFeatureFromZoom(newMove.zoom);
        this.tiles = newMove.tiles;
        this.geohashList = newMove.geohash;
        const allcornerInside = this.isLatLngInBbox(newMove.extendForTest[0], newMove.extendForTest[1], this.mapExtend) &&
            this.isLatLngInBbox(newMove.extendForTest[0], newMove.extendForTest[3], this.mapExtend) &&
            this.isLatLngInBbox(newMove.extendForTest[2], newMove.extendForTest[3], this.mapExtend) &&
            this.isLatLngInBbox(newMove.extendForTest[2], newMove.extendForTest[1], this.mapExtend);
        if (newMove.zoom < this.zoomLevelFullData) {
            // geoaggregate full data
            if (precision !== this.precision) {
                this.precision = precision;
                this.fetchType = fetchType.geohash;
                this.drawGeoaggregateGeohash(this.geohashList);
            }
            this.zoom = newMove.zoom;
        } else if (newMove.zoom >= this.zoomLevelFullData && newMove.zoom < this.zoomLevelForTestCount) {
            if (allcornerInside) {
                // the new extent is in the old, we draw if the precision change
                if (precision !== this.precision) {
                    this.precision = precision;
                    this.fetchType = fetchType.geohash;
                    this.drawGeoaggregateGeohash(this.geohashList);
                    this.mapExtend = newMove.extendForLoad;
                }
            } else {
                this.precision = precision;
                this.fetchType = fetchType.geohash;
                this.drawGeoaggregateGeohash(this.geohashList);
                this.mapExtend = newMove.extendForLoad;
            }
            this.zoom = newMove.zoom;
        } else if (newMove.zoom >= this.zoomLevelForTestCount) {
            if (!allcornerInside) {
                let pwithin = '';
                newMove.extendForLoad.forEach(v => pwithin = pwithin + ',' + v);
                let filter = {};
                if (!this.isBbox) {
                    filter = {
                        pwithin: [[pwithin.substring(1).trim().toLocaleLowerCase()]],
                    };
                }
                const count: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits([projType.count, {}], '', filter);
                if (count) {
                    count.finally(() => this.zoom = newMove.zoom).subscribe(value => {
                        if (value.totalnb <= this.nbMaxFeatureForCluster) {
                            if (this.isGeoaggregateCluster) {
                                this.geojsondata.features = [];
                            }
                            this.fetchType = fetchType.tile;
                            this.drawSearchTiles(newMove.tiles);
                            this.mapExtend = newMove.extendForLoad;

                        } else {
                            this.precision = precision;
                            this.fetchType = fetchType.geohash;
                            this.drawGeoaggregateGeohash(this.geohashList);
                            this.mapExtend = newMove.extendForLoad;
                        }
                    });
                }
            } else {
                let pwithin = '';
                newMove.extendForLoad.forEach(v => pwithin = pwithin + ',' + v);
                let filter = {};
                if (!this.isBbox) {
                    filter = {
                        pwithin: [[pwithin.substring(1).trim().toLocaleLowerCase()]],
                    };
                }
                if (this.isGeoaggregateCluster) {
                    const count: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits([projType.count, {}], '', filter);
                    if (count) {
                        count.finally(() => this.zoom = newMove.zoom).subscribe(value => {
                            if (value.totalnb <= this.nbMaxFeatureForCluster) {
                                this.geojsondata.features = [];
                                this.drawSearchTiles(newMove.tiles);
                                this.mapExtend = newMove.extendForLoad;
                            } else {
                                if (precision !== this.precision) {
                                    this.precision = precision;
                                    this.drawGeoaggregateGeohash(this.geohashList);
                                    this.mapExtend = newMove.extendForLoad;
                                }
                            }
                        });
                    }
                }
                this.zoom = newMove.zoom;
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
        this.fetchDataTileSearch(tiles)
            .map(f => this.computeDataTileSearch(f))
            .map(f => this.setDataTileSearch(f))
            .finally(() => this.setSelection(null, this.collaborativeSearcheService.getCollaboration(this.identifier)))

            .subscribe(data => data);
    }
    private drawGeoaggregateGeohash(geohashList: Array<string>) {
        this.fetchDataGeohashGeoaggregate(geohashList)
            .map(f => this.computeDataGeohashGeoaggregate(f))
            .map(f => this.setDataGeohashGeoaggregate(f))
            .finally(() => this.setSelection(null, this.collaborativeSearcheService.getCollaboration(this.identifier)))

            .subscribe(data => data);
    }

    private fetchDataGeohashGeoaggregate(geohashList: Array<string>): Observable<FeatureCollection> {
        const tabOfGeohash: Array<Observable<FeatureCollection>> = [];
        const aggregations = this.aggregation;
        aggregations.filter(agg => agg.type === Aggregation.TypeEnum.Geohash).map(a => a.interval.value = this.precision);
        const geohashSet = new Set(geohashList);
        geohashSet.forEach(geohash => {
            const geohahsAggregation: GeohashAggregation = {
                geohash: geohash,
                aggregations: aggregations
            };
            const geoAggregateData: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNotFeatureCollection(
                [projType.geohashgeoaggregate, geohahsAggregation]);
            tabOfGeohash.push(geoAggregateData);
        });
        this.geojsondata.features = [];
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
                const bbox: Array<number> = decode_bbox(feature.properties.geohash);
                const coordinates = [[
                    [bbox[3], bbox[2]],
                    [bbox[3], bbox[0]],
                    [bbox[1], bbox[0]],
                    [bbox[1], bbox[2]],
                    [bbox[3], bbox[2]],
                ]];
                const polygonGeojson = {
                    type: 'Feature',
                    properties: {
                        point_count_normalize: feature.properties.count / this.maxValueGeoHash * 100,
                        point_count: feature.properties.count,
                        geohash: feature.properties.geohash
                    },
                    geometry: {
                        type: 'Polygon',
                        coordinates: coordinates
                    }
                };
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
        projection.includes = this.idFieldName;
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
        if (zoomToPrecisionClusterObject[Math.ceil(zoom) - 1][0] !== undefined) {
            return zoomToPrecisionClusterObject[Math.ceil(zoom) - 1][0];
        } else {
            return this.getConfigValue('maxPrecision')[0];
        }
    }
    private isLatLngInBbox(lat, lng, bbox) {
        const polyPoints = [[bbox[2], bbox[3]], [bbox[0], bbox[3]],
        [bbox[0], bbox[1]], [bbox[2], bbox[1]],
        [bbox[2], bbox[3]]];
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
}
