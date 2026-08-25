import type { PilotSystemStatePostgresStore } from '../data/pilot-system-state-postgres-store.js';
import type { IntegrationRequest } from './integration-contract.js';
import type { LiveIntegrationExecutionGate } from './integration-registry.js';

export function createPilotLiveExecutionGate(
  store: Pick<PilotSystemStatePostgresStore, 'get'>,
): LiveIntegrationExecutionGate {
  return async (request: IntegrationRequest) => {
    let state;
    try {
      state = await store.get();
    } catch {
      throw new Error(`live integration ${request.integrationId}/${request.operation} blocked: authoritative pilot state is unavailable.`);
    }

    if (state.state !== 'PILOT_ACTIVE') {
      throw new Error(`live integration ${request.integrationId}/${request.operation} blocked while pilot state is ${state.state}.`);
    }
  };
}
