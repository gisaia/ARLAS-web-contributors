import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Search } from 'arlas-api/model/Search';
import { Size } from 'arlas-api/model/Size';
import { FeatureCollection } from 'arlas-api/model/FeatureCollection';
import { Collaboration } from 'arlas-web-core/models/Collaboration';
import { Hits } from 'arlas-api/model/Hits';
import { Filter } from 'arlas-api/model/Filter';
import { Aggregation } from 'arlas-api/model/Aggregation';
import { Expression } from 'arlas-api/model/Expression';
import { AggregationResponse } from 'arlas-api/model/AggregationResponse';
import { Action, ProductIdentifier, triggerType } from '../models/models';
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
    public geohashMapData: Map<string, [number, number]> = new Map<string, [number, number]>();
    /**
    * Data to display geosjon data, use in MapComponent @Input
    */
    public detailItemMapData: Map<string, [string, boolean]> = new Map<string, [string, boolean]>();


    private maxValueGeoHash = 0;
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
        this.drawGeoHash();
        // Subscribe to the collaborationBus to sent removeBbox bbox event if the contributor is removed
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                this.drawGeoHash();
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
        this.collaborativeSearcheService.setFilter(this.identifier, data);
    }

    public onRemoveBbox(isBboxRemoved: boolean) {
        if (isBboxRemoved) {
            if (this.collaborativeSearcheService.getFilter(this.identifier) !== null) {
                this.collaborativeSearcheService.removeFilter(this.identifier);
            };
        }
    }
    private drawGeoHash() {
        this.collaborativeSearcheService.ongoingSubscribe.next(1);
        const geoAggregateData: Observable<FeatureCollection> = this.collaborativeSearcheService.resolveButNot(
            [projType.geoaggregate, [this.aggregation]]
        );
        geoAggregateData.finally(() => this.collaborativeSearcheService.ongoingSubscribe.next(-1)).subscribe(
            value => {
                if (value.features !== undefined) {
                    value.features.forEach(feature => {
                        if (this.maxValueGeoHash <= feature.properties.count) {
                            this.maxValueGeoHash = feature.properties.count;
                        }
                        this.geohashMapData.set(feature.properties.geohash, [feature.properties.count, 0]);
                    });
                    this.geohashMapData.forEach((k, v) => {
                        if (k[1] === 0) {
                            this.geohashMapData.set(v, [k[0], this.maxValueGeoHash]);
                        } else {
                            this.geohashMapData.delete(v);
                        }
                    });
                    this.maxValueGeoHash = 0;
                } else {
                    this.geohashMapData.clear();
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }
}
