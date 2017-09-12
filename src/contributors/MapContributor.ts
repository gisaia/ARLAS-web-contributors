import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Search, Expression, Hits, AggregationResponse, Aggregation, Projection } from 'arlas-api';
import { Size } from 'arlas-api';
import { Filter, FeatureCollection } from 'arlas-api';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { Action, ProductIdentifier, triggerType } from '../models/models';
import { getElementFromJsonObject } from '../utils/utils';
import { projType } from 'arlas-web-core/models/projections';
import * as tinycolor from 'tinycolor2';
import * as turf from 'turf';
import { decode_bbox } from 'ngeohash';
import { Feature } from "@types/geojson";

export interface onMoveResult {
    zoom: number,
    extend: Array<number>
    extendForLoad: Array<number>
    extendForTest: Array<number>
}

/**
 * This contributor works with the Angular MapComponent of the Arlas-web-components project.
 * This class make the brigde between the component which displays the data and the
 * collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
 */
export class MapContributor extends Contributor {
    /**
     * Action subject nexted on showonmap action trigger, subscribe by the contributor to send data to addLayerDetailBus.
    */
    public addLayerActionrDetailBus: Subject<ProductIdentifier> = new Subject<ProductIdentifier>();
    /**
     * Action subject nexted on removefrommap action trigger, subscribe by the contributor to send data to removeLayerDetailBus.
    */
    public removeLayerActionDetailBus: Subject<ProductIdentifier> = new Subject<ProductIdentifier>();
    /**
     * Action subject nexted on hightlight action trigger, subscribe by the contributor to send data to consultItemLayerActionBus.
    */
    public hightlightLayerActionBus: Subject<ProductIdentifier> = new Subject<ProductIdentifier>();
    /**
     * List of actions that the contributor can trigger.
    */
    public actions: Array<Action> = [{
        id: 'showonmap',
        label: 'Show on map',
        actionBus: this.addLayerActionrDetailBus,
        triggerType: triggerType.onclick
    }, {
        id: 'removefrommap',
        label: 'Remove from map',
        actionBus: this.removeLayerActionDetailBus,
        triggerType: triggerType.onclick
    }, {
        id: 'hightlight',
        label: 'hightlight',
        actionBus: this.hightlightLayerActionBus,
        triggerType: triggerType.onconsult
    }];
    /**
    * Data to display analytics geohaah, use in MapComponent @Input
    */
    public geojsondata: { type: string, features: Array<any> };
    public clusterdata: { type: string, features: Array<any> } = {
        "type": "FeatureCollection",
        "features": []
    };

    /**
    * Data to display geosjon data, use in MapComponent @Input
    */
    public detailItemMapData: Map<string, [string, boolean]> = new Map<string, [string, boolean]>();
    private maxValueGeoHash = 0;
    private precision = 2;
    private zoom = 4;
    private count;
    private isBbox = false;
    //extend: [this.north, this.west, this.south, this.east],

    private mapExtend = [90, -180, -90, 180];
    private zoomLevelFullData = this.getConfigValue("zoomLevelFullData");
    private zoomLevelForTestCount = this.getConfigValue("zoomLevelForTestCount");
    private nbMaxFeatureForCluster = this.getConfigValue("nbMaxFeatureForCluster");
    /**
    /**
    * ARLAS Server Aggregation used to draw the data on small zoom level, define in configuration
    */
    private aggregation: Aggregation = this.getConfigValue('aggregationmodel');
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
                if (this.zoom < this.zoomLevelFullData) {
                    this.drawGeoaggregate();
                } else if (this.zoom >= this.zoomLevelFullData && this.zoom < this.zoomLevelForTestCount) {
                    if (this.isBbox) {
                        this.drawGeoaggregate();
                    } else {
                        this.drawGeoaggregate(this.mapExtend);
                    }
                } else if (this.zoom >= this.zoomLevelForTestCount) {
                    if (this.count <= this.nbMaxFeatureForCluster) {
                        if (this.isBbox) {
                            this.drawCluster();
                        } else {
                            this.drawCluster(this.mapExtend);
                        }
                    } else {
                        if (this.isBbox) {
                            this.drawGeoaggregate();
                        } else {
                            this.drawGeoaggregate(this.mapExtend);
                        }
                    }
                }
                if (contributorId !== this.identifier) {
                    if (contributorId === 'remove-all' || contributorId === 'remove-' + this.identifier) {
                        this.onRemoveBboxBus.next(true);
                    }
                }
                this.detailItemMapData.clear();
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
        // Subscribe to the addLayerActionrDetailBus to send data to addLayerDetailBus
        this.addLayerActionrDetailBus.subscribe(id => {
            let searchResult: Observable<Hits>;
            const search: Search = { size: { size: 1 } };
            const expression: Expression = {
                field: id.idFieldName,
                op: Expression.OpEnum.Eq,
                value: id.idValue
            };
            const filter: Filter = {
                f: [expression]
            };
            const actionsList = new Array<string>();
            searchResult = this.collaborativeSearcheService.resolve([projType.search, search], null, filter);
            searchResult.subscribe(h => {
                const geojsonData = getElementFromJsonObject(h.hits[0].data, this.getConfigValue('geometry'));
                this.detailItemMapData.set(id.idValue, [geojsonData, false]);
            });
        });
        // Subscribe to the addLayerActionrDetailBus to send data to addLayerDetailBus
        this.removeLayerActionDetailBus.subscribe(id => {
            this.detailItemMapData.delete(id.idValue);
        });
        this.hightlightLayerActionBus.subscribe(p => {
            let isleaving = false;
            let id = p.idValue;
            if (id.split('-')[0] === 'leave') {
                id = id.split('-')[1];
                isleaving = true;
            }
            if (this.detailItemMapData.get(id) !== undefined) {
                const geojsonData = this.detailItemMapData.get(id)[0];
                this.detailItemMapData.set(id, [geojsonData, isleaving]);
            }
        });
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

