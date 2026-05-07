import { useMemo, useState } from "react";

const weekdayOptions = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 7, label: "Dom" }
];

const shiftProfileOptions = [
  { value: "general", label: "Geral" },
  { value: "docente_morning", label: "Docente - Manhã" },
  { value: "docente_afternoon", label: "Docente - Tarde" },
  { value: "docente_evening", label: "Docente - Noite" },
  { value: "docente_flexible", label: "Docente - Flexível" }
];

const deviceProfileOptions = [
  { value: "generic", label: "Biométrico genérico" },
  { value: "zkteco", label: "ZKTeco" },
  { value: "hikvision", label: "Hikvision" },
  { value: "anviz", label: "Anviz" },
  { value: "suprema", label: "Suprema" },
  { value: "card_generic", label: "Leitor de cartão genérico" }
];

function formatMonthRefLabel(monthRef) {
  const normalized = String(monthRef || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    return "Sem vigência";
  }

  const [year, month] = normalized.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

function resolveLicenseTone(status) {
  if (status === "active") return "success";
  if (status === "trial_active") return "warning";
  return "danger";
}

function resolveLicenseStatusLabel(status) {
  if (status === "active") return "Licença ativa";
  if (status === "trial_active") return "Período gratuito";
  if (status === "expired") return "Licença expirada";
  if (status === "trial_expired") return "Teste expirado";
  return "Licença pendente";
}

function maskLicenseSerial(serialKey) {
  const value = String(serialKey || "").trim();
  if (!value) return "Ainda não ativado";

  const compact = value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const suffix = compact.slice(-4);
  return suffix ? `Oculto (...${suffix})` : "Oculto";
}

export default function SettingsSection({
  chooseAttendanceFolder,
  settingsForm,
  setSettingsForm,
  saveSettings,
  salaryScaleForm,
  setSalaryScaleForm,
  saveSalaryScale,
  initialSalaryScale,
  editSalaryScaleRow,
  deleteSalaryScale,
  workShiftForm,
  setWorkShiftForm,
  saveWorkShift,
  initialWorkShift,
  editWorkShiftRow,
  deleteWorkShift,
  user,
  boot,
  runtimeFlags,
  generateBackup,
  restoreBackup,
  licenseState,
  licensePlans,
  licenseBanner,
  openLicenseCenter,
  updateState,
  checkForUpdates,
  downloadUpdate,
  installUpdate
}) {
  const [backupSearch, setBackupSearch] = useState("");
  const salaryScales = boot.salaryScales || [];
  const workShifts = boot.workShifts || [];
  const backupItems = boot.backups || [];
  const payrollRuleEditingLocked = Boolean(runtimeFlags?.payrollRuleEditingLocked);
  const latestBackup = backupItems[0] || null;
  const resolvedFiscalProfile = settingsForm.resolvedFiscalProfile || null;
  const currentPlan = licenseState?.plan || licensePlans?.[0]?.name || "Plano mensal";
  const fiscalProfiles = useMemo(
    () =>
      [...(settingsForm.fiscalProfiles || [])].sort((left, right) =>
        String(right?.effectiveFrom || "").localeCompare(String(left?.effectiveFrom || ""), "pt")
      ),
    [settingsForm.fiscalProfiles]
  );
  const normalizedBackupSearch = String(backupSearch || "").trim().toLowerCase();
  const visibleBackups = useMemo(() => {
    if (!normalizedBackupSearch) {
      return latestBackup ? [latestBackup] : [];
    }

    return backupItems.filter((item) => {
      const modifiedDate = item.modified_at ? new Date(item.modified_at) : null;
      const dateLabel = modifiedDate ? modifiedDate.toLocaleString("pt-PT") : "";
      const shortDate = modifiedDate ? modifiedDate.toLocaleDateString("pt-PT") : "";
      const isoDate = modifiedDate ? modifiedDate.toISOString().slice(0, 10) : "";
      return `${item.fileName || ""} ${dateLabel} ${shortDate} ${isoDate}`.toLowerCase().includes(normalizedBackupSearch);
    });
  }, [backupItems, latestBackup, normalizedBackupSearch]);

  function loadFiscalProfileIntoForm(profile) {
    setSettingsForm((current) => ({
      ...current,
      inssEmployeeRate: String(profile?.inssEmployeeRate ?? current.inssEmployeeRate ?? ""),
      inssEmployerRate: String(profile?.inssEmployerRate ?? current.inssEmployerRate ?? ""),
      irtBrackets: JSON.stringify(profile?.irtBrackets || [], null, 2),
      fiscalProfileEditingId: String(profile?.id || ""),
      fiscalProfileEffectiveFrom: String(profile?.effectiveFrom || current.fiscalProfileEffectiveFrom || ""),
      fiscalProfileName: String(profile?.name || ""),
      fiscalProfileLegalReference: String(profile?.legalReference || ""),
      fiscalProfileNotes: String(profile?.notes || "")
    }));
  }

  return (
    <>
      <section className="two-column settings-grid settings-grid--primary">
        <div className="panel settings-panel settings-panel--system">
          <div className="section-heading">
            <h2>Sistema</h2>
            <p>INSS, tabela de IRT, moeda, subsídios e bónus configuráveis para o processamento salarial.</p>
          </div>

          <form className="grid-form settings-form settings-form--system" onSubmit={saveSettings}>
            <label>
              Moeda
              <input
                value={settingsForm.currency}
                onChange={(event) => setSettingsForm((current) => ({ ...current, currency: event.target.value }))}
              />
            </label>
            <label>
              INSS do funcionário (%)
              <input
                type="number"
                value={settingsForm.inssEmployeeRate}
                onChange={(event) => setSettingsForm((current) => ({ ...current, inssEmployeeRate: event.target.value }))}
              />
            </label>
            <label>
              INSS da empresa (%)
              <input
                type="number"
                value={settingsForm.inssEmployerRate}
                onChange={(event) => setSettingsForm((current) => ({ ...current, inssEmployerRate: event.target.value }))}
              />
            </label>
            <label>
              Mês do subsídio de férias
              <input
                type="number"
                value={settingsForm.vacationMonth}
                onChange={(event) => setSettingsForm((current) => ({ ...current, vacationMonth: event.target.value }))}
              />
            </label>
            <label>
              Mês do subsídio de Natal
              <input
                type="number"
                value={settingsForm.christmasMonth}
                onChange={(event) => setSettingsForm((current) => ({ ...current, christmasMonth: event.target.value }))}
              />
            </label>
            <label className="full-span">
              Tipos de subsídios
              <input
                value={settingsForm.allowanceTypes}
                onChange={(event) => setSettingsForm((current) => ({ ...current, allowanceTypes: event.target.value }))}
              />
            </label>
            <label className="full-span">
              Tipos de bónus
              <input
                value={settingsForm.bonusTypes}
                onChange={(event) => setSettingsForm((current) => ({ ...current, bonusTypes: event.target.value }))}
              />
            </label>
            <div className="full-span update-panel fiscal-profile-panel">
              <div className="section-heading compact">
                <h3>Vigência fiscal</h3>
                <p>Escolha o mês de entrada em vigor da revisão fiscal antes de guardar. Se usar um mês novo, o sistema cria uma nova versão.</p>
              </div>

              <div className="info-grid">
                <div>
                  <label>Perfil resolvido agora</label>
                  <strong>{resolvedFiscalProfile?.name || "Sem perfil"}</strong>
                  <small>{resolvedFiscalProfile?.effectiveFrom ? formatMonthRefLabel(resolvedFiscalProfile.effectiveFrom) : "Sem vigência"}</small>
                </div>
                <div>
                  <label>Versão atual</label>
                  <strong>{resolvedFiscalProfile?.version || "--"}</strong>
                  <small>{resolvedFiscalProfile?.legalReference || "Sem referência legal"}</small>
                </div>
              </div>

              <div className="grid-form fiscal-profile-grid">
                <label>
                  Mes de entrada em vigor
                  <input
                    type="month"
                    value={settingsForm.fiscalProfileEffectiveFrom || ""}
                    onChange={(event) =>
                      setSettingsForm((current) => ({ ...current, fiscalProfileEffectiveFrom: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Nome da versão fiscal
                  <input
                    value={settingsForm.fiscalProfileName || ""}
                    onChange={(event) =>
                      setSettingsForm((current) => ({ ...current, fiscalProfileName: event.target.value }))
                    }
                    placeholder="Ex.: Perfil fiscal Abril 2026"
                  />
                </label>
                <label className="full-span">
                  Referencia legal
                  <input
                    value={settingsForm.fiscalProfileLegalReference || ""}
                    onChange={(event) =>
                      setSettingsForm((current) => ({ ...current, fiscalProfileLegalReference: event.target.value }))
                    }
                    placeholder="Lei, despacho, circular ou validação interna"
                  />
                </label>
                <label className="full-span">
                  Notas internas
                  <textarea
                    rows="3"
                    value={settingsForm.fiscalProfileNotes || ""}
                    onChange={(event) =>
                      setSettingsForm((current) => ({ ...current, fiscalProfileNotes: event.target.value }))
                    }
                    placeholder="Contexto da revisão fiscal, motivo da mudança e observações"
                  />
                </label>
              </div>

              <div className="fiscal-profile-history">
                <div className="section-heading compact">
                  <h3>Histórico de versões</h3>
                  <p>Use &quot;Carregar no formulário&quot; para rever ou atualizar uma versão existente.</p>
                </div>

                <div className="table-list fiscal-profile-list">
                  {fiscalProfiles.map((profile) => (
                    <div className="table-row fiscal-profile-row" key={profile.id}>
                      <div>
                        <strong>{profile.name || profile.id}</strong>
                        <small>
                          Vigência {formatMonthRefLabel(profile.effectiveFrom)} | versão {profile.version || "--"}
                        </small>
                        <small>{profile.legalReference || "Sem referência legal"}</small>
                      </div>
                      <div className="inline-actions">
                        <span
                          className={`status-chip ${
                            profile.id === resolvedFiscalProfile?.id ? "status-chip--success" : "status-chip--info"
                          }`}
                        >
                          {profile.id === resolvedFiscalProfile?.id ? "Atual" : "Histórico"}
                        </span>
                        <button type="button" className="secondary-btn" onClick={() => loadFiscalProfileIntoForm(profile)}>
                          Carregar no formulário
                        </button>
                      </div>
                    </div>
                  ))}

                  {fiscalProfiles.length === 0 && (
                    <p className="empty-note">Ainda não existem versões fiscais registadas.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="full-span empty-note">
              A tabela de IRT fica oculta na interface normal e ? aplicada pelo motor fiscal versionado. Alterações fiscais
              devem entrar por atualização validada.
            </div>
            <button type="submit">Guardar configurações</button>
          </form>
        </div>

        <div className="panel settings-panel settings-panel--system">
          <div className="section-heading">
            <h2>Integrações de assiduidade</h2>
            <p>Configure a pasta monitorizada, a origem dos ficheiros e o perfil do biométrico ou leitor de cartão.</p>
          </div>

          <form className="grid-form settings-form settings-form--system" onSubmit={saveSettings}>
            <label>
              Sincronização automática
              <select
                value={settingsForm.attendanceAutoSyncEnabled ? "sim" : "nao"}
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    attendanceAutoSyncEnabled: event.target.value === "sim"
                  }))
                }
              >
                <option value="nao">Não</option>
                <option value="sim">Sim</option>
              </select>
            </label>
            <label>
              Origem monitorizada
              <select
                value={settingsForm.attendanceWatchedSourceType}
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    attendanceWatchedSourceType: event.target.value
                  }))
                }
              >
                <option value="biometric">Biométrico</option>
                <option value="card">Cartão</option>
              </select>
            </label>
            <label className="full-span">
              Pasta monitorizada
              <div className="inline-actions">
                <input
                  value={settingsForm.attendanceWatchedFolder}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      attendanceWatchedFolder: event.target.value
                    }))
                  }
                  placeholder="Selecione a pasta de sincronização automática"
                />
                <button type="button" className="secondary-btn" onClick={chooseAttendanceFolder}>
                  Selecionar pasta
                </button>
              </div>
            </label>
            <label>
              Perfil biométrico
              <select
                value={settingsForm.attendanceBiometricProfile}
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    attendanceBiometricProfile: event.target.value
                  }))
                }
              >
                {deviceProfileOptions
                  .filter((option) => option.value !== "card_generic")
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Perfil do cartão
              <select
                value={settingsForm.attendanceCardProfile}
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    attendanceCardProfile: event.target.value
                  }))
                }
              >
                {deviceProfileOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="full-span">
              Importação incremental
              <select
                value={settingsForm.attendanceIncrementalImport ? "sim" : "nao"}
                onChange={(event) =>
                  setSettingsForm((current) => ({
                    ...current,
                    attendanceIncrementalImport: event.target.value === "sim"
                  }))
                }
              >
                <option value="sim">Ativar deduplicação por ficheiro</option>
                <option value="nao">Reprocessar sempre que houver novo ficheiro</option>
              </select>
            </label>
            <button type="submit">Guardar integrações de assiduidade</button>
          </form>
        </div>

      </section>

      <section className="two-column">
        <div className="panel settings-panel">
          <div className="section-heading">
            <h2>Licenciamento</h2>
            <p>Compre, renove ou ative a licença mensal do Kwanza Folha sem sair do aplicativo.</p>
          </div>

          <div className="update-panel">
            <div className="update-panel__summary">
              <div>
                <label>Estado</label>
                <strong>{resolveLicenseStatusLabel(licenseState?.status)}</strong>
              </div>
              <div>
                <label>Plano</label>
                <strong>{currentPlan}</strong>
              </div>
              <div>
                <label>Serial</label>
                <strong>{maskLicenseSerial(licenseState?.serialKey)}</strong>
              </div>
              <div>
                <label>Validade</label>
                <strong>{licenseState?.expireDate ? new Date(licenseState.expireDate).toLocaleDateString("pt-PT") : "-"}</strong>
              </div>
            </div>

            <div className="update-panel__status">
              <span className={`status-chip status-chip--${resolveLicenseTone(licenseState?.status)}`}>
                {resolveLicenseStatusLabel(licenseState?.status)}
              </span>
              <p>{licenseBanner?.message || licenseState?.message || "A licença é validada offline depois da ativação."}</p>
            </div>

            <div className="inline-actions">
              <button
                type="button"
                onClick={() =>
                  openLicenseCenter(
                    licenseState?.status === "active" || licenseState?.status === "expired" ? "renew" : "purchase"
                  )
                }
              >
                {licenseState?.status === "active" ? "Renovar licença" : "Comprar licença"}
              </button>
              <button type="button" className="secondary-btn" onClick={() => openLicenseCenter("activate")}>
                Inserir licença
              </button>
            </div>
          </div>
        </div>

        <div className="panel settings-panel">
          <div className="section-heading">
            <h2>Atualização da aplicação</h2>
            <p>Verifique novas versões, descarregue o instalador e execute a atualização localmente.</p>
          </div>

          <div className="update-panel">
            <div className="update-panel__summary">
              <div>
                <label>Versão atual</label>
                <strong>{updateState.currentVersion || "-"}</strong>
              </div>
              <div>
                <label>Última versão</label>
                <strong>{updateState.latestVersion || "-"}</strong>
              </div>
              <div>
                <label>Release</label>
                <strong>{updateState.releaseName || "-"}</strong>
              </div>
              <div>
                <label>Publicada em</label>
                <strong>{updateState.publishedAt ? new Date(updateState.publishedAt).toLocaleDateString("pt-PT") : "-"}</strong>
              </div>
            </div>

            <div className="update-panel__status">
              <span
                className={`status-chip ${
                  updateState.downloaded ? "status-chip--success" : updateState.available ? "status-chip--warning" : "status-chip--info"
                }`}
              >
                {updateState.downloaded
                  ? "Atualização pronta a instalar"
                  : updateState.available
                    ? "Atualização disponível"
                    : "Aplicação em dia"}
              </span>
              <p>{updateState.message || "Use a verificação manual para procurar novas versões da aplicação."}</p>
              {updateState.path && <small>Ficheiro descarregado: {updateState.path}</small>}
            </div>

            <div className="inline-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={checkForUpdates}
                disabled={updateState.checking || updateState.downloading || updateState.installing}
              >
                {updateState.checking ? "A verificar..." : "Verificar atualizações"}
              </button>
              <button
                type="button"
                onClick={downloadUpdate}
                disabled={updateState.checking || updateState.downloading || updateState.installing}
              >
                {updateState.downloading ? "A descarregar..." : "Descarregar atualização"}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={installUpdate}
                disabled={!updateState.downloaded || updateState.installing}
              >
                {updateState.installing ? "A instalar..." : "Instalar atualização"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {user.role === "admin" && (
        <section className="two-column">
          <div className="panel settings-panel">
            <div className="section-heading">
              <h2>Escala salarial por função</h2>
              <p>Defina intervalos salariais por cargo e, quando necessário, por departamento.</p>
            </div>

            <form className="grid-form settings-form" onSubmit={saveSalaryScale}>
              <label>
                Função ou cargo
                <input
                  value={salaryScaleForm.job_title}
                  onChange={(event) => setSalaryScaleForm((current) => ({ ...current, job_title: event.target.value }))}
                  required
                />
              </label>
              <label>
                Departamento
                <input
                  value={salaryScaleForm.department}
                  onChange={(event) => setSalaryScaleForm((current) => ({ ...current, department: event.target.value }))}
                  placeholder="Opcional"
                />
              </label>
              <label>
                Salário mínimo
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={salaryScaleForm.min_salary}
                  onChange={(event) => setSalaryScaleForm((current) => ({ ...current, min_salary: event.target.value }))}
                  required
                />
              </label>
              <label>
                Salário de referência
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={salaryScaleForm.reference_salary}
                  onChange={(event) =>
                    setSalaryScaleForm((current) => ({ ...current, reference_salary: event.target.value }))
                  }
                  required
                />
              </label>
              <label>
                Salário máximo
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={salaryScaleForm.max_salary}
                  onChange={(event) => setSalaryScaleForm((current) => ({ ...current, max_salary: event.target.value }))}
                  required
                />
              </label>
              <label>
                Estado
                <select
                  value={salaryScaleForm.active ? "ativa" : "inativa"}
                  onChange={(event) =>
                    setSalaryScaleForm((current) => ({ ...current, active: event.target.value === "ativa" }))
                  }
                >
                  <option value="ativa">Ativa</option>
                  <option value="inativa">Inativa</option>
                </select>
              </label>
              <label className="full-span">
                Observações
                <textarea
                  rows="3"
                  value={salaryScaleForm.notes}
                  onChange={(event) => setSalaryScaleForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Notas internas sobre esta escala salarial."
                />
              </label>
              <div className="inline-actions full-span">
                <button type="submit">{salaryScaleForm.id ? "Atualizar" : "Guardar"} escala salarial</button>
                {salaryScaleForm.id && (
                  <button type="button" className="secondary-btn" onClick={() => setSalaryScaleForm(initialSalaryScale)}>
                    Cancelar edição
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="panel settings-panel">
            <div className="section-heading">
              <h2>Escalas registadas</h2>
              <p>Revise rapidamente a faixa salarial aplicada a cada função.</p>
            </div>

            <div className="table-list">
              {salaryScales.map((scale) => (
                <div className="table-row" key={scale.id}>
                  <div>
                    <strong>{scale.job_title}</strong>
                    <small>
                      {scale.department ? scale.department : "Todos os departamentos"} | {scale.active ? "ativa" : "inativa"}
                    </small>
                    <small>
                      Mín.: {Number(scale.min_salary || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} Kz | Ref.:{" "}
                      {Number(scale.reference_salary || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} Kz | Máx.:{" "}
                      {Number(scale.max_salary || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} Kz
                    </small>
                    <small>Funcionários abrangidos: {scale.employee_count || 0}</small>
                  </div>
                  <div className="payroll-values">
                    <button type="button" className="link-btn" onClick={() => editSalaryScaleRow(scale)}>
                      Editar
                    </button>
                    <button type="button" className="link-btn danger" onClick={() => deleteSalaryScale(scale.id)}>
                      Remover
                    </button>
                  </div>
                </div>
              ))}
              {!salaryScales.length && <p className="empty-note">Ainda não existem escalas salariais registadas.</p>}
            </div>
          </div>
        </section>
      )}

      {user.role === "admin" && (
        <section className="two-column">
          <div className="panel settings-panel">
            <div className="section-heading">
              <h2>Turnos e horários</h2>
              <p>Defina turnos gerais e modelos adaptados ao corpo docente para assiduidade e importação biométrica.</p>
            </div>

            <form className="grid-form settings-form" onSubmit={saveWorkShift}>
              <label>
                Código do turno
                <input
                  value={workShiftForm.code}
                  onChange={(event) => setWorkShiftForm((current) => ({ ...current, code: event.target.value }))}
                  placeholder="Ex.: DOC-MANHA"
                />
              </label>
              <label>
                Nome do turno
                <input
                  value={workShiftForm.name}
                  onChange={(event) => setWorkShiftForm((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </label>
              <label>
                Departamento
                <input
                  value={workShiftForm.department}
                  onChange={(event) => setWorkShiftForm((current) => ({ ...current, department: event.target.value }))}
                  placeholder="Opcional"
                />
              </label>
              <label>
                Perfil
                <select
                  value={workShiftForm.profile}
                  onChange={(event) => setWorkShiftForm((current) => ({ ...current, profile: event.target.value }))}
                >
                  {shiftProfileOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hora inicial
                <input
                  type="time"
                  value={workShiftForm.start_time}
                  onChange={(event) => setWorkShiftForm((current) => ({ ...current, start_time: event.target.value }))}
                  required
                />
              </label>
              <label>
                Hora final
                <input
                  type="time"
                  value={workShiftForm.end_time}
                  onChange={(event) => setWorkShiftForm((current) => ({ ...current, end_time: event.target.value }))}
                  required
                />
              </label>
              <label>
                Tolerância (minutos)
                <input
                  type="number"
                  min="0"
                  value={workShiftForm.tolerance_minutes}
                  onChange={(event) => setWorkShiftForm((current) => ({ ...current, tolerance_minutes: event.target.value }))}
                />
              </label>
              <label>
                Intervalo (minutos)
                <input
                  type="number"
                  min="0"
                  value={workShiftForm.break_minutes}
                  onChange={(event) => setWorkShiftForm((current) => ({ ...current, break_minutes: event.target.value }))}
                />
              </label>
              <label>
                Estado
                <select
                  value={workShiftForm.active ? "ativo" : "inativo"}
                  onChange={(event) => setWorkShiftForm((current) => ({ ...current, active: event.target.value === "ativo" }))}
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </label>
              <div className="full-span">
                <label>Dias de trabalho</label>
                <div className="inline-actions">
                  {weekdayOptions.map((day) => {
                    const checked = (workShiftForm.working_days || []).includes(day.value);
                    return (
                      <label key={day.value} className="status-chip">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setWorkShiftForm((current) => ({
                              ...current,
                              working_days: event.target.checked
                                ? [...new Set([...(current.working_days || []), day.value])].sort((left, right) => left - right)
                                : (current.working_days || []).filter((item) => item !== day.value)
                            }))
                          }
                        />
                        {day.label}
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className="full-span">
                Observações
                <textarea
                  rows="3"
                  value={workShiftForm.notes}
                  onChange={(event) => setWorkShiftForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Use os perfis docentes para manhã, tarde, noite ou horário flexível."
                />
              </label>
              <div className="inline-actions full-span">
                <button type="submit">{workShiftForm.id ? "Atualizar" : "Guardar"} turno</button>
                {workShiftForm.id && (
                  <button type="button" className="secondary-btn" onClick={() => setWorkShiftForm(initialWorkShift)}>
                    Cancelar edição
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="panel settings-panel">
            <div className="section-heading">
              <h2>Turnos registados</h2>
              <p>Associe estes turnos aos trabalhadores no cadastro e use-os na sincronização biométrica/cartão.</p>
            </div>

            <div className="table-list">
              {workShifts.map((shift) => (
                <div className="table-row" key={shift.id}>
                  <div>
                    <strong>{shift.name}</strong>
                    <small>
                      {shift.code || "Sem código"} |{" "}
                      {shiftProfileOptions.find((item) => item.value === shift.profile)?.label || shift.profile}
                    </small>
                    <small>
                      {shift.start_time} - {shift.end_time} | Tolerância {Number(shift.tolerance_minutes || 0)} min
                    </small>
                    <small>
                      {shift.department || "Todos os departamentos"} | Funcionários associados: {shift.employee_count || 0}
                    </small>
                  </div>
                  <div className="payroll-values">
                    <button type="button" className="link-btn" onClick={() => editWorkShiftRow(shift)}>
                      Editar
                    </button>
                    <button type="button" className="link-btn danger" onClick={() => deleteWorkShift(shift.id)}>
                      Remover
                    </button>
                  </div>
                </div>
              ))}
              {!workShifts.length && <p className="empty-note">Ainda não existem turnos registados.</p>}
            </div>
          </div>
        </section>
      )}

      <section className="settings-grid settings-grid--backups">
        <div className="panel settings-panel">
          <div className="section-heading">
            <h2>Backups</h2>
            <p>Crie cópias de segurança e restaure uma versão anterior da base de dados quando necessário.</p>
          </div>

          <div className="update-panel">
            <div className="update-panel__status">
              <span className="status-chip">Backups disponíveis: {backupItems.length}</span>
              <p>Os backups novos são cifrados automaticamente. Por padrão, o sistema mostra apenas o backup mais recente e os restantes ficam ocultos até que seja feita uma pesquisa por data.</p>
            </div>

            <div className="inline-actions">
              <button type="button" onClick={generateBackup}>
                Criar backup agora
              </button>
            </div>

            <div className="grid-form filter-grid backup-filter-grid">
              <label className="full-span">
                Procurar backup por data
                <input
                  value={backupSearch}
                  onChange={(event) => setBackupSearch(event.target.value)}
                  placeholder="Ex.: 05/04/2026 ou 2026-04-05"
                />
              </label>
            </div>

            {!normalizedBackupSearch && latestBackup && (
              <p className="empty-note">A mostrar apenas o backup mais recente. Pesquise por data para ver os restantes.</p>
            )}

            <div className="table-list">
              {visibleBackups.map((item) => (
                <div className="table-row" key={item.path}>
                  <div>
                    <strong>{item.fileName}</strong>
                    <small>
                      {new Date(item.modified_at).toLocaleString("pt-PT")} - {Math.round((item.size || 0) / 1024)} KB
                    </small>
                  </div>
                  <div className="payroll-values">
                    <span className={`status-chip ${item.encrypted ? "status-chip--success" : "status-chip--warning"}`}>
                      {item.encrypted ? "Cifrado" : "Legado"}
                    </span>
                    <button type="button" className="secondary-btn" onClick={() => restoreBackup(item.path)}>
                      Restaurar
                    </button>
                  </div>
                </div>
              ))}
              {!backupItems.length && <p className="empty-note">Ainda não existem backups disponíveis.</p>}
              {!!backupItems.length && normalizedBackupSearch && !visibleBackups.length && (
                <p className="empty-note">Nenhum backup corresponde à data pesquisada.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
