# Manual de Utilizacao do Kwanza Folha

Versao do manual: 1.0.8  
Produto: Kwanza Folha  
Publico-alvo: administradores, RH, financeiro, gestores e operadores autorizados.

> Nota importante: este manual explica como utilizar o sistema. A validação final dos cálculos fiscais, contratos, documentos laborais e ficheiros bancários deve ser feita por contabilista certificado, jurista/advogado e banco/parceiro financeiro antes de uso comercial definitivo.

## 1. Visao Geral

O Kwanza Folha e uma aplicação desktop para gestao de Recursos Humanos, folha salarial e obrigacoes laborais em Angola. O sistema trabalha localmente, funciona offline e guarda os dados no computador/ambiente instalado.

Principais áreas:

- Organizacao: empresas, filiais, departamentos, cargos e centros de custo.
- Suite RH: contratos, documentos, aprovacoes, recrutamento, desempenho, formacao, mapas fiscais e sincronizacao futura.
- RH 360: tarefas, processos, compliance, anexos e acompanhamento geral de RH.
- Funcionários: cadastro pessoal, profissional, fiscal, social e bancario.
- Movimentos: assiduidade, faltas, atrasos, férias, licenças, eventos salariais, emprestimos e adiantamentos.
- Folha Salarial: processamento mensal, revisão, fecho, recibos e custos.
- Pagamento ao Estado: IRT, INSS e mapas fiscais.
- Relatórios: PDFs, Excel e documentos de gestao.
- Utilizador: conta pessoal, senha e utilizadores.
- Auditoria: histórico de alterações e rastreabilidade.
- Configurações: fiscalidade, turnos, escalas salariais, backups, licenciamento e atualizações.

## 2. Instalacao e Atualizacao

### 2.1 Instalar pela primeira vez

1. Execute o instalador `KwanzaFolha-Setup-1.0.2.exe`.
2. Escolha a pasta de instalação quando solicitado.
3. Conclua a instalação.
4. Abra o Kwanza Folha pelo atalho criado.
5. Se for a primeira instalação, o sistema abre o registo inicial da empresa.

### 2.2 Atualizar por cima de uma versao existente

1. Feche o Kwanza Folha antes de atualizar.
2. Execute o novo instalador.
3. Instale por cima da versao anterior.
4. Abra novamente o aplicativo.

Ao atualizar, o programa e substituido, mas os dados do cliente devem ser preservados. A atualização não reinicia o período gratuito, não apaga funcionários e não limpa a licença.

### 2.3 Dados antigos

O sistema preserva:

- Empresa configurada.
- Utilizadores.
- Funcionários.
- Salarios processados.
- Recibos/documentos gerados.
- Backups.
- Licença local.
- Inicio e fim do período gratuito.

Se ja existirem utilizadores, a tela correta deve ser **Iniciar sessão**, não **Registar empresa**.

## 3. Licenciamento e Período Gratuito

### 3.1 Período gratuito de 15 dias

Na primeira configuração real da empresa, o Kwanza Folha inicia um período gratuito de 15 dias.

Durante o período gratuito:

- O utilizador pode entrar no sistema.
- Pode configurar empresa e funcionários.
- Pode testar a folha e relatórios.
- Pode validar se o produto serve para o cliente.

O período gratuito não deve reiniciar ao reinstalar ou atualizar.

### 3.2 Licença ativa

Se o cliente ja tiver uma licença:

1. Inicie sessão.
2. Aceda ao centro de licenciamento quando solicitado.
3. Insira o e-mail e serial recebido.
4. Ative a licença.

### 3.3 Licença ou trial expirado

Quando o período gratuito ou a licença termina:

- Os dados não sao apagados.
- O cliente deve conseguir iniciar sessão.
- As operações comerciais ficam limitadas ate renovar/ativar.
- A tela de licenciamento aparece depois da autenticacao, para o cliente provar que tem acesso ao sistema.

