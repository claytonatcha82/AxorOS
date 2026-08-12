export interface OperationsCapacity {
  functionName: 'lead' | 'sales' | 'production' | 'support' | 'marketing' | 'finance' | 'knowledge';
  currentLoadPercent: number;
}

export type CapacityStatus = 'available' | 'busy' | 'constrained' | 'overloaded';

export function capacityStatus(load: number): CapacityStatus {
  if (load < 0 || load > 100) throw new Error('capacity load must be between 0 and 100.');
  if (load >= 95) return 'overloaded';
  if (load >= 85) return 'constrained';
  if (load >= 70) return 'busy';
  return 'available';
}

export interface OperationsPriorityInput {
  id: string;
  businessImpact: number;
  clientImpact: number;
  deadlinePressure: number;
  revenueImpact: number;
  risk: number;
  dependencyImpact: number;
  agentCapacityAvailable: number;
}

export function scoreOperationsPriority(input: OperationsPriorityInput): number {
  const values = [input.businessImpact, input.clientImpact, input.deadlinePressure, input.revenueImpact, input.risk, input.dependencyImpact, input.agentCapacityAvailable];
  if (values.some((value) => !Number.isInteger(value) || value < 1 || value > 5)) throw new Error('priority factors must be integers between 1 and 5.');
  return input.businessImpact + input.clientImpact + input.deadlinePressure + input.revenueImpact + input.risk + input.dependencyImpact + input.agentCapacityAvailable;
}

export function shouldAcceptAggressiveDeadline(capacity: OperationsCapacity): boolean {
  return capacityStatus(capacity.currentLoadPercent) !== 'constrained' && capacityStatus(capacity.currentLoadPercent) !== 'overloaded';
}
