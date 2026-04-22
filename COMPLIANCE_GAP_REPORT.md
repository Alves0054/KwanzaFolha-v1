# Compliance Gap Report - Kwanza Folha

Data: 2026-04-22

## 1) Ja implementado no codigo

- motor fiscal centralizado em:
  - `electron/services/core/fiscal/index.js`
  - `electron/services/core/irt/irtCalculator.js`
  - `electron/services/core/inss/inssCalculator.js`
  - `electron/services/core/payroll/salaryEngine.js`
- processamento de folha com rasto de bases legais no `summary_json` de `payroll_runs`
- validacao assistida de mapa mensal AGT em:
  - `electron/services/database.js` (`buildAgtMonthlyRemunerationMap`, `saveAgtMonthlySubmission`)
- exportacao bancaria PS2/PSX no backend em `DatabaseService.exportBankPayrollFile`
- bloqueio de edicao manual de tabela IRT em producao (`electron/main.js`)
- release assinada e verificacao de assinatura no pipeline (`.github/workflows/release.yml`)
- trilha de auditoria operacional (`audit_logs`) e exportacao CSV/XLS
- novo artefacto de auditoria de calculo de folha (JSON/CSV):
  - `DatabaseService.exportPayrollCalculationAudit`

## 2) Parcialmente suportado

- AGT:
  - geracao e validacao interna estao implementadas
  - submissao oficial continua dependente de portal externo e procedimento manual/upload
- PS2/PSX:
  - formato tecnico gerado no sistema
  - validacao institucional final por banco ainda e externa
- documentos legais:
  - emissao existe
  - linguagem juridica final e responsabilidade de revisao humana especializada

## 3) Validacao externa pendente (obrigatoria)

- revisao contabilistica/fiscal formal da regra de calculo e mapas emitidos
- validacao de layout e aceitacao operacional PS2/PSX junto de cada banco usado
- validacao operacional do fluxo AGT em ambiente real de entrega
- revisao juridica dos textos/documentos emitidos para uso comercial
- governanca formal de atualizacao legal (mudanca de lei, decreto, OGE)

Checklist detalhada: `docs/validacao-externa-pendente/CHECKLIST_VALIDACAO_EXTERNA.md`

## 4) O que nao deve ser prometido comercialmente (neste estado)

- "homologado pela AGT"
- "certificado por bancos para PS2/PSX"
- "conformidade legal oficial garantida"
- "validacao juridica concluida"

Essas afirmacoes so podem ser publicadas apos evidencias formais externas.

## 5) Risco residual principal

- risco de desalinhamento entre regra implementada e interpretacao oficial externa de conformidade em cenarios limite.

Mitigacao aplicada no repositorio:

- artefactos de auditoria de calculo exportaveis
- checklists de validacao externa
- documentacao rastreavel por modulo
- bloqueios de release sem documentacao minima