## 4. Primeiro Acesso

### 4.1 Registo inicial da empresa

Use apenas quando não existe configuração anterior.

1. Abra o Kwanza Folha.
2. Clique em **Registar empresa**.
3. Preencha:
   - Nome da empresa.
   - NIF.
   - E-mail.
   - Contacto telefonico.
   - Morada.
   - Nome do administrador.
   - E-mail do administrador.
   - Utilizador.
   - Palavra-passe.
4. Clique em **Concluir registo inicial**.

Depois disso o sistema cria o primeiro administrador.

### 4.2 Iniciar sessão

1. Abra o Kwanza Folha.
2. Escolha **Iniciar sessão**.
3. Informe o utilizador ou e-mail.
4. Informe a palavra-passe.
5. Clique em **Entrar no sistema**.

Se o computador ja tiver dados antigos, use este caminho. Não crie nova empresa se o cliente ja tinha dados.

### 4.3 Recuperar acesso

Na tela de login:

1. Preencha o campo **Recuperar acesso por e-mail**.
2. Clique em **Enviar codigo de redefinicao**.
3. Insira o codigo recebido.
4. Defina a nova palavra-passe.
5. Confirme a nova palavra-passe.
6. Clique em **Concluir redefinicao**.

## 5. Dashboard

O Dashboard mostra a visão executiva do mês.

Use para acompanhar:

- Total de funcionários.
- Folha iliquida.
- Liquido pago.
- Encargos totais.
- Media salarial.
- Assiduidade do mês.
- Alertas de documentos.
- Funcionários sem turno.
- Funcionários sem codigo biometrico/cartão.
- Conflitos entre férias, licenças e assiduidade.
- Períodos por fechar.
- Mes ainda não processado.

Como usar:

1. Abra **Dashboard**.
2. Escolha o mês no topo da aplicação.
3. Veja os indicadores.
4. Clique nas acoes dos alertas para ir ao modulo correto.

Recomendação: antes de processar a folha, confirme todos os alertas do Dashboard.

## 6. Organizacao

Módulo para estruturar a empresa.

### 6.1 Empresas

Use para cadastrar dados empresariais usados em recibos, relatórios e organizacao.

Campos comuns:

- Nome.
- NIF.
- Morada.
- Contactos.
- E-mail.
- Logotipo.
- Regime fiscal.
- Estado ativo/inativo.

Como criar:

1. Abra **Organizacao**.
2. Escolha **Empresas**.
3. Preencha os dados.
4. Clique em **Guardar**.

### 6.2 Filiais

Use quando a empresa tem mais de uma unidade/localizacao.

Como criar:

1. Abra **Organizacao**.
2. Escolha **Filiais**.
3. Selecione a empresa.
4. Preencha nome, codigo, morada, responsavel e contactos.
5. Guarde.

### 6.3 Departamentos

Use para organizar funcionários por área.

Exemplos:

- Recursos Humanos.
- Financeiro.
- Comercial.
- Operacoes.
- Administracao.

Como criar:

1. Abra **Organizacao**.
2. Escolha **Departamentos**.
3. Selecione empresa e filial, se aplicável.
4. Indique nome, codigo, responsavel e centro de custo.
5. Guarde.

### 6.4 Cargos

Use para definir funcoes e categorias profissionais.

Campos:

- Nome do cargo.
- Departamento.
- Categoria profissional.
- Salário base sugerido.
- Nivel hierarquico.
- Descricao.
- Estado.

### 6.5 Centros de custo

Use para relatórios de custos por área/projeto.

Exemplos:

- CC-RH.
- CC-COMERCIAL.
- CC-OPERACOES.

Regras importantes:

- Registos usados por funcionários não devem ser apagados.
- Quando ja existirem dados, prefira desativar em vez de remover.
- Relatórios por empresa, filial, departamento, cargo e centro de custo dependem desta configuração.

## 7. Funcionários

