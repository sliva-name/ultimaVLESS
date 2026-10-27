/**
 * `electron-store` is only ever imported for its type outside `appStore.ts`,
 * which Android replaces; constructing it is a wiring mistake.
 */
export default class Store {
  constructor() {
    throw new Error('electron-store is not available on Android');
  }
}
