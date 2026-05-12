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

/**
 * Structure of the error emitted by the ResultlistContributor when creating or applying a process
 */
export interface ProcessError {
    /** Name of the column */
    column: string;
    /** Context in which the error occured */
    context: 'create' | 'apply';
    /** Value on which the process was applied */
    value?: any;
    /** Error thrown */
    error: any;
}

export function validProcess(process: string, variableName: string): boolean {
    return !!process && process.length < 250
        && !process.includes('document')
        && !process.includes('window')
        && !process.includes('eval')
        && !process.includes('localStorage')
        && !process.includes('this')
        && !process.includes('function')
        && !process.includes('Function')
        && processPassesAllowList(process, variableName);
}

/**
 * Verifies if the Javascript code to execute respects the following rules.
 * Only are allowed
 * - Date, Math, Number classes
 * - Date methods (getters & toxxxString methods only)
 * - Math methods (sqrt, pow, abs, ... you name it !)
 * - Number methods (parseInt, parseFloat, isNaN, ...)
 * - String methods (substring, concat, ...)
 * - Array methods (slice, concat, flat, ...)
 * - Mathematical operations (+ - % ^ x /)
 * - Comparison operators (== === != !== < <= > >=)
 * - The following chars ([ ] ( ) , ; : ? ! .)
 * - text between simple quotes 'your text'. Only these special chars are allowed : ,:-_;%!?
 * @param processToExecute A javascript code to execute.
 * @param variableName variable to use
 * @returns boolean (true if valid)
 */
export function processPassesAllowList(processToExecute: string, variableName: string): boolean {
    const classes = [
        'Date',
        'Math',
        'Number'
    ];
    const dateMethods = [
        'getDate',
        'getDay',
        'getFullYear',
        'getHours',
        'getMilliseconds',
        'getMinutes',
        'getMonth',
        'getSeconds',
        'getTime',
        'getTimezoneOffset',
        'getUTCDate',
        'getUTCDay',
        'getUTCFullYear',
        'getUTCHours',
        'getUTCMilliseconds',
        'getUTCMinutes',
        'getUTCSeconds',
        'toDateString',
        'toGMTString',
        'toISOString',
        'toJSON',
        'toLocaleDateString',
        'toLocaleString',
        'toLocaleTimeString',
        'toMetaDataString',
        'toString',
        'toTimeString',
        'toUTCString',
        'valueOf'
    ];

    const arrayMethod = [
        'concat',
        'filter',
        'find',
        'findIndex',
        'flat',
        'flatMap',
        'join',
        'map',
        'keys',
        'includes',
        'reduce',
        'slice',
        'toLocaleString',
        'values'
    ];

    const stringMethods = [
        'concat',
        'endsWith',
        'includes',
        'replace',
        'replaceAll',
        'slice',
        'split',
        'startsWith',
        'substring',
        'toLocaleLowerCase',
        'toLocaleUpperCase',
        'toLowerCase',
        'toString',
        'toUpperCase',
        'trim',
        ''
    ];

    const mathMethods = [
        'abs',
        'acos',
        'asin',
        'atan',
        'atan2',
        'ceil',
        'cos',
        'exp',
        'floor',
        'log',
        'max',
        'min',
        'pow',
        'random',
        'round',
        'sin',
        'sqrt',
        'tan',
        'trunc'
    ];

    const numberMethods = [
        'parseFloat',
        'parseInt',
        'toExponential',
        'toFixed',
        'toPrecision',
        'isNaN',
        'isFinite',
        'isInteger'
    ];

    const mathOps = [
        '+', '\\-', '\\/', '*', '%', '^'
    ];

    const chars = [
        '\\[', '\\]', '.', ';', ',', '(', ')', ':', '?', '!','&'
    ];

    const comparisonOps = [
        '==', '===', '!=', '!==', '<', '<=', '>', '>='
    ];
    const regexPattern: string = `^([ \\t]*(new[ \\t]+(?:${classes.join('|')})` + // use of new + classes
        `|(?:${variableName}|undefined|null|tmp)` + // variables names we can use
        `|(?:${dateMethods.join('|')})` +
        `|Math\.(?:${mathMethods.join('|')})` +
        `|(?:${numberMethods.join('|')})` +
        `|(?:${stringMethods.join('|')})` +
        `|(?:${arrayMethod.join('|')})` +
        `|[${mathOps.join('')}]` +
        `|[${chars.join('')}]` +
        `|(?:${comparisonOps.join('|')})` +
        `|[ \\t]*'(?:.+)'` + // match all chars between simple quotes ''.
        `|[ \\t]*\"(?:.+)\"` + // match all chars  between double quotes "".
        `|[ \\t]*''(?!')` + // empty simple quotes ''.
        `|[ \\t]*\"\"(?!\")` + // empty double quotes "".
        `|[ \\t]*\\d+(\\.\\d+)?))*[ \\t]*;?$`;

    const regexExp = new RegExp(regexPattern);
    return regexExp.test(processToExecute);

}