Módulo central para cadastro dos trabalhadores.

### 7.1 Criar funcionário

1. Abra **Funcionários**.
2. Preencha os dados pessoais.
3. Preencha os dados profissionais.
4. Preencha os dados bancários.
5. Preencha os dados fiscais e sociais.
6. Clique em **Guardar**.

Dados pessoais:

- Nome completo.
- Tipo de documento.
- BI/passaporte/carta, conforme configuração.
- NIF.
- INSS.
- Data de nascimento.
- Genero.
- Estado civil.
- Nacionalidade.
- Telefone.
- E-mail.
- Morada.
- Contacto de emergencia.

Dados profissionais:

- Empresa.
- Filial.
- Departamento.
- Cargo.
- Supervisor.
- Data de admissao.
- Tipo de contrato.
- Estado.
- Regime de trabalho.
- Horario/turno.
- Categoria profissional.

Dados bancários:

- Banco.
- IBAN/NIB.
- Conta.
- Titular da conta.
- Forma de pagamento.

Dados fiscais/sociais:

- NIF.
- Numero INSS.
- Regime de contribuicao.
- Dependentes.
- Isencoes.

### 7.2 Editar funcionário

1. Abra **Funcionários**.
2. Localize o funcionário na lista.
3. Clique em **Editar**.
4. Altere os campos necessarios.
5. Guarde.

Alteracoes relevantes devem ficar registadas em auditoria.

### 7.3 Remover funcionário

Use com cuidado.

Se o funcionário tiver folha salarial, documentos ou histórico associado, o sistema deve bloquear a eliminação. Nestes casos, altere o estado para inativo, demitido ou suspenso.

### 7.4 Importar funcionários por Excel

1. Abra **Suite RH**.
2. Na área de operações, escolha o ficheiro de funcionários.
3. Importe o ficheiro.
4. Revise o resultado da importação.
5. Corrija erros de BI, NIF, INSS, IBAN ou campos obrigatorios.

Recomendação: antes de importar, use uma lista limpa com colunas como nome, documento, NIF, INSS, cargo, departamento, salario, contrato, admissao, IBAN, banco e estado.

### 7.5 Exportar funcionários

1. Abra **Suite RH** ou **Funcionários**.
2. Clique em **Exportar funcionários**.
3. Guarde o ficheiro Excel gerado.

Use esta exportação para revisão interna, auditoria ou validação antes da folha.

## 8. Suite RH

Módulo empresarial avancado.

### 8.1 Contratos

Use para registar e acompanhar contratos.

Campos:

- Funcionário.
- Tipo de contrato.
- Data de inicio.
- Data de fim.
- Fim do período de experiencia.
- Salario contratual.
- Estado.
- Observacoes.

Como criar:

1. Abra **Suite RH**.
2. Escolha **Contratos**.
3. Selecione o funcionário.
4. Preencha tipo, datas, salario e estado.
5. Clique em **Guardar**.

Acoes:

- Editar contrato.
- Renovar contrato.
- Terminar contrato.
- Gerar documento com base em modelo.

### 8.2 Alertas de contratos

Mostra contratos:

- A vencer.
- Expirados.
- Com período experimental proximo do fim.

Use para agir antes do vencimento.

### 8.3 Modelos de documentos

Use para criar textos editaveis de contratos e declaracoes.

Exemplo de variaveis:

- `{{company.name}}`
- `{{employee.full_name}}`

Como usar:

1. Abra **Suite RH**.
2. Escolha **Modelos**.
3. Crie o nome e corpo do modelo.
4. Guarde.
5. Use o modelo para gerar documentos.

### 8.4 Documentos gerados

Mostra documentos criados pelo sistema.

Use para:

- Conferir documentos.
- Manter histórico por funcionário.
- Validar emissao de contratos/declaracoes.

### 8.5 Fluxos de aprovação

Use para configurar processos de aprovação.

Exemplos:

