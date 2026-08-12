import type { AgentRuntimeResult, AgentRuntimeTask, CoreAgentId } from './agent-runtime-contract.js';

export interface AgentRuntimeHandler {
  agentId: CoreAgentId;
  capabilityId: string;
  execute(task: AgentRuntimeTask): Promise<AgentRuntimeResult>;
}

export class AgentRuntimeHandlerRegistry {
  private readonly handlers = new Map<string, AgentRuntimeHandler>();

  private key(agentId: CoreAgentId, capabilityId: string): string {
    return `${agentId}:${capabilityId}`;
  }

  register(handler: AgentRuntimeHandler): void {
    if (!handler.capabilityId.trim()) throw new Error('runtime handler capabilityId is required.');
    const key = this.key(handler.agentId, handler.capabilityId);
    if (this.handlers.has(key)) throw new Error(`runtime handler already registered for ${key}.`);
    this.handlers.set(key, handler);
  }

  get(agentId: CoreAgentId, capabilityId: string): AgentRuntimeHandler | undefined {
    return this.handlers.get(this.key(agentId, capabilityId));
  }

  require(agentId: CoreAgentId, capabilityId: string): AgentRuntimeHandler {
    const handler = this.get(agentId, capabilityId);
    if (!handler) throw new Error(`no runtime handler registered for ${agentId}:${capabilityId}.`);
    return handler;
  }
}
