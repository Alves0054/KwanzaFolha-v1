# Fiscalidade Angola - Base Tecnica Atual

## Base legal declarada no motor fiscal

- Lei n. 18/14 (CIRT)
- Lei n. 28/20 (alteracao aplicavel ao regime em vigor)
- regras correntes de INSS: 3% trabalhador e 8% entidade empregadora

Perfil fiscal padrao no codigo:

- `electron/services/core/fiscal/index.js`
- vigencia base: `2020-09`

## Modulos tecnicos de calculo

- IRT: `electron/services/core/irt/irtCalculator.js`
- INSS: `electron/services/core/inss/inssCalculator.js`
- folha/engine: `electron/services/core/payroll/salaryEngine.js`
- faltas/assiduidade: `electron/services/core/payroll/absenceCalculator.js`
- orquestracao de processamento: `electron/services/payroll.js`

## Regras tecnicas aplicadas

- salario bruto: salario base + subsidios + bonus + horas extra
- desconto por falta/licenca sem vencimento: base diaria * dias
- base de INSS e IRT derivada da composicao fiscal dos itens
- INSS funcionario e INSS empresa aplicados por taxa
- IRT progressivo por escaloes configurados no perfil fiscal ativo
- salario liquido calculado apos deducoes legais e deducoes de assiduidade

## Auditoria tecnica de calculo

- cada processamento grava `summary_json` em `payroll_runs`
- exportacao rastreavel de auditoria de calculo:
  - `DatabaseService.exportPayrollCalculationAudit`
  - saida JSON + CSV em pasta de auditoria

## Itens de validacao externa pendente

- validacao formal contabilistica/fiscal do output em ambiente real
- validacao final de layouts/formato bancario PS2/PSX com bancos
- validacao operacional externa de entrega AGT

Ver checklist: `docs/validacao-externa-pendente/CHECKLIST_VALIDACAO_EXTERNA.md`