- Ferias.
- Faltas.
- Folha salarial.
- Documentos.
- Alteracoes contratuais.

Como usar:

1. Abra **Suite RH**.
2. Escolha **Fluxos de aprovação**.
3. Defina modulo, nome e etapas.
4. Guarde.

### 8.6 Pedidos de aprovação

Use para criar pedidos que precisam de aprovação.

Como usar:

1. Abra **Pedidos**.
2. Crie o pedido.
3. Indique modulo, entidade, ID e motivo.
4. Guarde.
5. Um responsavel pode aprovar, rejeitar ou reabrir.

### 8.7 Historico de aprovacoes

Mostra eventos de aprovação.

Use para auditoria:

- Quem aprovou.
- Quem rejeitou.
- Quando aconteceu.
- Qual pedido foi afetado.

### 8.8 Vagas

Use para gerir recrutamento.

Campos:

- Titulo.
- Descricao.
- Estado: Aberto ou Fechado.
- Numero de vagas.
- Data de abertura.

Como criar vaga:

1. Abra **Suite RH**.
2. Escolha **Vagas**.
3. Preencha o titulo.
4. Marque **Aberto**.
5. Indique numero de vagas.
6. Guarde.

Como fechar vaga:

1. Abra **Vagas**.
2. Clique em **Fechar** na vaga.

### 8.9 Candidatos

E aqui que se faz a inscricao de candidatos.

Como registar candidato:

1. Abra **Suite RH**.
2. Escolha **Vagas**.
3. Clique em **Inscrever candidato** na vaga pretendida.
4. O sistema abre o modulo **Candidatos**.
5. Preencha:
   - Vaga.
   - Nome do candidato.
   - E-mail.
   - Telefone.
   - Estado: novo, triagem, entrevista, contratado, convertido, etc.
   - Notas.
6. Clique em **Guardar**.

Tambem pode abrir diretamente **Candidatos** e escolher a vaga manualmente.

### 8.10 Converter candidato em funcionário

1. Abra **Candidatos**.
2. Selecione o candidato.
3. Clique em **Converter**.
4. Preencha dados necessarios:
   - BI/documento.
   - NIF.
   - INSS.
   - Salário base.
   - Data de admissao.
   - IBAN/banco/conta.
   - Tipo de contrato.
5. Confirme.

O sistema cria o funcionário e pode gerar contrato/onboarding conforme configuração.

### 8.11 Onboarding

Use para acompanhar entrada de novos colaboradores.

Exemplos de checklist:

- Contrato assinado.
- Documentos entregues.
- Equipamento entregue.
- E-mail criado.
- Formação inicial.

### 8.12 Offboarding

Use para acompanhar saidas.

Campos:

- Funcionário.
- Tipo de saida.
- Estado.
- Data de saida.
- Notas.
- Checklist de devolucao.

Use para garantir que acessos, equipamentos e documentos finais foram tratados.

### 8.13 Desempenho

Use para avaliações mensais, trimestrais ou anuais.

Campos:

- Funcionário.
- Período.
- Tipo de avaliacao.
- Pontuacao.
- Estado.
- Feedback.
- Plano de melhoria.

### 8.14 Formação

Use para registar cursos e capacitacoes.

Campos de curso:

- Titulo.
- Fornecedor.
- Tipo: interna ou externa.
- Data de inicio.
- Data de fim.
- Custo.
- Estado.
- Notas.

Participantes:

1. Crie a formacao.
2. Abra **Participantes**.
3. Escolha o curso.
4. Escolha o funcionário.
5. Indique presença e avaliacao.

### 8.15 Sincronizacao futura

Mostra eventos locais preparados para futura sincronizacao online.

Estados comuns:

- Pendente.
- Sincronizado.
- Falhado.

Use apenas para controlo tecnico/administrativo. A sincronizacao online completa deve ser validada antes de uso em produção.

### 8.16 Versoes da folha

Use para guardar snapshots da folha mensal.

