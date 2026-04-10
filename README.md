# Kwanza Folha

O **Kwanza Folha** é um aplicativo desktop de gestão de folha salarial, assiduidade e documentação laboral, desenvolvido para empresas em Angola que precisam de um sistema local, estável e profissional para processar salários, emitir documentos e controlar operações de RH.

O sistema foi concebido para funcionar em ambiente Windows, com base de dados local em SQLite, interface moderna em React e motor desktop em Electron. O foco principal é dar à empresa controlo operacional, reduzir erros manuais e transformar o processamento salarial num fluxo claro, auditável e pronto para uso empresarial.

O Kwanza Folha foi criado por **Adérito Alves** e pela empresa **Alves Estúdio**.

## Para quem o Kwanza Folha foi criado

O Kwanza Folha é indicado para:

- departamentos de Recursos Humanos
- áreas financeiras e administrativas
- pequenas, médias e grandes empresas
- escolas, centros de formação e instituições com corpo docente
- organizações que precisam de processar salários localmente, sem depender de um servidor externo para a operação principal

## O que o sistema faz

O Kwanza Folha cobre o ciclo completo da operação salarial e de RH da empresa.

### Gestão base da empresa

- configuração institucional da empresa
- logótipo, NIF, contactos e morada
- banco e conta de origem para exportações bancárias oficiais
- gestão de utilizadores e perfis de acesso
- autenticação local
- recuperação de acesso por e-mail

### Cadastro completo do trabalhador

- ficha pessoal do trabalhador
- documento principal com suporte para BI, passaporte ou cartão de estrangeiro
- número da Segurança Social
- contactos, morada, nacionalidade, género e estado civil
- dados laborais
- dados bancários
- número opcional da carta de condução

### Processamento salarial

- processamento mensal da folha
- cálculo automático de IRT
- cálculo automático de Segurança Social
- cálculo de faltas, licenças, horas extra, subsídios e bónus
- tratamento de empréstimos e adiantamentos
- fecho e reabertura de períodos
- bloqueios para impedir alterações indevidas em períodos fechados

### Base fiscal aplicada

- vigência fiscal padrão a partir de **2020-09**
- base legal do IRT: **Lei n.º 18/14** com alteração pela **Lei n.º 28/20**
- cálculo de INSS com **3% trabalhador** e **8% entidade empregadora**
- sem dependência de regras fiscais legadas anteriores ao regime atualmente em vigor

### Assiduidade, férias e ausências

- registo diário de assiduidade
- estados de presença, atraso, falta, meia falta, licença e férias
- importação de assiduidade por ficheiro vindo de biométrico ou leitor de cartão
- sincronização automática por pasta monitorizada
- histórico técnico de importações
- licenças laborais e justificação de ausência
- plano de férias e controlo de saldo anual
- turnos de trabalho e turnos ajustados ao corpo docente

### Relatórios e documentos

- recibo salarial em PDF
- recibos em lote
- relatório mensal de salários
- relatório anual de salários
- relatório por funcionário
- relatório de descontos
- relatório anual do IRT
- relatório anual da Segurança Social
- relatório de faltas
- relatório de presenças
- mapa mensal de turnos por trabalhador
- mapa mensal de turnos por departamento
- mapa docente
- pacote mensal consolidado com os principais documentos do período

### Exportações e operação externa

- exportação Excel
- exportação bancária em CSV
- exportação bancária oficial PS2
- exportação bancária oficial PSX
- separação entre banco de origem da empresa e bancos dos funcionários
- deteção automática do banco do funcionário por IBAN, quando o código bancário é reconhecido

### Segurança, controlo e continuidade

- auditoria de ações
- histórico com antes e depois
- backups
- restauro de backups
- atualizações automáticas por GitHub Releases
- licenciamento com teste grátis, ativação e renovação

## Licenciamento e uso comercial

O Kwanza Folha já está preparado para funcionar como software pago por assinatura.

### Fluxo atual de uso

1. A empresa regista-se no aplicativo.
2. O sistema ativa um período gratuito de **7 dias**.
3. Durante esse período, o utilizador pode usar o sistema normalmente.
4. Quando o período gratuito termina, o aplicativo fica bloqueado até a licença ser ativada ou comprada.
5. A compra e a renovação da licença podem ser iniciadas dentro do próprio aplicativo.

### Plano disponível

- **KwanzaFolha Mensal**: 15.000 Kz por mês
- acesso completo ao sistema
- múltiplos utilizadores dentro da empresa
- validade de 30 dias
- renovação mensal

## Como funciona a operação no dia a dia

O fluxo prático de uso é este:

1. Registar a empresa e o primeiro administrador
2. Configurar a empresa, os bancos e as regras base
3. Cadastrar os trabalhadores
4. Definir turnos, escalas salariais e dados bancários
5. Lançar eventos, faltas, licenças, férias ou assiduidade
6. Processar a folha do mês
7. Rever encargos, descontos e pagamentos ao Estado
8. Emitir recibos, relatórios e mapas
9. Exportar ficheiros bancários
10. Fechar o período
11. Criar backup

## Arquitetura do projeto

O sistema está organizado em duas camadas principais.

### Aplicação desktop

