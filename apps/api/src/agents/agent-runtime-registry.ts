import type { CoreAgentId } from './agent-runtime-contract.js';

export interface AgentCapability {
  capabilityId: string;
  description: string;
  acceptsHighRisk: boolean;
}

export interface AgentRuntimeRegistration {
  agentId: CoreAgentId;
  enabled: boolean;
  capabilities: AgentCapability[];
}

export class AgentRuntimeRegistry {
  private readonly registrations = new Map<CoreAgentId, AgentRuntimeRegistration>();

  register(registration: AgentRuntimeRegistration): void {
    if (!registration.capabilities.length) throw new Error('agent registration requires at least one capability.');
    if (this.registrations.has(registration.agentId)) throw new Error(`agent ${registration.agentId} is already registered.`);
    this.registrations.set(registration.agentId, registration);
  }

  get(agentId: CoreAgentId): AgentRuntimeRegistration | undefined {
    return this.registrations.get(agentId);
  }

  requireEnabled(agentId: CoreAgentId): AgentRuntimeRegistration {
    const registration = this.registrations.get(agentId);
    if (!registration) throw new Error(`agent ${agentId} is not registered.`);
    if (!registration.enabled) throw new Error(`agent ${agentId} is disabled.`);
    return registration;
  }

  supports(agentId: CoreAgentId, capabilityId: string): boolean {
    const registration = this.registrations.get(agentId);
    return Boolean(registration?.enabled && registration.capabilities.some((capability) => capability.capabilityId === capabilityId));
  }

  findByCapability(capabilityId: string): CoreAgentId[] {
    return [...this.registrations.values()]
      .filter((registration) => registration.enabled && registration.capabilities.some((capability) => capability.capabilityId === capabilityId))
      .map((registration) => registration.agentId);
  }
}
