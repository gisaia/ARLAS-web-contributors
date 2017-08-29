import { Subject } from 'rxjs/Subject';
/**
 * Action trigger by a contributor through the app or another contributor.
 * - id of action.
 * - label of action.
 * - actionBus suscribe by the contributor to do something when this bus is nexted by the app or another contributor.
 */
export interface Action {
    id: string;
    label: string;
    actionBus: Subject<ProductIdentifier>;
}
/**
 * Couple of field/value id product, use to retrieve the product.
 * - id field name.
 * - id field value.
 */
export interface ProductIdentifier {
    idFieldName: string;
    idValue: string;
}
