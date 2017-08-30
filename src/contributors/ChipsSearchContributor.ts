import { CollaborativesearchService, ConfigService, Contributor, projType, Collaboration } from 'arlas-web-core';
import { Filter, Hits } from 'arlas-api';
import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';
/**
 * This contributor must work with SearchContributor and a component
 * to display several chips label from SearchComponent.
 * This class make the brigde between the component which displays the data and the
 * collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
 */
export class ChipsSearchContributor extends Contributor {
    /**
    * Registry of all chips words present with their own count
    */
    public wordToCount: Map<string, number> = new Map<string, number>();
    /**
    * Bus of wordToCount map, notify when a chips is closed or add, the map is send for a global compute.
    */
    public wordsSubject: Subject<Map<string, number>> = new Subject<Map<string, number>>();
    /**
    * Bus of string, notify when a chips is closed, the closed string is send in the bus.
    */
    public removeWordEvent: Subject<string> = new Subject<string>();
    /**
    * Global query based on all concatenate chips word
    */
    public query: string;
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param addWordEvent  @Output of Angular SearchComponent, listen when a new search is coming.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        private addWordEvent: Subject<string>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService
    ) {
        super(identifier, configService);
        // Register the contributor in collaborativeSearcheService registry.
        this.collaborativeSearcheService.register(this.identifier, this);
        // Subscribe to the addWordEvent to add a chip with value and count and set filter in collaborativeSearcheService.
        this.addWordEvent.subscribe(
            value => {
                if (value !== null) {
                    if (value.length > 0) {
                        const filter: Filter = {
                            q: value
                        };
                        const countData: Observable<Hits> = this.collaborativeSearcheService.resolveButNot(
                            [projType.count, {}],
                            this.identifier,
                            filter
                        );
                        countData.subscribe(
                            count => {
                                this.wordToCount.set(value, count.totalnb);
                                this.wordsSubject.next(this.wordToCount);
                                this.setFilterFromMap();
                            }
                        );
                    }
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
        // Subscribe to the removeWordEvent to remove a chip  and set filter in collaborativeSearcheService
        this.removeWordEvent.subscribe(
            value => {
                this.wordToCount.delete(value);
                this.wordsSubject.next(this.wordToCount);
                this.setFilterFromMap();
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
        // Subscribe to the collaborationBus to update count value in chips
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                if (contributorId !== this.identifier) {
                    this.collaborativeSearcheService.ongoingSubscribe.next(1);
                    const tabOfCount: Array<Observable<[Hits, string]>> = [];
                    const f = this.collaborativeSearcheService.getFilter(this.identifier);
                    if (f !== null) {
                        f.q.split(' ').forEach((k) => {
                            if (k.length > 0) {
                                const filter: Filter = {
                                    q: k
                                };
                                const countData: Observable<Hits> = this.collaborativeSearcheService.resolveButNot(
                                    [projType.count,
                                    {}],
                                    this.identifier,
                                    filter
                                );
                                tabOfCount.push(countData.map(c => [c, k]));
                            }
                        });
                        Observable.from(tabOfCount).mergeAll().subscribe(
                            result => {
                                this.wordToCount.set(result[1], result[0].totalnb);
                            },
                            error => {
                                this.collaborativeSearcheService.collaborationErrorBus.next(error);
                            },
                            () => {
                                this.wordsSubject.next(this.wordToCount);
                                this.collaborativeSearcheService.ongoingSubscribe.next(-1);
                            }
                        );
                    } else {
                        this.wordToCount.clear();
                        this.wordsSubject.next(this.wordToCount);
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
    /**
    * Set Filter for collaborative search service from wordToCount map.
    */
    private setFilterFromMap() {
        let query = '';
        this.wordToCount.forEach((k, q) => {
            query = query + q + ' ';
        });
        const filters: Filter = {
            q: query
        };
        this.query = query;
        const data: Collaboration = {
            filter: filters,
            enabled: true
        };
        this.collaborativeSearcheService.setFilter(this.identifier, data);
    }
}
