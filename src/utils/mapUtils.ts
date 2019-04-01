import { Expression, Search, Hits, Filter } from 'arlas-api';
import { Observable } from 'rxjs/Observable';
import { ElementIdentifier } from 'models/models';
import { projType } from 'arlas-web-core';
import { getElementFromJsonObject } from './utils';
import bbox from '@turf/bbox';
import { CollaborativesearchService } from 'arlas-web-core/services/collaborativesearch.service';
import { map } from 'rxjs/internal/operators/map';


export function getBounds(elementidentifier: ElementIdentifier, collaborativeSearcheService: CollaborativesearchService)
    : Observable<Array<Array<number>>> {
    let searchResult: Observable<Hits>;
    const search: Search = { page: { size: 1 } };
    const expression: Expression = {
        field: elementidentifier.idFieldName,
        op: Expression.OpEnum.Eq,
        value: elementidentifier.idValue
    };
    const filter: Filter = {
        f: [[expression]]
    };
    searchResult = collaborativeSearcheService
        .resolveHits([projType.search, search], collaborativeSearcheService.collaborations, '', filter);
    return searchResult
    .pipe(
    map(h => {
        const geojsonData = getElementFromJsonObject(h.hits[0].md, 'geometry');
        const box = bbox(geojsonData);
        const minX = box[0];
        const minY = box[1];
        const maxX = box[2];
        const maxY = box[3];
        return [[minX, minY], [maxX, maxY]];
    }));
}

export function tileToString(tile: { x: number, y: number, z: number }): string {
    return tile.x.toString() + tile.y.toString() + tile.z.toString();
}
