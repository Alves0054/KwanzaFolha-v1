import AppIcon from "./AppIcon";

function getLicenseIconName(tone) {
  if (tone === "success") return "lock";
  if (tone === "warning") return "calendar";
  if (tone === "info") return "settings";
  return "alert";
}

function getLicenseToneClass(tone) {
  if (tone === "success") return "success";
  if (tone === "warning") return "warning";
  if (tone === "info") return "info";
  return "danger";
}

export default function TopBar({ monthRef, setMonthRef, runPayroll, updateState, licenseBanner, theme, setTheme, user }) {
  const canProcessPayroll = user?.role === "admin";

  return (
    <header className="topbar">
      <div className="topbar-copy">
        <span className="topbar-eyebrow">
          <AppIcon name="dashboard" size={14} />
          Centro de Operações
        </span>
        <h2>Operação Salarial</h2>
        <p>Controle a folha, os encargos, os recibos e os relatórios num ambiente empresarial claro e moderno.</p>

        <div className="topbar-meta">
          <span className="status-chip status-chip--info">
            <AppIcon name="calendar" size={14} />
            Período {monthRef}
          </span>
          {updateState?.available && (
            <span className="status-chip status-chip--warning">
              <AppIcon name="alert" size={14} />
              Nova versão disponível
            </span>
          )}
          <span className="status-chip status-chip--success">
            <AppIcon name="lock" size={14} />
            Sessão ativa
          </span>
          {licenseBanner && (
            <span className={`status-chip status-chip--${getLicenseToneClass(licenseBanner.tone)} page-license-chip`}>
              <AppIcon name={getLicenseIconName(licenseBanner.tone)} size={14} />
              {licenseBanner.message}
            </span>
          )}
        </div>
      </div>

      <div className="topbar-actions topbar-actions--dashboard">
        <label className="topbar-control">
          <span>Mês de trabalho</span>
          <input type="month" value={monthRef} onChange={(event) => setMonthRef(event.target.value)} />
        </label>

        <div className="theme-switch" role="group" aria-label="Tema">
          <button
            type="button"
            className={theme === "dark" ? "secondary-btn active-theme" : "secondary-btn"}
            onClick={() => setTheme("dark")}
          >
            <AppIcon name="moon" size={14} />
            Dark
          </button>
          <button
            type="button"
            className={theme === "light" ? "secondary-btn active-theme" : "secondary-btn"}
            onClick={() => setTheme("light")}
          >
            <AppIcon name="sun" size={14} />
            Light
          </button>
        </div>

        <button
          type="button"
          className="topbar-primary"
          onClick={canProcessPayroll ? runPayroll : undefined}
          disabled={!canProcessPayroll}
          title={!canProcessPayroll ? "Apenas administradores podem processar a folha." : undefined}
        >
          <AppIcon name="process" size={16} />
          Processar folha
        </button>
      </div>
    </header>
  );
}