Como usar:

1. Processe a folha.
2. Abra **Suite RH**.
3. Escolha **Versoes da folha**.
4. Crie uma versao/snapshot.
5. Compare versoes quando houver reprocessamento.

### 8.17 Mapas fiscais

Use para consolidar mapas mensais de IRT, INSS e AGT.

Estados:

- Pendente.
- Submetido.
- Aceite.
- Rejeitado.

Importante: não declarar como homologado pela AGT. Validar sempre com contabilista certificado.

## 9. RH 360

Módulo para tarefas e processos gerais de RH.

Use para:

- Processos internos.
- Compliance laboral.
- Acompanhamento de documentos.
- Tarefas administrativas.
- Anexos de suporte.
- Exportacao Excel.

Como criar item:

1. Abra **RH 360**.
2. Preencha área, titulo, responsavel, prioridade e estado.
3. Defina data limite.
4. Anexe documento, se necessario.
5. Guarde.

Como abrir anexo:

1. Localize o item.
2. Clique em abrir anexo.

Como exportar:

1. Abra **RH 360**.
2. Use **Exportar Excel**.

## 10. Movimentos

Módulo para registos mensais que afetam a folha.

### 10.1 Assiduidade manual

Use para registar presença, falta, atraso, licença ou férias.

Passos:

1. Abra **Movimentos**.
2. Escolha o funcionário.
3. Escolha a data.
4. Selecione o estado.
5. Preencha entrada, saida, horas trabalhadas e atrasos quando aplicável.
6. Guarde.

Estados:

- Presente.
- Atraso.
- Falta.
- Meia falta.
- Licença.
- Ferias.

### 10.2 Importacao de assiduidade

Use para importar ponto de Excel/ficheiro.

1. Abra **Movimentos**.
2. Escolha o ficheiro.
3. Indique perfil do equipamento, se existir.
4. Importe.
5. Revise logs de importação.

Recomendação: confirme códigos biometricos/cartão em cada funcionário antes de importar.

### 10.3 Fechar assiduidade

Antes de processar folha:

1. Revise presenças, faltas e atrasos.
2. Corrija conflitos.
3. Feche o período de assiduidade.

Depois de fechado, o período fica protegido para processamento.

### 10.4 Reabrir assiduidade

Use apenas se houver erro.

1. Abra o mês.
2. Clique para reabrir assiduidade.
3. Corrija os registos.
4. Feche novamente.

### 10.5 Eventos salariais

Use para abonos, bonus, subsídios ou descontos pontuais.

Exemplos:

- Bonus.
- Premio.
- Subsídio.
- Desconto eventual.

### 10.6 Faltas, licenças e ausências

Use para registar ausências justificadas e injustificadas.

Tipos:

- Falta injustificada.
- Ausencia justificada.
- Licença com vencimento.
- Licença sem vencimento.
- Baixa medica.
- Maternidade.
- Paternidade.
- Licença familiar.

Regra: faltas injustificadas e licenças sem vencimento podem afetar a folha salarial.

### 10.7 Ferias

Use para gerir saldo e pedidos.

Como registar saldo:

1. Escolha funcionário.
2. Escolha ano.
3. Informe direito anual.
4. Guarde.

Como solicitar/aprovar férias:

1. Escolha funcionário.
2. Indique ano, inicio e fim.
3. Grave o pedido.
4. Aprove, rejeite ou marque como gozado.

O sistema deve impedir férias acima do saldo, salvo autorização/regra definida.

### 10.8 Emprestimos e adiantamentos

Use para descontos automaticos na folha.

Adiantamento:

1. Escolha funcionário.
2. Indique valor, mês e motivo.
3. Guarde.

Emprestimo:

1. Escolha funcionário.
2. Indique valor total.
3. Indique numero de prestacoes.
4. Indique valor mensal e mês inicial.
5. Guarde.

O sistema inclui a prestacao/desconto no processamento mensal conforme o calendario.

