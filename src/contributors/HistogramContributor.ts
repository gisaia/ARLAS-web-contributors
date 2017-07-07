
import { Subject } from 'rxjs/Subject';
import { CollaborativesearchService } from 'arlas-web-core';
import { Observable } from "rxjs/Observable";
import { ArlasAggregation } from "api-arlas/model/arlasAggregation";
export  interface timelineOutput{
    endvalue:Date
    startvalue:Date


}

export class HistogramContributor {
    constructor(
        private valueChangedEvent: Subject<timelineOutput>,
        private chartData: Subject<any>,
        private collaborativeSearcheService: CollaborativesearchService) {
        this.valueChangedEvent.subscribe(value => {
            let data = {contributor: this, eventType: {}, detail: value}
            console.log(value)
            this.collaborativeSearcheService.setFilter(this, data)
        
    })
        this.collaborativeSearcheService.collaborationBus.subscribe(value => {
            if (value.contributor === this) {
                let data : Observable<ArlasAggregation>  = this.collaborativeSearcheService.searchButNot(value)
                let dataTab = new Array<any>()               
                 data.subscribe(value=>{
                     value.elements.forEach(element=>{
                        dataTab.push({key:element.key,value:element.elements[0].metric.value})
                     })
                     this.chartData.next(dataTab)
                })
                
                return
            } else {
                let data = this.collaborativeSearcheService.searchButNot(value)
                this.chartData.next(data)
            }
        })
    }
}