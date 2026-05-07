import { useMemo } from "react";
import AppIcon from "./AppIcon";
import brandIcon from "../assets/logos/logo-icon.ico";
import brandLogo from "../assets/logos/logo-light.png";

const navItems = [
  { key: "dashboard", icon: "dashboard", label: "Dashboard" },
  { key: "organizacao", icon: "company", label: "Organização" },
  { key: "empresarial", icon: "process", label: "Suite RH" },
  { key: "rh360", icon: "hr", label: "RH 360" },
  { key: "funcionarios", icon: "users", label: "Funcionários" },
  { key: "eventos", icon: "activity", label: "Movimentos" },
  { key: "historico", icon: "history", label: "Histórico" },
  { key: "processamento", icon: "payroll", label: "Folha Salarial" },
  { key: "estado", icon: "state", label: "Pagamento ao Estado" },
  { key: "relatorios", icon: "reports", label: "Relatórios" },
  { key: "utilizador", icon: "user", label: "Utilizador", section: "secondary" },
  { key: "auditoria", icon: "audit", label: "Auditoria", section: "secondary" },
  { key: "configuracoes", icon: "settings", label: "Configurações", role: "admin", section: "secondary" }
];

function getInitials(fullName) {
  return String(fullName || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "KF";
}

export default function AppSidebar({ tab, setTab, user, collapsed, setCollapsed }) {
  const visibleNavItems = navItems.filter((item) => !item.role || item.role === user.role);
  const primaryItems = visibleNavItems.filter((item) => item.section !== "secondary");
  const secondaryItems = visibleNavItems.filter((item) => item.section === "secondary");
  const initials = useMemo(() => getInitials(user.full_name), [user.full_name]);

  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}>
      <div className="sidebar__header">
        <div className="brand-block">
          <img
            className="brand-logo sidebar-brand-logo"
            src={collapsed ? brandIcon : brandLogo}
            alt="Kwanza Folha"
          />
          {!collapsed && (
            <div className="brand-copy">
              <strong>Kwanza Folha</strong>
              <small>Gestão salarial empresarial</small>
            </div>
          )}
        </div>

        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          title={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
        >
          <AppIcon name={collapsed ? "chevronRight" : "chevronLeft"} size={18} />
        </button>
      </div>

      <div className="sidebar-section">
        {!collapsed && <span className="sidebar-section__title">Principal</span>}
        <nav className="nav-list">
          {primaryItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? "nav-item active" : "nav-item"}
              onClick={() => setTab(item.key)}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-item__icon" aria-hidden="true">
                <AppIcon name={item.icon} size={18} />
              </span>
              {!collapsed && <span className="nav-item__label">{item.label}</span>}
            </button>
          ))}
        </nav>
      </div>

      {!!secondaryItems.length && (
        <div className="sidebar-section sidebar-section--secondary">
          {!collapsed && <span className="sidebar-section__title">Controlo</span>}
          <nav className="nav-list">
            {secondaryItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={tab === item.key ? "nav-item active" : "nav-item"}
                onClick={() => setTab(item.key)}
                title={collapsed ? item.label : undefined}
              >
                <span className="nav-item__icon" aria-hidden="true">
                  <AppIcon name={item.icon} size={18} />
                </span>
                {!collapsed && <span className="nav-item__label">{item.label}</span>}
              </button>
            ))}
          </nav>
        </div>
      )}

      <div className="sidebar-user">
        <span className="sidebar-user__avatar">{initials}</span>
        {!collapsed && (
          <div className="sidebar-user__copy">
            <strong>{user.full_name}</strong>
            <small>{user.role === "admin" ? "Administrador" : "Operador"}</small>
          </div>
        )}
      </div>
    </aside>
  );
}