## 11. Historico

Módulo de consulta consolidada.

Use para ver:

- Assiduidade.
- Ferias.
- Licenças.
- Documentos laborais.
- Historico administrativo.
- Filtros por funcionário, mês, data e estado.

Como usar:

1. Abra **Historico**.
2. Escolha a aba desejada.
3. Filtre por funcionário ou período.
4. Consulte os registos.

### Documentos laborais

Use para anexar:

- Contratos.
- Declaracoes.
- BI/passaporte.
- Certificados.
- Documentos fiscais.
- Comprovativos.

O sistema alerta documentos vencidos ou proximos de vencer.

## 12. Folha Salarial

Módulo de processamento mensal.

### 12.1 Antes de processar

Confirmar:

- Empresa configurada.
- Funcionários ativos.
- Salarios base.
- IBAN/banco/conta.
- Assiduidade revista.
- Assiduidade fechada.
- Ferias/licenças aprovadas.
- Emprestimos/adiantamentos registados.
- Tabela fiscal correta.

### 12.2 Processar folha

1. Abra **Folha Salarial**.
2. Escolha o mês.
3. Clique em processar.
4. Aguarde o calculo.
5. Revise bruto, descontos, INSS, IRT e liquido.

### 12.3 Rever resultado

Verifique por funcionário:

- Salário base.
- Subsídios.
- Bonus.
- Horas extra.
- Faltas.
- Atrasos.
- INSS trabalhador.
- IRT.
- Emprestimos.
- Adiantamentos.
- Liquido.

### 12.4 Reprocessar

Use quando houve correção antes do fecho.

1. Corrija o dado origem.
2. Reprocesse o mês.
3. Crie versao da folha para auditoria, se aplicável.

### 12.5 Fechar período

Depois de validar:

1. Feche a folha.
2. Gere recibos.
3. Gere relatórios.
4. Guarde backup.

Folha fechada não deve ser alterada sem autorização e auditoria.

### 12.6 Remover processamento

Use apenas quando o mês ainda não estiver fechado ou quando houver autorização para reprocessamento.

## 13. Pagamento ao Estado

Módulo para mapas fiscais e contribuicoes.

Use para:

- Consolidar IRT.
- Consolidar INSS.
- Preparar mapas mensais.
- Validar totais por funcionário.
- Guardar estados de submissão.

Como usar:

1. Abra **Pagamento ao Estado**.
2. Escolha o mês.
3. Revise totais.
4. Gere/exporte mapas.
5. Atualize estado de submissão quando aplicável.

Estados recomendados:

- Pendente.
- Submetido.
- Aceite.
- Rejeitado.

Importante: os mapas devem ser validados por contabilista certificado antes de submissão oficial.

## 14. Relatórios

Módulo para gerar documentos PDF/Excel.

Relatórios disponiveis:

- Relatório mensal de salários.
- Relatório anual de salários.
- Relatório anual de IRT.
- Relatório anual de INSS.
- Relatório de faltas.
- Relatório de presenças.
- Relatório de descontos.
- Relatório por funcionário.
- Recibos.
- Mapas e documentos fiscais.

Como gerar:

1. Abra **Relatórios**.
2. Escolha período.
3. Selecione funcionário, se aplicável.
4. Escolha o tipo de relatório.
5. Clique para gerar.
6. Abra o ficheiro criado.

Recomendação: gere relatórios apenas depois de validar a folha do mês.

## 15. Utilizador

Módulo para conta pessoal e gestao de acessos.

### 15.1 Alterar palavra-passe

1. Abra **Utilizador**.
2. Preencha senha atual.
3. Defina nova senha.
4. Confirme.
5. Guarde.

### 15.2 Gerir utilizadores

Disponivel para perfis autorizados.

Use para:

- Criar utilizadores.
- Editar utilizadores.
- Desativar utilizadores.
- Redefinir senha.
- Definir perfil.

