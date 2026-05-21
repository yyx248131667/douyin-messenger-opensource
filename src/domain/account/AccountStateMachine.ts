import { Account, AccountState } from './Account';

type StateChangeCallback = (account: Account, previousState: AccountState, currentState: AccountState) => void;

export class AccountStateMachine {
  private accounts: Map<string, Account> = new Map();
  private listeners: Set<StateChangeCallback> = new Set();

  public register(account: Account) {
    if (!this.accounts.has(account.data.id)) {
      this.accounts.set(account.data.id, account);
    }
  }

  public getAccount(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  public transition(id: string, newState: AccountState) {
    const target = this.accounts.get(id);
    if (!target) return;

    const previousState = target.state;
    if (previousState === newState) return;

    target.updateState(newState);
    console.log(`[AccountStateMachine] ${id} transitioned ${previousState} -> ${newState}`);
    
    // Notify external services (like Vue/React renderer or legacy UI event bus)
    this.notifyListeners(target, previousState, newState);
  }

  public onStateChange(callback: StateChangeCallback) {
    this.listeners.add(callback);
  }

  public removeListener(callback: StateChangeCallback) {
    this.listeners.delete(callback);
  }

  private notifyListeners(account: Account, prev: AccountState, curr: AccountState) {
    for (const listener of this.listeners) {
      try {
         listener(account, prev, curr);
      } catch (err) {
         console.error('[AccountStateMachine] Error in listener execution', err);
      }
    }
  }

  public getAll(): Account[] {
    return Array.from(this.accounts.values());
  }
}
