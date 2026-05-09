import { useEffect, useMemo, useState } from "react";
import AppIcon from "../AppIcon";

function overlapsMonth(startDate, endDate, monthRef) {
  const start = String(startDate || "").slice(0, 7);
  const end = String(endDate || "").slice(0, 7);
  if (!start || !end || !monthRef) {
    return false;
  }
  return start <= monthRef && end >= monthRef;
}

function getMonthRange(monthRef) {
  const normalized = String(monthRef || "").trim();
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    return null;
  }
  const [year, month] = normalized.split("-").map(Number);
  return {
    startDate: `${year}-${String(month).padStart(2, "0")}-01`,
    endDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  };
}

function enumerateDatesWithinMonth(startDate, endDate, monthRef) {
  const range = getMonthRange(monthRef);
  if (!range || !startDate || !endDate) {
    return [];
  }

  const effectiveStart = startDate > range.startDate ? startDate : range.startDate;
  const effectiveEnd = endDate < range.endDate ? endDate : range.endDate;
  if (effectiveStart > effectiveEnd) {
    return [];
  }

  const dates = [];
  const cursor = new Date(`${effectiveStart}T00:00:00Z`);
  const limit = new Date(`${effectiveEnd}T00:00:00Z`);
  while (cursor <= limit) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function percentage(value, total) {
  if (!total) {
    return 0;
  }
  return Number(((Number(value || 0) / Number(total || 1)) * 100).toFixed(1));
}

function formatDateLabel(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return "";
  }
  const [year, month, day] = normalized.split("-");
  return `${day}/${month}/${year}`;
}

function isPresenceStatus(status) {
  return ["present", "delay"].includes(String(status || "").toLowerCase());
}

