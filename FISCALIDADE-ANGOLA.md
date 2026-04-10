# Fiscalidade Angola

## Base legal aplicada no motor fiscal

O motor fiscal do **Kwanza Folha** passa a assumir como base legal ativa:

- **Lei n.º 18/14** - Código do Imposto sobre o Rendimento do Trabalho (IRT)
- **Lei n.º 28/20** - alteração ao Código do IRT
- comunicação oficial da **AGT** indicando que os rendimentos de trabalho realizados **a partir de 1 de Setembro de 2020** passam a ser tributados nos termos da Lei n.º 28/20
- regras operacionais correntes de **INSS** usadas pelo sistema: **3% trabalhador** e **8% entidade empregadora**

## Regras implementadas

- Salário bruto = salário base + subsídios + horas extras + prémios
- INSS do trabalhador = 3% da base sujeita
- INSS da empresa = 8% da base sujeita
- IRT calculado por tabela progressiva do Grupo A
- Isenção de IRT até **100.000 Kz**
- Desconto por falta = salário base / 30 x número de faltas
- Horas extras normais = 50%
- Horas extras em feriado ou descanso semanal = 100%
- Subsídio de férias = salário base
- Subsídio de Natal (13.º) = salário base

## Estrutura técnica

O cálculo fiscal foi organizado em módulos dedicados:

- [electron/services/core/fiscal/index.js](C:/Users/nunes/Documents/Pagamentos/electron/services/core/fiscal/index.js)
- [electron/services/core/irt/irtCalculator.js](C:/Users/nunes/Documents/Pagamentos/electron/services/core/irt/irtCalculator.js)
- [electron/services/core/inss/inssCalculator.js](C:/Users/nunes/Documents/Pagamentos/electron/services/core/inss/inssCalculator.js)
- [electron/services/core/payroll/salaryEngine.js](C:/Users/nunes/Documents/Pagamentos/electron/services/core/payroll/salaryEngine.js)
- [electron/services/core/payroll/absenceCalculator.js](C:/Users/nunes/Documents/Pagamentos/electron/services/core/payroll/absenceCalculator.js)

## Regras removidas

O sistema deixa de considerar regras fiscais legadas anteriores ao regime atualmente em vigor.

## Observação operacional

O perfil fiscal padrão do sistema entra em vigor em **2020-09**, para alinhar o motor com a aplicação da Lei n.º 28/20 aos rendimentos do Grupo A.
