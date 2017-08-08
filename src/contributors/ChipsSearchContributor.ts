import { Contributor, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { Subject } from 'rxjs/Subject';
import { Filter } from 'arlas-api/model/filter';
import { CollaborationEvent, eventType } from 'arlas-web-core/models/collaborationEvent';
import { Observable } from 'rxjs/Observable';
import { ArlasHits } from 'arlas-api/model/arlasHits';
import 'rxjs/add/observable/from';
import 'rxjs/add/operator/map'
import 'rxjs/add/operator/mergeAll'


export class ChipsSearchContributor extends Contributor {
    public wordToCount: Map<string, number> = new Map<string, number>();
    public wordsSubject: Subject<Map<string, number>> = new Subject<Map<string, number>>();
    public removeWordEvent: Subject<string> = new Subject<string>();
    constructor(
        identifier: string,
        private displayName: string,
        private addWordEvent: Subject<string>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {

        super(identifier, configService);

        this.addWordEvent.subscribe(
            value => {
                if (value !== null) {
                    if (value.length > 0) {
                        const filter: Filter = {
                            q: value
                        };
                        const countData: Observable<ArlasHits> = this.collaborativeSearcheService.resolveButNot([eventType.count, {}], this.identifier, filter)
                        countData.subscribe(
                            count => {
                                this.wordToCount.set(value, count.totalnb)
                                this.wordsSubject.next(this.wordToCount);
                                this.setFilterFromMap();
                            }
                        )
                    }
                }

            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );

        this.removeWordEvent.subscribe(
            value => {
                this.wordToCount.delete(value)
                this.wordsSubject.next(this.wordToCount);
                this.setFilterFromMap();
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        )

        this.collaborativeSearcheService.collaborationBus.subscribe(
            value => {
                if (value.contributorId !== this.identifier) {
                    const tabOfCount: Array<Observable<[ArlasHits, string]>> = []
                    this.wordToCount.forEach((k, v) => {
                        let filter: Filter = {
                            q: v
                        };
                        const countData: Observable<ArlasHits> = this.collaborativeSearcheService.resolveButNot([eventType.count, {}], this.identifier, filter)
                        tabOfCount.push(countData.map(c => [c, v]))

                    })
                    Observable.from(tabOfCount).mergeAll().subscribe(
                        result => {
                            result[0].totalnb
                            this.wordToCount.set(result[1], result[0].totalnb)
                        },
                        error => {
                            this.collaborativeSearcheService.collaborationErrorBus.next(error);
                        },
                        () => this.wordsSubject.next(this.wordToCount)
                    );
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }

    public getFilterDisplayName(): string {
        return '';
    }
    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.chipssearch';
    }

    private setFilterFromMap() {
        let query = '';
        this.wordToCount.forEach((k, q) => {
            query = query + q + ' ';
        })
        const filters: Filter = {
            q: query
        };
        const data: CollaborationEvent = {
            contributorId: this.identifier,
            detail: filters,
            enabled: true
        };
        this.collaborativeSearcheService.setFilter(data);
    }
}
