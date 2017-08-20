
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { projType } from 'arlas-web-core/models/collaborativesearch';
import { Filter } from 'arlas-api';
import { Search } from 'arlas-api';
import { Size } from 'arlas-api';
import { Expression } from 'arlas-api';

export class TableContributor extends Contributor {
    constructor(
        identifier: string,
        private displayName: string,
        private data: Array<Map<string, string | number | Date>>,
        private fieldsList: Array<{ columnName: string, fieldName: string, dataType: string }>,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.collaborativeSearcheService.register(this.identifier, this);

        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                if (contributorId !== this.identifier) {
                    this.fieldsList = new Array<{ columnName: string, fieldName: string, dataType: string }>();
                    this.fieldsList.push({ columnName: 'Source', fieldName: 'source', dataType: '' });
                    this.fieldsList.push({ columnName: 'Acquired', fieldName: 'acquired', dataType: '' });
                    this.fieldsList.push({ columnName: 'Cloud', fieldName: 'cloud', dataType: '%' });
                    this.fieldsList.push({ columnName: 'Incidence', fieldName: 'incidence', dataType: '°' });
                    this.fieldsList.push({ columnName: 'Id', fieldName: 'id', dataType: '' });
                }
                this.data = new Array<Map<string, string | number | Date>>();
                for (let i = 0; i < 5; i++) {
                    const map = new Map<string, string | number | Date>();
                    map.set('source', 'SPOT' + (i + 1));
                    map.set('acquired', '2017-0' + (i + 1) + '-' + (i + 3));
                    map.set('cloud', (i + 1) + '.0');
                    map.set('incidence', (i + 10));
                    map.set('id', (i + 10));
                    this.data.push(map);
                }
            },
            error => {
                this.collaborativeSearcheService.collaborationErrorBus.next((error));
            }
        );
    }

    public getFilterDisplayName(): string {
        return 'List';
    }

    public getPackageName(): string {
        return 'arlas.catalog.web.app.components.table';
    }

    public getData() {
        return this.data;
    }
    public getFieldsList() {
        return this.fieldsList;
    }

    private getElementFromJsonObject(jsonObject: any, pathstring: string): any {
        const path = pathstring.split('.');
        if (jsonObject == null) {
            return null;
        }
        if (path.length === 0) {
            return null;
        }
        if (path.length === 1) {
            return jsonObject[path[0]];
        } else {
            return this.getElementFromJsonObject(jsonObject[path[0]], path.slice(1).join('.'));
        }
    }
}
