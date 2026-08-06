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

export enum TaskStatus {
  accepted = 'accepted',
  running = 'running',
  successful = 'successful',
  failed = 'failed',
  dismissed = 'dismissed'
}

export interface Task {
  processID: 'download' | 'ingest' | 'directory_ingest' | 'enrich' | 'dc3build';
  type: string;
  jobID: string;
  status: TaskStatus;
  message: string;
  created: number;
  started: number;
  finished?: number;
  updated?: number;
  // TODO: unsure it is sent
  progress?: number;
  // TODO: unsure it is sent
  links?: any;
  resourceID: string;
}

export abstract class TaskService {
    // TODO: is there a pagination?
    /**
     * Fetches the tasks associated to an Item of the given identifier
     * @param collection Collection of the Item
     * @param identifier Id of the Item
     */
    public abstract getTasks(collection: string, identifier: string): Observable<Task[]>;
}
