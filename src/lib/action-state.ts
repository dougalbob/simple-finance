export interface ActionState {
  status: 'idle' | 'ok' | 'error';
  message: string | null;
}

export interface DuplicateNoticeState {
  purchaseId: number;
  version: number;
  enteredBy: string;
  totalPence: number;
  minutesAgo: number;
}

export interface PurchaseActionState extends ActionState {
  duplicateNotice: DuplicateNoticeState | null;
}

export const initialActionState: ActionState = { status: 'idle', message: null };

export const initialPurchaseActionState: PurchaseActionState = {
  status: 'idle',
  message: null,
  duplicateNotice: null,
};
