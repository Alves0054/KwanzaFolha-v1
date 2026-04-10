import AppIcon from "../components/AppIcon";
import AppSidebar from "../components/AppSidebar";
import TopBar from "../components/TopBar";
import { PageHeader } from "../ui/primitives";

function renderLicenseMeta(licenseBanner) {
  if (!licenseBanner) {
    return null;
  }

  const toneClass =
    licenseBanner.tone === "success"
      ? "success"
      : licenseBanner.tone === "warning"
        ? "warning"
        : licenseBanner.tone === "info"
          ? "info"
          : "danger";
  const iconName =
    licenseBanner.tone === "success"
      ? "lock"
      : licenseBanner.tone === "warning"
        ? "calendar"
        : licenseBanner.tone === "info"
          ? "settings"
          : "alert";

  return (
    <span className={`status-chip status-chip--${toneClass} page-license-chip`}>
      <AppIcon name={iconName} size={14} />
      {licenseBanner.message}
    </span>
  );
}

export default function AppShell({
  tab,
  setTab,
  user,
  sidebarCollapsed,
  setSidebarCollapsed,
  monthRef,
  setMonthRef,
  runPayroll,
  updateState,
  licenseBanner,
  theme,
  setTheme,
  pageMeta,
  pageActions = null,
  children
}) {
  const showDashboardTopbar = tab === "dashboard";
  const activePageMeta = pageMeta?.[tab] || null;

  return (
    <div className={`app-shell ${sidebarCollapsed ? "app-shell--sidebar-collapsed" : ""}`}>
      <AppSidebar
        tab={tab}
        setTab={setTab}
        user={user}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      <main className={`content content--${tab}`}>
        {showDashboardTopbar ? (
          <TopBar
            monthRef={monthRef}
            setMonthRef={setMonthRef}
            runPayroll={runPayroll}
            updateState={updateState}
            licenseBanner={licenseBanner}
            theme={theme}
            setTheme={setTheme}
            user={user}
          />
        ) : activePageMeta ? (
          <PageHeader
            icon={activePageMeta.icon}
            title={activePageMeta.title}
            description={activePageMeta.description}
            meta={renderLicenseMeta(licenseBanner)}
            actions={pageActions}
          />
        ) : null}

        {children}
      </main>
    </div>
  );
}
