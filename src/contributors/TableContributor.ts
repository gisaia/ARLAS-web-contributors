
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService, Contributor, ConfigService } from 'arlas-web-core';
import { Observable } from "rxjs/Observable";
import { ArlasAggregation } from "arlas-api/model/arlasAggregation";
import { AggregationModel } from "arlas-api/model/aggregationModel";
import { Filter } from "arlas-api/model/filter";
import { arlasProjection, eventType } from "arlas-web-core/models/collaborationEvent";
import { Aggregations } from "arlas-api/model/aggregations";
import { AggregationRequest } from "arlas-api/model/aggregationRequest";
import { ArlasHits } from "arlas-api/model/arlasHits";

export class TableContributor extends Contributor {
    constructor(
        identifier,
        private settings: Object,
        private dataSubject: Subject<any>,
        private source: Object,
        private valuesChangedEvent: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService, configService: ConfigService) {
        super(identifier, configService);
        this.settings = this.getConfigValue("settings")
        let data = this.collaborativeSearcheService.resolveButNot(eventType.search)
        let dataForTab = new Array<Object>();
        data.subscribe(value => {
            value.hits.forEach(h => {
                let line = {};
                Object.keys(this.settings["columns"]).forEach(element => {
                    if (element == "id") {
                        line["id"] = h.md.id
                    } else {
                        line[element] = h.data[element]
                    }
                });
                dataForTab.push(line)
            })
            this.dataSubject.next({ data: dataForTab, settings: this.settings })
        })
        this.valuesChangedEvent.subscribe(value => {
            let arrayString = new Array<string>()
            value.forEach(element => {
                arrayString.push(element.field + ":like:" + element.value)
            });
            let filter: Filter = {
                f: arrayString
            }
            let detail: arlasProjection = {
                filter: filter
            }
            let data = {
                contributor: this,
                eventType: eventType.search,
                detail: detail
            }
            this.collaborativeSearcheService.setFilter(data)

            if (arrayString.length > 0) {
                this.collaborativeSearcheService.setFilter(data)

            } else {
                this.collaborativeSearcheService.contributions.forEach(x => {
                    if (x.contributor == this) {
                        this.collaborativeSearcheService.removeFilter(x)
                    }
                })
                this.collaborativeSearcheService.setFilter(data)

            }
        })
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributor === this) {
                return
            } else {
                let data = this.collaborativeSearcheService.resolveButNot(eventType.search)
                let dataForTab = new Array<Object>();
                data.subscribe(value => {
                    value.hits.forEach(h => {
                        let line = {};
                        Object.keys(this.settings["columns"]).forEach(element => {
                            if (element == "id") {
                                line["id"] = h.md.id
                            } else {
                                line[element] = h.data[element]
                            }
                        });
                        dataForTab.push(line)
                    })
                    this.dataSubject.next({ data: dataForTab, settings: this.settings })
                })

            }
        })
    }
    getPackageName(): string {
        return "arlas.catalog.web.app.components.table";
    }
}