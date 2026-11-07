// Expertise descreve contribuição e evidências; nunca concede ferramentas.
const SOFTWARE={
  architect:['APIContract',['interfaces','decisions','consumers','risks','evidenceRefs']],
  backend:['BackendImplementationArtifact',['files','apiContractRef','authorizationChecks','testResults','knownLimits']],
  frontend:['FrontendImplementationArtifact',['files','apiContractRef','states','accessibilityChecks','visualEvidenceRefs','testResults','knownLimits']],
  ui:['InteractionSpec',['userGoal','states','interactions','accessibility','evidenceRefs']],
  dados:['DataMigrationArtifact',['schemaChanges','migration','rollback','compatibility','testResults']],
  seguranca:['SecurityReviewResult',['outcome','threats','negativeTests','findings','evidenceRefs']],
  qa:['IntegrationEvidence',['outcome','criteria','environment','testResults','notExecuted','evidenceRefs']],
  revisor:['ReviewResult',['outcome','revision','findings','evidenceRefs']],
  integracoes:['IntegrationContract',['provider','scope','contract','failureCases','testResults','knownLimits']],
  mcp:['ToolCapabilityReport',['server','toolNames','readScopes','writeScopes','authorization','knownLimits']],
  infra:['EnvironmentReport',['environment','commands','versions','rollback','evidenceRefs']],
  pipeline:['PipelineEvidence',['stages','requiredChecks','environment','evidenceRefs']],
  versionamento:['IntegratedCommit',['sourceCommit','targetCommit','destination','files','integrationTests','conflicts','evidenceRefs']],
  curador:['KnowledgeUpdate',['sources','versions','scope','changes','knownLimits']],
};
const PROFESSIONAL={
  conhecimento:['KnowledgeContextPackage',['sources','versions','scope','unknowns']],
  coletor:['EvidenceCollection',['sources','queries','period','limits','missingSources']],
  progresso:['ActivityProgressReport',['period','timeline','statuses','evidenceRefs']],
  contribuicao:['ContributionReport',['contributions','attribution','uncertainties','evidenceRefs']],
  projetos:['ProjectAnalysis',['scope','dependencies','changes','evidenceRefs']],
  desempenho:['ImpactAssessment',['metrics','formulas','comparison','limitations','evidenceRefs']],
  riscos:['RiskAndNextStepsReport',['risks','severity','owners','mitigations','evidenceRefs']],
  relatorios:['ExecutiveReport',['claims','coverage','knownLimits','evidenceRefs']],
  narrativa:['ExecutiveNarrative',['audience','objective','messages','evidenceRefs']],
  arquitetura_slides:['PresentationBlueprint',['slides','messages','evidenceRefs','visualSources']],
  design_slides:['PresentationArtifact',['artifactRefs','renderRefs','editable','links','knownLimits']],
  marca:['BrandComplianceReport',['outcome','brandSource','typography','contrast','findings']],
  qa_evidencias:['EvidenceQAResult',['outcome','claims','coverage','findings','evidenceRefs']],
  reunioes:['MeetingPreparationPackage',['audience','confirmedTime','materials','questions','decisions']],
  comunicacao:['SpeakingPreparation',['audience','brief','script','caveats','evidenceRefs']],
};
export function contratoDoPapel(elenco,id){
  const entry=(elenco.id==='professional-operations'?PROFESSIONAL:SOFTWARE)[id];
  if(!entry)return null;
  return {schema:'nectar.role.v1',role:id,output:{type:entry[0],requiredFields:entry[1]},inputs:['TaskContractV1','artefatos autorizados','critérios de aceite','stack/fontes existentes'],skills:elenco.POR_ID[id]?.skills||[],qualityGates:['integridade/proveniência determinísticas','revisão independente proporcional','validação funcional/visual pertinente'],cannotInvent:['fonte não consultada','teste não executado','compromisso não confirmado','autoria não rastreada','impacto causal não medido'],permissions:'Somente CapabilityGrant desta execução. Expertise e persona não concedem acesso.'};
}
export function validarSaidaEspecializada(type,payload){
  const spec=Object.values({...SOFTWARE,...PROFESSIONAL}).find(e=>e[0]===type);
  if(!spec)return true;
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('typed_output_missing');
  const missing=spec[1].filter(k=>!Object.hasOwn(payload,k));if(missing.length)throw new Error(`typed_output_missing: ${missing.join(', ')}`);
  if(payload.outcome&&!['passed','failed','inconclusive'].includes(payload.outcome))throw new Error('quality_gate_invalid');
  if(type==='ExecutiveReport'&&(!Array.isArray(payload.claims)||!payload.claims.length||payload.claims.some(c=>!c.text||!c.evidenceRefs?.length)))throw new Error('claim_without_evidence');
  return true;
}
export function capabilitiesDoTemplate(templateId,ids,papeis={}){const definitions=templateId==='professional-operations'?PROFESSIONAL:SOFTWARE;const result={};for(const id of ids)result[id]=definitions[id]?[definitions[id][0]]:[];if(papeis.lead)result[papeis.lead]=[...(result[papeis.lead]||[]),'AcceptanceResult','Plan','Report'];return result;}
