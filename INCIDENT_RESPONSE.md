# Incident Response - Kwanza Folha

## Severidades

- SEV1: indisponibilidade total (arranque bloqueado generalizado, falha critica licenciamento)
- SEV2: funcionalidade critica degradada (processamento de folha, exportacoes legais)
- SEV3: impacto parcial sem bloqueio total

## Procedimento

1. identificar severidade e abrir incidente
2. congelar release/rollout ate conter impacto
3. recolher bundle de suporte da maquina afetada
4. recolher logs de servidor de licenciamento e `GET /health`
5. aplicar mitigacao rapida (rollback, hotfix, isolamento de modulo)
6. validar restauracao operacao com checklist objetiva
7. emitir postmortem tecnico com causa raiz e acoes preventivas

## Playbook de contingencia

- licenciamento indisponivel:
  - validar DNS/HTTPS/proxy
  - restaurar servico e validar ativacoes pendentes
- erro de base local:
  - restaurar ultimo backup valido
  - preservar snapshot para analise forense
- falha de release:
  - retirar release atual
  - restaurar ultima release estavel

## Evidencias obrigatorias no postmortem

- timeline (inicio, deteccao, mitigacao, resolucao)
- causa raiz tecnica comprovada
- impacto no negocio
- clientes/instalacoes afetadas
- acao preventiva com owner e prazo