Perfis comuns:

- Administrador.
- Operador.
- RH.
- Financeiro.
- Gestor.
- Auditor.

Nota: nem todos os perfis podem ver configuracoes, auditoria ou salários, conforme permissao.

## 16. Auditoria

Módulo de rastreabilidade.

Mostra:

- Quem criou.
- Quem editou.
- Quem removeu.
- Data e hora.
- Módulo afetado.
- Valores antigos e novos, quando disponivel.
- Motivo/observacao, quando aplicável.

Como usar:

1. Abra **Auditoria**.
2. Filtre por utilizador, acao, período ou texto.
3. Consulte o histórico.
4. Exporte CSV quando necessario.

Use auditoria para investigar alterações salariais, fiscais, contratuais, documentais e de acesso.

## 17. Configurações

Disponivel para administradores.

### 17.1 Sistema e fiscalidade

Configure:

- Moeda.
- INSS do funcionário.
- INSS da empresa.
- Mes de subsídio de férias.
- Mes de subsídio de Natal/13o, se usado.
- Perfis fiscais.
- Tabela IRT.
- Observacoes legais.

Regra: alterações fiscais devem ser versionadas e validadas antes de processar meses oficiais.

### 17.2 Perfis fiscais

Use para separar regras por ano/mês.

Campos:

- Nome do perfil.
- Vigencia.
- Referencia legal.
- Notas.
- Tabela IRT.
- INSS trabalhador.
- INSS empresa.

Antes de alterar fiscalidade:

1. Confirme fonte legal.
2. Crie perfil/versionamento.
3. Teste cálculos.
4. Valide com contabilista.

### 17.3 Escalas salariais

Use para definir limites por cargo/departamento.

Campos:

- Cargo.
- Departamento.
- Salario minimo.
- Salario maximo.

O sistema pode alertar quando um funcionário fica fora da escala.

### 17.4 Turnos e horarios

Use para controlar assiduidade.

Campos:

- Nome do turno.
- Hora de entrada.
- Hora de saida.
- Minutos de intervalo.
- Tolerancia de atraso.
- Dias de trabalho.
- Perfil.

Depois de criar, atribua o turno ao funcionário.

### 17.5 Integracao de assiduidade

Configure:

- Pasta monitorizada.
- Perfil do equipamento.
- Mapeamento de colunas.

Use para preparar importação de relogios biometricos/cartão.

### 17.6 Backups

Use para proteger dados.

Backup manual:

1. Abra **Configurações**.
2. Clique em gerar backup.
3. Confirme o ficheiro criado.

Restauro:

1. Garanta que tem copia valida.
2. Abra **Configurações**.
3. Escolha restaurar backup.
4. Reinicie o aplicativo.

Recomendação: fazer backup antes de atualizações, antes do fecho mensal e no fim de cada mês.

### 17.7 Licenciamento

Mostra:

- Estado da licença.
- Plano.
- Serial mascarado.
- Validade.
- Período gratuito.
- Acesso ao centro de licenciamento.

Use para ativar, renovar ou regularizar.

### 17.8 Atualizacoes

Use para:

- Verificar nova versao.
- Descarregar atualização.
- Instalar atualização.

Antes de atualizar:

1. Feche a folha se necessario.
2. Gere backup.
3. Feche o aplicativo.
4. Execute o instalador.

## 18. Fluxo Mensal Recomendado

1. Atualizar dados de funcionários.
2. Confirmar contratos e documentos.
3. Registar férias, licenças, faltas e atrasos.
4. Importar/validar assiduidade.
5. Fechar assiduidade.
6. Registar bonus, descontos, emprestimos e adiantamentos.
7. Processar folha.
8. Rever cálculos por funcionário.
9. Criar versao da folha, se aplicável.
10. Fechar período.
11. Gerar recibos.
12. Gerar mapas de IRT/INSS.
13. Exportar relatórios.
14. Fazer backup.
15. Arquivar documentos e comprovativos.

