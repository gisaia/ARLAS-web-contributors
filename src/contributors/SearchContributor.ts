import { Contributor, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { Subject } from 'rxjs/Subject';
import { Filter } from 'arlas-api/model/filter';
import { CollaborationEvent } from 'arlas-web-core/models/collaborationEvent';



export class SearchContributor extends Contributor {
    constructor(
        identifier: string,
        private displayName: string,
        private valuesChangedEvent: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {

        super(identifier, configService);

        this.valuesChangedEvent.subscribe(value => {
            const filter: Filter = {
                q: value
            };

            const data: CollaborationEvent = {
                contributorId: this.identifier,
                detail: filter,
                enabled: true
            };

            this.collaborativeSearcheService.setFilter(data);
        });

        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributorId !== this.identifier) {
                // TODO : Update Count
            }
        });
    }
    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.search';
    }
}
