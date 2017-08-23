import { Contributor, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { Subject } from 'rxjs/Subject';
import { Filter } from 'arlas-api';


export class SearchContributor extends Contributor {
    private addWordEvent: Subject<string> = new Subject<string>();
    constructor(
        identifier: string,
        private displayName: string,
        private valuesChangedEvent: Subject<string>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.collaborativeSearcheService.register(this.identifier, this);
        this.valuesChangedEvent.subscribe(
            value => {
                if (value !== null) {
                    if (value.length > 0) {
                        this.addWordEvent.next(value);
                    }
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }

    public getFilterDisplayName(): string {
        return 'Search';
    }
    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.search';
    }
}