function listRecentMonths(monthRef, count = 6) {
  const normalized = /^\d{4}-\d{2}$/.test(String(monthRef || "").trim())
    ? String(monthRef).trim()
    : new Date().toISOString().slice(0, 7);
  const [year, month] = normalized.split("-").map(Number);
  const months = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const cursor = new Date(year, month - 1 - index, 1);
    months.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`
    );
  }

  return months;
}

function formatMonthShortLabel(monthRef) {
  const normalized = /^\d{4}-\d{2}$/.test(String(monthRef || "").trim())
    ? `${String(monthRef).trim()}-01`
    : `${new Date().toISOString().slice(0, 7)}-01`;
  const parsed = new Date(`${normalized}T00:00:00`);
  return parsed.toLocaleDateString("pt-PT", { month: "short" }).replace(".", "");
}

function buildSmoothPath(points) {
  if (!points.length) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midpointX = (current.x + next.x) / 2;
    const midpointY = (current.y + next.y) / 2;
    path += ` Q ${current.x} ${current.y} ${midpointX} ${midpointY}`;
  }

  const lastPoint = points[points.length - 1];
  path += ` T ${lastPoint.x} ${lastPoint.y}`;
  return path;
}

export default function DashboardSection({
  stats,
  monthRef,
  boot,
  formatMoney,
  generatePayslip,
  alerts,
  updateState,
  setTab,
  onAlertAction = null
}) {
  const [departmentFilter, setDepartmentFilter] = useState("todos");
  const [employeeFilter, setEmployeeFilter] = useState("todos");
  const [waveMetric, setWaveMetric] = useState("net");

  const employees = boot?.employees || [];
  const attendanceRecords = boot?.attendanceRecords || [];
  const leaveRequests = boot?.leaveRequests || [];
  const vacationRequests = boot?.vacationRequests || [];

  const departments = useMemo(
    () =>
      Array.from(
        new Set(
          employees
            .map((employee) => String(employee.department || "").trim())
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right, "pt")),
    [employees]
  );

  const availableEmployees = useMemo(
    () =>
      employees.filter((employee) =>
        departmentFilter === "todos" ? true : String(employee.department || "") === departmentFilter
      ),
    [employees, departmentFilter]
  );

  useEffect(() => {
    if (employeeFilter === "todos") {
      return;
    }

    const stillAvailable = availableEmployees.some((employee) => Number(employee.id) === Number(employeeFilter));
    if (!stillAvailable) {
      setEmployeeFilter("todos");
    }
  }, [availableEmployees, employeeFilter]);

  const filteredEmployees = useMemo(
    () =>
      employees.filter((employee) => {
        const matchesDepartment =
          departmentFilter === "todos" || String(employee.department || "") === departmentFilter;
        const matchesEmployee =
          employeeFilter === "todos" || Number(employee.id) === Number(employeeFilter);
        return matchesDepartment && matchesEmployee;
      }),
    [employees, departmentFilter, employeeFilter]
  );

  const filteredEmployeeIds = useMemo(
    () => new Set(filteredEmployees.map((employee) => Number(employee.id))),
    [filteredEmployees]
  );

  const monthAttendanceRecords = useMemo(
    () =>
      attendanceRecords.filter(
        (item) =>
          String(item.attendance_date || "").slice(0, 7) === monthRef &&
          filteredEmployeeIds.has(Number(item.employee_id))
      ),
    [attendanceRecords, monthRef, filteredEmployeeIds]
  );

  const monthLeaveRequests = useMemo(
    () =>
      leaveRequests.filter(
        (item) =>
          item.status === "approved" &&
          filteredEmployeeIds.has(Number(item.employee_id)) &&
          overlapsMonth(item.start_date, item.end_date, monthRef)
      ),
    [leaveRequests, filteredEmployeeIds, monthRef]
  );

  const monthVacationRequests = useMemo(
    () =>
      vacationRequests.filter(
        (item) =>
          ["approved", "taken"].includes(String(item.status || "").toLowerCase()) &&
          filteredEmployeeIds.has(Number(item.employee_id)) &&
          overlapsMonth(item.start_date, item.end_date, monthRef)
      ),
    [vacationRequests, filteredEmployeeIds, monthRef]
  );

  const attendanceInconsistencies = useMemo(() => {
    const employeeMap = new Map(filteredEmployees.map((employee) => [Number(employee.id), employee]));
    const attendanceByKey = new Map();
    const leaveByKey = new Map();
    const vacationByKey = new Map();

    const pushIssue = (bucket, issue) => {
      bucket.push(issue);
    };

    monthAttendanceRecords.forEach((record) => {
      const key = `${record.employee_id}:${record.attendance_date}`;
      const current = attendanceByKey.get(key) || [];
      current.push(record);
      attendanceByKey.set(key, current);
    });

    monthLeaveRequests.forEach((request) => {
      enumerateDatesWithinMonth(request.start_date, request.end_date, monthRef).forEach((dateValue) => {
        const key = `${request.employee_id}:${dateValue}`;
        const current = leaveByKey.get(key) || [];
        current.push(request);
        leaveByKey.set(key, current);
      });
    });

    monthVacationRequests.forEach((request) => {
      enumerateDatesWithinMonth(request.start_date, request.end_date, monthRef).forEach((dateValue) => {
        const key = `${request.employee_id}:${dateValue}`;
        const current = vacationByKey.get(key) || [];
        current.push(request);
        vacationByKey.set(key, current);
      });
    });

    const missingShiftItems = filteredEmployees
      .filter((employee) => !employee.shift_id)
      .map((employee) => ({
        id: `missing-shift-${employee.id}`,
        type: "missing_shift",
        tone: "warning",
        title: `${employee.full_name} sem turno atribuído`,
        description: "Associe um turno ao trabalhador para melhorar a análise da assiduidade e a leitura dos mapas mensais.",
        employeeName: employee.full_name,
        department: employee.department || "Sem departamento",
        dateLabel: "",
        actionLabel: "Configurar turno",
        tab: "configuracoes"
      }));

    const missingAttendanceCodeItems = filteredEmployees
      .filter((employee) => !String(employee.attendance_code || "").trim())
      .map((employee) => ({
        id: `missing-attendance-code-${employee.id}`,
        type: "missing_attendance_code",
        tone: "danger",
        title: `${employee.full_name} sem código biométrico/cartão`,
        description: "Sem este código, a sincronização automática não consegue localizar o trabalhador no ficheiro do dispositivo.",
        employeeName: employee.full_name,
        department: employee.department || "Sem departamento",
        dateLabel: "",
        actionLabel: "Atualizar cadastro",
        tab: "funcionarios"
      }));

    const entryWithoutExitItems = [];
    const exitWithoutEntryItems = [];
    const duplicateMarkItems = [];
    const conflictItems = [];

    monthAttendanceRecords.forEach((record) => {
      if (!isPresenceStatus(record.status)) {
        return;
      }

      const employee = employeeMap.get(Number(record.employee_id));
      const checkInTime = String(record.check_in_time || "").trim();
      const checkOutTime = String(record.check_out_time || "").trim();
      const punchCount = Number(record.punch_count || 0);
      const importedSinglePunch =
        punchCount === 1 &&
        Boolean(checkInTime) &&
        Boolean(checkOutTime) &&
        checkInTime === checkOutTime;

      if ((checkInTime && !checkOutTime) || importedSinglePunch) {
        pushIssue(entryWithoutExitItems, {
          id: `entry-without-exit-${record.id}`,
          type: "entry_without_exit",
          tone: "warning",
          title: `Entrada sem saída em ${formatDateLabel(record.attendance_date)}`,
          description: importedSinglePunch
            ? "O dia ficou com apenas uma marcação importada. Reveja a saída do trabalhador."
            : "Existe hora de entrada registada, mas a saída não foi concluída.",
          employeeName: employee?.full_name || "Trabalhador",
          department: employee?.department || "Sem departamento",
          dateLabel: formatDateLabel(record.attendance_date),
          actionLabel: "Rever assiduidade",
          tab: "eventos"
        });
      }

      if (!checkInTime && checkOutTime) {
        pushIssue(exitWithoutEntryItems, {
          id: `exit-without-entry-${record.id}`,
          type: "exit_without_entry",
          tone: "warning",
          title: `Saída sem entrada em ${formatDateLabel(record.attendance_date)}`,
          description: "Existe hora de saída registada sem a respetiva entrada inicial.",
          employeeName: employee?.full_name || "Trabalhador",
          department: employee?.department || "Sem departamento",
          dateLabel: formatDateLabel(record.attendance_date),
          actionLabel: "Rever assiduidade",
          tab: "eventos"
        });
      }

      if (punchCount > 2) {
        pushIssue(duplicateMarkItems, {
          id: `duplicate-marks-${record.id}`,
          type: "duplicate_marks",
          tone: "danger",
          title: `${punchCount} marcações no mesmo dia`,
          description: "O sistema resumiu mais de duas marcações para este dia. Confirme se houve duplicação ou registo indevido no dispositivo.",
          employeeName: employee?.full_name || "Trabalhador",
          department: employee?.department || "Sem departamento",
          dateLabel: formatDateLabel(record.attendance_date),
          actionLabel: "Analisar registo",
          tab: "eventos"
        });
      }
    });

    const conflictKeys = new Set([...leaveByKey.keys(), ...vacationByKey.keys(), ...attendanceByKey.keys()]);
    conflictKeys.forEach((key) => {
      const [employeeIdRaw, dateValue] = key.split(":");
      const employeeId = Number(employeeIdRaw);
      const employee = employeeMap.get(employeeId);
      const leaves = leaveByKey.get(key) || [];
      const vacations = vacationByKey.get(key) || [];
      const attendances = attendanceByKey.get(key) || [];
      const reasons = [];

      if (leaves.length && vacations.length) {
        reasons.push("Existe licença e férias aprovadas para o mesmo dia.");
      }

      if (leaves.length && attendances.some((item) => item.status !== "leave")) {
        reasons.push("Existe assiduidade registada apesar de licença aprovada.");
      }

      if (vacations.length && attendances.some((item) => item.status !== "vacation")) {
        reasons.push("Existe assiduidade registada apesar de férias aprovadas.");
      }

      if (!reasons.length) {
        return;
      }

      pushIssue(conflictItems, {
        id: `protected-conflict-${employeeId}-${dateValue}`,
        type: "same_day_conflict",
        tone: "danger",
        title: `Conflito no mesmo dia (${formatDateLabel(dateValue)})`,
        description: reasons.join(" "),
        employeeName: employee?.full_name || "Trabalhador",
        department: employee?.department || "Sem departamento",
        dateLabel: formatDateLabel(dateValue),
        actionLabel: "Rever licenças e férias",
        tab: "eventos"
      });
    });

    const priority = {
      same_day_conflict: 0,
      duplicate_marks: 1,
      exit_without_entry: 2,
      entry_without_exit: 3,
      missing_attendance_code: 4,
      missing_shift: 5
    };

    const items = [
      ...conflictItems,
      ...duplicateMarkItems,
      ...entryWithoutExitItems,
      ...exitWithoutEntryItems,
      ...missingShiftItems,
      ...missingAttendanceCodeItems
    ].sort((left, right) => {
      const leftPriority = priority[left.type] ?? 99;
      const rightPriority = priority[right.type] ?? 99;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return `${left.employeeName} ${left.dateLabel}`.localeCompare(
        `${right.employeeName} ${right.dateLabel}`,
        "pt"
      );
    });

    return {
      summary: {
        entryWithoutExit: entryWithoutExitItems.length,
        exitWithoutEntry: exitWithoutEntryItems.length,
        duplicateMarks: duplicateMarkItems.length,
        missingShift: missingShiftItems.length,
        missingAttendanceCode: missingAttendanceCodeItems.length,
        sameDayConflicts: conflictItems.length,
        total: items.length
      },
      items,
      previewItems: items.slice(0, 10),
      hiddenCount: Math.max(items.length - 10, 0)
    };
  }, [filteredEmployees, monthAttendanceRecords, monthLeaveRequests, monthVacationRequests, monthRef]);

  const attendanceSummary = useMemo(() => {
    const present = monthAttendanceRecords.filter((item) => item.status === "present").length;
    const delay = monthAttendanceRecords.filter((item) => item.status === "delay").length;
    const absences = monthAttendanceRecords.filter(
      (item) => item.status === "absent" || item.status === "half_absence"
    ).length;
    const leaveDays = monthLeaveRequests.reduce((sum, item) => sum + Number(item.days || 0), 0);
    const vacationDays = monthVacationRequests.reduce((sum, item) => sum + Number(item.days || 0), 0);
    const attendanceBase = present + delay + absences;
    const punctualityRate = percentage(present, present + delay);
    const absenteeismRate = percentage(absences, attendanceBase);

    return {
      present,
      delay,
      absences,
      leaveDays,
      vacationDays,
      incompleteRecords:
        attendanceInconsistencies.summary.entryWithoutExit + attendanceInconsistencies.summary.exitWithoutEntry,
      punctualityRate,
      absenteeismRate,
      attendanceBase
    };
  }, [monthAttendanceRecords, monthLeaveRequests, monthVacationRequests, attendanceInconsistencies]);

  const attendanceAlerts = useMemo(() => {
    const summary = attendanceInconsistencies.summary;
    const alertRows = [];

    if (summary.missingShift) {
      alertRows.push({
        id: "dashboard-missing-shift",
        tone: "warning",
        title: `${summary.missingShift} funcionário(s) sem turno`,
        description: "Atribua um turno aos trabalhadores para melhorar a leitura da assiduidade e a sincronização.",
        actionLabel: "Configurar turnos",
        tab: "configuracoes"
      });
    }

    if (summary.missingAttendanceCode) {
      alertRows.push({
        id: "dashboard-missing-attendance-code",
        tone: "danger",
        title: `${summary.missingAttendanceCode} funcionário(s) sem código biométrico/cartão`,
        description: "Sem este código, a sincronização automática do biométrico ou do cartão não consegue localizar o trabalhador.",
        actionLabel: "Atualizar cadastros",
        tab: "funcionarios"
      });
    }

    if (summary.entryWithoutExit || summary.exitWithoutEntry) {
      alertRows.push({
        id: "dashboard-incomplete-attendance",
        tone: "warning",
        title: `${summary.entryWithoutExit + summary.exitWithoutEntry} marcação(ões) incompleta(s)`,
        description: "Existem registos do mês com entrada ou saída em falta. Reveja-os antes do fecho do período.",
        actionLabel: "Rever assiduidade",
        tab: "eventos"
      });
    }

    if (summary.duplicateMarks) {
      alertRows.push({
        id: "dashboard-duplicate-attendance",
        tone: "danger",
        title: `${summary.duplicateMarks} dia(s) com marcações duplicadas`,
        description: "Foram detetadas mais de duas marcações no mesmo dia para alguns trabalhadores.",
        actionLabel: "Analisar registos",
        tab: "eventos"
      });
    }

    if (summary.sameDayConflicts) {
      alertRows.push({
        id: "dashboard-protected-conflicts",
        tone: "danger",
        title: `${summary.sameDayConflicts} conflito(s) entre férias, licença e assiduidade`,
        description: "Existem dias com férias, licença e assiduidade em conflito. Corrija-os antes da conferência final.",
        actionLabel: "Rever conflitos",
        tab: "eventos"
      });
    }

    return alertRows;
  }, [attendanceInconsistencies.summary]);

  const selectedEmployeeName =
    employeeFilter === "todos"
      ? "Todos os trabalhadores"
      : filteredEmployees.find((employee) => Number(employee.id) === Number(employeeFilter))?.full_name ||
        "Trabalhador selecionado";

  const topMetrics = useMemo(() => {
    const monthRuns = (boot?.payrollRuns || []).filter((run) => run.month_ref === monthRef);
    const grossTotal = monthRuns.reduce((sum, run) => sum + Number(run.gross_salary || 0), 0);
    const employerInss = monthRuns.reduce(
      (sum, run) => sum + Number(run.summary_json?.employerInssAmount || 0),
      0
    );
    const totalCharges = stats.deductions + employerInss;
    const averageSalary = stats.runs ? stats.net / stats.runs : 0;
    const processedCoverage = percentage(stats.runs, stats.employees || 0);
    const liquidShare = percentage(stats.net, grossTotal || 0);
    const chargesShare = percentage(totalCharges, grossTotal || 0);
    const averageGross = grossTotal / Math.max(stats.runs || 1, 1);
    const averageShare = percentage(averageSalary, averageGross || 0);

    return [
      {
        id: "employees",
        icon: "users",
        title: "Total de funcionários",
        value: String(stats.employees),
        detail: processedCoverage
          ? `${processedCoverage}% com folha processada no mês`
          : "Sem folha processada no período",
        progress: Math.max(processedCoverage, stats.employees ? 18 : 0),
        tone: "neutral"
      },
      {
        id: "gross",
        icon: "payroll",
        title: "Total da folha salarial",
        value: formatMoney(grossTotal),
        detail: "Valor ilíquido consolidado do mês",
        progress: grossTotal ? 100 : 0,
        tone: "primary"
      },
      {
        id: "charges",
        icon: "state",
        title: "Total de encargos",
        value: formatMoney(totalCharges),
        detail: `${chargesShare}% da folha em impostos e contribuições`,
        progress: Math.max(chargesShare, totalCharges ? 16 : 0),
        tone: "warning"
      },
      {
        id: "average",
        icon: "dashboard",
        title: "Salário médio",
        value: formatMoney(averageSalary),
        detail: "Média líquida por colaborador processado",
        progress: Math.max(averageShare, averageSalary ? 22 : 0),
        tone: "success"
      },
      {
        id: "net",
        icon: "receipt",
        title: "Total pago no mês",
        value: formatMoney(stats.net),
        detail: `${liquidShare}% do ilíquido convertido em líquido`,
        progress: Math.max(liquidShare, stats.net ? 28 : 0),
        tone: "accent"
      }
    ];
  }, [boot, formatMoney, monthRef, stats]);

  const payrollWave = useMemo(() => {
    const runs = boot?.payrollRuns || [];
    const months = listRecentMonths(monthRef, 6);
    const toneMap = {
      gross: "primary",
      net: "accent",
      charges: "warning"
    };
    const metaMap = {
      gross: {
        title: "Folha ilíquida",
        description: "Evolução do salário bruto processado por mês."
      },
      net: {
        title: "Líquido pago",
        description: "Valor líquido realmente entregue aos trabalhadores."
      },
      charges: {
        title: "Encargos totais",
        description: "IRT, INSS, faltas, licenças e custo patronal do período."
      }
    };

    const series = months.map((entryMonth) => {
      const monthRuns = runs.filter((run) => run.month_ref === entryMonth);
      const gross = monthRuns.reduce((sum, run) => sum + Number(run.gross_salary || 0), 0);
      const net = monthRuns.reduce((sum, run) => sum + Number(run.net_salary || 0), 0);
      const charges = monthRuns.reduce(
        (sum, run) =>
          sum +
          Number(run.mandatory_deductions || 0) +
          Number(run.absence_deduction || 0) +
          Number(run.summary_json?.employerInssAmount || 0),
        0
      );

      return {
        monthRef: entryMonth,
        label: formatMonthShortLabel(entryMonth),
        gross,
        net,
        charges
      };
    });

    const values = series.map((item) => Number(item[waveMetric] || 0));
    const maxValue = Math.max(...values, 1);
    const chartWidth = 620;
    const chartHeight = 220;
    const paddingX = 28;
    const paddingTop = 20;
    const baseline = chartHeight - 24;
    const usableWidth = chartWidth - paddingX * 2;
    const usableHeight = baseline - paddingTop;
    const points = series.map((item, index) => {
      const divisor = Math.max(series.length - 1, 1);
      const x = paddingX + (usableWidth / divisor) * index;
      const ratio = maxValue ? Number(item[waveMetric] || 0) / maxValue : 0;
      const y = baseline - usableHeight * ratio;
      return {
        ...item,
        x,
        y
      };
    });

    const linePath = buildSmoothPath(points);
    const areaPath = points.length
      ? `${linePath} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`
      : "";
    const currentPoint = points[points.length - 1] || null;
    const previousPoint = points[points.length - 2] || null;
    const currentValue = Number(currentPoint?.[waveMetric] || 0);
    const previousValue = Number(previousPoint?.[waveMetric] || 0);
    const delta = currentValue - previousValue;
    const progress = Math.max(0, Math.min(100, maxValue ? (currentValue / maxValue) * 100 : 0));

    return {
      tone: toneMap[waveMetric] || "primary",
      title: metaMap[waveMetric]?.title || "Evolução mensal",
      description: metaMap[waveMetric]?.description || "Resumo da evolução mensal.",
      series,
      points,
      linePath,
      areaPath,
      currentLabel: currentPoint?.monthRef || monthRef,
      currentValue,
      previousValue,
      delta,
      progress,
      maxValue
    };
  }, [boot, monthRef, waveMetric]);

  function handleAlertAction(alert) {
    if (typeof onAlertAction === "function") {
      onAlertAction(alert);
      return;
    }

    setTab(alert?.tab || "configuracoes");
  }

  return (
    <>
      <section className="dashboard-hero">
        {topMetrics.map((item) => (
          <article key={item.id} className={`metric-card metric-card--${item.tone}`}>
            <div className="metric-card__header">
              <div>
                <span>{item.title}</span>
                <strong>{item.value}</strong>
              </div>
              <div className="metric-card__icon" aria-hidden="true">
                <AppIcon name={item.icon} size={20} />
              </div>
            </div>
            <small>{item.detail}</small>
            <div className="metric-card__bar" aria-hidden="true">
              <span style={{ width: `${Math.min(item.progress || 0, 100)}%` }} />
            </div>
          </article>
        ))}
      </section>

      <section className="panel dashboard-wave-panel">
        <div className="section-heading dashboard-wave-panel__heading">
          <div>
            <h2>Controlador gráfico do período</h2>
            <p>Leitura visual da folha com curvas limpas para bruto, líquido e encargos mensais.</p>
          </div>
          <div className="dashboard-wave-controls" role="group" aria-label="Controlador do gráfico">
            <button
              type="button"
              className={waveMetric === "net" ? "secondary-btn active-theme" : "secondary-btn"}
              onClick={() => setWaveMetric("net")}
            >
              Líquido
            </button>
            <button
              type="button"
              className={waveMetric === "gross" ? "secondary-btn active-theme" : "secondary-btn"}
              onClick={() => setWaveMetric("gross")}
            >
              Bruto
            </button>
            <button
              type="button"
              className={waveMetric === "charges" ? "secondary-btn active-theme" : "secondary-btn"}
              onClick={() => setWaveMetric("charges")}
            >
              Encargos
            </button>
          </div>
        </div>

        <div className="dashboard-wave-shell">
          <div className={`dashboard-wave-chart dashboard-wave-chart--${payrollWave.tone}`}>
            <svg viewBox="0 0 620 220" aria-hidden="true">
              {[25, 50, 75, 100].map((step) => {
                const y = 196 - 172 * (step / 100);
                return <line key={step} x1="28" x2="592" y1={y} y2={y} />;
              })}
              {payrollWave.areaPath ? <path className="dashboard-wave-chart__area" d={payrollWave.areaPath} /> : null}
              {payrollWave.linePath ? <path className="dashboard-wave-chart__line" d={payrollWave.linePath} /> : null}
              {payrollWave.points.map((point) => (
                <g key={point.monthRef}>
                  <circle className="dashboard-wave-chart__point" cx={point.x} cy={point.y} r="4.5" />
                  <text x={point.x} y="210" textAnchor="middle">
                    {point.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          <div className="dashboard-wave-summary">
            <div className="dashboard-wave-summary__card">
              <label>{payrollWave.title}</label>
              <strong>{formatMoney(payrollWave.currentValue)}</strong>
              <small>{payrollWave.description}</small>
            </div>
            <div className="dashboard-wave-summary__grid">
              <div>
                <label>Mês em foco</label>
                <strong>{payrollWave.currentLabel}</strong>
              </div>
              <div>
                <label>Variação mensal</label>
                <strong>
                  {payrollWave.delta >= 0 ? "+" : ""}
                  {formatMoney(payrollWave.delta)}
                </strong>
              </div>
              <div>
                <label>Mês anterior</label>
                <strong>{formatMoney(payrollWave.previousValue)}</strong>
              </div>
              <div>
                <label>Pico da série</label>
                <strong>{formatMoney(payrollWave.maxValue)}</strong>
              </div>
            </div>
            <div className="metric-card__bar dashboard-wave-summary__bar" aria-hidden="true">
              <span style={{ width: `${payrollWave.progress}%` }} />
            </div>
          </div>
        </div>
      </section>

      <section className="two-column">
        <div className="panel attendance-dashboard-panel">
          <div className="section-heading">
            <h2>Painel de assiduidade e turnos</h2>
            <p>Resumo do mês por departamento e trabalhador, com foco em presença, pontualidade e ausência.</p>
          </div>

          <div className="grid-form filter-grid dashboard-filter-grid">
            <label>
              Departamento
              <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                <option value="todos">Todos</option>
                {departments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Trabalhador
              <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
                <option value="todos">Todos</option>
                {availableEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="dashboard-context-card">
              <label>Ambito analisado</label>
              <strong>{selectedEmployeeName}</strong>
              <small>{departmentFilter === "todos" ? "Todos os departamentos" : departmentFilter}</small>
            </div>
          </div>

          <div className="dashboard-metrics-grid">
            <article className="stat-card stat-card--compact">
              <span>Presenças</span>
              <strong>{attendanceSummary.present}</strong>
              <small>Registos normais no mês</small>
            </article>
            <article className="stat-card stat-card--compact">
              <span>Atrasos</span>
              <strong>{attendanceSummary.delay}</strong>
              <small>Entradas fora da tolerância</small>
            </article>
            <article className="stat-card stat-card--compact">
              <span>Faltas</span>
              <strong>{attendanceSummary.absences}</strong>
              <small>Faltas e meias faltas</small>
            </article>
            <article className="stat-card stat-card--compact">
              <span>Licenças</span>
              <strong>{attendanceSummary.leaveDays}</strong>
              <small>Dias aprovados</small>
            </article>
            <article className="stat-card stat-card--compact">
              <span>Férias</span>
              <strong>{attendanceSummary.vacationDays}</strong>
              <small>Dias aprovados ou gozados</small>
            </article>
          </div>

          <div className="info-grid dashboard-indicators">
            <div>
              <label>Pontualidade</label>
              <strong>{attendanceSummary.punctualityRate}%</strong>
              <small>Presenças sem atraso sobre as entradas do mês</small>
            </div>
            <div>
              <label>Absentismo</label>
              <strong>{attendanceSummary.absenteeismRate}%</strong>
              <small>Faltas sobre o total de registos de presença e falta</small>
            </div>
            <div>
              <label>Marcações incompletas</label>
              <strong>{attendanceSummary.incompleteRecords}</strong>
              <small>Entrada ou saída por confirmar</small>
            </div>
            <div>
              <label>Trabalhadores abrangidos</label>
              <strong>{filteredEmployees.length}</strong>
              <small>Depois dos filtros aplicados</small>
            </div>
          </div>
        </div>

        <div className="panel operational-alerts-panel">
          <div className="section-heading">
            <h2>Alertas operacionais</h2>
            <p>O que exige atenção para manter o processamento e a assiduidade mais fiáveis.</p>
          </div>

          <div className="alert-list">
            {updateState.available && (
              <div className="alert-card alert-card--info">
                <div>
                  <strong>Atualização disponível</strong>
                  <small>
                    Já existe a versão {updateState.latestVersion || updateState.releaseName || "mais recente"} pronta para descarregar.
                  </small>
                </div>
                <button className="secondary-btn" onClick={() => handleAlertAction({ tab: "utilizador" })}>
                  Atualizar
                </button>
              </div>
            )}

            {[...alerts, ...attendanceAlerts].map((alert) => (
              <div className={`alert-card alert-card--${alert.tone || "warning"}`} key={alert.id}>
                <div>
                  <strong>{alert.title}</strong>
                  <small>{alert.description}</small>
                </div>
                {alert.actionLabel && (
                  <button className="secondary-btn" onClick={() => handleAlertAction(alert)}>
                    {alert.actionLabel}
                  </button>
                )}
              </div>
            ))}

            {!alerts.length && !attendanceAlerts.length && !updateState.available && (
              <p className="empty-note">Não existem alertas críticos neste momento.</p>
            )}
          </div>
        </div>
      </section>

      <section className="two-column">
        <div className="panel">
          <div className="section-heading">
            <h2>Painel de inconsistências</h2>
            <p>Conferência rápida das situações que exigem correção antes do fecho da assiduidade.</p>
          </div>

          <div className="dashboard-inconsistency-grid">
            <div className="dashboard-inconsistency-card">
              <label>Entradas sem saída</label>
              <strong>{attendanceInconsistencies.summary.entryWithoutExit}</strong>
              <small>Inclui dias importados com apenas uma marcação.</small>
            </div>
            <div className="dashboard-inconsistency-card">
              <label>Saídas sem entrada</label>
              <strong>{attendanceInconsistencies.summary.exitWithoutEntry}</strong>
              <small>Registos com saída preenchida sem entrada inicial.</small>
            </div>
            <div className="dashboard-inconsistency-card dashboard-inconsistency-card--danger">
              <label>Marcações duplicadas</label>
              <strong>{attendanceInconsistencies.summary.duplicateMarks}</strong>
              <small>Dias com mais de duas marcações associadas ao trabalhador.</small>
            </div>
            <div className="dashboard-inconsistency-card">
              <label>Sem turno</label>
              <strong>{attendanceInconsistencies.summary.missingShift}</strong>
              <small>Funcionários ainda sem turno atribuído.</small>
            </div>
            <div className="dashboard-inconsistency-card dashboard-inconsistency-card--danger">
              <label>Sem código biométrico/cartão</label>
              <strong>{attendanceInconsistencies.summary.missingAttendanceCode}</strong>
              <small>Cadastros que não conseguem ser localizados no dispositivo.</small>
            </div>
            <div className="dashboard-inconsistency-card dashboard-inconsistency-card--danger">
              <label>Conflitos no mesmo dia</label>
              <strong>{attendanceInconsistencies.summary.sameDayConflicts}</strong>
              <small>Férias, licença e assiduidade em conflito no mesmo período.</small>
            </div>
            <div className="dashboard-inconsistency-card dashboard-inconsistency-card--info">
              <label>Total de ocorrências</label>
              <strong>{attendanceInconsistencies.summary.total}</strong>
              <small>Ocorrências detetadas no âmbito analisado.</small>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="section-heading">
            <h2>Ocorrências do mês</h2>
            <p>Lista operacional para revisão rápida pela equipa de RH.</p>
          </div>

          <div className="dashboard-issue-list">
            {attendanceInconsistencies.previewItems.map((issue) => (
              <div className={`dashboard-issue-card dashboard-issue-card--${issue.tone}`} key={issue.id}>
                <div>
                  <strong>{issue.title}</strong>
                  <small>{issue.description}</small>
                <div className="dashboard-issue-meta">
                  <span>{issue.employeeName}</span>
                  <span>{issue.department}</span>
                  {issue.dateLabel ? <span>{issue.dateLabel}</span> : null}
                </div>
              </div>
              {issue.actionLabel ? (
                  <button className="secondary-btn" onClick={() => handleAlertAction(issue)}>
                    {issue.actionLabel}
                  </button>
                ) : null}
              </div>
            ))}

            {!attendanceInconsistencies.previewItems.length && (
              <p className="empty-note">Não foram detetadas inconsistências no âmbito selecionado.</p>
            )}

            {attendanceInconsistencies.hiddenCount > 0 && (
              <p className="empty-note">
                Existem mais {attendanceInconsistencies.hiddenCount} ocorrência(s) para análise. Ajuste os filtros para ver menos dados de cada vez.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="two-column">
        <div className="panel">
          <div className="section-heading">
            <h2>Perfil da empresa</h2>
            <p>Resumo institucional para recibos, relatórios e exportações.</p>
          </div>
          <div className="info-grid">
            <div><label>Empresa</label><strong>{boot.company.name || "Não configurada"}</strong></div>
            <div><label>NIF</label><strong>{boot.company.nif || "-"}</strong></div>
            <div><label>E-mail</label><strong>{boot.company.email || "-"}</strong></div>
            <div><label>Contacto</label><strong>{boot.company.phone || "-"}</strong></div>
          </div>
        </div>

        <div className="panel">
          <div className="section-heading">
            <h2>Estado do período</h2>
            <p>Visão rápida do mês em trabalho.</p>
          </div>
          <div className="info-grid">
            <div><label>Mês selecionado</label><strong>{monthRef}</strong></div>
            <div><label>Atualização</label><strong>{updateState.available ? "Disponível" : "Em dia"}</strong></div>
            <div><label>Folhas geradas</label><strong>{stats.runs}</strong></div>
            <div><label>Backups</label><strong>{boot.backups?.length || 0}</strong></div>
          </div>
        </div>
      </section>

      <section className="two-column">
        <div className="panel">
          <div className="section-heading">
            <h2>Últimos recibos</h2>
            <p>Geração rápida de documentos por colaborador.</p>
          </div>
          <div className="table-list compact">
            {boot.payrollRuns.slice(0, 5).map((run) => (
              <div className="table-row" key={run.id}>
                <div>
                  <strong>{run.full_name}</strong>
                  <small>{run.month_ref}</small>
                </div>
                <div className="action-row">
                  <strong>{formatMoney(run.net_salary)}</strong>
                  <button className="link-btn" onClick={() => generatePayslip(run.id)}>PDF</button>
                </div>
              </div>
            ))}
            {boot.payrollRuns.length === 0 && <p className="empty-note">Sem folhas processadas.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="section-heading">
            <h2>Assiduidade do mês</h2>
            <p>Resumo consolidado para gestão de RH e direção.</p>
          </div>
          <div className="info-grid">
            <div><label>Registos no mês</label><strong>{monthAttendanceRecords.length}</strong></div>
            <div><label>Licenças aprovadas</label><strong>{monthLeaveRequests.length}</strong></div>
            <div><label>Pedidos de férias</label><strong>{monthVacationRequests.length}</strong></div>
            <div><label>Base analisada</label><strong>{attendanceSummary.attendanceBase}</strong></div>
          </div>
        </div>
      </section>
    </>
  );
}
