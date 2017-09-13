import { CollaborativesearchService, ConfigService, Contributor, projType, Collaboration } from 'arlas-web-core';
import { Filter, Hits } from 'arlas-api';
import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';

export interface SearchLabel {
    label: string;
    count: number;
}
/**
 * This contributor must work with SearchContributor and a component
 * to display several chips label from SearchComponent.
 * This class make the brigde between the component which displays the data and the
 * collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
 */
export class ChipsSearchContributor extends Contributor {
    /**
  * Global query based on all concatenate chips word
  */
    public query: string;
    public chipMapData: Map<string, number> = new Map<string, number>();
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService);
        // Register the contributor in collaborativeSearcheService registry.
        this.collaborativeSearcheService.register(this.identifier, this);
        // Subscribe to the collaborationBus to update count value in chips
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                if (contributorId !== this.identifier) {
                    this.collaborativeSearcheService.ongoingSubscribe.next(1);
                    const tabOfCount: Array<Observable<{ label: string, hits: Hits }>> = [];
                    let f = new Array<string>();
                    const fil = this.collaborativeSearcheService.getFilter(this.identifier);
                    if (fil != null) {
                        f = Array.from(this.chipMapData.keys());
                    }
                    if (f.length > 0) {
                        f.forEach((k) => {
                            if (k.length > 0) {
                                const filter: Filter = {
                                    q: k
                                };
                                const countData: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits(
                                    [projType.count,
                                    {}],
                                    this.identifier,
                                    filter
                                );
                                tabOfCount.push(countData.map(c => {
                                    return { label: k, hits: c };
                                }));
                            }
                        });
                        Observable.from(tabOfCount)
                            .mergeAll()
                            .finally(() => this.collaborativeSearcheService.ongoingSubscribe.next(-1))
                            .subscribe(
                            result => {
                                this.chipMapData.set(result.label, result.hits.totalnb);
                            },
                            error => {
                                this.collaborativeSearcheService.collaborationErrorBus.next(error);
                            },
                            () => {
                                const newMap = new Map<string, number>();
                                this.chipMapData.forEach((k, v) => newMap.set(v, k));
                                this.chipMapData = newMap;
                            }
                            );
                    } else {
                        this.chipMapData.clear();
                        this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                    }
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }
    /**
    * @returns Pretty name of contributor based on query propoerty.
    */
    public getFilterDisplayName(): string {
        return this.query;
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'catalog.web.app.components.chipssearch';
    }
    public addWord(value: any) {
        if (value !== null) {
            if (value.length > 0) {
                this.chipMapData.set(value, 0);
                this.setFilterFromMap();
                const filter: Filter = {
                    q: value
                };
                const countData: Observable<Hits> = this.collaborativeSearcheService.resolveButNotHits(
                    [projType.count, {}],
                    this.identifier,
                    filter
                );
                countData.subscribe(
                    count => {
                        this.chipMapData.set(value, count.totalnb);
                    }
                );
            }
        }
    }

    public removeWord(word: any) {
        this.chipMapData.delete(word);
        if (this.chipMapData.size === 0) {
            this.collaborativeSearcheService.removeFilter(this.identifier);
        }
        this.setFilterFromMap();

    }

    /**
    * Set Filter for collaborative search service from wordToCount map.
    */
    private setFilterFromMap() {
        let query = '';
        this.chipMapData.forEach((k, q) => {
            query = query + q + ' ';
        });
        const filters: Filter = {
            q: query
        };
        this.query = query;
        if (this.query.trim().length > 0) {
            const data: Collaboration = {
                filter: filters,
                enabled: true
            };
            this.collaborativeSearcheService.setFilter(this.identifier, data);
        }
    }
}
