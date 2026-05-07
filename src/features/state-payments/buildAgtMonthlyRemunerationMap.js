import { roundAmount } from "../../shared/utils/number";

function matchesMonthRange(monthRef, filters) {
  const normalized = String(monthRef || "").trim();
  const startMonthRef = String(filters.startDate || "").slice(0, 7);
  const endMonthRef = String(filters.endDate || "").slice(0, 7);
  if (!startMonthRef || !endMonthRef) {
    return normalized === filters.monthRef;
  }
  return normalized >= startMonthRef && normalized <= endMonthRef;
}

function normalizeFilters(input) {
  if (typeof input === "string") {
    return { monthRef: input, startDate: `${input}-01`, endDate: `${input}-31`, employeeId: "" };
  }
  return {
    monthRef: input?.monthRef || "",
    startDate: input?.startDate || "",
    endDate: input?.endDate || "",
    employeeId: input?.employeeId || ""
  };
}

export function buildAgtMonthlyRemunerationMapFromBoot(boot, monthOrFilters) {
  const filters = normalizeFilters(monthOrFilters);

  if (!boot) {
    return {
      company: { name: "", nif: "" },
      submissionMode: "manual",
      rows: [],
      totals: { grossRemuneration: 0, employeeInss: 0, taxableBase: 0, irtWithheld: 0 },
      validation: {
        ready: false,
        blockingIssues: [],
        warnings: [],
        missingEmployeeNif: 0,
        missingEmployeeBi: 0,
        missingEmployeeNiss: 0,
        missingFiscalVersion: 0,
        inconsistentRows: 0
      }
    };
  }

  const rows = (boot.payrollRuns || [])
    .filter((run) =>
      matchesMonthRange(run.month_ref, filters) &&
      (!filters.employeeId || String(run.employee_id) === String(filters.employeeId))
    )
    .map((run, index) => {
      const summary = run.summary_json || {};
      const grossRemuneration = roundAmount(Number(summary.payableGrossSalary ?? run.gross_salary ?? 0));
      const irtBaseBeforeInss = roundAmount(
        Number(summary.legalBases?.irtBaseBeforeSocialSecurity ?? summary.irtBaseBeforeSocialSecurity ?? grossRemuneration)
      );
      const employeeInss = roundAmount(Number(run.inss_amount || 0));
      const taxableBase = roundAmount(
        Number(
          summary.legalBases?.materiaColectavel ??
            summary.materiaColectavel ??
            Math.max(irtBaseBeforeInss - employeeInss, 0)
        )
      );
      const irtWithheld = roundAmount(Number(run.irt_amount || 0));
      const expectedTaxableBase = roundAmount(Math.max(irtBaseBeforeInss - employeeInss, 0));
      const issues = [];
      const consistencyIssues = [];

      if (!String(run.nif || "").trim()) {
        issues.push("NIF em falta");
      }
      if (!String(run.bi || "").trim()) {
        issues.push("BI em falta");
      }
      if (!String(run.social_security_number || "").trim()) {
        issues.push("NISS em falta");
      }
      if (!String(summary.fiscalProfileVersion || summary.fiscalProfile?.version || "").trim()) {
        issues.push("Versão fiscal em falta");
      }
      if (Math.abs(taxableBase - expectedTaxableBase) > 1) {
        consistencyIssues.push("Matéria coletável inconsistente");
      }
      if (taxableBase > grossRemuneration) {
        consistencyIssues.push("Base tributável acima da remuneração");
      }
      if (taxableBase > 100000 && irtWithheld <= 0) {
        consistencyIssues.push("IRT retido inconsistente");
      }

      return {
        id: run.id,
        index: index + 1,
        employeeId: run.employee_id,
        monthRef: run.month_ref,
        fullName: run.full_name,
        jobTitle: run.job_title || "-",
        department: run.department || "-",
        nif: run.nif || "",
        bi: run.bi || "",
        socialSecurityNumber: run.social_security_number || "",
        grossRemuneration,
        irtBaseBeforeInss,
        employeeInss,
        taxableBase,
        irtWithheld,
        fiscalProfileName: String(summary.fiscalProfile?.name || "").trim(),
        fiscalProfileVersion: String(summary.fiscalProfileVersion || summary.fiscalProfile?.version || "").trim(),
        consistencyIssues,
        issues: issues.concat(consistencyIssues)
      };
    });

  const blockingIssues = [];
  const warnings = [];
  const missingEmployeeNif = rows.filter((row) => !String(row.nif || "").trim()).length;
  const missingEmployeeBi = rows.filter((row) => !String(row.bi || "").trim()).length;
  const missingEmployeeNiss = rows.filter((row) => !String(row.socialSecurityNumber || "").trim()).length;
  const missingFiscalVersion = rows.filter((row) => !String(row.fiscalProfileVersion || "").trim()).length;
  const inconsistentRows = rows.filter((row) => (row.consistencyIssues || []).length > 0).length;

  if (!String(boot.company?.nif || "").trim()) {
    blockingIssues.push("NIF da empresa em falta no perfil da entidade.");
  }
  if (missingEmployeeNif) {
    blockingIssues.push(`Existem ${missingEmployeeNif} trabalhador(es) sem NIF.`);
  }
  if (missingEmployeeBi) {
    blockingIssues.push(`Existem ${missingEmployeeBi} trabalhador(es) sem BI.`);
  }
  if (missingEmployeeNiss) {
    blockingIssues.push(`Existem ${missingEmployeeNiss} trabalhador(es) sem NISS.`);
  }
  if (missingFiscalVersion) {
    blockingIssues.push(`Existem ${missingFiscalVersion} registo(s) de folha sem versão fiscal gravada.`);
  }
  if (inconsistentRows) {
    blockingIssues.push(`Existem ${inconsistentRows} linha(s) com inconsistencias entre folha, INSS e IRT.`);
  }
  if (rows.length > 0 && rows.length <= 3) {
    warnings.push("Confirme no Portal do Contribuinte se a submissão e obrigatoria para o volume atual de trabalhadores.");
  }
  if (!filters.monthRef) {
    warnings.push("A entrega e o comprovativo AGT continuam a ser registados por mês exato.");
  }

  return {
    company: {
      name: boot.company?.name || "",
      nif: boot.company?.nif || ""
    },
    submissionMode: rows.length > 150 ? "upload" : "manual",
    rows,
    totals: {
      grossRemuneration: roundAmount(rows.reduce((sum, row) => sum + Number(row.grossRemuneration || 0), 0)),
      employeeInss: roundAmount(rows.reduce((sum, row) => sum + Number(row.employeeInss || 0), 0)),
      taxableBase: roundAmount(rows.reduce((sum, row) => sum + Number(row.taxableBase || 0), 0)),
      irtWithheld: roundAmount(rows.reduce((sum, row) => sum + Number(row.irtWithheld || 0), 0))
    },
    validation: {
      ready: rows.length > 0 && blockingIssues.length === 0,
      blockingIssues,
      warnings,
      missingEmployeeNif,
      missingEmployeeBi,
      missingEmployeeNiss,
      missingFiscalVersion,
      inconsistentRows
    }
  };
}
