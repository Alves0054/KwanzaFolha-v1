import { angolaBanks } from "../../utils/payroll";

export default function UserSection({
  user,
  company,
  boot,
  passwordForm,
  setPasswordForm,
  changeOwnPassword,
  companyForm,
  setCompanyForm,
  saveCompany,
  chooseLogo,
  resetPasswordForm,
  setResetPasswordForm,
  resetUserPassword,
  userForm,
  setUserForm,
  saveUser,
  initialUserForm,
  editUserRow,
  removeUser
}) {
  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return (
      <section className="two-column">
        <div className="panel settings-panel">
          <div className="section-heading">
            <h2>Conta do utilizador</h2>
            <p>Dados da sessão atual para consulta.</p>
          </div>

          <div className="info-grid">
            <div>
              <label>Nome</label>
              <strong>{user.full_name}</strong>
            </div>
            <div>
              <label>Utilizador</label>
              <strong>{user.username}</strong>
            </div>
            <div>
              <label>Perfil</label>
              <strong>Operador</strong>
            </div>
            <div>
              <label>Estado</label>
              <strong>{user.active ? "Ativo" : "Inativo"}</strong>
            </div>
            <div>
              <label>E-mail</label>
              <strong>{user.email || "-"}</strong>
            </div>
          </div>
        </div>

        <div className="panel settings-panel">
          <div className="section-heading">
            <h2>Empresa</h2>
            <p>Dados institucionais da empresa para consulta.</p>
          </div>

          <div className="info-grid">
            <div>
              <label>Nome da empresa</label>
              <strong>{company?.name || "-"}</strong>
            </div>
            <div>
              <label>NIF</label>
              <strong>{company?.nif || "-"}</strong>
            </div>
            <div>
              <label>E-mail institucional</label>
              <strong>{company?.email || "-"}</strong>
            </div>
            <div>
              <label>Contacto telefónico</label>
              <strong>{company?.phone || "-"}</strong>
            </div>
            <div>
              <label>Banco de origem</label>
              <strong>{angolaBanks.find((bank) => bank.code === company?.origin_bank_code)?.name || company?.origin_bank_code || "-"}</strong>
            </div>
            <div>
              <label>Conta de origem</label>
              <strong>{company?.origin_account || "-"}</strong>
            </div>
            <div className="full-span">
              <label>Morada</label>
              <strong>{company?.address || "-"}</strong>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="two-column">
        <div className="panel settings-panel">
          <div className="section-heading">
            <h2>Conta do utilizador</h2>
            <p>Dados da sessão atual, empresa associada e informações principais do administrador.</p>
          </div>

          <div className="info-grid">
            <div>
              <label>Nome</label>
              <strong>{user.full_name}</strong>
            </div>
            <div>
              <label>Utilizador</label>
              <strong>{user.username}</strong>
            </div>
            <div>
              <label>Perfil</label>
              <strong>{user.role === "admin" ? "Administrador" : "Operador"}</strong>
            </div>
            <div>
              <label>Estado</label>
              <strong>{user.active ? "Ativo" : "Inativo"}</strong>
            </div>
            <div>
              <label>Empresa</label>
              <strong>{company?.name || "-"}</strong>
            </div>
            <div>
              <label>E-mail institucional</label>
              <strong>{company?.email || "-"}</strong>
            </div>
          </div>
        </div>

        <div className="panel settings-panel">
          <div className="section-heading">
            <h2>A minha palavra-passe</h2>
            <p>Atualize a palavra-passe do utilizador autenticado sempre que precisar de reforçar a segurança.</p>
          </div>

          <form className="grid-form settings-form" onSubmit={changeOwnPassword}>
            <label>
              Palavra-passe atual
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
              />
            </label>
            <label>
              Nova palavra-passe
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                required
              />
            </label>
            <label className="full-span">
              Confirmar nova palavra-passe
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                required
              />
            </label>
            <button type="submit">Atualizar palavra-passe</button>
          </form>
        </div>
      </section>

      <section className="two-column">
        <div className="panel settings-panel settings-panel--company">
          <div className="section-heading">
            <h2>Empresa</h2>
            <p>Dados institucionais usados em recibos, relatórios, exportações bancárias e licenciamento.</p>
          </div>

          <form className="grid-form settings-form settings-form--company" onSubmit={saveCompany}>
            <label>
              Nome da empresa
              <input
                value={companyForm.name}
                onChange={(event) => setCompanyForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>
            <label>
              NIF
              <input
                value={companyForm.nif}
                onChange={(event) => setCompanyForm((current) => ({ ...current, nif: event.target.value }))}
                required
              />
            </label>
            <label>
              E-mail
              <input
                value={companyForm.email}
                onChange={(event) => setCompanyForm((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label>
              Contacto telefónico
              <input
                value={companyForm.phone}
                onChange={(event) => setCompanyForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </label>
            <label>
              Banco de origem para PS2/PSX
              <select
                value={companyForm.origin_bank_code || ""}
                onChange={(event) => setCompanyForm((current) => ({ ...current, origin_bank_code: event.target.value }))}
              >
                <option value="">Selecionar</option>
                {angolaBanks.map((bank) => (
                  <option key={bank.code} value={bank.code}>
                    {bank.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Número da conta de origem para PS2/PSX
              <input
                value={companyForm.origin_account || ""}
                onChange={(event) => setCompanyForm((current) => ({ ...current, origin_account: event.target.value }))}
                placeholder="Ex.: 300200100999"
              />
            </label>
            <label className="full-span">
              Morada
              <input
                value={companyForm.address}
                onChange={(event) => setCompanyForm((current) => ({ ...current, address: event.target.value }))}
              />
            </label>
            <label className="full-span">
              Logótipo
              <div className="inline-actions">
                <input value={companyForm.logo_path} readOnly />
                <button type="button" className="secondary-btn" onClick={chooseLogo}>
                  Selecionar
                </button>
              </div>
            </label>
            <button type="submit">Guardar dados da empresa</button>
          </form>
        </div>

        <div className="panel settings-panel">
          <div className="section-heading">
            <h2>Redefinir palavra-passe</h2>
            <p>Use esta área para desbloquear contas e criar uma palavra-passe temporária para outro utilizador.</p>
          </div>

          <form className="grid-form settings-form" onSubmit={resetUserPassword}>
            <label>
              Utilizador
              <select
                value={resetPasswordForm.userId}
                onChange={(event) => setResetPasswordForm((current) => ({ ...current, userId: event.target.value }))}
              >
                {(boot?.users || []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.full_name} ({item.username})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nova palavra-passe temporária
              <input
                type="password"
                value={resetPasswordForm.newPassword}
                onChange={(event) => setResetPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                required
              />
            </label>
            <button type="submit">Redefinir palavra-passe</button>
          </form>
        </div>
      </section>

      <section className="two-column">
        <div className="panel settings-panel">
          <div className="section-heading">
            <h2>Utilizadores</h2>
            <p>Crie administradores e operadores, ou ajuste o estado de cada acesso existente.</p>
          </div>

          <form className="grid-form settings-form" onSubmit={saveUser}>
            <label>
              Nome completo
              <input
                value={userForm.full_name}
                onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))}
                required
              />
            </label>
            <label>
              E-mail
              <input
                value={userForm.email}
                onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="utilizador@empresa.ao"
              />
            </label>
            <label>
              Utilizador
              <input
                value={userForm.username}
                onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))}
                required
              />
            </label>
            {!userForm.id && (
              <label>
                Palavra-passe inicial
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                  required
                />
              </label>
            )}
            <label>
              Perfil
              <select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}>
                <option value="admin">Administrador</option>
                <option value="operador">Operador</option>
              </select>
            </label>
            <label>
              Estado
              <select
                value={userForm.active ? "ativo" : "inativo"}
                onChange={(event) => setUserForm((current) => ({ ...current, active: event.target.value === "ativo" }))}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </label>
            <div className="inline-actions full-span">
              <button type="submit">{userForm.id ? "Atualizar" : "Criar"} utilizador</button>
              {userForm.id && (
                <button type="button" className="secondary-btn" onClick={() => setUserForm(initialUserForm)}>
                  Cancelar edição
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="panel settings-panel">
          <div className="section-heading">
            <h2>Acessos existentes</h2>
            <p>As contas com palavra-passe inicial ou redefinida ficam marcadas para alteração obrigatória.</p>
          </div>

          <div className="table-list">
            {(boot?.users || []).map((item) => (
              <div className="table-row" key={item.id}>
                <div>
                  <strong>{item.full_name}</strong>
                  <small>
                    {item.username} - {item.role} - {item.active ? "ativo" : "inativo"}
                    {item.must_change_password ? " - alteração pendente" : ""}
                  </small>
                  <small>{item.email || "Sem e-mail registado"}</small>
                </div>
                <div className="payroll-values">
                  <button type="button" className="link-btn" onClick={() => editUserRow(item)}>
                    Editar
                  </button>
                  <button type="button" className="link-btn danger" onClick={() => removeUser(item.id)}>
                    Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

    </>
  );
}