    public onMove(newMove: onMoveResult) {
        const precision = this.getPrecisionFromZoom(newMove.zoom)
        const allcornerInside = this.isLatLngInBbox(newMove.extendForTest[0], newMove.extendForTest[1], this.mapExtend) &&
            this.isLatLngInBbox(newMove.extendForTest[0], newMove.extendForTest[3], this.mapExtend) &&
            this.isLatLngInBbox(newMove.extendForTest[2], newMove.extendForTest[3], this.mapExtend) &&
            this.isLatLngInBbox(newMove.extendForTest[2], newMove.extendForTest[1], this.mapExtend);
        console.log(allcornerInside);
        if (newMove.zoom < this.zoomLevelFullData) {
            //geoaggregate full data
            if (precision !== this.precision) {
                this.precision = precision;
                this.drawGeoaggregate();
            }
        } else if (newMove.zoom >= this.zoomLevelFullData && newMove.zoom < this.zoomLevelForTestCount) {
            //geoaggregate intersect data
            //test if newMove.extendForTest is totaly in the precedent extendForload
            //extend: [this.north, this.west, this.south, this.east],
            if (allcornerInside) {
                //the new extent is in the old, we draw if the precision change
                if (precision !== this.precision) {
                    this.precision = precision;
                    this.drawGeoaggregate(newMove.extendForLoad);
                    this.mapExtend = newMove.extendForLoad
                }
            } else {
                this.precision = precision;
                this.drawGeoaggregate(newMove.extendForLoad);
                this.mapExtend = newMove.extendForLoad
            }
        } else if (newMove.zoom >= this.zoomLevelForTestCount) {
            //count
            this.collaborativeSearcheService.ongoingSubscribe.next(1);
            let pwithin = '';
            newMove.extendForLoad.forEach(v => pwithin = pwithin + ',' + v);
            const filter = {
                pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
            };
            const count: Observable<any> = this.collaborativeSearcheService.resolveButNot([projType.count, {}], null, filter);
            if (count) {
                count.finally(() => this.collaborativeSearcheService.ongoingSubscribe.next(-1)).subscribe(value => {
                    this.count = value;
                    if (value <= this.nbMaxFeatureForCluster) {
                        if (!allcornerInside) {
                            //the new extent is in the old, we draw if the precision change
                            this.drawCluster(newMove.extendForLoad);
                            this.mapExtend = newMove.extendForLoad
                        } else {
                            if (this.zoom !== newMove.zoom) {
                                this.drawCluster(newMove.extendForLoad);
                                this.mapExtend = newMove.extendForLoad
                            }
                        }
                    } else {
                        if (allcornerInside) {
                            //the new extent is in the old, we draw if the precision change
                            if (precision !== this.precision) {
                                this.precision = precision;
                                this.drawGeoaggregate(newMove.extendForLoad);
                                this.mapExtend = newMove.extendForLoad
                            }
                        } else {
                            this.precision = precision;
                            this.drawGeoaggregate(newMove.extendForLoad);
                            this.mapExtend = newMove.extendForLoad
                        }

                    }
                })

            }
        }
        this.zoom = newMove.zoom;

    }


    public onRemoveBbox(isBboxRemoved: boolean) {
        if (isBboxRemoved) {
            this.isBbox = false;
            if (this.collaborativeSearcheService.getFilter(this.identifier) !== null) {
                this.collaborativeSearcheService.removeFilter(this.identifier);
            };
        }
    }


