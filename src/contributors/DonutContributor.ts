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
    Contributor, CollaborationEvent, Collaboration, projType, OperationEnum,
    CollaborativesearchService, ConfigService
} from 'arlas-web-core';
import { Observable, from} from 'rxjs';
import { Aggregation, AggregationResponse, Filter, Expression } from 'arlas-api';
import { TreeNode, SimpleNode } from '../models/models';
import jsonSchema from '../jsonSchemas/donutContributorConf.schema.json';
import { TreeContributor } from './TreeContributor';


/**
 * Deprecated contributor. Use TreeContributor instead.
 */
export class DonutContributor extends TreeContributor {

    /**
     * Title given to the aggregation result
     */
    public title: string;
    /**
     * Data retrieved from ARLAS-server response and to be returned for the donut component as an input
     */
    public donutData: TreeNode;
    /**
     * The minimum ratio of the arc in its ring needed to be plot. Otherwise the arc is considered as OTHER
     */
    public arcMinPourcentage = (this.getConfigValue('arcMinPourcentage')) ? this.getConfigValue('arcMinPourcentage') : 0.01;
    /**
     * List of selected nodes to be returned to the donut component as an input
     */
    public selectedArcsList: Array<Array<SimpleNode>> = new Array<Array<SimpleNode>>();

    constructor(
        identifier: string,
        collaborativeSearcheService: CollaborativesearchService,
        configService: ConfigService,
        title: string

    ) {
        super(identifier, collaborativeSearcheService, configService, title);
        this.nodeSizeMinPourcentage = this.arcMinPourcentage;
        this.title = title;
    }

    /**
    * @returns Json schema for configuration.
    */
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
        return this.title;
    }

    public fetchData(collaborationEvent: CollaborationEvent): Observable<any> {
        return super.fetchData(collaborationEvent);
    }

    public computeData(aggregationResponse: AggregationResponse): TreeNode {
        return super.computeData(aggregationResponse);
    }

    public setData(data: TreeNode): TreeNode {
        this.donutData = super.setData(data);
        return this.donutData;
    }

    public setSelection(data: TreeNode, collaboration: Collaboration): any {
        const selection = super.setSelection(data, collaboration);
        this.selectedArcsList = this.selectedNodesPathsList;
        return selection;
    }

    public selectedArcsListChanged(selectedArcsList: Array<Array<SimpleNode>>): void {
        super.selectedNodesListChanged(selectedArcsList);
    }
}