- `Electron` para a camada desktop
- `React` para a interface
- `SQLite` para armazenamento local
- `pdf-lib` para geração de PDFs
- `better-sqlite3` para persistência rápida e local

### Serviços principais

- [electron/main.js](C:/Users/nunes/Documents/Pagamentos/electron/main.js)
- [electron/preload.js](C:/Users/nunes/Documents/Pagamentos/electron/preload.js)
- [electron/services/database.js](C:/Users/nunes/Documents/Pagamentos/electron/services/database.js)
- [electron/services/payroll.js](C:/Users/nunes/Documents/Pagamentos/electron/services/payroll.js)
- [electron/services/core/fiscal/index.js](C:/Users/nunes/Documents/Pagamentos/electron/services/core/fiscal/index.js)
- [electron/services/core/irt/irtCalculator.js](C:/Users/nunes/Documents/Pagamentos/electron/services/core/irt/irtCalculator.js)
- [electron/services/core/inss/inssCalculator.js](C:/Users/nunes/Documents/Pagamentos/electron/services/core/inss/inssCalculator.js)
- [electron/services/core/payroll/salaryEngine.js](C:/Users/nunes/Documents/Pagamentos/electron/services/core/payroll/salaryEngine.js)
- [electron/services/core/payroll/absenceCalculator.js](C:/Users/nunes/Documents/Pagamentos/electron/services/core/payroll/absenceCalculator.js)
- [electron/services/pdf.js](C:/Users/nunes/Documents/Pagamentos/electron/services/pdf.js)
- [electron/services/updater.js](C:/Users/nunes/Documents/Pagamentos/electron/services/updater.js)
- [electron/services/licensing.js](C:/Users/nunes/Documents/Pagamentos/electron/services/licensing.js)
- [electron/services/mailer.js](C:/Users/nunes/Documents/Pagamentos/electron/services/mailer.js)
- [src/App.jsx](C:/Users/nunes/Documents/Pagamentos/src/App.jsx)

### Servidor de licenciamento

O projeto também inclui uma base de servidor de licenciamento:

- [licensing-server/server.js](C:/Users/nunes/Documents/Pagamentos/licensing-server/server.js)

Esse servidor suporta:

- geração de referências de pagamento
- ativação de licença
- renovação
- geração de serial
- envio de e-mails
- emissão de fatura
- painel administrativo de licenças

## Como executar em desenvolvimento

1. Instale o Node.js 20 ou superior.
2. Execute `npm install`.
3. Inicie a aplicação com `npm run dev`.
4. Execute `npm test` para validar a suite automatizada.

## Como gerar builds

### Build padrão

- `npm run build`

### Build separada

- `npm run build:installer`
- `npm run build:portable`

### Build assinada

- `npm run build:signed`
- `npm run build:signed:installer`
- `npm run build:signed:portable`

### Release comercial preparada

- `npm run release:prepare`
- `npm run release:prepare:beta`

Estes comandos executam a suite, exigem assinatura digital valida e geram `SHA256SUMS.txt`, `release-manifest.json` e um rascunho de notas da release em `dist-electron`.

## Estrutura resumida do projeto

- [src](C:/Users/nunes/Documents/Pagamentos/src)
- [electron](C:/Users/nunes/Documents/Pagamentos/electron)
- [shared](C:/Users/nunes/Documents/Pagamentos/shared)
- [tests](C:/Users/nunes/Documents/Pagamentos/tests)
- [build](C:/Users/nunes/Documents/Pagamentos/build)
- [dist-electron](C:/Users/nunes/Documents/Pagamentos/dist-electron)

## Documentação adicional

- [OPERACAO-RAPIDA.md](C:/Users/nunes/Documents/Pagamentos/OPERACAO-RAPIDA.md)
- [FISCALIDADE-ANGOLA.md](C:/Users/nunes/Documents/Pagamentos/FISCALIDADE-ANGOLA.md)
- [RELEASE-CHECKLIST.md](C:/Users/nunes/Documents/Pagamentos/RELEASE-CHECKLIST.md)
- [RELEASE-POLICY.md](C:/Users/nunes/Documents/Pagamentos/RELEASE-POLICY.md)
- [GITHUB-SECRETS-SETUP.md](C:/Users/nunes/Documents/Pagamentos/GITHUB-SECRETS-SETUP.md)

## Saídas geradas pelo sistema

O sistema grava os principais ficheiros operacionais em `Documentos\Kwanza Folha`, incluindo:

- PDFs
- exportações Excel
- exportações bancárias
- backups
- atualizações descarregadas

## Estado atual do produto

O Kwanza Folha já se encontra num estado forte para uso empresarial interno, cobrindo folha salarial, RH operacional, documentação, exportações bancárias e licenciamento.

Os próximos melhoramentos tendem a concentrar-se em:

- maior integração com equipamentos biométricos específicos por fabricante
- mais refinamento visual e institucional
- amadurecimento da área comercial e pública do produto

## Site de apresentação

Foi criada uma área dedicada de apresentação do produto em:

- [site-kwanzafolha](C:/Users/nunes/Documents/Pagamentos/site-kwanzafolha)

Esse material já inclui:

- apresentação do produto
- funcionalidades principais
- planos de assinatura
- explicação do teste grátis de 7 dias
- instruções de pagamento/licenciamento
- botões para descarregar o instalador e a versão portátil
