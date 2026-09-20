export interface ActionState {
  status: 'idle' | 'ok' | 'error';
  message: string | null;
}

export const initialActionState: ActionState = { status: 'idle', message: null };
