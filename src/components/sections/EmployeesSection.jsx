import { angolaBanks, extractAngolaBankRegistryCode, inferBankFromIban } from "../../utils/payroll";
import LineItemsEditor from "../form/LineItemsEditor";

function findMatchingSalaryScale(scales, jobTitle, department) {
  const normalizedJobTitle = String(jobTitle || "").trim().toLowerCase();
  const normalizedDepartment = String(department || "").trim().toLowerCase();
  if (!normalizedJobTitle) {
    return null;
  }

  return (
    (scales || []).find(
      (scale) =>
        scale.active &&
        String(scale.job_title || "").trim().toLowerCase() === normalizedJobTitle &&
        String(scale.department || "").trim().toLowerCase() === normalizedDepartment
    ) ||
    (scales || []).find(
      (scale) =>
        scale.active &&
        String(scale.job_title || "").trim().toLowerCase() === normalizedJobTitle &&
        !String(scale.department || "").trim()
    ) ||
    null
  );
}

export default function EmployeesSection({
  employeeForm,
  setEmployeeForm,
  saveEmployee,
  boot,
  user,
  employees,
  employeeFilters,
  setEmployeeFilters,
  formatMoney,
  editEmployee,
  deleteEmployee,
  banks = angolaBanks
}) {
  const matchingScale = findMatchingSalaryScale(boot.salaryScales || [], employeeForm.job_title, employeeForm.department);
  const activeShifts = (boot.workShifts || []).filter((shift) => shift.active);
  const detectedBank = inferBankFromIban(employeeForm.iban, banks);
  const detectedRegistryCode = extractAngolaBankRegistryCode(employeeForm.iban);
  const canManageEmployees = Boolean(user);

  return (
    <section className="two-column">
      <div className="panel">
        <div className="section-heading">
          <h2>Cadastro de Funcionários</h2>
          <p>Ficha completa do trabalhador com dados pessoais, laborais, bancários e controlo de assiduidade.</p>
        </div>

        {canManageEmployees ? (
          <form className="grid-form" onSubmit={saveEmployee}>
          <div className="full-span section-heading compact">
            <h3>Dados Pessoais</h3>
            <p>Informações principais de identificação e contacto.</p>
          </div>

          <label>
            Nome completo
            <input
              value={employeeForm.full_name}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, full_name: event.target.value }))}
              required
            />
          </label>
          <label>
            Tipo de documento principal
            <select
              value={employeeForm.document_type || "bi"}
              onChange={(event) =>
                setEmployeeForm((current) => ({ ...current, document_type: event.target.value }))
              }
            >
              <option value="bi">BI</option>
              <option value="passport">Passaporte</option>
              <option value="foreign_card">Cartão de estrangeiro</option>
            </select>
          </label>
          <label>
            Número do documento principal
            <input
              value={employeeForm.bi}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, bi: event.target.value }))}
              placeholder={
                employeeForm.document_type === "passport"
                  ? "Número do passaporte"
                  : employeeForm.document_type === "foreign_card"
                    ? "Número do cartão de estrangeiro"
                    : "Ex.: 123456789LA042"
              }
              required
            />
          </label>
          <label>
            Número da carta de condução
            <input
              value={employeeForm.driver_license_number || ""}
              onChange={(event) =>
                setEmployeeForm((current) => ({ ...current, driver_license_number: event.target.value }))
              }
              placeholder="Opcional"
            />
          </label>
          <label>
            NIF
            <input
              value={employeeForm.nif}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, nif: event.target.value }))}
              required
            />
          </label>
          <label>
            Número da Segurança Social
            <input
              value={employeeForm.social_security_number}
              onChange={(event) =>
                setEmployeeForm((current) => ({ ...current, social_security_number: event.target.value }))
              }
            />
          </label>
          <label>
            Data de nascimento
            <input
              type="date"
              value={employeeForm.birth_date}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, birth_date: event.target.value }))}
            />
          </label>
          <label>
            Género
            <select
              value={employeeForm.gender}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, gender: event.target.value }))}
            >
              <option value="">Selecionar</option>
              <option value="Masculino">Masculino</option>
              <option value="Feminino">Feminino</option>
            </select>
          </label>
          <label>
            Estado civil
            <select
              value={employeeForm.marital_status}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, marital_status: event.target.value }))}
            >
              <option value="">Selecionar</option>
              <option value="Solteiro(a)">Solteiro(a)</option>
              <option value="Casado(a)">Casado(a)</option>
              <option value="Divorciado(a)">Divorciado(a)</option>
              <option value="Viúvo(a)">Viúvo(a)</option>
            </select>
          </label>
          <label>
            Nacionalidade
            <input
              value={employeeForm.nationality}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, nationality: event.target.value }))}
            />
          </label>
          <label>
            Telefone
            <input
              value={employeeForm.personal_phone}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, personal_phone: event.target.value }))}
              placeholder="+244..."
            />
          </label>
          <label>
            E-mail
            <input
              type="email"
              value={employeeForm.personal_email}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, personal_email: event.target.value }))}
              placeholder="nome@empresa.ao"
            />
          </label>
          <label className="full-span">
            Morada
            <input
              value={employeeForm.address}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, address: event.target.value }))}
              placeholder="Rua, bairro, município e província"
            />
          </label>

          <div className="full-span section-heading compact">
            <h3>Dados Laborais</h3>
            <p>Função, enquadramento contratual, salário base e turno de trabalho.</p>
          </div>

          <label>
            Cargo
            <input
              value={employeeForm.job_title}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, job_title: event.target.value }))}
              required
            />
          </label>
          <label>
            Departamento
            <input
              value={employeeForm.department}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, department: event.target.value }))}
              required
            />
          </label>
          <label>
            Salário base
            <input
              type="number"
              value={employeeForm.base_salary}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, base_salary: event.target.value }))}
              required
            />
          </label>
          <label>
            Tipo de contrato
            <input
              value={employeeForm.contract_type}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, contract_type: event.target.value }))}
              required
            />
          </label>
          <label>
            Data de admissão
            <input
              type="date"
              value={employeeForm.hire_date}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, hire_date: event.target.value }))}
              required
            />
          </label>
          <label>
            Estado
            <select
              value={employeeForm.status}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </label>
          <label>
            Código biométrico/cartão
            <input
              value={employeeForm.attendance_code}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, attendance_code: event.target.value }))}
              placeholder="Ex.: DOC-001 ou 1024"
            />
          </label>
          <label>
            Turno atribuído
            <select
              value={employeeForm.shift_id}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, shift_id: event.target.value }))}
            >
              <option value="">Sem turno definido</option>
              {activeShifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name}
                  {shift.department ? ` - ${shift.department}` : ""}
                </option>
              ))}
            </select>
          </label>
          {matchingScale && (
            <div className="full-span empty-note">
              Escala salarial aplicável: {matchingScale.job_title}
              {matchingScale.department ? ` / ${matchingScale.department}` : ""}. Intervalo previsto:{" "}
              {formatMoney(matchingScale.min_salary)} a {formatMoney(matchingScale.max_salary)}. Referência:{" "}
              {formatMoney(matchingScale.reference_salary)}.
            </div>
          )}

          <div className="full-span section-heading compact">
            <h3>Dados Bancários</h3>
            <p>Informações para pagamento salarial e exportação bancária.</p>
          </div>

          <label>
            IBAN
            <input
              value={employeeForm.iban}
              onFocus={() =>
                setEmployeeForm((current) => ({
                  ...current,
                  iban: String(current.iban || "").trim() ? current.iban : "AO06"
                }))
              }
              onChange={(event) =>
                setEmployeeForm((current) => {
                  const nextIban = event.target.value;
                  const nextDetectedBank = inferBankFromIban(nextIban, banks);
                  return {
                    ...current,
                    iban: nextIban,
                    bank_code: nextDetectedBank?.code || current.bank_code
                  };
                })
              }
              placeholder="AO06..."
            />
          </label>
          <label>
            Banco do funcionário
            <select
              value={employeeForm.bank_code}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, bank_code: event.target.value }))}
            >
              {banks.map((bank) => (
                <option key={bank.code} value={bank.code}>
                  {bank.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Número da conta bancária
            <input
              value={employeeForm.bank_account}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, bank_account: event.target.value }))}
            />
          </label>
          {detectedBank && (
            <div className="full-span empty-note">
              Banco identificado automaticamente pelo IBAN: {detectedBank.name}.
            </div>
          )}
          {!detectedBank && detectedRegistryCode && (
            <div className="full-span empty-note">
              Foi identificado o código bancário {detectedRegistryCode} no IBAN. Se o banco não for reconhecido
              automaticamente, selecione-o manualmente.
            </div>
          )}

          <div className="full-span section-heading compact">
            <h3>Observações</h3>
            <p>Notas complementares e referências internas do trabalhador.</p>
          </div>

          <label className="full-span">
            Observações
            <textarea
              rows="3"
              value={employeeForm.notes}
              onChange={(event) => setEmployeeForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Informação adicional relevante para RH."
            />
          </label>

          <div className="full-span compensation-stack">
            <LineItemsEditor
              title="Subsídios fixos"
              subtitle="Defina os apoios recorrentes e marque o tratamento fiscal aplicável a cada verba."
              items={employeeForm.recurring_allowances}
              onChange={(items) => setEmployeeForm((current) => ({ ...current, recurring_allowances: items }))}
              enableFiscalMode
            />
            <LineItemsEditor
              title="Bónus recorrentes"
              subtitle="Use esta área para prémios mensais previsíveis e classifique a incidência fiscal de cada valor."
              items={employeeForm.recurring_bonuses}
              onChange={(items) => setEmployeeForm((current) => ({ ...current, recurring_bonuses: items }))}
              enableFiscalMode
            />
            <LineItemsEditor
              title="Pagamentos especiais"
              subtitle="Agende pagamentos sazonais e registe se cada verba entra ou não na base legal."
              items={employeeForm.special_payments}
              withSchedule
              onChange={(items) => setEmployeeForm((current) => ({ ...current, special_payments: items }))}
              enableFiscalMode
            />
          </div>

            <button type="submit">{employeeForm.id ? "Atualizar" : "Guardar"} funcionário</button>
          </form>
        ) : (
          <p className="empty-note">
            Inicie sessão para gerir o cadastro de funcionários.
          </p>
        )}
      </div>

      <div className="panel">
        <div className="section-heading">
          <h2>Lista de Funcionários</h2>
          <p>Consulta rápida com pesquisa, filtros e edição do cadastro.</p>
        </div>

        <div className="grid-form filter-grid">
          <label>
            Pesquisar
            <input
              value={employeeFilters.search}
              onChange={(event) => setEmployeeFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Nome, cargo, BI, NIF, código ou departamento"
            />
          </label>
          <label>
            Estado
            <select
              value={employeeFilters.status}
              onChange={(event) => setEmployeeFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="todos">Todos</option>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </label>
          <label className="full-span">
            Departamento
            <input
              value={employeeFilters.department}
              onChange={(event) => setEmployeeFilters((current) => ({ ...current, department: event.target.value }))}
              placeholder="Filtrar por departamento"
            />
          </label>
        </div>

        <div className="table-list">
          {employees.map((employee) => (
            <div className="table-row" key={employee.id}>
              <div>
                <strong>{employee.full_name}</strong>
                <small>
                  {employee.job_title} | {employee.department}
                </small>
                <small>
                  {employee.bi} | {employee.nif}
                  {employee.attendance_code ? ` | Código: ${employee.attendance_code}` : ""}
                </small>
                <small>
                  {employee.shift_name ? `Turno: ${employee.shift_name}` : "Sem turno atribuído"}
                </small>
              </div>
              <div className="payroll-values">
                <strong>{formatMoney(employee.base_salary)}</strong>
                {canManageEmployees && (
                  <>
                    <button type="button" className="link-btn" onClick={() => editEmployee(employee)}>
                      Editar
                    </button>
                    <button type="button" className="link-btn danger" onClick={() => deleteEmployee(employee.id)}>
                      Remover
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {employees.length === 0 && (
            <p className="empty-note">Nenhum funcionário encontrado com os filtros atuais.</p>
          )}
        </div>
      </div>
    </section>
  );
}
