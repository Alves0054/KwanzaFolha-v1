# Calculo Tecnico da Folha (Rastreavel por Modulo)

## Modulos de referencia no codigo

- folha salarial: `electron/services/payroll.js`
- engine de salario: `electron/services/core/payroll/salaryEngine.js`
- faltas/assiduidade: `electron/services/core/payroll/absenceCalculator.js`
- IRT: `electron/services/core/irt/irtCalculator.js`
- INSS: `electron/services/core/inss/inssCalculator.js`
- perfil fiscal vigente: `electron/services/core/fiscal/index.js`
- validacao AGT: `electron/services/database.js` (`buildAgtMonthlyRemunerationMap`)

## Formula base do processamento mensal

- `gross_salary = base_salary + allowances_total + bonuses_total + overtime_total`
- `attendance_deduction = daily_rate * (absence_days + leave_days)`
- `social_security_base = soma dos itens sujeitos a INSS`
- `employee_inss = social_security_base * employee_rate / 100`
- `employer_inss = social_security_base * employer_rate / 100`
- `taxable_base = max(irt_base_before_social_security - employee_inss, 0)`
- `irt = fixed + (taxable_base - bracket_min) * bracket_rate`
- `mandatory_deductions = employee_inss + irt + penalties + financial_deductions`
- `total_deductions = mandatory_deductions + attendance_deduction`
- `net_salary = gross_salary - total_deductions`

## Regras de arredondamento

- arredondamento central: `roundCurrency(value)` com 2 casas decimais
- aplicado em totais, deducoes, bases e liquido

## Rastreabilidade por processamento

- cada `payroll_run` guarda `summary_json` com:
  - bases legais
  - perfil fiscal usado
  - totais de deducoes
  - decomposicao de componentes da remuneracao
- auditoria de calculo exportavel:
  - `DatabaseService.exportPayrollCalculationAudit`
  - saidas JSON e CSV em pasta de auditoria

## Fecho de periodo

- periodo fechado bloqueia alteracao sem reabertura/autorizacao
- reprocessamento de periodo fechado exige motivo explicito

## Mapas e exportacoes

- mapa AGT: validacao de NIF/NISS/BI + consistencia de bases IRT/INSS
- exportacoes PS2/PSX: exigem banco e conta de origem da empresa configurados
- formatos PS2/PSX exigem validacao externa por banco para certificacao operacional
