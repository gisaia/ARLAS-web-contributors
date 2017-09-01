import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Search, Expression, Hits, AggregationResponse, Aggregation } from 'arlas-api';
import { Size } from 'arlas-api';
import { Filter, FeatureCollection } from 'arlas-api';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { Action, ProductIdentifier } from '../models/models';
import { getElementFromJsonObject } from '../utils/utils';
import { projType } from 'arlas-web-core/models/projections';
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
     * List of actions that the contributor can trigger.
    */
    public actions: Array<Action> = [{
        id: 'showonmap',
        label: 'Show on map',
        actionBus: this.addLayerActionrDetailBus
    }, {
        id: 'removefrommap',
        label: 'Remove from map',
        actionBus: this.removeLayerActionDetailBus
    }];
    /**
    * .
    */
    public geohashMapData: Map<string, [number, number]> = new Map<string, [number, number]>();
    /**
    * .
    */
    public maxValueGeoHash = 0;
    /**
    /**
    * ARLAS Server Aggregation used to draw the data on small zoom level, define in configuration
    */
    private aggregation: Aggregation = this.getConfigValue('aggregationmodel');
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param selectedBbox  @Output of Angular MapComponent, send the Bbox of a rectangle of selection draw on the map when it changes.
    * @param removeBbox  @Output of Angular MapComponent, send true when the rectangle of selection is removed.
    * @param addLayerDetailBus  @Output of Angular MapComponent, send a {geometry: string,id: string} when the showonmap action is called.
    * @param removeLayerDetailBus  @Output of Angular MapComponent, send a sring id when the removefrommap action is called.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        public identifier,
        private selectedBbox: Subject<Array<number>>,
        private removeBbox: Subject<boolean>,
        private addLayerDetailBus: Subject<{
            geometry: string,
            id: string
        }>,
        private removeLayerDetailBus: Subject<string>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService);
        // Register the contributor in collaborativeSearcheService registry
        this.collaborativeSearcheService.register(this.identifier, this);
        // Subscribe to the collaborationBus to sent removeBbox bbox event if the contributor is removed
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                this.collaborativeSearcheService.ongoingSubscribe.next(1);
                const geoAggregateData: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNot(
                    [projType.geoaggregate, [this.aggregation]]
                );
                geoAggregateData.subscribe(
                    value => {
                        value.features.forEach(feature => {
                            if (this.maxValueGeoHash <= feature.properties.count) {
                                this.maxValueGeoHash = feature.properties.count;
                            }
                            this.geohashMapData.set(feature.properties.geohash, [feature.properties.count, 0])
                        });
                        this.geohashMapData.forEach((k, v) => {
                            if (k[1] === 0) {
                                this.geohashMapData.set(v, [k[0], this.maxValueGeoHash]);
                            } else {
                                this.geohashMapData.delete(v);
                            }
                        })
                        this.maxValueGeoHash = 0;
                    },
                    error => {
                        this.collaborativeSearcheService.collaborationErrorBus.next(error);
                    },
                    () => {
                        this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                    }
                );
                if (contributorId !== this.identifier) {
                    if (contributorId === 'remove-all' || contributorId === 'remove-' + this.identifier) {
                        this.removeBbox.next(true);
                    }
                }
                this.removeLayerDetailBus.next('all');
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
        // Subscribe to the selectedBbox to set a new filter on the collaborativeSearcheService
        this.selectedBbox.subscribe(
            value => {
                let pwithin = '';
                value.forEach(v => pwithin = pwithin + ',' + v);
                const filters: Filter = {
                    pwithin: pwithin.substring(1).trim().toLocaleLowerCase(),
                };
                const data: Collaboration = {
                    filter: filters,
                    enabled: true
                };
                this.collaborativeSearcheService.setFilter(this.identifier, data);
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
        // Subscribe to the removeBbox to remove filter in collaborativeSearcheService
        this.removeBbox.subscribe(
            value => {
                if (value) {
                    if (this.collaborativeSearcheService.getFilter(this.identifier) !== null) {
                        this.collaborativeSearcheService.removeFilter(this.identifier);
                    };
                }
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
                this.addLayerDetailBus.next(
                    {
                        geometry: geojsonData,
                        id: id.idValue
                    }
                );
            });
        });
        // Subscribe to the addLayerActionrDetailBus to send data to addLayerDetailBus
        this.removeLayerActionDetailBus.subscribe(id => {
            this.removeLayerDetailBus.next(id.idValue);
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
}
