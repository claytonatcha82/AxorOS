import type { AgentRuntimeTask, CoreAgentId } from './agent-runtime-contract.js';
import type { AgentRuntimeRegistry } from './agent-runtime-registry.js';

export interface RouteDecision {
  destinationAgent: CoreAgentId;
  capabilityId: string;
  approved: boolean;
  reason: string;
}

export function validateRuntimeDestination(task: AgentRuntimeTask, capabilityId: string, registry: AgentRuntimeRegistry): RouteDecision {
  const registration = registry.requireEnabled(task.destinationAgent);
  const capability = registration.capabilities.find((item) => item.capabilityId === capabilityId);
  if (!capability) {
    return { destinationAgent: task.destinationAgent, capabilityId, approved: false, reason: 'destination agent does not declare the required capability.' };
  }
  if ((task.priority === 'critical' || task.risks.length > 0) && !capability.acceptsHighRisk) {
    return { destinationAgent: task.destinationAgent, capabilityId, approved: false, reason: 'destination capability is not authorised for high-risk work.' };
  }
  if (task.approvalRequired && !task.approvalOwner) {
    return { destinationAgent: task.destinationAgent, capabilityId, approved: false, reason: 'required approval owner is missing.' };
  }
  return { destinationAgent: task.destinationAgent, capabilityId, approved: true, reason: 'destination is enabled and capability-authorised.' };
}

export function resolveCapabilityDestination(capabilityId: string, registry: AgentRuntimeRegistry): CoreAgentId | null {
  const matches = registry.findByCapability(capabilityId);
  return matches.length === 1 ? matches[0]! : null;
}
