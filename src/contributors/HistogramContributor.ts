
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService } from 'arlas-web-core';
export class HistogramContributor {
    constructor(
        private valueChangedEvent: Subject<any>,
        private chartData: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService) {
        this.valueChangedEvent.subscribe(value => this.collaborativeSearcheService.setFilter(this, value))
        this.collaborativeSearcheService.collaboraticeSubject.subscribe(value => {
            let data = this.collaborativeSearcheService.searchButNot(value)
            chartData.next(value)
        })

    }
}