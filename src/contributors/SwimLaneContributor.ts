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

import {
    Collaboration,
    CollaborationEvent,
    CollaborativesearchService,
    ConfigService,
    Contributor,
    OperationEnum,
    projType
} from 'arlas-web-core';
import { Observable } from 'rxjs/Observable';
import { SelectedOutputValues, DataType } from '../models/models';
import { Aggregation, AggregationResponse } from 'arlas-api';
import { getSelectionToSet, getvaluesChanged } from '../utils/histoswimUtils';
import * as jsonSchema from '../jsonSchemas/swimlaneContributorConf.schema.json';


export class SwimLaneContributor extends Contributor {
    /**
    * New data need to be draw in the swimlane (could be set to
    @Input() data of Swimlane Component
    */
    public swimData: Map<string, Array<{ key: number, value: number }>> = new Map<string, Array<{ key: number, value: number }>>();
    /**
    * New selection current need to be draw on the histogram (could be set to
    @Input() intervalSelection of Swimlane Component
    */
    public intervalSelection: SelectedOutputValues;
    /**
    * New selections need to be draw on the Swimlane (could be set to
    @Input() intervalSelection of Swimlane Component
    */
    public intervalListSelection: SelectedOutputValues[] = [];

    public aggregations: Aggregation[] = this.getConfigValue('swimlanes')[0]['aggregationmodels'];

    public field: string = this.getConfigValue('swimlanes')[0]['field'];
    /**

    /**
    * Start value of selection use to the display of filterDisplayName
    */
    private startValue: string;
    /**
    * End value of selection use to the display of filterDisplayName
    */
    private endValue: string;

    private histogramHasCurrentSelection = false;

    /**
    * Build a new contributor.
    * @param identifier  Identifier of contributor.
    * @param dataType  type of data histrogram (time or numeric).
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
* Set filter on value change, use in output of component
* @param value DateType.millisecond | DateType.second
*/
    public valueChanged(values: SelectedOutputValues[]) {
        if (values.length === 0 || (values.length > 0 && values[values.length - 1] === null)) {
            this.histogramHasCurrentSelection = false;
        } else {
            this.histogramHasCurrentSelection = true;
        }
        const resultList = getvaluesChanged(values, this.field, this.identifier, this.collaborativeSearcheService);
        this.intervalSelection = resultList[0];
        this.startValue = resultList[1];
        this.endValue = resultList[2];

    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<AggregationResponse> {
        const aggObservable = this.collaborativeSearcheService.resolveButNotAggregation(
            [projType.aggregate, this.aggregations],
            this.identifier
        );
        if (collaborationEvent.id !== this.identifier || collaborationEvent.operation === OperationEnum.remove) {
            return aggObservable;
        } else {
            return Observable.from([]);
        }
    }

    public computeData(aggResonse: AggregationResponse): Map<string, Array<{ key: number, value: number }>> {
        const mapResponse = new Map<string, Array<{ key: number, value: number }>>();
        if (aggResonse.elements !== undefined) {
            aggResonse.elements.forEach(element => {
                const key = element.key;
                const dataTab = new Array<{ key: number, value: number }>();
                element.elements.forEach(e => {
                    e.elements.forEach(el => dataTab.push({ key: el.key, value: el.count }));
                });
                mapResponse.set(key, dataTab);
            });
        }
        return mapResponse;
    }

    public setData(data: any): Map<string, Array<{ key: number, value: number }>> {
        this.swimData = data;
        return this.swimData;
    }

    public setSelection(data: Map<string, Array<{ key: number, value: number }>>, c: Collaboration): any {
        const resultList = getSelectionToSet(data, c, this.dataType, this.histogramHasCurrentSelection);
        this.intervalListSelection = resultList[0];
        this.intervalSelection = resultList[1];
        this.startValue = resultList[2];
        this.endValue = resultList[3];
        return Observable.from([]);

    }

    public getPackageName(): string {
        return 'arlas.web.contributors.swimlane';
    }

    public getFilterDisplayName(): string {
        return 'SwimLane';
    }
}
