  runtimeStore,
});
const pilotLeadWorker = createPilotLeadWorker(
  pilotSystemState,
  leadLiveResearchRuntime,
  {
    intervalMs: 60 * 60 * 1000,
    geographicFocus: 'South Africa',
    maxQueries: 6,
    maxBusinessesPerQuery: 3,
    maxWebResultsPerBusiness: 3,
    onCycleCompleted(result) {
      logEvent('info', 'pilot_lead_worker_cycle_completed', {
        queries: result.queries,
        atlasSourcePaths: result.atlasSourcePaths,
        discovered: result.discovered,
        newOrRetryable: result.discovered,
        providerCandidatesExamined: result.discovered + result.outcomes.duplicateSkipped,
        enriched: result.enriched.length,
        ambiguousOrUnresolved: result.proposals.length,
        duplicateSkipped: result.outcomes.duplicateSkipped,
        webResearchFailed: result.outcomes.webResearchFailed,
        candidateOutcomes: result.outcomes,
        reviewExecutionIds: result.enriched.map((lead) => lead.qualificationReviewExecutionId),
      });
    },