import { Contributor, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { Filter } from 'arlas-api';
import { Subject } from 'rxjs/Subject';

/**
 * This contributor works with the Angular SearchComponent of the Arlas-web-components project.
 * This contributor notify a string Bus when a new search is coming.
 */
export class SearchContributor extends Contributor {
    /**
    * Bus of string search word.
    */
    private addWordBus: Subject<string> = new Subject<string>();
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param valuesChangedEvent  @Output of Angular SearchComponent, listen when a new search is coming.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        private valuesChangedEvent: Subject<string>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.collaborativeSearcheService.register(this.identifier, this);
        this.valuesChangedEvent.subscribe(
            value => {
                if (value !== null) {
                    if (value.length > 0) {
                        this.addWordBus.next(value);
                    }
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }
    /**
    * @returns Pretty name of contributor.
    */
    public getFilterDisplayName(): string {
        return 'Search';
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'catalog.web.app.components.search';
    }
}
