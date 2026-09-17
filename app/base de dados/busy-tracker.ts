export type BusyOperations = Map<string, string>;

export function beginBusyOperation(operations: BusyOperations, key: string, label: string) {
  operations.set(key, label);
  return latestBusyLabel(operations);
}

export function endBusyOperation(operations: BusyOperations, key: string) {
  operations.delete(key);
  return latestBusyLabel(operations);
}

export function latestBusyLabel(operations: BusyOperations) {
  let label = "";
  for (const value of operations.values()) label = value;
  return label;
}
