import { Contributor, CollaborationEvent, Collaboration, projType, OperationEnum, CollaborativesearchService, ConfigService } from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { Aggregation, AggregationResponse } from 'arlas-api';
import { DonutArc } from '../models/models';
import * as jsonSchema from '../jsonSchemas/donutContributorConf.schema.json';



export class DonutContributor extends Contributor {

    /**
     * Title given to the aggregation result
     */
    public donutTitle: string;

    public donutArc: DonutArc;


     /**
    * ARLAS Server Aggregation used to draw the chart, define in configuration
    */
    private aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');

    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        title: string

    ) {
        super(identifier, configService, collaborativeSearcheService);
        this.donutTitle = title;
    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.donut';
    }

    public getFilterDisplayName(): string {
        return this.donutTitle;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<any> {
        const aggregationObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, this.aggregations],
            this.identifier
        );
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return aggregationObservable;
        } else {
            return Observable.from([]);
        }
    }

    public computeData(aggregationResonse: AggregationResponse): DonutArc {
        const donutArc: DonutArc = {id: 'root', name: 'root', ringName: 'root', isOther: false, children: []};
        this.populateChildren(donutArc, aggregationResonse);
        return donutArc;
    }


    public setData(data: DonutArc): DonutArc {
        this.donutArc = data;
        return data;
    }

    public setSelection(data: any, c: Collaboration): any {
        return Observable.from([]);;
    }

    private populateChildren (donutArc: DonutArc, aggregationResonse: AggregationResponse): void {
        const ring = donutArc.children;
        const aggregationBuckets = aggregationResonse.elements;
        // TODO : add sum_other_docs_count in ARLAS-server
        const countOfOthers = aggregationResonse.sumOtherDocCount;
        if (aggregationResonse.elements !== undefined && aggregationResonse.name !== undefined) {
            const aggregationBuckets = aggregationResonse.elements;
            let countOfBuckets = 0;
            aggregationBuckets.forEach(bucket => {
                countOfBuckets += bucket.count;
            });
            let relativeTotal = 0;
            let isOther = false;
            for(let i = 0; i < aggregationBuckets.length; i++) {
                const bucket = aggregationBuckets[i];
                const arc: DonutArc = {id: bucket.key + bucket.count, name: bucket.key, ringName: bucket.key, isOther: false, children: []};
                relativeTotal += bucket.count;
                if (bucket.elements !== undefined && bucket.elements[0].elements != undefined) {
                    if (relativeTotal / (countOfBuckets + countOfOthers) <= 0.9) {
                        arc.isOther = false;
                        this.populateChildren(arc, bucket.elements[0]);
                        ring.push(arc);
                    } else {
                        if (bucket.count / (countOfBuckets + countOfOthers) >= 0.2) {
                            arc.isOther = false;
                            this.populateChildren(arc, bucket.elements[0]);
                            ring.push(arc);
                        } else {
                            relativeTotal -= bucket.count;
                            isOther = true;
                            break;
                        }
                    }

                } else {
                    arc.isOther = false;
                    arc.size = bucket.count;
                    ring.push(arc);
                }
            }

            if (isOther) {
                const arc: DonutArc = {id: aggregationResonse.key + aggregationResonse.count, name: 'OTHER', ringName: aggregationResonse.key,
                 isOther: true, size: countOfOthers + (countOfBuckets - relativeTotal)};
                ring.push(arc);
            }
        } else {
            const arc: DonutArc = {id: aggregationResonse.key + aggregationResonse.count, name: 'OTHER', ringName: aggregationResonse.key, isOther: true, size: aggregationResonse.count};
            ring.push(arc);
        }
    }
}