    private drawGeoaggregate(extend?) {
        let filter: Filter = {}
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        const aggregation = this.aggregation;
        aggregation.interval.value = this.precision;
        if (extend) {
            let pwithin = '';
            extend.forEach(v => pwithin = pwithin + ',' + v);
            filter = {
                pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
            };
        }
        const geoAggregateData: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNot(
            [projType.geoaggregate, [aggregation]], null, filter
        );
        geoAggregateData.finally(() => this.collaborativeSearcheService.ongoingSubscribe.next(-1)).subscribe(
            value => {
                if (value.features !== undefined) {
                    value.features.forEach(feature => {
                        if (this.maxValueGeoHash <= feature.properties.count) {
                            this.maxValueGeoHash = feature.properties.count;
                        }
                    });
                    const allfeatures: Array<any> = []
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
                                color: this.getColor(feature.properties.count, this.maxValueGeoHash)
                            },
                            geometry: {
                                type: 'Polygon',
                                coordinates: coordinates
                            }
                        };
                        const polygon = turf.polygon(coordinates);
                        const centroid = turf.centroid(polygon);
                        const zeroToOne: number = 0.7 * feature.properties.count / this.maxValueGeoHash;
                        const to = turf.point([bbox[3], bbox[2]]);
                        //const radius = turf.distance(centroid, to, "kilometers") * zeroToOne *this.getConfigValue('coef');
                        const radius = 40 * zeroToOne;

                        feature.properties['color'] = this.getColor(feature.properties.count, this.maxValueGeoHash);
                        feature.properties['radius'] = radius;
                        feature.geometry['coordinates'] = centroid.geometry.coordinates;
                        allfeatures.push(feature)
                        allfeatures.push(polygonGeojson)
                    });
                    this.geojsondata = {
                        type: 'FeatureCollection',
                        features: allfeatures
                    }
                    this.clusterdata = {
                        type: 'FeatureCollection',
                        features: []
                    }
                    this.maxValueGeoHash = 0;
                } else {
                    this.geojsondata = {
                        type: 'FeatureCollection',
                        features: []
                    }
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }


    private drawCluster(extend?) {
        let filter: Filter = {}
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        let pwithin = '';
        if (extend) {
            extend.forEach(v => pwithin = pwithin + ',' + v);
            filter = {
                pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
            };
        }
        const search: Search = { size: { size: this.nbMaxFeatureForCluster } };
        const projection: Projection = {};
        projection.excludes = 'geographicBoundingPolygon,data,product,attachments,semantics'
        search.projection = projection;
        const searchResult: Observable<Hits> = this.collaborativeSearcheService.resolveButNot([projType.search, search],
            null, filter);
        searchResult.finally(() => this.collaborativeSearcheService.ongoingSubscribe.next(-1)).subscribe(
            value => {
                const pointsFeatures = [];
                value.hits.forEach(hit => {
                    const pointGeosjon = {
                        type: 'Feature',
                        properties: {
                        },
                        geometry: {
                            type: 'Point',
                            coordinates: hit.md.centroid.coordinates
                        }
                    };
                    pointsFeatures.push(pointGeosjon);
                })
                this.clusterdata = {
                    type: 'FeatureCollection',
                    features: pointsFeatures
                }
                this.geojsondata = {
                    type: 'FeatureCollection',
                    features: []
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }
    private getTinyColor(zeroToOne: number): tinycolorInstance {
        // Scrunch the green/cyan range in the middle
        const sign = (zeroToOne < .5) ? -1 : 1;
        zeroToOne = sign * Math.pow(2 * Math.abs(zeroToOne - .5), .35) / 2 + .5;
        // Linear interpolation between the cold and hot
        const h0 = 259;
        const h1 = 12;
        const h = (h0) * (1 - zeroToOne) + (h1) * (zeroToOne);
        return tinycolor({ h: h, s: 75, v: 90 });
    }
    private getColor(value: number, maxValue: number) {
        const halfToOne = .5 * value / maxValue * 1.2 + 0.5;
        const color: tinycolorInstance = this.getTinyColor(halfToOne);
        return color.toHexString();
    }
    private getPrecisionFromZoom(zoom: number): number {
        if (zoom < 4) {
            return 2;
        } else if (zoom >= 4 && zoom < 6) {
            return 3;
        } else if (zoom >= 6 && zoom < 9) {
            return 4;
        } else if (zoom >= 9 && zoom < 10) {
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
            const intersect = ((yi > y) != (yj > y))
                && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) { inside = !inside };
        }
        return inside;
    };

}
