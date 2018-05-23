/*
 * Licensed to Gisaïa under one or more contributor
 * license agreements. See the NOTICE.txt file distributed with
 * this work for additional information regarding copyright
 * ownership. Gisaïa licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { Subject } from 'rxjs/Subject';
import { Observable } from 'rxjs/Observable';
import {
    Collaboration,
    CollaborativesearchService,
    ConfigService,
    Contributor,
    OperationEnum,
    projType, CollaborationEvent
} from 'arlas-web-core';
import {
    Hits, Filter, Aggregation,
    Expression, AggregationResponse, RangeResponse, RangeRequest, AggregationsRequest,
} from 'arlas-api';
import { SelectedOutputValues, DataType } from '../models/models';
import { getSelectionToSet, getvaluesChanged, getAggregationPrecision } from '../utils/histoswimUtils';
import * as jsonSchema from '../jsonSchemas/histogramContributorConf.schema.json';

/**
* This contributor works with the Angular HistogramComponent of the Arlas-web-components project.
* This class make the brigde between the component which displays the data and the
* collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.
*/
export class HistogramContributor extends Contributor {
    /**
    * New data need to be draw on the histogram (could be set to
    @Input() data of HistogramComponent
    */
    public chartData: Array<{ key: number, value: number }> = new Array<{ key: number, value: number }>();
    /**
    * New selection current need to be draw on the histogram (could be set to
    @Input() intervalSelection of HistogramComponent
    */
    public intervalSelection: SelectedOutputValues;
    /**
    * New selections need to be draw on the histogram (could be set to
    @Input() intervalSelection of HistogramComponent
    */
    public intervalListSelection: SelectedOutputValues[] = [];
    /**
     * Histogram's range
    */
    public range: number;
    /**
    * ARLAS Server Aggregation used to draw the chart, define in configuration
    */
    private aggregations: Array<Aggregation> = this.getConfigValue('aggregationmodels');
    /**
    * Number of buckets in the histogram. If not specified, the interval in the aggregagtion model is used instead.
    */
    private nbBuckets: number = this.getConfigValue('numberOfBuckets');
    /**
    * ARLAS Server field of aggregation used to draw the chart, retrieve from Aggregation
    */
    private field: string = (this.aggregations !== undefined) ? (this.aggregations[this.aggregations.length - 1].field) : (undefined);
    /**
    * Start value of selection use to the display of filterDisplayName
    */
    private startValue: string;
    /**
    * End value of selection use to the display of filterDisplayName
    */
    private endValue: string;
    /**
    * Max value of all bucketn use for oneDimension histogram palette
    */
    private maxCount = 0;
    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        private dataType: DataType.numeric | DataType.time,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService, private isOneDimension?: boolean
    ) {
        super(identifier, configService, collaborativeSearcheService);
    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    /**
    * @returns Pretty name of contribution based on startValue/endValue properties
    */
    public getFilterDisplayName(): string {
        let displayName = '';
        const name = this.getConfigValue('name');
        const lastAggregation: Aggregation = this.aggregations[this.aggregations.length - 1];
        if (lastAggregation.type.toString().toLocaleLowerCase() === Aggregation.TypeEnum.Datehistogram.toString().toLocaleLowerCase()) {
            displayName = 'Timeline';
        } else if (lastAggregation.type.toString().toLocaleLowerCase() === Aggregation.TypeEnum.Histogram.toString().toLocaleLowerCase()) {
            displayName = this.startValue + ' <= ' + name + ' <= ' + this.endValue;
        } else {
            displayName = name;
        }
        return displayName;
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.histogram';
    }
    /**
    * Set filter on value change, use in output of component
    * @param value DateType.millisecond | DateType.second
    */
    public valueChanged(values: SelectedOutputValues[]) {
        const resultList = getvaluesChanged(values, this.field, this.identifier, this.collaborativeSearcheService);
        this.intervalSelection = resultList[0];
        this.startValue = resultList[1];
        this.endValue = resultList[2];
    }

    public fetchData(collaborationEvent?: CollaborationEvent): Observable<AggregationResponse> {
        this.maxCount = 0;
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            if (this.nbBuckets) {
              return (this.collaborativeSearcheService.resolveButNotFieldRange([projType.range,
                     <RangeRequest>{filter: null, field: this.field}], this.identifier)
                    .map((range: RangeResponse) => {
                        this.range = (range.min && range.max) ? (range.max - range.min) : 0;
                        this.aggregations[0].interval = getAggregationPrecision(this.nbBuckets, this.range, this.aggregations[0].type);
                    }).flatMap( () =>
                        this.collaborativeSearcheService.resolveButNotAggregation(
                         [projType.aggregate, this.aggregations],
                         this.identifier)
                    ));
            } else {
                return this.collaborativeSearcheService.resolveButNotAggregation(
                    [projType.aggregate, this.aggregations],
                    this.identifier);
            }
        } else {
            return Observable.from([]);
        }
    }
    public computeData(aggResponse: AggregationResponse): Array<{ key: number, value: number }> {
        const dataTab = new Array<{ key: number, value: number }>();
        if (aggResponse.elements !== undefined) {
            aggResponse.elements.forEach(element => {
                if (this.maxCount <= element.count) {
                    this.maxCount = element.count;
                }
                dataTab.push({ key: element.key, value: element.count });
            });
        }
        return dataTab;
    }

    public setData(data: Array<{ key: number, value: number }>): Array<{ key: number, value: number }> {
        if (!this.isOneDimension || this.isOneDimension === undefined) {
            this.chartData = data;
        } else {
            data.forEach(obj => {
                obj.value = obj.value / this.maxCount;
            });
            this.chartData = data;
        }
        return this.chartData;
    }

    public setSelection(data: Array<{ key: number, value: number }>, collaboration: Collaboration): any {
        const resultList = getSelectionToSet(data, collaboration, this.dataType);
        this.intervalListSelection = resultList[0];
        this.intervalSelection = resultList[1];
        this.startValue = resultList[2];
        this.endValue = resultList[3];
        return Observable.from([]);

    }
}
