import { TiledSearch } from '@gisaia-team/arlas-web-core/models/projections';
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Search, Expression, Hits, AggregationResponse, Aggregation, Projection } from 'arlas-api';
import { Size } from 'arlas-api';
import { Filter, FeatureCollection } from 'arlas-api';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { Action, OnMoveResult, ProductIdentifier, triggerType } from '../models/models';
import { getElementFromJsonObject } from '../utils/utils';
import { projType } from 'arlas-web-core/models/projections';
import * as turf from 'turf';
import { decode_bbox } from 'ngeohash';
import { Feature } from 'geojson';

export enum drawType {
    RECTANGLE,
    CIRCLE
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

    public isGeoaggregateCluster = true;
    public redrawTile: Subject<boolean> = new Subject<boolean>();
    private maxValueGeoHash = 0;
    private precision = 1;
    private zoom = 2;
    private tiles: Array<{ x: number, y: number, z: number }>;
    private isBbox = false;
    private mapExtend = [90, -180, -90, 180];
    private zoomLevelFullData = this.getConfigValue('zoomLevelFullData');
    private zoomLevelForTestCount = this.getConfigValue('zoomLevelForTestCount');
    private nbMaxFeatureForCluster = this.getConfigValue('nbMaxFeatureForCluster');
    /**
    /**
    * ARLAS Server Aggregation used to draw the data on small zoom level, define in configuration
    */
    private aggregation: Aggregation = this.getConfigValue('aggregationmodel');
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param idFieldName  @Input of Angular MapResultlistComponent, field name of the id column of the collection.
    * @param onRemoveBboxBus  @Output of Angular MapComponent, send true when the rectangle of selection is removed.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        public identifier,
        public idFieldName: string,
        private onRemoveBboxBus: Subject<boolean>,
        private drawtype: drawType,

        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService);
        // Register the contributor in collaborativeSearcheService registry
        this.collaborativeSearcheService.register(this.identifier, this);
        this.drawGeoaggregate();
        // Subscribe to the collaborationBus to sent removeBbox bbox event if the contributor is removed
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                this.maxValueGeoHash = 0;
                if (this.zoom < this.zoomLevelFullData) {
                    this.drawGeoaggregate();
                } else if (this.zoom >= this.zoomLevelFullData && this.zoom < this.zoomLevelForTestCount) {
                    if (this.isBbox) {
                        this.drawGeoaggregate();
                    } else {
                        this.drawGeoaggregate(this.mapExtend);
                    }
                } else if (this.zoom >= this.zoomLevelForTestCount) {
                    let pwithin = '';
                    this.mapExtend.forEach(v => pwithin = pwithin + ',' + v);
                    let filter = {};
                    if (!this.isBbox) {
                        filter = {
                            pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
                        };
                    }
                    const count: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits([projType.count, {}], null, filter);
                    if (count) {
                        count.subscribe(value => {
                            if (value.totalnb <= this.nbMaxFeatureForCluster) {
                                this.geojsondata.features = []; 
                                if (this.isBbox) {
                                    // this.drawSearch();
                                    this.drawTileSearch(this.tiles)

                                } else {
                                    //this.drawSearch(this.mapExtend);
                                    this.drawTileSearch(this.tiles)

                                }
                            } else {
                                if (this.isBbox) {
                                    this.drawGeoaggregate();
                                } else {
                                    this.drawGeoaggregate(this.mapExtend);
                                }
                            }
                        });
                    }
                }
                if (contributorId !== this.identifier) {
                    if (contributorId === 'remove-all' || contributorId === 'remove-' + this.identifier) {
                        this.onRemoveBboxBus.next(true);
                    }
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );

    }

    public getBoundsToFit(productidentifier: ProductIdentifier): Observable<Array<Array<number>>> {
        console.log(productidentifier)
        let searchResult: Observable<Hits>;
        const search: Search = { size: { size: 1 } };
        const expression: Expression = {
            field: productidentifier.idFieldName,
            op: Expression.OpEnum.Eq,
            value: productidentifier.idValue
        };
        const filter: Filter = {
            f: [expression]
        };
        searchResult = this.collaborativeSearcheService.resolveHits([projType.search, search], null, filter);
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

    public getFeatureToHightLight(productidentifier: ProductIdentifier) {
        let isleaving = false;
        let id = productidentifier.idValue;
        if (id.split('-')[0] === 'leave') {
            id = id.split('-')[1];
            isleaving = true;
        }
        return {
            isleaving: isleaving,
            productIdentifier: {
                idFieldName: this.idFieldName,
                idValue: id
            }
        }
    }

    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'catalog.web.app.components.map';
    }
    /**
    * @returns Pretty name of contribution.
    */
    public getFilterDisplayName(): string {
        return 'GeoBox';
    }
    public onChangeBbox(newBbox: Array<number>) {
        let pwithin = '';
        newBbox.forEach(v => pwithin = pwithin + ',' + v);
        const filters: Filter = {
            pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
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
        this.tiles = newMove.tiles;
        const allcornerInside = this.isLatLngInBbox(newMove.extendForTest[0], newMove.extendForTest[1], this.mapExtend) &&
            this.isLatLngInBbox(newMove.extendForTest[0], newMove.extendForTest[3], this.mapExtend) &&
            this.isLatLngInBbox(newMove.extendForTest[2], newMove.extendForTest[3], this.mapExtend) &&
            this.isLatLngInBbox(newMove.extendForTest[2], newMove.extendForTest[1], this.mapExtend);
        if (newMove.zoom < this.zoomLevelFullData) {
            // geoaggregate full data
            if (precision !== this.precision) {
                this.precision = precision;
                this.drawGeoaggregate();
            }
            this.zoom = newMove.zoom;
        } else if (newMove.zoom >= this.zoomLevelFullData && newMove.zoom < this.zoomLevelForTestCount) {
            // geoaggregate intersect data
            // test if newMove.extendForTest is totaly in the precedent extendForload
            // extend: [this.north, this.west, this.south, this.east],
            if (allcornerInside) {
                // the new extent is in the old, we draw if the precision change
                if (precision !== this.precision) {
                    this.precision = precision;
                    if (this.isBbox) {
                        this.drawGeoaggregate();
                    } else {
                        this.drawGeoaggregate(newMove.extendForLoad);
                    }
                    this.mapExtend = newMove.extendForLoad;
                }
            } else {
                this.precision = precision;
                if (this.isBbox) {
                    this.drawGeoaggregate();
                } else {
                    this.drawGeoaggregate(newMove.extendForLoad);
                }
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
                        pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
                    };
                }
                const count: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits([projType.count, {}], null, filter);
                if (count) {
                    count.finally(() => this.zoom = newMove.zoom).subscribe(value => {
                        if (value.totalnb <= this.nbMaxFeatureForCluster) {
                            if (this.isBbox) {
                                // this.drawSearch();
                                this.drawTileSearch(newMove.tiles)
                            } else {
                                // this.drawSearch(newMove.extendForLoad);
                                this.drawTileSearch(newMove.tiles)

                            }
                            this.mapExtend = newMove.extendForLoad;

                        } else {
                            this.precision = precision;
                            if (this.isBbox) {
                                this.drawGeoaggregate();
                            } else {
                                this.drawGeoaggregate(newMove.extendForLoad);
                            }
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
                        pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
                    };
                }
                if (this.isGeoaggregateCluster) {
                    const count: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits([projType.count, {}], null, filter);
                    if (count) {
                        count.finally(() => this.zoom = newMove.zoom).subscribe(value => {
                            if (value.totalnb <= this.nbMaxFeatureForCluster) {
                                this.geojsondata = {
                                    type: 'FeatureCollection',
                                    features: []
                                };
                                if (this.isBbox) {
                                    this.drawSearch();
                                    // this.drawTileSearch(newMove.tiles)
                                } else {
                                    // this.drawSearch(newMove.extendForLoad);
                                    this.drawTileSearch(newMove.tiles)

                                }
                                this.mapExtend = newMove.extendForLoad;
                            } else {
                                if (precision !== this.precision) {
                                    this.precision = precision;
                                    if (this.isBbox) {
                                        this.drawGeoaggregate();
                                    } else {
                                        this.drawGeoaggregate(newMove.extendForLoad);
                                    }
                                    this.mapExtend = newMove.extendForLoad;
                                }
                            }
                        });
                    }
                };

                this.zoom = newMove.zoom;
            }
        }
    }


    public onRemoveBbox(isBboxRemoved: boolean) {
        if (isBboxRemoved) {
            this.isBbox = false;
            if (this.collaborativeSearcheService.getFilter(this.identifier) !== null) {
                this.collaborativeSearcheService.removeFilter(this.identifier);
            }
        }
    }


    private drawGeoaggregate(extend?: Array<number>) {
        let filter: Filter = {};
        const aggregation = this.aggregation;
        aggregation.interval.value = this.precision;
        if (extend) {
            let pwithin = '';
            extend.forEach(v => pwithin = pwithin + ',' + v);
            filter = {
                pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
            };
        }
        const geoAggregateData: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNotFeatureCollection(
            [projType.geoaggregate, [aggregation]], null, filter
        );
        geoAggregateData.finally(() => this.isGeoaggregateCluster = true).subscribe(
            value => {
                if (value.features !== undefined) {
                    value.features.forEach(feature => {
                        if (this.maxValueGeoHash <= feature.properties.count) {
                            this.maxValueGeoHash = feature.properties.count;
                        }
                    });
                    const allfeatures: Array<any> = [];
                    value.features.forEach(feature => {
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
                                point_count: feature.properties.count
                            },
                            geometry: {
                                type: 'Polygon',
                                coordinates: coordinates
                            }
                        };
                        feature.properties['point_count_normalize'] = feature.properties.count / this.maxValueGeoHash * 100;
                        feature.properties['point_count'] = feature.properties.count;

                        if (this.drawtype === drawType.CIRCLE) {
                            allfeatures.push(feature);
                        } else if (this.drawtype === drawType.RECTANGLE) {
                            allfeatures.push(polygonGeojson);
                        }
                    });
                    this.geojsondata = {
                        type: 'FeatureCollection',
                        features: allfeatures
                    };
                } else {
                    this.geojsondata = {
                        type: 'FeatureCollection',
                        features: []
                    };
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }

    private drawTileSearch(tiles: Array<{ x: number, y: number, z: number }>) {

        let filter: Filter = {};
        const search: Search = { size: { size: this.nbMaxFeatureForCluster } };
        const projection: Projection = {};
        projection.includes = 'citationIdentifier';
        search.projection = projection;
        tiles.forEach(tile => {
            const dataSet = new Set(this.geojsondata.features.map(f => f.properties[this.idFieldName]))

            const tiledSearch: TiledSearch = {
                search: search,
                x: tile.x,
                y: tile.y,
                z: tile.z
            }
            const searchResult: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNotFeatureCollection(
                [projType.tiledgeosearch, tiledSearch],
                null, filter);
            searchResult.finally(() => { this.isGeoaggregateCluster = false; this.redrawTile.next(true) }).subscribe(
                value => {
                    if (value.features !== undefined) {
                        value.features.map(f => [f.properties[this.idFieldName], f])
                            .filter(f => dataSet.has(f[0]) === false)
                            .forEach(f => this.geojsondata.features.push(f[1]))
                    }
                },
                error => {
                    this.collaborativeSearcheService.collaborationErrorBus.next(error);
                }
            );

        })
    }


    private drawSearch(extend?: Array<number>) {
        let filter: Filter = {};
        let pwithin = '';
        if (extend) {
            extend.forEach(v => pwithin = pwithin + ',' + v);
            filter = {
                pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
            };
        }
        const search: Search = { size: { size: this.nbMaxFeatureForCluster } };
        const projection: Projection = {};
        projection.includes = 'citationIdentifier';
        search.projection = projection;
        const searchResult: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNotFeatureCollection(
            [projType.geosearch, search],
            null, filter);
        searchResult.finally(() => this.isGeoaggregateCluster = false).subscribe(
            value => {
                if (value.features !== undefined) {
                    this.geojsondata = {
                        type: 'FeatureCollection',
                        features: value.features
                    };
                } else {
                    this.geojsondata = {
                        type: 'FeatureCollection',
                        features: []
                    };
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }
    private getPrecisionFromZoom(zoom: number): number {
        if (zoom >= 0 && zoom < 3) {
            return 1;
        } else if (zoom >= 3 && zoom < 5) {
            return 2;
        } else if (zoom >= 5 && zoom < 7) {
            return 3;
        } else if (zoom >= 7 && zoom < 10) {
            return 4;
        } else if (zoom >= 10 && zoom < 11) {
            return 5;
        } else {
            return 6;
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

}