## 19. Fluxo de Recrutamento Recomendado

1. Criar vaga em **Suite RH > Vagas**.
2. Marcar vaga como **Aberto**.
3. Clicar em **Inscrever candidato**.
4. Registar candidato em **Candidatos**.
5. Atualizar estado: novo, triagem, entrevista, contratado.
6. Converter candidato aprovado em funcionário.
7. Criar contrato.
8. Criar onboarding.
9. Acompanhar checklist de entrada.

## 20. Fluxo de Saída de Funcionário

1. Confirmar tipo de saida.
2. Criar processo em **Offboarding**.
3. Registar data de saida.
4. Rever férias pendentes.
5. Rever salários e descontos finais.
6. Confirmar devolucao de equipamentos.
7. Cancelar acessos.
8. Emitir documentos finais.
9. Alterar estado do funcionário.
10. Guardar auditoria e backup.

## 21. Boas Praticas

- Não reutilizar o registo inicial quando ja existe empresa criada.
- Fazer login com utilizador existente quando reinstalar ou atualizar.
- Não apagar funcionários com histórico salarial.
- Usar inativo/demitido em vez de remover.
- Fechar assiduidade antes de processar folha.
- Fazer backup antes de alterar fiscalidade.
- Validar IRT/INSS com contabilista.
- Validar contratos/documentos com jurista.
- Validar ficheiros bancários com o banco.
- Guardar comprovativos de submissão fiscal.
- Revisar auditoria em alterações sensiveis.

## 22. Problemas Comuns

### A aplicação pede registo de empresa, mas ja havia dados

Verifique se esta a usar o instalador mais recente. Se existirem utilizadores antigos, a aplicação deve permitir **Iniciar sessão**. Não crie nova empresa sem confirmar backup/dados.

### Licença expirada

Inicie sessão e ative/renove a licença. A expiracao não apaga dados.

### Trial expirado

Inicie sessão e regularize a licença. Reinstalar não renova o trial.

### Funcionários não aparecem na folha

Confirme:

- Estado ativo.
- Data de admissao.
- Salário base.
- Assiduidade do mês.
- Período correto.

### IRT divergente

Confirme:

- Perfil fiscal aplicado.
- Mes de vigencia.
- Verbas tributaveis.
- INSS deduzido.
- Tabela validada por contabilista.

### IBAN invalido

Revise:

- Banco.
- IBAN/NIB.
- Conta.
- Titular.

### PDF ou relatório incompleto

Confirme:

- Dados da empresa.
- Funcionários processados.
- Período correto.
- Pasta de destino com permissao de escrita.

## 23. Responsabilidades de Validacao

Antes de entregar a clientes finais:

- Contabilista certificado deve validar IRT, INSS e mapas fiscais.
- Jurista/advogado deve validar contrato de licença, termos, politica de privacidade, contratos e documentos laborais.
- Banco deve validar exportacoes PS2/PSX ou formato bancario usado.
- Cliente deve aprovar testes em maquina limpa.
- Responsavel tecnico deve validar instalador, checksum e backup/restauro.

## 24. Suporte

Ao pedir suporte, informe:

- Versao da aplicação.
- Sistema operativo.
- Caminho do instalador usado.
- Mensagem de erro.
- Módulo afetado.
- Mes/processamento afetado.
- Se havia dados antigos.
- Se houve atualização recente.
- Bundle de diagnostico, quando solicitado.

## 25. Checklist Rapido de Entrega ao Cliente

- Instalador testado.
- Login testado.
- Trial/licença testado.
- Empresa configurada.
- Funcionários importados/cadastrados.
- Assiduidade validada.
- Folha processada em teste.
- Recibos gerados.
- Relatórios exportados.
- Backup criado.
- IRT/INSS validado por contabilista.
- Documentos legais revistos por advogado.
- Cliente treinado com este manual.
