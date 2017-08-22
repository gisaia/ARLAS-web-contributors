
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Collaboration } from 'arlas-web-core/models/collaboration';
import { projType } from 'arlas-web-core/models/collaborativesearch';
import { Filter } from 'arlas-api';
import { Search } from 'arlas-api';
import { Size } from 'arlas-api';
import { Expression } from 'arlas-api';

export class ResultListContributor extends Contributor {
    public data: Array<Map<string, string | number | Date>>;
    public fieldsList: Array<{ columnName: string, fieldName: string, dataType: string }> = [];

    constructor(
        identifier: string,
        private displayName: string,
        private collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService) {
        super(identifier, configService);
        this.collaborativeSearcheService.register(this.identifier, this);
        this.feedTable();
        this.collaborativeSearcheService.collaborationBus.subscribe(
            contributorId => {
                this.feedTable();

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

    private feedTable() {
        let searchResult;
        const search: Search = { size: { size: this.getConfigValue('search_size') } };
        this.fieldsList = [];
        Object.keys(this.getConfigValue('columns')).forEach(element => {
            this.fieldsList.push(this.getConfigValue('columns')[element]);
        });
        this.data = new Array<Map<string, string | number | Date>>();

        searchResult = this.collaborativeSearcheService.resolveButNot([projType.search, search]);
        searchResult.subscribe(value => {
            if (value.nbhits > 0) {
                value.hits.forEach(h => {
                    const map = new Map<string, string | number | Date>();
                    this.fieldsList.forEach(element => {
                        const result: string = this.getElementFromJsonObject(h.data, element.fieldName);
                        const process: string = this.getConfigValue('process')[element.fieldName]['process'];
                        let resultValue = null;
                        if (process.trim().length > 0) {
                            resultValue = eval(this.getConfigValue('process')[element.fieldName]['process']);
                        } else {
                            resultValue = result;

                        }
                        map.set(element.fieldName, resultValue);
                    });
                    this.data.push(map);
                });
            }
        });
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
