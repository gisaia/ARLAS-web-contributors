
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService } from 'arlas-web-core';

export class HistogramContributor {
    constructor(
        private valueChangedEvent: Subject<any>,
        private chartData: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService) {
        this.valueChangedEvent.subscribe(value => this.collaborativeSearcheService.setFilter(this, value))
        this.collaborativeSearcheService.changeSubject.subscribe(value=>{
            if(value.contributor===this){
                return
            }else{
                let data = this.collaborativeSearcheService.searchButNot(value.contributor)
                this.chartData.next(data)
            }
        })
    }
}