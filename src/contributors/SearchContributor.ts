import { Contributor, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { Subject } from 'rxjs/Subject';
import { Filter } from 'arlas-api/model/filter';
import { CollaborationEvent } from 'arlas-web-core/models/collaborationEvent';



export class SearchContributor extends Contributor {
    private addWordEvent: Subject<any> = new Subject<any>()
    constructor(
        identifier: string,
        private displayName: string,
        private valuesChangedEvent: Subject<string>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
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
        return '';
    }
    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.search';
    }
}
