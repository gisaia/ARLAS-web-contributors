import { Contributor, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { Subject } from 'rxjs/Subject';
import { Filter } from 'arlas-api/model/filter';


export class CountAllContributor extends Contributor {
    private addWordEvent: Subject<string> = new Subject<string>();
    constructor(
        identifier: string,
        private displayName: string,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.collaborativeSearcheService.nextCountAll();
        this.collaborativeSearcheService.collaborationBus.subscribe(value => this.collaborativeSearcheService.nextCountAll());
        this.collaborativeSearcheService.countAllBus.subscribe(
            data => {
                this.collaborativeSearcheService.countAll = data;
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next(error);
            }
        );
    }

    public getFilterDisplayName(): string {
        return 'CountAll';
    }
    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.countall';
    }
}
