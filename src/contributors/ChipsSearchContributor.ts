import { Contributor, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';


import { projType } from 'arlas-web-core/models/collaborativesearch';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { Filter } from 'arlas-api';
import { Hits } from 'arlas-api';


export class ChipsSearchContributor extends Contributor {
    public wordToCount: Map<string, number> = new Map<string, number>();
    public wordsSubject: Subject<Map<string, number>> = new Subject<Map<string, number>>();
    public removeWordEvent: Subject<string> = new Subject<string>();
    public query: string;
    constructor(
        identifier: string,
        private displayName: string,
        private addWordEvent: Subject<string>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.collaborativeSearcheService.register(this.identifier, this);
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

        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                if (contributorId !== this.identifier) {
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
                            () => this.wordsSubject.next(this.wordToCount)
                        );

                    } else {
                        this.wordToCount.clear();
                        this.wordsSubject.next(this.wordToCount);
                    }

                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }

    public getFilterDisplayName(): string {
        return this.query;
    }
    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.chipssearch';
    }

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
