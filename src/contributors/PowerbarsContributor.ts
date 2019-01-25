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

import { Observable } from 'rxjs';
import {
    Collaboration,
    CollaborativesearchService,
    ConfigService,
    CollaborationEvent
} from 'arlas-web-core';
import { AggregationResponse } from 'arlas-api';
import jsonSchema from '../jsonSchemas/powerbarsContributorConf.schema.json';
import { TreeNode, SimpleNode } from '../models/models.js';
import { TreeContributor } from './TreeContributor.js';

/**
* This contributor works with the Angular PowerbarsComponent of the Arlas-web-components project.
* This class make the brigde between the component which displays the data and the
* collaborativeSearchService of the Arlas-web-core which retrieve the data from the server.

* This contributor is deprecated.
*/
export class PowerbarsContributor extends TreeContributor {

    /**
     * data retrieved from Server response and to be returned for the component as input
     * @Input() inputData
     */
    public powerbarsData: TreeNode;

    /**
     * List of selected nodes to be returned to a powerbars component to determine the powerbars to select
     */
    public selectedBars: Array<Array<SimpleNode>> = new Array<Array<SimpleNode>>();

    /**
     * Title given to the aggregation result
     */
    public powerbarsTitle: string;



    /**
    * Build a new contributor.
    * @param identifier  Identifier of the contributor.
    * @param collaborativeSearcheService  Instance of CollaborativesearchService from Arlas-web-core.
    * @param configService  Instance of ConfigService from Arlas-web-core.
    */
    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        title: string,
    ) {
        super(identifier, collaborativeSearcheService, configService, title);
        this.powerbarsTitle = title;
    }

    public static getJsonSchema(): Object {
        return jsonSchema;
    }

    /**
    * @returns Pretty name of contribution based on selected bar
    */
    public getFilterDisplayName(): string {
        return this.powerbarsTitle;
    }
    /**
    * @returns Package name for the configuration service.
    */
    public getPackageName(): string {
        return 'arlas.web.contributors.powerbars';
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<AggregationResponse> {
        return super.fetchData(collaborationEvent);
    }

    public computeData(aggregationResponse: AggregationResponse): TreeNode {
        return super.computeData(aggregationResponse);
    }

    public setData(data: TreeNode): TreeNode {
        this.powerbarsData = super.setData(data);
        return this.powerbarsData;
    }

    public setSelection(data: TreeNode, collaboration: Collaboration): any {
        const selection = super.setSelection(data, collaboration);
        this.selectedBars = this.selectedNodesPathsList;
        return selection;
    }

    public selectedBarsChanged(selectedBars: Array<Array<SimpleNode>>) {
        super.selectedNodesListChanged(selectedBars);
    }


    public updatePowerbarsData(search: any) {
        super.updateTreeDataSearch(search);
    }
}
