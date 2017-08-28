import { Subject } from 'rxjs/Subject';

export interface Action {
    id: string;
    label: string;
    actionBus: Subject<IdObject>;
}

export interface IdObject {
    idFieldName: string;
    idValue: string;
}
