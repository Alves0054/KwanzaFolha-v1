# Maintenance Refactor Report

Data: 2026-04-22

## Extracoes/modulos introduzidos nesta ronda

- `electron/services/core/db/domains/payroll-audit.js`
  - extrai montagem de artefacto de auditoria de calculo de folha
  - reduz responsabilidade direta no `database.js` para formatacao/trace
- `electron/services/support-diagnostics.js`
  - centraliza eventos operacionais estruturados, crash reports e export de bundle de suporte
- `shared/domain/payroll-constants.js`
  - remove numeros magicos de calculo (divisor de horas extra e faltas)

## Ganhos de organizacao

- trilha de auditoria de calculo separada por dominio
- observabilidade operacional desacoplada do `main.js` para funcoes de suporte
- constantes de negocio compartilhadas e reutilizadas entre modulos de payroll
- pipeline com validacao de release preflight e packaged integrada

## Riscos remanescentes

- `electron/services/database.js` ainda concentra muitas responsabilidades
- `electron/main.js` ainda possui alto volume de IPC em ficheiro unico
- `electron/services/pdf.js` permanece grande e com alta densidade de layout
- `licensing-server/server.js` ainda agrega HTTP, regras de negocio e render admin

## Proxima divisao recomendada (incremental)

- separar `database.js` por write paths restantes (payroll runs, financial, leave/vacation)
- extrair registry de IPC de `main.js` para modulos por dominio
- extrair camada de templates/layout de `pdf.js` para modulo dedicado
- extrair handlers HTTP por dominio no licensing server (`payments`, `installations`, `admin`)
