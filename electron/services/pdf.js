const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const A4 = [595.28, 841.89];
const A4_LANDSCAPE = [841.89, 595.28];
const REPORT_MARGIN = 56;
const REPORT_COLORS = {
  title: rgb(0, 0.2, 0.4),
  subtitle: rgb(0.4, 0.4, 0.4),
  line: rgb(0.78, 0.8, 0.82),
  mutedFill: rgb(0.95, 0.96, 0.97),
  altFill: rgb(0.97, 0.98, 0.99),
  text: rgb(0.12, 0.12, 0.12),
  accent: rgb(0.16, 0.35, 0.55),
  accentSoft: rgb(0.78, 0.86, 0.92),
  gray: rgb(0.62, 0.66, 0.7)
};

function normalizeReportPayload(payload = {}) {
  const source =
    typeof payload === "string"
      ? { monthRef: payload }
      : payload && typeof payload === "object"
        ? { ...payload }
        : {};
  return {
    type: String(source.type || "mensal").trim().toLowerCase(),
    monthRef: String(source.monthRef || "").trim(),
    startDate: String(source.startDate || "").trim(),
    endDate: String(source.endDate || "").trim(),
    employeeId: source.employeeId === undefined || source.employeeId === null ? "" : String(source.employeeId).trim()
  };
}

class PdfService {
  constructor(database) {
    this.database = database;
  }

  async saveValidatedPdf(doc, output, options = {}) {
    const bytes = await doc.save();
    fs.writeFileSync(output, bytes);
    const qaReport = await this.validatePdfArtifact(output, options);
    if (!qaReport.ok) {
      throw new Error(`Falha de QA do PDF: ${qaReport.issues.join("; ")}`);
    }
    const qaPath = `${output}.qa.json`;
    fs.writeFileSync(qaPath, JSON.stringify(qaReport, null, 2), "utf8");
    return { path: output, qaPath, qaReport };
  }

  async validatePdfArtifact(filePath, options = {}) {
    const issues = [];
    const minimumPages = Math.max(1, Number(options.minimumPages || 1));
    if (!fs.existsSync(filePath)) {
      return { ok: false, checked_at: new Date().toISOString(), issues: ["Ficheiro PDF não encontrado."], file_path: filePath };
    }

    const bytes = fs.readFileSync(filePath);
    if (bytes.length < 700) issues.push("PDF demasiado pequeno para conter layout profissional validavel.");
    if (bytes.subarray(0, 4).toString("utf8") !== "%PDF") issues.push("Cabecalho PDF inválido.");

    let pageSummaries = [];
    try {
      const loaded = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = loaded.getPages();
      if (pages.length < minimumPages) issues.push(`PDF tem ${pages.length} pagina(s), abaixo do minimo esperado (${minimumPages}).`);
      pageSummaries = pages.map((page, index) => {
        const { width, height } = page.getSize();
        if (width < 250 || height < 250) issues.push(`Pagina ${index + 1} tem dimensoes demasiado pequenas.`);
        if (width > 1200 || height > 1200) issues.push(`Pagina ${index + 1} tem dimensoes fora do intervalo esperado.`);
        return { page: index + 1, width: Number(width.toFixed(2)), height: Number(height.toFixed(2)) };
      });
    } catch (error) {
      issues.push(`PDF não pode ser reaberto para validação: ${error.message}`);
    }

    return {
      ok: issues.length === 0,
      checked_at: new Date().toISOString(),
      document_type: options.documentType || "pdf",
      file_path: filePath,
      file_size: bytes.length,
      pages: pageSummaries,
      issues
    };
  }

  async generatePayslip(payrollRunId) {
    const run = this.database.getPayrollRun(payrollRunId);
    const company = this.database.getCompanyProfile();
    if (!run) {
      throw new Error("Folha salarial não encontrada.");
    }

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([842, 595]);

    page.drawRectangle({ x: 0, y: 0, width: 842, height: 595, color: rgb(1, 1, 1) });
    this.drawDivider(page);
    this.drawPayslipPanel({ page, company, run, font, bold, copyLabel: "Original", panelX: 34, panelWidth: 366 });
    this.drawPayslipPanel({ page, company, run, font, bold, copyLabel: "Duplicado", panelX: 442, panelWidth: 366 });

    const fileName = `recibo-${run.month_ref}-${run.full_name.replace(/\s+/g, "-")}.pdf`;
    const output = path.join(this.database.exportsDir, fileName);
    const saved = await this.saveValidatedPdf(doc, output, { documentType: "payslip", minimumPages: 1 });
    return { ok: true, path: output, qaReport: saved.qaReport };
  }

  async generatePayslipsByMonth(monthRef) {
    const runs = this.database.listPayrollRuns().filter((run) => run.month_ref === monthRef);
    if (!runs.length) {
      return { ok: false, message: "Não existem salários processados para gerar recibos em lote neste período." };
    }

    const company = this.database.getCompanyProfile();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    for (const runSummary of runs) {
      const run = this.database.getPayrollRun(runSummary.id);
      if (!run) {
        continue;
      }

      const page = doc.addPage([842, 595]);
      page.drawRectangle({ x: 0, y: 0, width: 842, height: 595, color: rgb(1, 1, 1) });
      this.drawDivider(page);
      this.drawPayslipPanel({ page, company, run, font, bold, copyLabel: "Original", panelX: 34, panelWidth: 366 });
      this.drawPayslipPanel({ page, company, run, font, bold, copyLabel: "Duplicado", panelX: 442, panelWidth: 366 });
    }

    const fileName = `recibos-lote-${monthRef}.pdf`;
    const output = path.join(this.database.exportsDir, fileName);
    const saved = await this.saveValidatedPdf(doc, output, { documentType: "payslips_batch", minimumPages: 1 });
    return { ok: true, path: output, count: runs.length, qaReport: saved.qaReport };
  }

  async exportMonthlyPackage(filters) {
    const normalizedFilters = normalizeReportPayload(filters);
    const runs = this.database.listPayrollRuns(normalizedFilters);
    if (!runs.length) {
      return { ok: false, message: "Não existem salários processados para exportar o pacote mensal deste período." };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const periodKey = normalizedFilters.monthRef || [normalizedFilters.startDate, normalizedFilters.endDate].filter(Boolean).join("_") || "geral";
    const packageDir = path.join(this.database.workspaceDir, "Pacotes Mensais", `${periodKey}-${stamp}`);
    fs.mkdirSync(packageDir, { recursive: true });

    const generatedFiles = [];
    const operations = [
      () => this.generateMonthlyExecutiveReport(normalizedFilters),
      () => this.generateReport({ ...normalizedFilters, type: "descontos" }),
      () => this.generateReport({ ...normalizedFilters, type: "funcionario" }),
      () => normalizedFilters.monthRef ? this.generatePayslipsByMonth(normalizedFilters.monthRef) : { ok: true, path: "" },
      () => this.database.exportMonthlyPayrollExcel(normalizedFilters),
      () => this.database.exportStatePaymentsExcel(normalizedFilters)
    ];

    for (const createFile of operations) {
      const result = await createFile();
      if (!result?.ok) {
        return result;
      }
      if (!result.path) {
        continue;
      }
      const targetPath = path.join(packageDir, path.basename(result.path));
      fs.copyFileSync(result.path, targetPath);
      generatedFiles.push(targetPath);
    }

    return {
      ok: true,
      path: packageDir,
      files: generatedFiles,
      count: generatedFiles.length
    };
  }

  async generateReport(payload = {}) {
    const filters = normalizeReportPayload(payload);
    const { type } = filters;
    if ((type || "").toLowerCase() === "anual") {
      return this.generateAnnualExecutiveReport(filters);
    }

    if ((type || "").toLowerCase() === "irt-anual") {
      return this.generateAnnualTaxReport(filters, "irt");
    }

    if ((type || "").toLowerCase() === "inss-anual") {
      return this.generateAnnualTaxReport(filters, "inss");
    }

    if ((type || "mensal") === "mensal") {
      return this.generateMonthlyExecutiveReport(filters);
    }

    if ((type || "").toLowerCase() === "funcionario") {
      return this.generateEmployeeDetailedReport(filters);
    }

    const normalizedType = String(type || "").toLowerCase();
    let rows;
    let emptyMessage = "Não existem salários processados para gerar este relatório no período selecionado.";

    if (normalizedType === "faltas" || normalizedType === "presencas") {
      const attendanceData = this.database.buildAttendanceReportData(filters, normalizedType);
      rows = attendanceData.rows;
      if (!rows.length) {
        return {
          ok: false,
          message:
            normalizedType === "faltas"
              ? "Não existem registos de faltas para gerar este relatório no período selecionado."
              : "Não existem registos de presenças para gerar este relatório no período selecionado."
        };
      }
    }

    if (["turnos-trabalhador", "turnos-departamento", "mapa-docente"].includes(normalizedType)) {
      const shiftData = this.database.buildShiftMapData(filters);
      if (!shiftData?.ok) {
        return shiftData;
      }

      rows =
        normalizedType === "turnos-trabalhador"
          ? shiftData.employeeRows
          : normalizedType === "turnos-departamento"
            ? shiftData.departmentRows
            : shiftData.teacherRows;

      if (!rows.length) {
        return {
          ok: false,
          message:
            normalizedType === "turnos-trabalhador"
              ? "Não existem turnos atribuídos ou registos de assiduidade para gerar o mapa mensal de turnos neste período."
              : normalizedType === "turnos-departamento"
                ? "Não existem departamentos com turnos ou assiduidade registada para este período."
                : "Não existem turnos docentes ou registos letivos para gerar o mapa docente neste período."
        };
      }
      emptyMessage =
        normalizedType === "turnos-trabalhador"
          ? "Não existem turnos atribuídos ou registos de assiduidade para gerar o mapa mensal de turnos neste período."
          : normalizedType === "turnos-departamento"
            ? "Não existem departamentos com turnos ou assiduidade registada para este período."
            : "Não existem turnos docentes ou registos letivos para gerar o mapa docente neste período.";
    }

    const company = this.database.getCompanyProfile();
    if (!rows) {
      rows = this.database.listPayrollRuns(filters);
    }
    if (!rows.length) {
      return { ok: false, message: emptyMessage };
    }

    const report = this.resolveReportDefinition(normalizedType);
    const periodLabel = this.resolveReportPeriodLabel(filters);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const logo = await this.loadLogo(doc, company.logo_path);
    let pageNumber = 1;
    let pageContext = this.createTabularReportPage({
      doc,
      company,
      title: this.reportTitle(normalizedType || type),
      sectionLabel: report.sectionLabel,
      periodLabel,
      rowsCount: rows.length,
      report,
      font,
      bold,
      logo,
      pageNumber
    });
    let page = pageContext.page;
    let y = pageContext.firstRowY;

    let rowIndex = 0;
    for (const row of rows) {
      if (y < pageContext.bottomY) {
        pageNumber += 1;
        pageContext = this.createTabularReportPage({
          doc,
          company,
          title: this.reportTitle(normalizedType || type),
          sectionLabel: `${report.sectionLabel} (continuação)`,
          periodLabel,
          rowsCount: rows.length,
          report,
          font,
          bold,
          logo,
          pageNumber
        });
        page = pageContext.page;
        y = pageContext.firstRowY;
      }

      y = this.drawTabularReportRow({
        page,
        y,
        row,
        rowIndex,
        columns: pageContext.columns,
        rowHeight: report.rowHeight,
        font
      });
      rowIndex += 1;
    }

    if (y < 144) {
      pageNumber += 1;
      pageContext = this.createTabularReportPage({
        doc,
        company,
        title: this.reportTitle(normalizedType || type),
        sectionLabel: "Resumo",
        periodLabel,
        rowsCount: rows.length,
        report,
        font,
        bold,
        logo,
        pageNumber
      });
      page = pageContext.page;
      y = pageContext.firstRowY - 8;
    }

    this.drawReportTotals({ page, y: y - 8, type: normalizedType, rows, font, bold });

    const fileName = `relatorio-${type}-${filters.monthRef || [filters.startDate, filters.endDate].filter(Boolean).join("_") || "geral"}.pdf`;
    const output = path.join(this.database.exportsDir, fileName);
    const saved = await this.saveValidatedPdf(doc, output, { documentType: `report_${type}`, minimumPages: 1 });
    return { ok: true, path: output, qaReport: saved.qaReport };
  }

  async generateEmployeeDetailedReport(filters) {
    const normalizedFilters = normalizeReportPayload(filters);
    const monthRef = normalizedFilters.monthRef;
    const company = this.database.getCompanyProfile();
    const rows = this.database
      .listPayrollRuns(normalizedFilters)
      .sort((left, right) => String(left.full_name || "").localeCompare(String(right.full_name || ""), "pt"));
    if (!rows.length) {
      return { ok: false, message: "Não existem salários processados para gerar o relatório individual no período selecionado." };
    }

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const logo = await this.loadLogo(doc, company.logo_path);

    const pageCapacity = 18;
    const indexPageCount = Math.max(1, Math.ceil(rows.length / pageCapacity));
    const indexedRows = rows.map((row, index) => ({
      row,
      reportPageNumber: indexPageCount + index + 1
    }));

    for (let offset = 0; offset < indexedRows.length || offset === 0; offset += pageCapacity) {
      const indexPage = doc.addPage(A4);
      this.drawStandardReportPage({
        page: indexPage,
        company,
        title: "Relatório por funcionário",
        section: indexPageCount > 1 ? `Índice ${Math.floor(offset / pageCapacity) + 1}` : "Índice",
        font,
        bold,
        logo,
        pageNumber: Math.floor(offset / pageCapacity) + 1
      });
      this.drawEmployeeReportIndexPage({
        page: indexPage,
        rows: indexedRows.slice(offset, offset + pageCapacity),
        monthRef,
        font,
        bold
      });
      if (!indexedRows.length) {
        break;
      }
    }

    indexedRows.forEach((entry, index) => {
      const detailedRun = this.database.getPayrollRun(entry.row.id) || entry.row;
      const page = doc.addPage(A4);
      this.drawStandardReportPage({
        page,
        company,
        title: "Relatório Individual do Funcionário",
        section: `${index + 1}`,
        font,
        bold,
        logo,
        pageNumber: entry.reportPageNumber
      });
      this.drawEmployeeReportPage({
        page,
        company,
        run: detailedRun,
        periodRows: rows,
        font,
        bold
      });
    });

    const fileName = `relatorio-funcionario-${monthRef || [normalizedFilters.startDate, normalizedFilters.endDate].filter(Boolean).join("_") || "geral"}.pdf`;
    const output = path.join(this.database.exportsDir, fileName);
    const saved = await this.saveValidatedPdf(doc, output, { documentType: "employee_detailed_report", minimumPages: 1 });
    return { ok: true, path: output, count: rows.length, qaReport: saved.qaReport };
  }

  drawEmployeeReportIndexPage({ page, rows, monthRef, font, bold }) {
    const { width, height } = page.getSize();
    const topY = height - 156;
    page.drawText("Lista de funcionários incluídos", {
      x: REPORT_MARGIN,
      y: topY,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    page.drawText(
      monthRef
        ? `Consulte a página indicada para abrir o detalhe de cada funcionário no período ${monthRef}.`
        : "Consulte a página indicada para abrir o detalhe de cada funcionário.",
      {
        x: REPORT_MARGIN,
        y: topY - 22,
        font,
        size: 10.5,
        color: REPORT_COLORS.subtitle
      }
    );

    const headersY = topY - 56;
    const nameX = REPORT_MARGIN + 18;
    const departmentX = REPORT_MARGIN + 314;
    const pageX = width - REPORT_MARGIN - 90;
    page.drawRectangle({
      x: REPORT_MARGIN,
      y: headersY - 12,
      width: width - REPORT_MARGIN * 2,
      height: 22,
      color: REPORT_COLORS.title
    });
    page.drawText("Funcionário", { x: nameX, y: headersY - 4, font: bold, size: 8.8, color: rgb(1, 1, 1) });
    page.drawText("Departamento / Cargo", { x: departmentX, y: headersY - 4, font: bold, size: 8.8, color: rgb(1, 1, 1) });
    page.drawText("Página", { x: pageX, y: headersY - 4, font: bold, size: 8.8, color: rgb(1, 1, 1) });

    let y = headersY - 34;
    const safeRows = rows.length
      ? rows
      : [{ row: { full_name: "Sem funcionários processados", department: "-", job_title: "-" }, reportPageNumber: "-" }];
    safeRows.forEach((entry, index) => {
      page.drawRectangle({
        x: REPORT_MARGIN,
        y: y - 8,
        width: width - REPORT_MARGIN * 2,
        height: 24,
        color: index % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1)
      });
      this.drawFittedText(page, entry.row.full_name || "-", nameX, y, font, 10, 270, REPORT_COLORS.text);
      this.drawFittedText(
        page,
        `${entry.row.department || "-"} | ${entry.row.job_title || entry.row.contract_type || "-"}`,
        departmentX,
        y,
        font,
        9.6,
        250,
        REPORT_COLORS.text
      );
      page.drawText(String(entry.reportPageNumber), {
        x: pageX + 16,
        y,
        font: bold,
        size: 10,
        color: REPORT_COLORS.title
      });
      y -= 28;
    });

    page.drawRectangle({
      x: REPORT_MARGIN,
      y: 68,
      width: width - REPORT_MARGIN * 2,
      height: 74,
      color: REPORT_COLORS.mutedFill,
      borderColor: REPORT_COLORS.line,
      borderWidth: 0.6
    });
    this.drawWrappedText({
      page,
      text: "Cada funcionário segue em páginas próprias para facilitar a consulta individual, a impressão seletiva e a navegação dentro do relatório.",
      x: REPORT_MARGIN + 16,
      y: 114,
      maxWidth: width - REPORT_MARGIN * 2 - 32,
      lineHeight: 14,
      font,
      size: 10.2,
      color: REPORT_COLORS.text
    });
  }

  async generateMonthlyExecutiveReport(filters) {
    const normalizedFilters = normalizeReportPayload(filters);
    const monthRef = normalizedFilters.monthRef;
    const data = this.buildMonthlyReportData(normalizedFilters);
    if (!data.rows.length) {
      return { ok: false, message: "Não existem salários processados para gerar o relatório mensal deste período." };
    }
    const { company } = data;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const logo = await this.loadLogo(doc, company.logo_path);
    const pages = [];

    const coverPage = doc.addPage(A4);
    pages.push(coverPage);
    this.drawMonthlyCoverPage({ page: coverPage, data, font, bold, logo });

    const summaryPage = doc.addPage(A4);
    pages.push(summaryPage);
    this.drawStandardReportPage({ page: summaryPage, company, title: "Sumario Executivo", section: "Indice", font, bold, logo, pageNumber: 2 });

    const overviewPage = doc.addPage(A4);
    pages.push(overviewPage);
    this.drawStandardReportPage({ page: overviewPage, company, title: "Resumo Geral", section: "1", font, bold, logo, pageNumber: 3 });
    this.drawMonthlySummaryPage({ page: overviewPage, data, font, bold });

    const indicatorsPage = doc.addPage(A4);
    pages.push(indicatorsPage);
    this.drawStandardReportPage({ page: indicatorsPage, company, title: "Indicadores Financeiros", section: "2", font, bold, logo, pageNumber: 4 });
    this.drawIndicatorsPage({ page: indicatorsPage, data, font, bold });

    const tablePages = this.drawDetailedTablePages({ doc, company, data, font, bold, logo, startPageNumber: pages.length + 1 });
    pages.push(...tablePages);

    const chargesPage = doc.addPage(A4);
    pages.push(chargesPage);
    this.drawStandardReportPage({
      page: chargesPage,
      company,
      title: "Encargos e Obrigações",
      section: "4",
      font,
      bold,
      logo,
      pageNumber: pages.length
    });
    this.drawChargesPage({ page: chargesPage, data, font, bold });

    const observationsPage = doc.addPage(A4);
    pages.push(observationsPage);
    this.drawStandardReportPage({
      page: observationsPage,
      company,
      title: "Observações do Período",
      section: "5",
      font,
      bold,
      logo,
      pageNumber: pages.length
    });
    this.drawObservationsPage({ page: observationsPage, data, font, bold });

    const signaturesPage = doc.addPage(A4);
    pages.push(signaturesPage);
    this.drawStandardReportPage({
      page: signaturesPage,
      company,
      title: "Assinaturas",
      section: "6",
      font,
      bold,
      logo,
      pageNumber: pages.length
    });
    this.drawSignaturesPage({ page: signaturesPage, data, font, bold });

    this.drawTableOfContents({
      page: summaryPage,
      data,
      font,
      bold,
      entries: [
        { label: "Resumo Geral", page: 3 },
        { label: "Indicadores Financeiros", page: 4 },
        { label: "Tabela Salarial Detalhada", page: 5 },
        { label: "Encargos e Obrigações", page: 5 + tablePages.length },
        { label: "Observações do Período", page: 6 + tablePages.length },
        { label: "Assinaturas", page: 7 + tablePages.length }
      ]
    });

    const fileName = `relatorio-mensal-${monthRef || [normalizedFilters.startDate, normalizedFilters.endDate].filter(Boolean).join("_") || "geral"}.pdf`;
    const output = path.join(this.database.exportsDir, fileName);
    const saved = await this.saveValidatedPdf(doc, output, { documentType: "monthly_executive_report", minimumPages: 1 });
    return { ok: true, path: output, qaReport: saved.qaReport };
  }

  drawEmployeeReportPage({ page, company, run, periodRows, font, bold }) {
    const { width, height } = page.getSize();
    const sectionTop = height - 150;
    const cardWidth = (width - REPORT_MARGIN * 2 - 18) / 2;
    const summary = run.summary_json || {};
    const employeeRowsThisYear = this.database.listPayrollRuns().filter(
      (item) => Number(item.employee_id) === Number(run.employee_id) && String(item.month_ref || "").startsWith(String(run.month_ref || "").slice(0, 4))
    );
    const totalReceivedInYear = employeeRowsThisYear.reduce((sum, item) => sum + Number(item.net_salary || 0), 0);
    const totalEmployerCostPeriod = periodRows.reduce((sum, item) => sum + Number(item.summary_json?.employerCost || item.gross_salary || 0), 0);
    const currentEmployerCost = Number(summary.employerCost || run.gross_salary || 0);
    const participation = this.percentageOf(currentEmployerCost, totalEmployerCostPeriod);

    page.drawText("Período analisado", {
      x: REPORT_MARGIN,
      y: sectionTop,
      font: bold,
      size: 11,
      color: REPORT_COLORS.title
    });
    page.drawText(this.formatMonthYear(run.month_ref), {
      x: REPORT_MARGIN + 118,
      y: sectionTop,
      font,
      size: 11,
      color: REPORT_COLORS.text
    });
    page.drawText(`Data de emissão: ${this.formatDate(new Date().toISOString())}`, {
      x: width - REPORT_MARGIN - 170,
      y: sectionTop,
      font,
      size: 10,
      color: REPORT_COLORS.subtitle
    });

    page.drawRectangle({
      x: REPORT_MARGIN,
      y: sectionTop - 118,
      width: width - REPORT_MARGIN * 2,
      height: 94,
      color: REPORT_COLORS.altFill,
      borderColor: REPORT_COLORS.line,
      borderWidth: 0.8
    });
    page.drawText("Identificação do funcionário", {
      x: REPORT_MARGIN + 16,
      y: sectionTop - 36,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });

    const infoRows = [
      ["Nome completo", run.full_name || "-"],
      ["Nº mecanográfico", String(run.employee_id || "-")],
      ["Departamento", run.department || "-"],
      ["Cargo", run.job_title || run.contract_type || "-"],
      ["Data de admissão", this.formatDate(run.hire_date) || "-"]
    ];
    let infoY = sectionTop - 60;
    infoRows.forEach(([label, value], index) => {
      const x = index < 3 ? REPORT_MARGIN + 16 : REPORT_MARGIN + cardWidth + 42;
      const y = index < 3 ? infoY - index * 20 : sectionTop - 60 - (index - 3) * 20;
      page.drawText(label, { x, y, font: bold, size: 9.6, color: REPORT_COLORS.subtitle });
      this.drawFittedText(page, value, x + 104, y, font, 10.2, 220, REPORT_COLORS.text);
    });

    page.drawText("Resumo do período", {
      x: REPORT_MARGIN,
      y: sectionTop - 146,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });
    const metricY = sectionTop - 236;
    [
      ["Salário bruto", this.currency(run.gross_salary)],
      ["Total de descontos", this.currency(summary.totalDeductions || 0)],
      ["Salário líquido", this.currency(run.net_salary)],
      ["Custo total para a empresa", this.currency(currentEmployerCost)]
    ].forEach(([label, value], index) => {
      this.drawMetricCard({
        page,
        x: REPORT_MARGIN + index * 122,
        y: metricY,
        width: 110,
        height: 74,
        label,
        value,
        font,
        bold
      });
    });

    page.drawText("Detalhe das remunerações", {
      x: REPORT_MARGIN,
      y: sectionTop - 274,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });
    this.drawEmployeeDetailTable({
      page,
      x: REPORT_MARGIN,
      y: sectionTop - 300,
      width: cardWidth,
      title: null,
      headers: ["Descrição", "Referência", "Valor"],
      rows: this.getEmployeeRemunerationRows(run),
      font,
      bold
    });

    page.drawText("Detalhe dos descontos", {
      x: REPORT_MARGIN + cardWidth + 18,
      y: sectionTop - 274,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });
    this.drawEmployeeDetailTable({
      page,
      x: REPORT_MARGIN + cardWidth + 18,
      y: sectionTop - 300,
      width: cardWidth,
      title: null,
      headers: ["Descrição", "Referência", "Valor"],
      rows: this.getEmployeeDeductionRows(run),
      font,
      bold
    });

    page.drawText("Indicadores do funcionário", {
      x: REPORT_MARGIN,
      y: 180,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });
    [
      ["Custo mensal para a empresa", this.currency(currentEmployerCost)],
      ["Participação no custo total da folha", this.formatPercentage(participation)],
      ["Total recebido no ano", this.currency(totalReceivedInYear)]
    ].forEach(([label, value], index) => {
      this.drawMetricCard({
        page,
        x: REPORT_MARGIN + index * 164,
        y: 86,
        width: 150,
        height: 74,
        label,
        value,
        font,
        bold
      });
    });

    page.drawRectangle({
      x: REPORT_MARGIN,
      y: 34,
      width: width - REPORT_MARGIN * 2,
      height: 38,
      color: REPORT_COLORS.mutedFill,
      borderColor: REPORT_COLORS.line,
      borderWidth: 0.6
    });
    this.drawWrappedText({
      page,
      text: `Este relatório individual consolida as principais componentes remuneratórias e os descontos legais do período, permitindo uma leitura clara do valor líquido pago e do custo total suportado pela empresa.`,
      x: REPORT_MARGIN + 12,
      y: 56,
      maxWidth: width - REPORT_MARGIN * 2 - 24,
      lineHeight: 14,
      font,
      size: 9.8,
      color: REPORT_COLORS.text
    });
  }

  drawEmployeeDetailTable({ page, x, y, width, headers, rows, font, bold }) {
    const descriptionWidth = width - 150;
    const referenceX = x + descriptionWidth + 16;
    const valueRightX = x + width - 10;
    page.drawRectangle({ x, y: y - 18, width, height: 22, color: REPORT_COLORS.title });
    page.drawText(headers[0], { x: x + 8, y: y - 10, font: bold, size: 8.5, color: rgb(1, 1, 1) });
    page.drawText(headers[1], { x: referenceX, y: y - 10, font: bold, size: 8.5, color: rgb(1, 1, 1) });
    page.drawText(headers[2], { x: valueRightX - 34, y: y - 10, font: bold, size: 8.5, color: rgb(1, 1, 1) });

    let rowY = y - 42;
    const safeRows = rows.length ? rows : [{ description: "Sem registos no período.", reference: "-", value: this.currency(0) }];
    safeRows.forEach((row, index) => {
      page.drawRectangle({
        x,
        y: rowY - 6,
        width,
        height: 22,
        color: index % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1)
      });
      this.drawFittedText(page, row.description, x + 8, rowY, font, 9.2, descriptionWidth - 6, REPORT_COLORS.text);
      this.drawFittedText(page, row.reference || "-", referenceX, rowY, font, 9.2, 62, REPORT_COLORS.text);
      this.drawRightText(page, row.value, valueRightX, rowY, font, 9.2);
      rowY -= 24;
    });
  }

  getEmployeeRemunerationRows(run) {
    const summary = run.summary_json || {};
    const rows = [
      { description: "Salário base", reference: "Mensal", value: this.currency(summary.baseSalary || 0) }
    ];
    (summary.allowances || []).forEach((item) => {
      rows.push({
        description: this.normalizeEarningLabel(item.label, "Subsídio"),
        reference: item.quantity ? this.formatReferenceValue(item.quantity) : "1",
        value: this.currency(item.amount || 0)
      });
    });
    (summary.bonuses || []).forEach((item) => {
      rows.push({
        description: this.normalizeEarningLabel(item.label, "Bónus"),
        reference: item.quantity ? this.formatReferenceValue(item.quantity) : "1",
        value: this.currency(item.amount || 0)
      });
    });
    (summary.overtime || []).forEach((item) => {
      const label = String(item.label || "").toLowerCase();
      rows.push({
        description: label.includes("100") ? "Horas extra 100%" : label.includes("50") ? "Horas extra 50%" : "Horas extra",
        reference: item.quantity ? `${this.formatReferenceValue(item.quantity)} h` : "Horas",
        value: this.currency(item.amount || 0)
      });
    });
    return rows;
  }

  getEmployeeDeductionRows(run) {
    const summary = run.summary_json || {};
    return [
      { description: "Segurança Social", reference: "3%", amount: Number(run.inss_amount || 0) },
      { description: "IRT", reference: "Legal", amount: Number(run.irt_amount || 0) },
      {
        description: "Faltas e licenças",
        reference: `${this.formatReferenceValue((summary.absencesDays || 0) + (summary.leaveDays || 0))} dia(s)`,
        amount: Number(summary.absenceDeduction || 0) + Number(summary.leaveDeduction || 0)
      },
      {
        description: "Empréstimos e adiantamentos",
        reference: `${this.formatReferenceValue(summary.financialItems?.length || 0)} reg.`,
        amount: Number(summary.financialDeductions || 0)
      },
      { description: "Outros descontos", reference: "Diversos", amount: Number(summary.penalties || 0) }
    ]
      .filter((item) => item.amount > 0 || item.description === "Segurança Social" || item.description === "IRT")
      .map((item) => ({
        description: item.description,
        reference: item.reference,
        value: this.currency(item.amount)
      }));
  }

  drawDivider(page) {
    for (let y = 12; y < 586; y += 13) {
      page.drawLine({
        start: { x: 421, y },
        end: { x: 421, y: Math.min(y + 7, 586) },
        thickness: 1,
        color: rgb(0.42, 0.42, 0.42)
      });
    }
  }

  drawPayslipPanel({ page, company, run, font, bold, copyLabel, panelX, panelWidth }) {
    const panelRight = panelX + panelWidth;
    const titleY = 566;
    const sectionLine = rgb(0.84, 0.86, 0.89);
    const mutedLabel = rgb(0.33, 0.33, 0.33);
    const cardFill = rgb(0.978, 0.982, 0.988);

    page.drawText(copyLabel, { x: panelX, y: titleY, font: bold, size: 7, color: mutedLabel });
    page.drawText("Recibo de Vencimentos", { x: panelX, y: titleY - 28, font: bold, size: 15, color: rgb(0, 0, 0) });
    page.drawText("Documento salarial individual", {
      x: panelRight - 124,
      y: titleY - 27,
      font,
      size: 6.4,
      color: mutedLabel
    });
    page.drawLine({
      start: { x: panelX, y: titleY - 38 },
      end: { x: panelRight - 4, y: titleY - 38 },
      thickness: 1.8,
      color: rgb(0.08, 0.08, 0.08)
    });

    page.drawRectangle({
      x: panelX,
      y: titleY - 110,
      width: panelWidth - 4,
      height: 70,
      color: cardFill,
      borderColor: sectionLine,
      borderWidth: 0.6
    });
    page.drawText("Empresa", { x: panelX + 10, y: titleY - 56, font: bold, size: 6.6, color: mutedLabel });
    this.drawFittedText(page, company.name || "Empresa", panelX + 10, titleY - 72, bold, 11.5, panelWidth - 18, rgb(0, 0, 0), 7);
    page.drawText("Nome do trabalhador", { x: panelX + 10, y: titleY - 88, font: bold, size: 6.6, color: mutedLabel });
    this.drawFittedText(page, run.full_name || "-", panelX + 10, titleY - 103, bold, 10.8, panelWidth - 18, rgb(0, 0, 0), 7);

    const infoCards = this.getPayslipInfoRows(run, company);
    const infoStartY = titleY - 146;
    const cardGap = 8;
    const cardWidth = (panelWidth - 4 - cardGap * 2) / 3;
    const cardHeight = 38;
    infoCards.forEach((item, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = panelX + col * (cardWidth + cardGap);
      const y = infoStartY - row * (cardHeight + 8);
      page.drawRectangle({
        x,
        y,
        width: cardWidth,
        height: cardHeight,
        color: rgb(1, 1, 1),
        borderColor: sectionLine,
        borderWidth: 0.55
      });
      page.drawText(item.label, { x: x + 8, y: y + 25, font: bold, size: 6.4, color: mutedLabel });
      this.drawFittedText(page, item.value, x + 8, y + 11, font, 6.8, cardWidth - 16, rgb(0, 0, 0), 4.8);
    });

    const tableRows = this.getPayslipTableRows(run);
    const rowCount = Math.max(tableRows.length, 8);
    const tableTopY = infoStartY - 106;
    const codeX = panelX + 2;
    const descriptionX = panelX + 34;
    const referenceX = panelX + 186;
    const remunerationRightX = panelX + 296;
    const deductionsRightX = panelRight - 4;

    page.drawText("Código", { x: codeX, y: tableTopY, font: bold, size: 6.8, color: rgb(0, 0, 0) });
    page.drawText("Descrição", { x: descriptionX, y: tableTopY, font: bold, size: 6.8, color: rgb(0, 0, 0) });
    page.drawText("Referência", { x: referenceX, y: tableTopY, font: bold, size: 6.8, color: rgb(0, 0, 0) });
    page.drawText("Remunerações", { x: panelX + 238, y: tableTopY, font: bold, size: 6.8, color: rgb(0, 0, 0) });
    page.drawText("Descontos", { x: panelX + 315, y: tableTopY, font: bold, size: 6.8, color: rgb(0, 0, 0) });
    page.drawLine({
      start: { x: panelX, y: tableTopY - 5 },
      end: { x: panelRight, y: tableTopY - 5 },
      thickness: 0.9,
      color: sectionLine
    });

    let rowY = tableTopY - 19;
    for (let index = 0; index < rowCount; index += 1) {
      const row = tableRows[index];

      page.drawLine({
        start: { x: panelX, y: rowY + 8 },
        end: { x: panelRight, y: rowY + 8 },
        thickness: 0.45,
        color: rgb(0.86, 0.86, 0.86)
      });

      if (row) {
        page.drawText(row.code, { x: codeX, y: rowY, font, size: 6.8, color: rgb(0, 0, 0) });
        this.drawFittedText(page, row.description, descriptionX, rowY, font, 6.8, 142, rgb(0, 0, 0), 4.8);
        this.drawFittedText(page, row.reference || "-", referenceX, rowY, font, 6.8, 58, rgb(0, 0, 0), 4.8);
        if (row.remuneration) {
          this.drawRightText(page, row.remuneration, remunerationRightX, rowY, font, 6.8);
        }
        if (row.deduction) {
          this.drawRightText(page, row.deduction, deductionsRightX, rowY, font, 6.8);
        }
      }

      rowY -= 16;
    }

    const totalsY = 142;
    const totalsLeftX = panelX + 160;
    const totalsLabelX = totalsLeftX + 10;
    const totalsValueRightX = panelRight - 4;
    page.drawLine({
      start: { x: panelX, y: totalsY },
      end: { x: panelRight, y: totalsY },
      thickness: 1.1,
      color: rgb(0.1, 0.1, 0.1)
    });
    const totals = [
      { label: "Total de Remunerações", value: this.formatPlainNumber(run.gross_salary), bold: true },
      { label: "Total de Descontos", value: this.formatPlainNumber(run.summary_json.totalDeductions), bold: true },
      { label: "Total Ilíquido", value: this.formatPlainNumber(run.gross_salary), bold: false },
      { label: "Total Líquido a Receber", value: this.formatPlainNumber(run.net_salary), bold: true, accent: true }
    ];
    totals.forEach((item, index) => {
      const y = totalsY - 18 - index * 15;
      if (item.accent) {
        page.drawRectangle({
          x: totalsLeftX,
          y: y - 5,
          width: panelRight - totalsLeftX,
          height: 16,
          color: cardFill,
          borderColor: sectionLine,
          borderWidth: 0.4
        });
      }
      page.drawText(item.label, {
        x: totalsLabelX,
        y,
        font: item.bold ? bold : font,
        size: item.accent ? 7.1 : 6.8,
        color: rgb(0, 0, 0)
      });
      this.drawRightText(page, item.value, totalsValueRightX, y, item.bold ? bold : font, item.accent ? 7.4 : 6.8);
    });

    const observationTitleY = 60;
    const observationTextY = 46;
    const observationDateY = 22;
    page.drawText("Observações", { x: panelX, y: observationTitleY, font: bold, size: 6.8, color: rgb(0, 0, 0) });
    const observationLines = this.wrapTextLines(this.getObservationLine(run), font, 5.8, panelWidth - 10, 2);
    observationLines.forEach((line, index) => {
      page.drawText(line, {
        x: panelX,
        y: observationTextY - index * 8,
        font,
        size: 5.8,
        color: rgb(0, 0, 0)
      });
    });
    page.drawText(`Data: ${this.formatDate(run.generated_at)}`, {
      x: panelX,
      y: observationDateY,
      font,
      size: 5.9,
      color: mutedLabel
    });

    const signatureY = 34;
    page.drawLine({
      start: { x: panelX, y: signatureY },
      end: { x: panelX + 146, y: signatureY },
      thickness: 1.2,
      color: rgb(0.1, 0.1, 0.1)
    });
    page.drawLine({
      start: { x: panelRight - 146, y: signatureY },
      end: { x: panelRight, y: signatureY },
      thickness: 1.2,
      color: rgb(0.1, 0.1, 0.1)
    });
    page.drawText("Assinatura do trabalhador", { x: panelX, y: signatureY - 11, font, size: 5.9, color: mutedLabel });
    page.drawText("Assinatura da entidade empregadora", {
      x: panelRight - 146,
      y: signatureY - 11,
      font,
      size: 5.9,
      color: mutedLabel
    });
  }

  getPayslipInfoRows(run, company) {
    const paidDays = Math.max(22 - Number(run.summary_json.absencesDays || 0) - Number(run.summary_json.leaveDays || 0), 0);
    const hourlyRate = Number(run.summary_json.baseSalary || 0) / 176;
    return [
      { label: "Mês de Referência", value: this.formatMonthName(run.month_ref) },
      { label: "Departamento", value: run.department || "-" },
      { label: "Categoria Profissional", value: run.contract_type || run.job_title || "-" },
      { label: "Nº Mecanográfico", value: String(run.employee_id || "-") },
      { label: "Nº Beneficiário", value: run.bi || "-" },
      { label: "Nº Contribuinte", value: run.nif || "-" },
      { label: "Salário Base", value: `${this.formatPlainNumber(run.summary_json.baseSalary)} AOA` },
      { label: "Valor Hora", value: `${this.formatPlainNumber(hourlyRate)} AOA` },
      { label: "Dias Úteis Pagos", value: this.formatPlainNumber(paidDays) }
    ];
  }

  getPayslipTableRows(run) {
    const remunerationEntries = this.getPayslipRemunerationEntries(run).map((item) => ({
      code: item.code,
      description: item.description,
      reference: item.reference || "-",
      remuneration: item.amount,
      deduction: ""
    }));
    const deductionEntries = this.getPayslipDeductionEntries(run).map((item) => ({
      code: item.code,
      description: item.description,
      reference: item.reference || "-",
      remuneration: "",
      deduction: item.amount
    }));
    return [...remunerationEntries, ...deductionEntries];
  }

  getPayslipRemunerationEntries(run) {
    const entries = [
      {
        code: "R01",
        description: "Salário Base",
        reference: "Mensal",
        amount: this.formatPlainNumber(run.summary_json.baseSalary)
      }
    ];

    (run.summary_json.allowances || []).forEach((item, index) => {
      entries.push({
        code: `R${String(index + 2).padStart(2, "0")}`,
        description: this.normalizeEarningLabel(item.label, "Subsídio"),
        reference: item.quantity ? this.formatReferenceValue(item.quantity) : "1",
        amount: this.formatPlainNumber(item.amount)
      });
    });

    (run.summary_json.bonuses || []).forEach((item, index) => {
      entries.push({
        code: `R${String(index + 2 + (run.summary_json.allowances || []).length).padStart(2, "0")}`,
        description: this.normalizeEarningLabel(item.label, "Bónus"),
        reference: item.quantity ? this.formatReferenceValue(item.quantity) : "1",
        amount: this.formatPlainNumber(item.amount)
      });
    });

    (run.summary_json.overtime || []).forEach((item, index) => {
      const rawLabel = String(item.label || "").toLowerCase();
      const description = rawLabel.includes("100")
        ? "Horas Extra 100%"
        : rawLabel.includes("50")
          ? "Horas Extra 50%"
          : "Horas Extra";
      entries.push({
        code: `R${String(index + 2 + (run.summary_json.allowances || []).length + (run.summary_json.bonuses || []).length).padStart(2, "0")}`,
        description,
        reference: item.quantity ? `${this.formatReferenceValue(item.quantity)} h` : "Horas",
        amount: this.formatPlainNumber(item.amount)
      });
    });

    return entries;
  }

  getPayslipDeductionEntries(run) {
    return [
      ["D01", "Segurança Social", run.inss_amount],
      ["D02", "IRT", run.irt_amount],
      ["D03", "Faltas", run.summary_json.absenceDeduction],
      ["D04", "Licenças", run.summary_json.leaveDeduction],
      ["D05", "Empréstimos/Adiant.", run.summary_json.financialDeductions],
      ["D06", "Outros Descontos", run.summary_json.penalties]
    ]
      .filter(([, , value]) => Number(value || 0) > 0)
      .map(([code, description, value]) => ({
        code,
        description,
        reference: this.getDeductionReference(run, code),
        amount: this.formatPlainNumber(value)
      }));
  }

  drawRightText(page, text, rightX, y, font, size, color = rgb(0, 0, 0)) {
    const value = String(text || "");
    const width = font.widthOfTextAtSize(value, size);
    page.drawText(value, {
      x: Math.max(rightX - width, 0),
      y,
      font,
      size,
      color
    });
  }

  fitText(text, font, size, maxWidth) {
    const value = String(text || "");
    if (!value) {
      return "";
    }
    if (font.widthOfTextAtSize(value, size) <= maxWidth) {
      return value;
    }

    let shortened = value;
    while (shortened.length > 1 && font.widthOfTextAtSize(shortened, size) > maxWidth) {
      shortened = shortened.slice(0, -1);
    }
    return shortened.trim();
  }

  fitTextStyle(text, font, size, maxWidth, minSize = 5.2) {
    const value = String(text ?? "");
    if (!value) {
      return { text: "", size };
    }

    let fittedSize = size;
    while (fittedSize > minSize && font.widthOfTextAtSize(value, fittedSize) > maxWidth) {
      fittedSize = Math.max(minSize, Number((fittedSize - 0.2).toFixed(2)));
    }

    if (font.widthOfTextAtSize(value, fittedSize) <= maxWidth) {
      return { text: value, size: fittedSize };
    }

    let fittedText = value;
    while (fittedText.length > 1 && font.widthOfTextAtSize(fittedText, fittedSize) > maxWidth) {
      fittedText = fittedText.slice(0, -1);
    }
    return { text: fittedText.trim(), size: fittedSize };
  }

  drawFittedText(page, text, x, y, font, size, maxWidth, color = REPORT_COLORS.text, minSize = 5.2) {
    const fitted = this.fitTextStyle(text, font, size, maxWidth, minSize);
    page.drawText(fitted.text, {
      x,
      y,
      font,
      size: fitted.size,
      color
    });
    return fitted;
  }

  normalizeEarningLabel(label, prefix) {
    const value = String(label || "").trim();
    if (!value) {
      return prefix;
    }

    const lower = value.toLowerCase();
    if (lower.includes("aliment")) {
      return "Subsídio de Alimentação";
    }
    if (lower.includes("transport")) {
      return "Subsídio de Transporte";
    }
    if (lower.includes("assid")) {
      return "Subsídio de Assiduidade";
    }
    if (lower.includes("subsídio")) {
      return value;
    }
    if (lower.includes("bónus") || lower.includes("bonus")) {
      if (lower.includes("produt")) {
        return "Bónus de Produtividade";
      }
      return value.replace(/bonus/gi, "Bónus");
    }
    if (prefix === "Subsídio") {
      return `Subsídio de ${value}`;
    }
    return `${prefix} - ${value}`;
  }

  getObservationLine(run) {
    const baseText = "Este recibo comprova o pagamento do salário referente ao período indicado, incluindo as remunerações e os descontos legais aplicáveis.";
    if (run.iban) {
      return `${baseText} O pagamento foi processado por transferência bancária para a conta ${run.iban}.`;
    }
    return `${baseText} O pagamento foi efetuado por numerário ou por meio interno da entidade empregadora.`;
  }

  getDeductionReference(run, code) {
    if (code === "D01") {
      return "3%";
    }
    if (code === "D02") {
      return "Legal";
    }
    if (code === "D03") {
      return Number(run.summary_json.absencesDays || 0) > 0 ? `${this.formatReferenceValue(run.summary_json.absencesDays)} dia(s)` : "-";
    }
    if (code === "D04") {
      return Number(run.summary_json.leaveDays || 0) > 0 ? `${this.formatReferenceValue(run.summary_json.leaveDays)} dia(s)` : "-";
    }
    if (code === "D05") {
      return Number(run.summary_json?.financialItems?.length || 0) > 0
        ? `${this.formatReferenceValue(run.summary_json.financialItems.length)} reg.`
        : "-";
    }
    return "Diversos";
  }

  formatReferenceValue(value) {
    const numeric = Number(value || 0);
    if (Number.isInteger(numeric)) {
      return String(numeric);
    }
    return new Intl.NumberFormat("pt-PT", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(numeric);
  }

  createTabularReportPage({ doc, company, title, sectionLabel, periodLabel, rowsCount, report, font, bold, logo, pageNumber }) {
    const page = doc.addPage(A4_LANDSCAPE);
    this.drawStandardReportPage({
      page,
      company,
      title,
      section: sectionLabel || "Tabela",
      font,
      bold,
      logo,
      pageNumber
    });

    const { width, height } = page.getSize();
    const contentX = REPORT_MARGIN;
    const contentWidth = width - REPORT_MARGIN * 2;
    const metaTopY = height - 148;

    page.drawRectangle({
      x: contentX,
      y: metaTopY - 36,
      width: contentWidth,
      height: 30,
      color: REPORT_COLORS.mutedFill
    });
    page.drawText(report.tableTitle, {
      x: contentX + 12,
      y: metaTopY - 24,
      font: bold,
      size: 10.4,
      color: REPORT_COLORS.title
    });
    page.drawText(`Período: ${periodLabel}`, {
      x: contentX + 238,
      y: metaTopY - 24,
      font,
      size: 9.6,
      color: REPORT_COLORS.text
    });
    page.drawText(`Registos: ${rowsCount}`, {
      x: width - REPORT_MARGIN - 180,
      y: metaTopY - 24,
      font,
      size: 9.6,
      color: REPORT_COLORS.text
    });
    page.drawText(`Emitido: ${this.formatDate(new Date().toISOString())}`, {
      x: width - REPORT_MARGIN - 180,
      y: metaTopY - 36,
      font,
      size: 8.8,
      color: REPORT_COLORS.subtitle
    });

    const columns = this.normalizeTabularColumns(report.columns || [], contentX + 8, contentWidth - 16);
    const tableHeaderY = metaTopY - 62;
    this.drawTabularReportHeader({ page, y: tableHeaderY, columns, font: bold });

    return {
      page,
      columns,
      firstRowY: tableHeaderY - 22,
      bottomY: 92
    };
  }

  normalizeTabularColumns(columns, x, availableWidth) {
    const safeColumns = Array.isArray(columns) && columns.length ? columns : [];
    const rawTotalWidth = safeColumns.reduce((sum, column) => sum + Number(column.width || 0), 0);
    const scale = rawTotalWidth > availableWidth && rawTotalWidth > 0 ? availableWidth / rawTotalWidth : 1;

    let currentX = x;
    return safeColumns.map((column, index) => {
      const isLast = index === safeColumns.length - 1;
      const scaledWidth = Math.max(44, Math.round(Number(column.width || 0) * scale));
      const width = isLast ? Math.max(44, x + availableWidth - currentX) : scaledWidth;
      const normalized = {
        ...column,
        x: currentX,
        width
      };
      currentX += width;
      return normalized;
    });
  }

  drawTabularReportHeader({ page, y, columns, font }) {
    const firstColumn = columns[0];
    const lastColumn = columns[columns.length - 1];
    if (!firstColumn || !lastColumn) {
      return;
    }

    page.drawRectangle({
      x: firstColumn.x,
      y: y - 9,
      width: lastColumn.x + lastColumn.width - firstColumn.x,
      height: 22,
      color: REPORT_COLORS.title
    });

    columns.forEach((column) => {
      page.drawText(column.label, {
        x: column.x + 4,
        y: y - 1,
        font,
        size: 8.2,
        color: rgb(1, 1, 1)
      });
    });
  }

  drawTabularReportRow({ page, y, row, rowIndex, columns, rowHeight, font }) {
    const firstColumn = columns[0];
    const lastColumn = columns[columns.length - 1];
    if (!firstColumn || !lastColumn) {
      return y;
    }

    page.drawRectangle({
      x: firstColumn.x,
      y: y - 4,
      width: lastColumn.x + lastColumn.width - firstColumn.x,
      height: rowHeight,
      color: rowIndex % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1)
    });

    columns.forEach((column) => {
      const rawValue = typeof column.getValue === "function" ? column.getValue(row) : row?.[column.key];
      this.drawTabularReportCell({
        page,
        value: rawValue,
        column,
        y: y + 3,
        font,
        size: 8.6
      });
    });

    return y - rowHeight;
  }

  drawTabularReportCell({ page, value, column, y, font, size }) {
    const text = String(value ?? "-");
    const maxWidth = Math.max(column.width - 8, 12);

    if (column.align === "right") {
      this.drawRightAlignedWithin(page, text, column.x + column.width - 4, y, font, size, maxWidth);
      return;
    }

    if (column.align === "center") {
      this.drawCenteredText(page, text, column.x + 4, y, column.width - 8, font, size, REPORT_COLORS.text);
      return;
    }

    this.drawFittedText(page, text, column.x + 4, y, font, size, maxWidth, REPORT_COLORS.text);
  }

  resolveReportDefinition(type) {
    const definitions = {
      mensal: {
        sectionLabel: "Tabela geral",
        tableTitle: "Detalhe mensal de salários processados",
        rowHeight: 20,
        columns: [
          { label: "Funcionário", width: 200, getValue: (row) => row.full_name || "-" },
          { label: "Mês", width: 78, align: "center", getValue: (row) => row.month_ref || "-" },
          { label: "Bruto", width: 98, align: "right", getValue: (row) => this.currency(row.gross_salary) },
          { label: "Subsídios", width: 98, align: "right", getValue: (row) => this.currency(row.allowances_total) },
          { label: "Bónus", width: 90, align: "right", getValue: (row) => this.currency(row.bonuses_total) },
          { label: "Líquido", width: 98, align: "right", getValue: (row) => this.currency(row.net_salary) }
        ]
      },
      descontos: {
        sectionLabel: "Tabela de descontos",
        tableTitle: "Resumo dos descontos por colaborador e período",
        rowHeight: 20,
        columns: [
          { label: "Funcionário", width: 170, getValue: (row) => row.full_name || "-" },
          { label: "Mês", width: 72, align: "center", getValue: (row) => row.month_ref || "-" },
          { label: "IRT", width: 84, align: "right", getValue: (row) => this.currency(row.irt_amount) },
          { label: "INSS Func.", width: 86, align: "right", getValue: (row) => this.currency(row.inss_amount) },
          { label: "Faltas/Lic.", width: 98, align: "right", getValue: (row) => this.currency(row.absence_deduction) },
          {
            label: "Outros Desc.",
            width: 96,
            align: "right",
            getValue: (row) => this.currency(Number(row.summary_json?.penalties || 0) + Number(row.summary_json?.financialDeductions || 0))
          },
          {
            label: "Total",
            width: 96,
            align: "right",
            getValue: (row) =>
              this.currency(
                Number(row.irt_amount || 0) +
                Number(row.inss_amount || 0) +
                Number(row.absence_deduction || 0) +
                Number(row.summary_json?.penalties || 0) +
                Number(row.summary_json?.financialDeductions || 0)
              )
          }
        ]
      },
      funcionario: {
        sectionLabel: "Tabela por funcionário",
        tableTitle: "Comparativo por colaborador no período selecionado",
        rowHeight: 20,
        columns: [
          { label: "Funcionário", width: 166, getValue: (row) => row.full_name || "-" },
          { label: "Departamento", width: 128, getValue: (row) => row.department || "-" },
          { label: "Cargo", width: 128, getValue: (row) => row.job_title || "-" },
          { label: "Mês", width: 76, align: "center", getValue: (row) => row.month_ref || "-" },
          { label: "Líquido", width: 100, align: "right", getValue: (row) => this.currency(row.net_salary) },
          { label: "Custo Emp.", width: 106, align: "right", getValue: (row) => this.currency(row.summary_json?.employerCost || row.gross_salary) }
        ]
      },
      faltas: {
        sectionLabel: "Mapa de faltas",
        tableTitle: "Registos de assiduidade marcados como falta",
        rowHeight: 20,
        columns: [
          { label: "Funcionário", width: 150, getValue: (row) => row.full_name || "-" },
          { label: "Departamento", width: 120, getValue: (row) => row.department || "-" },
          { label: "Data", width: 90, align: "center", getValue: (row) => row.attendance_date || "-" },
          { label: "Estado", width: 92, align: "center", getValue: (row) => row.status_label || "-" },
          { label: "Horas", width: 72, align: "right", getValue: (row) => this.formatPlainNumber(row.hours_worked) },
          { label: "Observações", width: 176, getValue: (row) => row.notes || "-" }
        ]
      },
      presencas: {
        sectionLabel: "Mapa de presenças",
        tableTitle: "Registos de presença e atrasos no período",
        rowHeight: 20,
        columns: [
          { label: "Funcionário", width: 152, getValue: (row) => row.full_name || "-" },
          { label: "Departamento", width: 120, getValue: (row) => row.department || "-" },
          { label: "Data", width: 92, align: "center", getValue: (row) => row.attendance_date || "-" },
          { label: "Estado", width: 90, align: "center", getValue: (row) => row.status_label || "-" },
          { label: "Horas", width: 72, align: "right", getValue: (row) => this.formatPlainNumber(row.hours_worked) },
          { label: "Atraso", width: 106, align: "right", getValue: (row) => `${Number(row.delay_minutes || 0).toFixed(0)} min` }
        ]
      },
      "turnos-trabalhador": {
        sectionLabel: "Mapa de turnos",
        tableTitle: "Consolidação por trabalhador e turno atribuído",
        rowHeight: 20,
        columns: [
          { label: "Funcionário", width: 136, getValue: (row) => row.full_name || "-" },
          { label: "Departamento", width: 98, getValue: (row) => row.department || "-" },
          { label: "Turno", width: 128, getValue: (row) => row.shift_name || "-" },
          { label: "Dias", width: 46, align: "right", getValue: (row) => String(row.planned_days || 0) },
          { label: "Pres.", width: 52, align: "right", getValue: (row) => String(Number(row.present_days || 0) + Number(row.delay_days || 0)) },
          { label: "Atrasos", width: 54, align: "right", getValue: (row) => String(row.delay_days || 0) },
          { label: "Faltas", width: 54, align: "right", getValue: (row) => String(Number(row.absent_days || 0) + Number(row.half_absence_days || 0)) },
          { label: "Horas", width: 58, align: "right", getValue: (row) => this.formatPlainNumber(row.hours_worked) },
          { label: "Pont.", width: 62, align: "right", getValue: (row) => `${Number(row.punctuality_rate || 0).toFixed(1)}%` }
        ]
      },
      "turnos-departamento": {
        sectionLabel: "Mapa departamental",
        tableTitle: "Consolidação de turnos por departamento",
        rowHeight: 20,
        columns: [
          { label: "Departamento", width: 140, getValue: (row) => row.department || "-" },
          { label: "Trab.", width: 50, align: "right", getValue: (row) => String(row.employees_count || 0) },
          { label: "Turnos", width: 138, getValue: (row) => row.shifts_label || "-" },
          { label: "Pres.", width: 54, align: "right", getValue: (row) => String(Number(row.present_days || 0) + Number(row.delay_days || 0)) },
          { label: "Atrasos", width: 54, align: "right", getValue: (row) => String(row.delay_days || 0) },
          { label: "Faltas", width: 54, align: "right", getValue: (row) => String(row.absent_days || 0) },
          { label: "Lic./Fér.", width: 62, align: "right", getValue: (row) => String(Number(row.leave_days || 0) + Number(row.vacation_days || 0)) },
          { label: "Horas", width: 56, align: "right", getValue: (row) => this.formatPlainNumber(row.hours_worked) },
          { label: "Cobertura", width: 66, align: "right", getValue: (row) => `${Number(row.coverage_rate || 0).toFixed(1)}%` }
        ]
      },
      "mapa-docente": {
        sectionLabel: "Mapa docente",
        tableTitle: "Consolidação mensal de turnos e carga letiva",
        rowHeight: 20,
        columns: [
          { label: "Docente", width: 130, getValue: (row) => row.full_name || "-" },
          { label: "Turno", width: 104, getValue: (row) => row.shift_name || "-" },
          { label: "Blocos letivos", width: 158, getValue: (row) => row.blocks_label || "-" },
          { label: "Carga prev.", width: 62, align: "right", getValue: (row) => this.formatPlainNumber(row.expected_hours) },
          { label: "Carga reg.", width: 62, align: "right", getValue: (row) => this.formatPlainNumber(row.hours_worked) },
          { label: "Pres.", width: 50, align: "right", getValue: (row) => String(row.present_days || 0) },
          { label: "Atrasos", width: 52, align: "right", getValue: (row) => String(row.delay_days || 0) },
          { label: "Faltas", width: 52, align: "right", getValue: (row) => String(row.absent_days || 0) }
        ]
      }
    };

    return definitions[String(type || "mensal").toLowerCase()] || definitions.mensal;
  }

  resolveReportPeriodLabel(filters) {
    if (filters.startDate || filters.endDate) {
      return `${filters.startDate || "?"} a ${filters.endDate || "?"}`;
    }
    if (filters.monthRef) {
      return this.formatMonthYear(filters.monthRef);
    }
    return "Todos os períodos";
  }

  drawReportTotals({ page, y, type, rows, font, bold }) {
    const totalsByType = {
      mensal: [
        `Bruto total: ${this.currency(rows.reduce((sum, row) => sum + Number(row.gross_salary || 0), 0))}`,
        `Líquido total: ${this.currency(rows.reduce((sum, row) => sum + Number(row.net_salary || 0), 0))}`
      ],
      descontos: [
        `IRT total: ${this.currency(rows.reduce((sum, row) => sum + Number(row.irt_amount || 0), 0))}`,
        `INSS funcionário total: ${this.currency(rows.reduce((sum, row) => sum + Number(row.inss_amount || 0), 0))}`,
        `Descontos por faltas/licenças: ${this.currency(rows.reduce((sum, row) => sum + Number(row.absence_deduction || 0), 0))}`
      ],
      faltas: [
        `Registos de faltas: ${rows.length}`,
        `Faltas completas: ${rows.filter((row) => row.status === "absent").length}`,
        `Meias faltas: ${rows.filter((row) => row.status === "half_absence").length}`
      ],
      presencas: [
        `Registos de presença: ${rows.length}`,
        `Presenças normais: ${rows.filter((row) => row.status === "present").length}`,
        `Registos com atraso: ${rows.filter((row) => row.status === "delay").length}`
      ],
      "turnos-trabalhador": [
        `Trabalhadores abrangidos: ${rows.length}`,
        `Horas previstas: ${this.formatPlainNumber(rows.reduce((sum, row) => sum + Number(row.expected_hours || 0), 0))}`,
        `Horas registadas: ${this.formatPlainNumber(rows.reduce((sum, row) => sum + Number(row.hours_worked || 0), 0))}`
      ],
      "turnos-departamento": [
        `Departamentos abrangidos: ${rows.length}`,
        `Trabalhadores consolidados: ${rows.reduce((sum, row) => sum + Number(row.employees_count || 0), 0)}`,
        `Marcações incompletas: ${rows.reduce((sum, row) => sum + Number(row.incomplete_records || 0), 0)}`
      ],
      "mapa-docente": [
        `Docentes abrangidos: ${rows.length}`,
        `Carga horária prevista: ${this.formatPlainNumber(rows.reduce((sum, row) => sum + Number(row.expected_hours || 0), 0))}`,
        `Carga horária registada: ${this.formatPlainNumber(rows.reduce((sum, row) => sum + Number(row.hours_worked || 0), 0))}`
      ],
      funcionario: [
        `Funcionários listados: ${rows.length}`,
        `Custo patronal total: ${this.currency(rows.reduce((sum, row) => sum + Number(row.summary_json?.employerCost || row.gross_salary || 0), 0))}`
      ]
    };

    const totals = totalsByType[type] || totalsByType.mensal;
    const { width } = page.getSize();
    const topY = Math.max(y, 132);
    page.drawText("Resumo do relatório", {
      x: REPORT_MARGIN,
      y: topY,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });

    let currentY = topY - 22;
    totals.forEach((line, index) => {
      page.drawRectangle({
        x: REPORT_MARGIN,
        y: currentY - 6,
        width: width - REPORT_MARGIN * 2,
        height: 22,
        color: index % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1)
      });
      page.drawText(line, {
        x: REPORT_MARGIN + 12,
        y: currentY,
        font: bold,
        size: 10,
        color: REPORT_COLORS.text
      });
      currentY -= 24;
    });
  }

  async loadLogo(doc, logoPath) {
    if (!logoPath || !fs.existsSync(logoPath)) {
      return null;
    }

    const ext = path.extname(logoPath).toLowerCase();
    const bytes = fs.readFileSync(logoPath);
    let image;
    if (ext === ".png") {
      image = await doc.embedPng(bytes);
    } else if (ext === ".jpg" || ext === ".jpeg") {
      image = await doc.embedJpg(bytes);
    } else {
      return null;
    }

    const maxWidth = 46;
    const maxHeight = 36;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    return {
      image,
      width: image.width * scale,
      height: image.height * scale
    };
  }

  reportTitle(type) {
    const titles = {
      mensal: "Relatório mensal de salários",
      anual: "Relatório anual de salários",
      "irt-anual": "Relatório anual do IRT",
      "inss-anual": "Relatório anual da Segurança Social (INSS)",
      descontos: "Relatório de descontos",
      faltas: "Relatório de faltas",
      presencas: "Relatório de presenças",
      "turnos-trabalhador": "Mapa mensal de turnos por trabalhador",
      "turnos-departamento": "Mapa mensal de turnos por departamento",
      "mapa-docente": "Mapa docente mensal",
      funcionario: "Relatório por funcionário"
    };
    return titles[type] || "Relatório salarial";
  }

  formatMonthName(monthRef) {
    if (!monthRef) return "-";
    const [year, month] = monthRef.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return new Intl.DateTimeFormat("pt-PT", { month: "long" }).format(date);
  }

  formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 10);
    }
    return new Intl.DateTimeFormat("pt-PT").format(date);
  }

  formatPlainNumber(value) {
    return new Intl.NumberFormat("pt-PT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  currency(value) {
    return new Intl.NumberFormat("pt-PT", {
      style: "currency",
      currency: "AOA",
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  buildMonthlyReportData(filters) {
    const normalizedFilters = normalizeReportPayload(filters);
    const monthRef = normalizedFilters.monthRef;
    const company = this.database.getCompanyProfile();
    const employees = this.database.listEmployees();
    const allRuns = this.database.listPayrollRuns();
    const runs = this.database.listPayrollRuns(normalizedFilters);
    const previousMonthRef = this.previousMonthRef(monthRef);
    const currentSummary = this.summarizeRuns(runs, monthRef);
    const previousSummary = previousMonthRef ? this.summarizeRuns(allRuns.filter((run) => run.month_ref === previousMonthRef), previousMonthRef) : null;
    const monthLabel = this.formatMonthYear(monthRef);
    const totalAllowances = runs.reduce((sum, run) => sum + Number(run.allowances_total || 0), 0);
    const totalBonuses = runs.reduce((sum, run) => sum + Number(run.bonuses_total || 0), 0);
    const totalOtherDiscounts = runs.reduce((sum, run) => {
      const summary = run.summary_json || {};
      return sum + Number(summary.absenceDeduction || 0) + Number(summary.leaveDeduction || 0) + Number(summary.penalties || 0);
    }, 0);
    const totalDeductions = currentSummary.totalIrt + currentSummary.totalInss + totalOtherDiscounts;
    const averageCost = runs.length ? currentSummary.totalEmployerCost / runs.length : 0;
    const variation = previousSummary?.totalGross
      ? ((currentSummary.totalGross - previousSummary.totalGross) / previousSummary.totalGross) * 100
      : 0;

    const detailedRows = runs.map((run, index) => {
      const summary = run.summary_json || {};
      const overtime = Number(summary.overtimeTotal || 0);
      const otherDiscounts = Number(summary.absenceDeduction || 0) + Number(summary.leaveDeduction || 0) + Number(summary.penalties || 0);
      return {
        index: index + 1,
        name: run.full_name,
        jobTitle: run.job_title || run.contract_type || "-",
        department: run.department || "-",
        baseSalary: Number(summary.baseSalary || run.gross_salary || 0),
        allowances: Number(summary.allowancesTotal || run.allowances_total || 0),
        overtime,
        deductions: Number(run.inss_amount || 0) + Number(run.irt_amount || 0) + otherDiscounts,
        netSalary: Number(run.net_salary || 0),
        observations: this.buildRowObservation(summary)
      };
    });

    const topJobTitles = Array.from(
      runs.reduce((map, run) => {
        const key = run.job_title || run.contract_type || "Sem cargo";
        const current = map.get(key) || { title: key, amount: 0 };
        current.amount += Number(run.summary_json?.employerCost || run.gross_salary || 0);
        map.set(key, current);
        return map;
      }, new Map()).values()
    )
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const chartHistory = this.buildChargesHistory(monthRef);
    const admissions = employees.filter((employee) => String(employee.hire_date || "").slice(0, 7) === monthRef);
    const inactiveEmployees = employees.filter((employee) => {
      const status = String(employee.status || "").trim().toLowerCase();
      return status && status !== "active" && status !== "ativo";
    });
    const changesWithBonuses = runs.filter((run) => Number(run.bonuses_total || 0) > 0);
    const changesWithAllowances = runs.filter((run) => Number(run.allowances_total || 0) > 0);

    return {
      company,
      monthRef,
      monthLabel,
      previousMonthRef,
      rows: runs,
      currentSummary,
      previousSummary,
      totalAllowances,
      totalBonuses,
      totalOtherDiscounts,
      totalDeductions,
      averageCost,
      variation,
      detailedRows,
      topJobTitles,
      chartHistory,
      admissions,
      inactiveEmployees,
      changesWithBonuses,
      changesWithAllowances
    };
  }

  buildRowObservation(summary) {
    const notes = [];
    if (Number(summary.absenceDeduction || 0) > 0) {
      notes.push("Faltas");
    }
    if (Number(summary.leaveDeduction || 0) > 0) {
      notes.push("Licença");
    }
    if (Number(summary.financialDeductions || 0) > 0) {
      notes.push("Empréstimos/adiantamentos");
    }
    if (Number(summary.penalties || 0) > 0) {
      notes.push("Penalizações");
    }
    if ((summary.bonuses || []).length) {
      notes.push("Bónus");
    }
    return notes.join(", ") || "Pagamento regular";
  }

  buildChargesHistory(monthRef) {
    const months = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      months.push(this.shiftMonth(monthRef, -offset));
    }
    const allRuns = this.database.listPayrollRuns();
    return months.map((ref) => {
      const summary = this.summarizeRuns(allRuns.filter((run) => run.month_ref === ref), ref);
      return {
        monthRef: ref,
        label: this.shortMonthName(ref),
        employerInss: Number(summary.totalEmployerInss || 0),
        irt: Number(summary.totalIrt || 0),
        total: Number(summary.totalEmployerCost || 0)
      };
    });
  }

  summarizeRuns(runs, monthRef) {
    return {
      month_ref: monthRef,
      employeeCount: runs.length,
      totalGross: runs.reduce((sum, run) => sum + Number(run.gross_salary || 0), 0),
      totalNet: runs.reduce((sum, run) => sum + Number(run.net_salary || 0), 0),
      totalIrt: runs.reduce((sum, run) => sum + Number(run.irt_amount || 0), 0),
      totalInss: runs.reduce((sum, run) => sum + Number(run.inss_amount || 0), 0),
      totalEmployerInss: runs.reduce((sum, run) => sum + Number(run.summary_json?.employerInssAmount || 0), 0),
      totalEmployerCost: runs.reduce((sum, run) => sum + Number(run.summary_json?.employerCost || run.gross_salary || 0), 0)
    };
  }

  drawMonthlyCoverPage({ page, data, font, bold, logo }) {
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: height - 240, width, height: 240, color: rgb(0.91, 0.95, 0.99) });
    page.drawRectangle({ x: REPORT_MARGIN, y: 108, width: width - REPORT_MARGIN * 2, height: height - 248, color: rgb(1, 1, 1), borderColor: REPORT_COLORS.line, borderWidth: 1 });

    const logoBoxY = height - 170;
    page.drawRectangle({
      x: REPORT_MARGIN,
      y: logoBoxY,
      width: 118,
      height: 88,
      color: REPORT_COLORS.altFill
    });
    if (logo) {
      const scale = Math.min(86 / logo.width, 58 / logo.height, 1);
      const drawWidth = logo.width * scale;
      const drawHeight = logo.height * scale;
      page.drawImage(logo.image, {
        x: REPORT_MARGIN + (118 - drawWidth) / 2,
        y: logoBoxY + (88 - drawHeight) / 2,
        width: drawWidth,
        height: drawHeight
      });
    }

    page.drawText("Relatório Mensal de Salários", {
      x: REPORT_MARGIN + 142,
      y: height - 126,
      font: bold,
      size: 24,
      color: REPORT_COLORS.title
    });
    page.drawText(data.monthLabel, {
      x: REPORT_MARGIN + 142,
      y: height - 154,
      font,
      size: 15,
      color: REPORT_COLORS.subtitle
    });

    page.drawLine({
      start: { x: REPORT_MARGIN, y: height - 196 },
      end: { x: width - REPORT_MARGIN, y: height - 196 },
      thickness: 1,
      color: REPORT_COLORS.line
    });

    page.drawText(data.company.name || "Empresa", {
      x: REPORT_MARGIN,
      y: height - 246,
      font: bold,
      size: 16,
      color: REPORT_COLORS.text
    });
    page.drawText("Relatório executivo para acompanhamento interno da folha salarial do período.", {
      x: REPORT_MARGIN,
      y: height - 274,
      font,
      size: 11,
      color: REPORT_COLORS.subtitle
    });

    const infoY = height - 360;
    page.drawRectangle({
      x: REPORT_MARGIN,
      y: infoY - 94,
      width: width - REPORT_MARGIN * 2,
      height: 114,
      color: REPORT_COLORS.mutedFill
    });
    page.drawText("Identificacao do documento", {
      x: REPORT_MARGIN + 18,
      y: infoY,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });
    page.drawText(`Empresa: ${data.company.name || "-"}`, {
      x: REPORT_MARGIN + 18,
      y: infoY - 24,
      font,
      size: 11,
      color: REPORT_COLORS.text
    });
    page.drawText(`NIF: ${data.company.nif || "-"}`, {
      x: REPORT_MARGIN + 18,
      y: infoY - 44,
      font,
      size: 11,
      color: REPORT_COLORS.text
    });
    page.drawText(`Período: ${data.monthLabel}`, {
      x: REPORT_MARGIN + 280,
      y: infoY - 24,
      font,
      size: 11,
      color: REPORT_COLORS.text
    });
    page.drawText(`Data de emissão: ${this.formatDate(new Date().toISOString())}`, {
      x: REPORT_MARGIN + 280,
      y: infoY - 44,
      font,
      size: 11,
      color: REPORT_COLORS.text
    });

    page.drawRectangle({
      x: REPORT_MARGIN,
      y: 126,
      width: width - REPORT_MARGIN * 2,
      height: 110,
      color: REPORT_COLORS.altFill
    });
    page.drawText("Conteudo", {
      x: REPORT_MARGIN + 18,
      y: 208,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });
    this.drawWrappedText({
      page,
      text: "Este relatório apresenta o resumo geral da folha, os principais indicadores financeiros, a tabela salarial detalhada, os encargos legais e o espaço de validação interna.",
      x: REPORT_MARGIN + 18,
      y: 186,
      maxWidth: width - REPORT_MARGIN * 2 - 36,
      lineHeight: 15,
      font,
      size: 10.5,
      color: REPORT_COLORS.text
    });

    page.drawText("Documento confidencial | Uso interno", {
      x: REPORT_MARGIN,
      y: 42,
      font,
      size: 10,
      color: REPORT_COLORS.subtitle
    });
  }

  drawStandardReportPage({ page, company, title, section, font, bold, logo, pageNumber }) {
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: height - 78, width, height: 78, color: REPORT_COLORS.title });

    if (logo) {
      page.drawImage(logo.image, {
        x: REPORT_MARGIN,
        y: height - 63,
        width: logo.width,
        height: logo.height
      });
    }

    const textX = logo ? REPORT_MARGIN + 58 : REPORT_MARGIN;
    page.drawText(company.name || "Kwanza Folha", {
      x: textX,
      y: height - 35,
      font: bold,
      size: 14,
      color: rgb(1, 1, 1)
    });
    const sectionLabel = `Secao ${section}`;
    const sectionWidth = Math.min(120, font.widthOfTextAtSize(sectionLabel, 10) + 10);
    const titleMaxWidth = width - REPORT_MARGIN * 2 - sectionWidth - 18;
    this.drawFittedText(page, title, REPORT_MARGIN, height - 106, bold, 21, titleMaxWidth, REPORT_COLORS.title, 12);
    this.drawRightText(page, sectionLabel, width - REPORT_MARGIN, height - 103, font, 10, REPORT_COLORS.subtitle);
    page.drawLine({
      start: { x: REPORT_MARGIN, y: height - 116 },
      end: { x: width - REPORT_MARGIN, y: height - 116 },
      thickness: 1,
      color: REPORT_COLORS.line
    });

    page.drawText(`${company.name || "Empresa"}  |  Documento Confidencial - Uso Interno`, {
      x: REPORT_MARGIN,
      y: 26,
      font,
      size: 9,
      color: REPORT_COLORS.subtitle
    });
    page.drawText(`Pagina ${pageNumber}`, {
      x: width - REPORT_MARGIN - 44,
      y: 26,
      font,
      size: 9,
      color: REPORT_COLORS.subtitle
    });
  }

  drawTableOfContents({ page, data, font, bold, entries }) {
    const { width, height } = page.getSize();
    let y = height - 150;
    page.drawText("Estrutura do documento", {
      x: REPORT_MARGIN,
      y,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    y -= 26;

    [
      "1. Resumo Geral",
      "2. Indicadores Financeiros",
      "3. Tabela Salarial Detalhada",
      "4. Encargos e Obrigações",
      "5. Observações do Período",
      "6. Assinaturas"
    ].forEach((label) => {
      page.drawText(label, {
        x: REPORT_MARGIN,
        y,
        font,
        size: 12,
        color: REPORT_COLORS.text
      });
      y -= 18;
    });

    y -= 18;
    entries.forEach((entry, index) => {
      const label = `${index + 1}. ${entry.label}`;
      page.drawText(label, {
        x: REPORT_MARGIN,
        y,
        font,
        size: 11,
        color: REPORT_COLORS.text
      });
      page.drawLine({
        start: { x: REPORT_MARGIN + 180, y: y + 4 },
        end: { x: width - REPORT_MARGIN - 34, y: y + 4 },
        thickness: 0.6,
        color: REPORT_COLORS.line
      });
      page.drawText(String(entry.page), {
        x: width - REPORT_MARGIN - 16,
        y,
        font: bold,
        size: 11,
        color: REPORT_COLORS.title
      });
      y -= 24;
    });

    page.drawRectangle({
      x: REPORT_MARGIN,
      y: 120,
      width: width - REPORT_MARGIN * 2,
      height: 70,
      color: REPORT_COLORS.altFill
    });
    page.drawText(`Período de referência: ${data.monthLabel}`, {
      x: REPORT_MARGIN + 18,
      y: 164,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });
    page.drawText("Relatório preparado para consulta interna, revisão financeira e arquivo corporativo.", {
      x: REPORT_MARGIN + 18,
      y: 142,
      font,
      size: 10,
      color: REPORT_COLORS.subtitle
    });
  }

  drawMonthlySummaryPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    const cards = [
      ["Total de colaboradores", String(data.currentSummary.employeeCount)],
      ["Total bruto da folha", this.currency(data.currentSummary.totalGross)],
      ["Total de descontos", this.currency(data.totalDeductions)],
      ["Total líquido pago", this.currency(data.currentSummary.totalNet)],
      ["Total de encargos do mês", this.currency(data.currentSummary.totalEmployerCost)]
    ];

    let cardX = REPORT_MARGIN;
    let cardY = height - 186;
    cards.forEach(([label, value], index) => {
      const cardWidth = index < 3 ? 152 : 220;
      this.drawMetricCard({ page, x: cardX, y: cardY, width: cardWidth, height: 72, label, value, font, bold });
      cardX += cardWidth + 14;
      if (index === 2) {
        cardX = REPORT_MARGIN;
        cardY -= 92;
      }
    });

    page.drawText("Distribuicao dos custos", {
      x: REPORT_MARGIN,
      y: height - 370,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    this.drawCostDistributionChart({
      page,
      x: REPORT_MARGIN,
      y: height - 560,
      width: 220,
      height: 150,
      data: [
        { label: "Líquido", value: data.currentSummary.totalNet, color: REPORT_COLORS.title },
        { label: "Descontos", value: data.totalDeductions, color: REPORT_COLORS.gray },
        { label: "INSS Patronal", value: data.currentSummary.totalEmployerInss, color: REPORT_COLORS.accent }
      ],
      font,
      bold
    });

      page.drawText("Notas do período", {
      x: 310,
      y: height - 370,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    const notes = [
      `Subsídios processados: ${this.currency(data.totalAllowances)}`,
        `Bonificações processadas: ${this.currency(data.totalBonuses)}`,
      `Encargos legais consolidados: ${this.currency(data.currentSummary.totalIrt + data.currentSummary.totalInss + data.currentSummary.totalEmployerInss)}`,
      `Comparação com ${this.formatMonthYear(data.previousMonthRef)}: ${this.formatPercentage(data.variation)}`
    ];
    let noteY = height - 402;
    notes.forEach((line) => {
      page.drawRectangle({
        x: 310,
        y: noteY - 12,
        width: width - 310 - REPORT_MARGIN,
        height: 28,
        color: REPORT_COLORS.altFill
      });
      this.drawFittedText(page, line, 324, noteY, font, 10.3, width - 310 - REPORT_MARGIN - 24, REPORT_COLORS.text);
      noteY -= 40;
    });
  }

  drawIndicatorsPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    this.drawMetricCard({
      page,
      x: REPORT_MARGIN,
      y: height - 186,
      width: 210,
      height: 78,
      label: "Custo medio por colaborador",
      value: this.currency(data.averageCost),
      font,
      bold
    });
    this.drawMetricCard({
      page,
      x: REPORT_MARGIN + 226,
      y: height - 186,
      width: 150,
      height: 78,
      label: "Variação mensal",
      value: this.formatPercentage(data.variation),
      font,
      bold
    });
    this.drawMetricCard({
      page,
      x: REPORT_MARGIN + 392,
      y: height - 186,
      width: 146,
      height: 78,
      label: "Custo patronal",
      value: this.currency(data.currentSummary.totalEmployerCost),
      font,
      bold
    });

    page.drawText("Top 5 cargos com maior custo mensal", {
      x: REPORT_MARGIN,
      y: height - 252,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    this.drawHorizontalBarChart({
      page,
      x: REPORT_MARGIN,
      y: height - 445,
      width: 260,
      height: 160,
      data: data.topJobTitles,
      font,
      bold
    });

    page.drawText("Leitura financeira", {
      x: 350,
      y: height - 252,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    const bullets = [
      `Folha bruta do mês: ${this.currency(data.currentSummary.totalGross)}`,
      `Líquido pago: ${this.currency(data.currentSummary.totalNet)}`,
      `INSS patronal: ${this.currency(data.currentSummary.totalEmployerInss)}`,
      `Variação face ao período anterior: ${this.formatPercentage(data.variation)}`
    ];
    let bulletY = height - 288;
    bullets.forEach((line) => {
      page.drawCircle({ x: 362, y: bulletY + 4, size: 2.5, color: REPORT_COLORS.accent });
      this.drawFittedText(page, line, 374, bulletY, font, 10.5, width - 374 - REPORT_MARGIN, REPORT_COLORS.text);
      bulletY -= 24;
    });

    page.drawRectangle({
      x: 350,
      y: height - 510,
      width: width - 350 - REPORT_MARGIN,
      height: 140,
      color: REPORT_COLORS.altFill
    });
      page.drawText("Análise executiva", {
      x: 366,
      y: height - 400,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });
    this.drawWrappedText({
      page,
      text: "A comparação mensal permite acompanhar a pressão da folha sobre a tesouraria. O custo médio por colaborador e os cargos com maior peso ajudam a orientar decisões de estrutura, benefícios e controlo de encargos legais.",
      x: 366,
      y: height - 422,
      maxWidth: width - 390 - REPORT_MARGIN,
      lineHeight: 14,
      font,
      size: 10.5,
      color: REPORT_COLORS.text
    });
  }

  drawDetailedTablePages({ doc, company, data, font, bold, logo, startPageNumber }) {
    const pages = [];
    const rows = data.detailedRows;
    const pageCapacity = 16;
    const chunks = [];
    for (let index = 0; index < rows.length; index += pageCapacity) {
      chunks.push(rows.slice(index, index + pageCapacity));
    }
    if (!chunks.length) {
      chunks.push([]);
    }

    chunks.forEach((chunk, chunkIndex) => {
      const page = doc.addPage(A4_LANDSCAPE);
      pages.push(page);
      this.drawStandardReportPage({
        page,
        company,
        title: "Tabela Salarial Detalhada",
        section: "3",
        font,
        bold,
        logo,
        pageNumber: startPageNumber + chunkIndex
      });
      this.drawDetailedTable({ page, rows: chunk, font, bold });
    });

    return pages;
  }

  drawDetailedTable({ page, rows, font, bold }) {
    const { width, height } = page.getSize();
    const topY = height - 165;
    const rowHeight = 22;
    const columns = [
      { key: "index", label: "No", x: REPORT_MARGIN, width: 24, align: "center" },
        { key: "name", label: "Nome do Colaborador", x: REPORT_MARGIN + 28, width: 130 },
      { key: "jobTitle", label: "Cargo", x: REPORT_MARGIN + 162, width: 90 },
      { key: "department", label: "Departamento", x: REPORT_MARGIN + 256, width: 80 },
      { key: "baseSalary", label: "Salário Base", x: REPORT_MARGIN + 340, width: 60, align: "right", money: true },
      { key: "allowances", label: "Subsídios", x: REPORT_MARGIN + 404, width: 56, align: "right", money: true },
      { key: "overtime", label: "Horas Extras", x: REPORT_MARGIN + 464, width: 56, align: "right", money: true },
      { key: "deductions", label: "Descontos", x: REPORT_MARGIN + 524, width: 58, align: "right", money: true },
      { key: "netSalary", label: "Salário Líquido", x: REPORT_MARGIN + 586, width: 62, align: "right", money: true },
      { key: "observations", label: "Observações", x: REPORT_MARGIN + 652, width: 76 }
    ];

    page.drawRectangle({
      x: REPORT_MARGIN,
      y: topY - 14,
      width: width - REPORT_MARGIN * 2,
      height: 22,
      color: REPORT_COLORS.title
    });
    columns.forEach((column) => {
        page.drawText(column.label, {
          x: column.x + 2,
          y: topY - 6,
          font: bold,
          size: 8,
          color: rgb(1, 1, 1)
        });
      });

    let y = topY - 36;
    rows.forEach((row, rowIndex) => {
      page.drawRectangle({
        x: REPORT_MARGIN,
        y: y - 4,
        width: width - REPORT_MARGIN * 2,
        height: rowHeight,
        color: rowIndex % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1)
      });

      columns.forEach((column) => {
        const rawValue = row[column.key];
        const text = column.money ? this.formatCompactNumber(rawValue) : String(rawValue ?? "");
        if (column.align === "right") {
          this.drawRightAlignedWithin(page, text, column.x + column.width - 2, y + 3, font, 8.1, column.width - 4);
          return;
        }
        if (column.align === "center") {
          this.drawCenteredText(page, text, column.x, y + 3, column.width, font, 8.1, REPORT_COLORS.text);
          return;
        }
        this.drawFittedText(page, text, column.x + 2, y + 3, font, 8.1, column.width - 4, REPORT_COLORS.text);
      });

      page.drawLine({
        start: { x: REPORT_MARGIN, y: y - 4 },
        end: { x: width - REPORT_MARGIN, y: y - 4 },
        thickness: 0.45,
        color: REPORT_COLORS.line
      });
      y -= rowHeight;
    });
  }

  drawChargesPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    const items = [
      ["INSS Empresa", data.currentSummary.totalEmployerInss],
        ["INSS Colaborador", data.currentSummary.totalInss],
      ["IRT", data.currentSummary.totalIrt],
      ["Contribuicoes legais", data.currentSummary.totalIrt + data.currentSummary.totalInss + data.currentSummary.totalEmployerInss],
      ["Custos adicionais", data.totalOtherDiscounts],
      ["Total consolidado", data.currentSummary.totalEmployerCost]
    ];

    page.drawText("Composição dos encargos", {
      x: REPORT_MARGIN,
      y: height - 160,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    let y = height - 196;
    items.forEach(([label, value], index) => {
      page.drawRectangle({
        x: REPORT_MARGIN,
        y: y - 8,
        width: 250,
        height: 26,
        color: index % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1)
      });
      page.drawText(label, {
        x: REPORT_MARGIN + 12,
        y,
        font,
        size: 11,
        color: REPORT_COLORS.text
      });
      this.drawRightText(page, this.formatCompactNumber(value), REPORT_MARGIN + 236, y, bold, 11);
      y -= 30;
    });

    page.drawText("Evolução dos encargos", {
      x: 332,
      y: height - 160,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    this.drawLineChart({
      page,
      x: 332,
      y: height - 420,
      width: width - 332 - REPORT_MARGIN,
      height: 180,
      data: data.chartHistory,
      font,
      bold
    });
  }

  drawObservationsPage({ page, data, font, bold }) {
    const { height } = page.getSize();
    const sections = [
      {
        title: "Admissões",
        lines: data.admissions.length
          ? data.admissions.slice(0, 5).map((employee) => `${employee.full_name} | ${employee.job_title || employee.contract_type || "-"}`)
          : ["Sem admissões registadas no período."]
      },
      {
        title: "Saidas",
        lines: data.inactiveEmployees.length
          ? data.inactiveEmployees.slice(0, 5).map((employee) => `${employee.full_name} | ${employee.department || "-"}`)
          : ["Sem demissões registadas automaticamente no período."]
      },
      {
        title: "Alteracoes salariais",
        lines: data.changesWithBonuses.length
          ? data.changesWithBonuses.slice(0, 5).map((run) => `${run.full_name} | Bonificação no período ${this.currency(run.bonuses_total)}`)
          : ["Sem alteracoes salariais automaticas identificadas."]
      },
      {
        title: "Mudanças em benefícios",
        lines: data.changesWithAllowances.length
          ? data.changesWithAllowances.slice(0, 5).map((run) => `${run.full_name} | Subsídios ${this.currency(run.allowances_total)}`)
          : ["Sem mudanças automáticas em benefícios identificadas."]
      },
      {
        title: "Observações gerais",
        lines: [
          `Folha processada para ${data.currentSummary.employeeCount} colaboradores.`,
            `Líquido global pago: ${this.currency(data.currentSummary.totalNet)}.`,
          "Espaço reservado para notas adicionais da administração."
        ]
      }
    ];

    let y = height - 165;
    sections.forEach((section) => {
      page.drawText(section.title, {
        x: REPORT_MARGIN,
        y,
        font: bold,
        size: 13,
        color: REPORT_COLORS.title
      });
      y -= 18;
      page.drawLine({
        start: { x: REPORT_MARGIN, y },
        end: { x: 520, y },
        thickness: 0.9,
        color: REPORT_COLORS.line
      });
      y -= 18;
      section.lines.forEach((line) => {
        this.drawFittedText(page, line, REPORT_MARGIN + 8, y, font, 10.5, 470, REPORT_COLORS.text);
        y -= 16;
      });
      y -= 14;
    });
  }

  drawSignaturesPage({ page, font, bold }) {
    const { width, height } = page.getSize();
    page.drawText("Validação e aprovação", {
      x: REPORT_MARGIN,
      y: height - 162,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    page.drawText("Espaço reservado para validação formal do relatório mensal.", {
      x: REPORT_MARGIN,
      y: height - 186,
      font,
      size: 10.5,
      color: REPORT_COLORS.subtitle
    });

    page.drawRectangle({
      x: REPORT_MARGIN,
      y: height - 248,
      width: width - REPORT_MARGIN * 2,
      height: 44,
      color: REPORT_COLORS.altFill
    });
    page.drawText(`Data do documento: ${this.formatDate(new Date().toISOString())}`, {
      x: REPORT_MARGIN + 16,
      y: height - 228,
      font,
      size: 11,
      color: REPORT_COLORS.text
    });
    page.drawText("Assinaturas requeridas: 3", {
      x: width - REPORT_MARGIN - 150,
      y: height - 228,
      font,
      size: 11,
      color: REPORT_COLORS.text
    });

    const blocks = [
      { label: "Responsável de Recursos Humanos", x: REPORT_MARGIN, y: height - 390, width: 220, height: 118 },
      { label: "Diretor Financeiro", x: REPORT_MARGIN + 256, y: height - 390, width: 220, height: 118 },
      { label: "Direção Geral", x: REPORT_MARGIN, y: height - 548, width: 220, height: 118 }
    ];
    blocks.forEach((block) => {
      page.drawRectangle({
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        color: REPORT_COLORS.altFill
      });
      this.drawFittedText(page, block.label, block.x + 16, block.y + block.height - 26, bold, 11, block.width - 32, REPORT_COLORS.title);
      page.drawText("Nome", {
        x: block.x + 16,
        y: block.y + block.height - 54,
        font,
        size: 10,
        color: REPORT_COLORS.subtitle
      });
      page.drawLine({
        start: { x: block.x + 16, y: block.y + block.height - 62 },
        end: { x: block.x + block.width - 16, y: block.y + block.height - 62 },
        thickness: 0.8,
        color: REPORT_COLORS.gray
      });
      page.drawText("Assinatura", {
        x: block.x + 16,
        y: block.y + 36,
        font,
        size: 10,
        color: REPORT_COLORS.subtitle
      });
      page.drawLine({
        start: { x: block.x + 16, y: block.y + 28 },
        end: { x: block.x + block.width - 16, y: block.y + 28 },
        thickness: 0.8,
        color: REPORT_COLORS.gray
      });
    });

    page.drawText("Documento preparado para arquivo interno e validação formal da gestão.", {
      x: REPORT_MARGIN,
      y: 84,
      font,
      size: 10.5,
      color: REPORT_COLORS.text
    });
  }

  drawMetricCard({ page, x, y, width, height, label, value, font, bold }) {
    page.drawRectangle({ x, y, width, height, color: REPORT_COLORS.altFill });
    page.drawRectangle({ x, y: y + height - 6, width, height: 6, color: REPORT_COLORS.title });
    page.drawText(label, {
      x: x + 14,
      y: y + height - 30,
      font,
      size: 9.6,
      color: REPORT_COLORS.subtitle
    });
    this.drawFittedText(page, value, x + 14, y + 18, bold, 14, width - 28, REPORT_COLORS.title, 7);
  }

  drawCostDistributionChart({ page, x, y, width, height, data, font, bold }) {
    const maxValue = Math.max(...data.map((item) => item.value), 1);
    const barWidth = 42;
    const gap = 20;
    const chartHeight = height - 44;
    data.forEach((item, index) => {
      const barHeight = (item.value / maxValue) * chartHeight;
      const barX = x + 20 + index * (barWidth + gap);
      page.drawRectangle({
        x: barX,
        y,
        width: barWidth,
        height: barHeight,
        color: item.color
      });
      this.drawCenteredText(page, item.label, barX - 8, y - 20, barWidth + 16, font, 8.5, REPORT_COLORS.text);
      this.drawCenteredText(page, this.formatCompactNumber(item.value), barX - 10, y + barHeight + 6, barWidth + 20, bold, 8, REPORT_COLORS.subtitle);
    });
  }

  drawHorizontalBarChart({ page, x, y, width, height, data, font, bold }) {
    const maxValue = Math.max(...data.map((item) => item.amount || 0), 1);
    const rowHeight = Math.min(28, height / Math.max(data.length, 1));
    data.forEach((item, index) => {
      const rowY = y + height - (index + 1) * rowHeight;
      const barWidth = ((item.amount || 0) / maxValue) * (width - 110);
      this.drawFittedText(page, item.title, x, rowY + 7, font, 9.5, 120, REPORT_COLORS.text);
      page.drawRectangle({
        x: x + 122,
        y: rowY + 4,
        width: barWidth,
        height: 13,
        color: REPORT_COLORS.accent
      });
      this.drawRightText(page, this.formatCompactNumber(item.amount), x + width, rowY + 7, bold, 9.2);
    });
  }

  drawLineChart({ page, x, y, width, height, data, font, bold }) {
    const maxValue = Math.max(...data.map((item) => item.total || 0), 1);
    page.drawLine({
      start: { x, y },
      end: { x, y: y + height },
      thickness: 0.9,
      color: REPORT_COLORS.line
    });
    page.drawLine({
      start: { x, y },
      end: { x: x + width, y },
      thickness: 0.9,
      color: REPORT_COLORS.line
    });

    let previousPoint = null;
    data.forEach((item, index) => {
      const px = x + (index * (width / Math.max(data.length - 1, 1)));
      const py = y + ((item.total || 0) / maxValue) * (height - 18);
      if (previousPoint) {
        page.drawLine({
          start: previousPoint,
          end: { x: px, y: py },
          thickness: 2,
          color: REPORT_COLORS.accent
        });
      }
      page.drawCircle({ x: px, y: py, size: 3, color: REPORT_COLORS.title });
      this.drawCenteredText(page, item.label, px - 20, y - 18, 40, font, 8.5, REPORT_COLORS.text);
      previousPoint = { x: px, y: py };
    });

    page.drawText(`Total atual: ${this.currency(data[data.length - 1]?.total || 0)}`, {
      x,
      y: y + height + 10,
      font: bold,
      size: 10,
      color: REPORT_COLORS.title
    });
  }

  drawWrappedText({ page, text, x, y, maxWidth, lineHeight, font, size, color }) {
    const lines = this.wrapTextLines(text, font, size, maxWidth);
    lines.forEach((line, index) => {
      page.drawText(line, { x, y: y - index * lineHeight, font, size, color });
    });
  }

  wrapTextLines(text, font, size, maxWidth, maxLines = Infinity) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";

    words.forEach((word) => {
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (line) {
          lines.push(line);
          line = "";
        }

        const chunks = [];
        let chunk = "";
        for (const ch of String(word)) {
          const candidate = `${chunk}${ch}`;
          if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
            chunks.push(chunk);
            chunk = ch;
          } else {
            chunk = candidate;
          }
        }
        if (chunk) {
          chunks.push(chunk);
        }
        chunks.forEach((piece, index) => {
          if (index === chunks.length - 1) {
            line = piece;
            return;
          }
          lines.push(piece);
        });
        return;
      }

      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });

    if (line) {
      lines.push(line);
    }

    if (lines.length <= maxLines) {
      return lines;
    }

    const trimmed = lines.slice(0, maxLines);
    const lastIndex = trimmed.length - 1;
    let shortened = String(trimmed[lastIndex] || "");
    while (shortened.length > 1 && font.widthOfTextAtSize(shortened, size) > maxWidth) {
      shortened = shortened.slice(0, -1);
    }
    trimmed[lastIndex] = shortened.trim();
    return trimmed;
  }

  drawRightAlignedWithin(page, text, rightX, y, font, size, maxWidth) {
    const fitted = this.fitTextStyle(text, font, size, maxWidth);
    const textWidth = font.widthOfTextAtSize(fitted.text, fitted.size);
    page.drawText(fitted.text, {
      x: Math.max(rightX - textWidth, 0),
      y,
      font,
      size: fitted.size,
      color: REPORT_COLORS.text
    });
  }

  drawCenteredText(page, text, x, y, width, font, size, color) {
    const fitted = this.fitTextStyle(text, font, size, width);
    const textWidth = font.widthOfTextAtSize(fitted.text, fitted.size);
    page.drawText(fitted.text, {
      x: x + Math.max((width - textWidth) / 2, 0),
      y,
      font,
      size: fitted.size,
      color
    });
  }

  formatCompactNumber(value) {
    return new Intl.NumberFormat("pt-PT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value || 0));
  }

  formatMonthYear(monthRef) {
    if (!monthRef) {
      return "Período não definido";
    }
    const [year, month] = monthRef.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    const label = new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" }).format(date);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  shortMonthName(monthRef) {
    if (!monthRef) {
      return "-";
    }
    const [year, month] = monthRef.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    const label = new Intl.DateTimeFormat("pt-PT", { month: "short" }).format(date);
    return label.replace(".", "");
  }

  previousMonthRef(monthRef) {
    return this.shiftMonth(monthRef, -1);
  }

  shiftMonth(monthRef, offset) {
    if (!monthRef) {
      return "";
    }
    const [year, month] = monthRef.split("-").map(Number);
    const date = new Date(year, month - 1 + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  formatPercentage(value) {
    const numeric = Number(value || 0);
    const sign = numeric > 0 ? "+" : "";
    return `${sign}${numeric.toFixed(1)}%`;
  }

  async generateAnnualExecutiveReport(filters) {
    const normalizedFilters = normalizeReportPayload(filters);
    const data = this.buildAnnualReportData(normalizedFilters);
    if (!data.monthly.length || !data.employeeRows.length) {
      return { ok: false, message: "Não existem salários processados para gerar o relatório anual." };
    }
    const { company } = data;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const logo = await this.loadLogo(doc, company.logo_path);

    const coverPage = doc.addPage(A4);
    this.drawAnnualCoverPage({ page: coverPage, data, font, bold, logo });

    const summaryPage = doc.addPage(A4);
    this.drawStandardReportPage({ page: summaryPage, company, title: "Sumário Executivo", section: "Índice", font, bold, logo, pageNumber: 2 });

    const executivePage = doc.addPage(A4);
    this.drawStandardReportPage({ page: executivePage, company, title: "Resumo Executivo", section: "1", font, bold, logo, pageNumber: 3 });
    this.drawAnnualSummaryPage({ page: executivePage, data, font, bold });

    const indicatorsPage = doc.addPage(A4);
    this.drawStandardReportPage({ page: indicatorsPage, company, title: "Indicadores Anuais", section: "2", font, bold, logo, pageNumber: 4 });
    this.drawAnnualIndicatorsPage({ page: indicatorsPage, data, font, bold });

    const consolidationPage = doc.addPage(A4);
    this.drawStandardReportPage({ page: consolidationPage, company, title: "Consolidação Salarial", section: "3", font, bold, logo, pageNumber: 5 });
    this.drawAnnualConsolidationPage({ page: consolidationPage, data, font, bold });

    const monthPages = data.monthly.map((month, index) => {
      const page = doc.addPage(A4);
      this.drawStandardReportPage({
        page,
        company,
        title: `Análise Comparativa Mensal - ${month.label}`,
        section: "4",
        font,
        bold,
        logo,
        pageNumber: 6 + index
      });
      this.drawAnnualMonthPage({ page, month, data, font, bold });
      return page;
    });

    const employeeTableStart = 6 + monthPages.length;
    const employeePages = this.drawAnnualEmployeeTablePages({
      doc,
      company,
      data,
      font,
      bold,
      logo,
      startPageNumber: employeeTableStart
    });

    const chargesPageNumber = employeeTableStart + employeePages.length;
    const chargesPage = doc.addPage(A4);
    this.drawStandardReportPage({ page: chargesPage, company, title: "Encargos e Obrigações Legais", section: "6", font, bold, logo, pageNumber: chargesPageNumber });
    this.drawAnnualChargesPage({ page: chargesPage, data, font, bold });

    const rhCostsPage = doc.addPage(A4);
    this.drawStandardReportPage({ page: rhCostsPage, company, title: "Custos Totais de RH", section: "7", font, bold, logo, pageNumber: chargesPageNumber + 1 });
    this.drawAnnualRhCostsPage({ page: rhCostsPage, data, font, bold });

    const eventsPage = doc.addPage(A4);
    this.drawStandardReportPage({ page: eventsPage, company, title: "Eventos Importantes do Ano", section: "8", font, bold, logo, pageNumber: chargesPageNumber + 2 });
    this.drawAnnualEventsPage({ page: eventsPage, data, font, bold });

    const conclusionPage = doc.addPage(A4);
    this.drawStandardReportPage({ page: conclusionPage, company, title: "Conclusão", section: "9", font, bold, logo, pageNumber: chargesPageNumber + 3 });
    this.drawAnnualConclusionPage({ page: conclusionPage, data, font, bold });

    const signaturesPage = doc.addPage(A4);
    this.drawStandardReportPage({ page: signaturesPage, company, title: "Assinaturas", section: "10", font, bold, logo, pageNumber: chargesPageNumber + 4 });
    this.drawAnnualSignaturesPage({ page: signaturesPage, font, bold });

    this.drawTableOfContents({
      page: summaryPage,
      data: { monthLabel: `Exercício de ${data.year}` },
      font,
      bold,
      entries: [
        { label: "Resumo Executivo", page: 3 },
        { label: "Indicadores Anuais", page: 4 },
        { label: "Consolidação Salarial", page: 5 },
        { label: "Análise Comparativa Mensal", page: 6 },
        { label: "Tabela Geral de Funcionários", page: employeeTableStart },
        { label: "Encargos e Obrigações Legais", page: chargesPageNumber },
        { label: "Custos Totais de RH", page: chargesPageNumber + 1 },
        { label: "Eventos Anuais", page: chargesPageNumber + 2 },
        { label: "Conclusão", page: chargesPageNumber + 3 },
        { label: "Assinaturas", page: chargesPageNumber + 4 }
      ]
    });

    const fileName = `relatorio-anual-${normalizedFilters.monthRef || [normalizedFilters.startDate, normalizedFilters.endDate].filter(Boolean).join("_") || data.year}.pdf`;
    const output = path.join(this.database.exportsDir, fileName);
    const saved = await this.saveValidatedPdf(doc, output, { documentType: "annual_report", minimumPages: 1 });
    return { ok: true, path: output, qaReport: saved.qaReport };
  }

  async generateAnnualTaxReport(filters, taxType = "irt") {
    const normalizedFilters = normalizeReportPayload(filters);
    const data = this.buildAnnualTaxReportData(normalizedFilters, taxType);
    if (!data.rows.length) {
      return {
        ok: false,
        message:
          taxType === "inss"
            ? "Não existem salários processados para gerar o relatório anual da Segurança Social."
            : "Não existem salários processados para gerar o relatório anual do IRT."
      };
    }

    const { company } = data;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const logo = await this.loadLogo(doc, company.logo_path);

    const coverPage = doc.addPage(A4);
    this.drawAnnualTaxCoverPage({ page: coverPage, data, font, bold, logo });

    const indexPage = doc.addPage(A4);
    this.drawStandardReportPage({
      page: indexPage,
      company,
      title: "Sumário Executivo",
      section: "Índice",
      font,
      bold,
      logo,
      pageNumber: 2
    });

    const summaryPage = doc.addPage(A4);
    this.drawStandardReportPage({
      page: summaryPage,
      company,
      title: "Resumo Anual",
      section: "1",
      font,
      bold,
      logo,
      pageNumber: 3
    });
    this.drawAnnualTaxSummaryPage({ page: summaryPage, data, font, bold });

    const monthlyPage = doc.addPage(A4);
    this.drawStandardReportPage({
      page: monthlyPage,
      company,
      title: "Evolução Mensal",
      section: "2",
      font,
      bold,
      logo,
      pageNumber: 4
    });
    this.drawAnnualTaxMonthlyPage({ page: monthlyPage, data, font, bold });

    const employeePages = this.drawAnnualTaxEmployeeTablePages({
      doc,
      company,
      data,
      font,
      bold,
      logo,
      startPageNumber: 5
    });

    const conclusionPageNumber = 5 + employeePages.length;
    const conclusionPage = doc.addPage(A4);
    this.drawStandardReportPage({
      page: conclusionPage,
      company,
      title: "Leitura Fiscal",
      section: "4",
      font,
      bold,
      logo,
      pageNumber: conclusionPageNumber
    });
    this.drawAnnualTaxConclusionPage({ page: conclusionPage, data, font, bold });

    this.drawAnnualTaxTableOfContents({
      page: indexPage,
      data,
      font,
      bold,
      entries: [
        { label: "Resumo Anual", page: 3 },
        { label: "Evolução Mensal", page: 4 },
        { label: "Mapa por Funcionário", page: 5 },
        { label: "Leitura Fiscal", page: conclusionPageNumber }
      ]
    });

    const fileName =
      taxType === "inss"
        ? `relatorio-anual-inss-${data.year}.pdf`
        : `relatorio-anual-irt-${data.year}.pdf`;
    const output = path.join(this.database.exportsDir, fileName);
    const saved = await this.saveValidatedPdf(doc, output, { documentType: `annual_${taxType}_report`, minimumPages: 1 });
    return { ok: true, path: output, qaReport: saved.qaReport };
  }

  buildAnnualTaxReportData(filters, taxType = "irt") {
    const normalizedFilters = normalizeReportPayload(filters);
    const monthRef = normalizedFilters.monthRef;
    const company = this.database.getCompanyProfile();
    const allRuns = this.database.listPayrollRuns();
    const year = String(monthRef || normalizedFilters.startDate || new Date().toISOString().slice(0, 10)).slice(0, 4);
    const previousYear = String(Number(year) - 1);
    const annualRuns = this.database.listPayrollRuns(normalizedFilters).filter((run) => String(run.month_ref || "").startsWith(`${year}-`));
    const previousRuns = allRuns.filter((run) => String(run.month_ref || "").startsWith(`${previousYear}-`));
    const normalizedType = String(taxType || "irt").toLowerCase();
    const isInss = normalizedType === "inss";

    const computeEmployeeInss = (run) => Number(run.inss_amount || 0);
    const computeEmployerInss = (run) => Number(run.summary_json?.employerInssAmount || 0);
    const computeIrt = (run) => Number(run.irt_amount || 0);
    const computeTotal = (run) => (isInss ? computeEmployeeInss(run) + computeEmployerInss(run) : computeIrt(run));

    const currentTotal = annualRuns.reduce((sum, run) => sum + computeTotal(run), 0);
    const previousTotal = previousRuns.reduce((sum, run) => sum + computeTotal(run), 0);
    const totalGross = annualRuns.reduce((sum, run) => sum + Number(run.gross_salary || 0), 0);
    const employeeCount = new Set(annualRuns.map((run) => Number(run.employee_id))).size;
    const variation = previousTotal ? ((currentTotal - previousTotal) / previousTotal) * 100 : 0;

    const rows = Array.from(
      annualRuns.reduce((map, run) => {
        const key = Number(run.employee_id);
        const current = map.get(key) || {
          employeeId: key,
          name: run.full_name,
          department: run.department || "-",
          jobTitle: run.job_title || "-",
          months: 0,
          grossTotal: 0,
          taxableBaseTotal: 0,
          employeeValue: 0,
          employerValue: 0,
          totalValue: 0
        };
        current.months += 1;
        current.grossTotal += Number(run.gross_salary || 0);
        current.taxableBaseTotal += Number(run.summary_json?.materiaColectavel || run.summary_json?.legalBases?.materiaColectavel || 0);
        current.employeeValue += isInss ? computeEmployeeInss(run) : computeIrt(run);
        current.employerValue += isInss ? computeEmployerInss(run) : 0;
        current.totalValue += computeTotal(run);
        map.set(key, current);
        return map;
      }, new Map()).values()
    )
      .sort((left, right) => right.totalValue - left.totalValue)
      .map((row, index) => ({
        index: index + 1,
        ...row,
        averageMonthly: row.months ? row.totalValue / row.months : 0,
        participation: this.percentageOf(row.totalValue, currentTotal)
      }));

    const monthly = Array.from({ length: 12 }, (_, index) => {
      const monthRefValue = `${year}-${String(index + 1).padStart(2, "0")}`;
      const runs = annualRuns.filter((run) => run.month_ref === monthRefValue);
      const employeeValue = runs.reduce((sum, run) => sum + (isInss ? computeEmployeeInss(run) : computeIrt(run)), 0);
      const employerValue = runs.reduce((sum, run) => sum + (isInss ? computeEmployerInss(run) : 0), 0);
      const totalValue = runs.reduce((sum, run) => sum + computeTotal(run), 0);
      return {
        monthRef: monthRefValue,
        label: this.formatMonthYear(monthRefValue),
        shortLabel: this.shortMonthName(monthRefValue),
        employeeValue,
        employerValue,
        totalValue,
        taxableBase: runs.reduce((sum, run) => sum + Number(run.summary_json?.materiaColectavel || run.summary_json?.legalBases?.materiaColectavel || 0), 0),
        employeeCount: new Set(runs.map((run) => Number(run.employee_id))).size
      };
    });

    const departments = Array.from(
      annualRuns.reduce((map, run) => {
        const key = run.department || "Sem departamento";
        map.set(key, (map.get(key) || 0) + computeTotal(run));
        return map;
      }, new Map()).entries()
    )
      .map(([title, amount]) => ({ title, amount }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 6);

    const peakMonth = monthly.reduce(
      (current, month) => (!current || month.totalValue > current.totalValue ? month : current),
      null
    );

    return {
      company,
      year,
      previousYear,
      taxType: isInss ? "inss" : "irt",
      title: isInss ? "Relatório anual da Segurança Social (INSS)" : "Relatório anual do IRT",
      shortLabel: isInss ? "INSS" : "IRT",
      baseLabel: isInss ? "Base anual de incidência" : "Matéria coletável anual",
      annualRuns,
      rows,
      monthly,
      departments,
      employeeCount,
      totalGross,
      currentTotal,
      previousTotal,
      variation,
      peakMonth,
      averagePerEmployee: employeeCount ? currentTotal / employeeCount : 0,
      employeePortionTotal: isInss ? annualRuns.reduce((sum, run) => sum + computeEmployeeInss(run), 0) : currentTotal,
      employerPortionTotal: isInss ? annualRuns.reduce((sum, run) => sum + computeEmployerInss(run), 0) : 0,
      taxableBaseTotal: annualRuns.reduce(
        (sum, run) => sum + Number(run.summary_json?.materiaColectavel || run.summary_json?.legalBases?.materiaColectavel || 0),
        0
      )
    };
  }

  buildAnnualReportData(filters) {
    const normalizedFilters = normalizeReportPayload(filters);
    const monthRef = normalizedFilters.monthRef;
    const company = this.database.getCompanyProfile();
    const employees = this.database.listEmployees();
    const allRuns = this.database.listPayrollRuns();
    const year = String(monthRef || normalizedFilters.startDate || new Date().toISOString().slice(0, 10)).slice(0, 4);
    const previousYear = String(Number(year) - 1);
    const annualRuns = this.database.listPayrollRuns(normalizedFilters).filter((run) => String(run.month_ref || "").startsWith(`${year}-`));
    const previousRuns = allRuns.filter((run) => String(run.month_ref || "").startsWith(`${previousYear}-`));
    const annualSummary = this.summarizeRuns(annualRuns, year);
    const previousSummary = this.summarizeRuns(previousRuns, previousYear);
    const totalAllowances = annualRuns.reduce((sum, run) => sum + Number(run.allowances_total || 0), 0);
    const totalBonuses = annualRuns.reduce((sum, run) => sum + Number(run.bonuses_total || 0), 0);
    const totalOtherDiscounts = annualRuns.reduce((sum, run) => {
      const summary = run.summary_json || {};
      return sum + Number(summary.absenceDeduction || 0) + Number(summary.leaveDeduction || 0) + Number(summary.penalties || 0);
    }, 0);
    const totalDeductions = annualSummary.totalIrt + annualSummary.totalInss + totalOtherDiscounts;
    const variation = previousSummary.totalGross
      ? ((annualSummary.totalGross - previousSummary.totalGross) / previousSummary.totalGross) * 100
      : 0;
    const averageAnnualSalary = annualRuns.length ? annualSummary.totalGross / Math.max(new Set(annualRuns.map((run) => run.employee_id)).size, 1) : 0;

    const monthly = Array.from({ length: 12 }, (_, index) => {
      const monthRefValue = `${year}-${String(index + 1).padStart(2, "0")}`;
      const runs = annualRuns.filter((run) => run.month_ref === monthRefValue);
      const summary = this.summarizeRuns(runs, monthRefValue);
      return {
        monthRef: monthRefValue,
        label: this.formatMonthYear(monthRefValue),
        shortLabel: this.shortMonthName(monthRefValue),
        gross: summary.totalGross,
        net: summary.totalNet,
        charges: summary.totalEmployerInss + summary.totalIrt + summary.totalInss,
        deductions: summary.totalIrt + summary.totalInss + runs.reduce((sum, run) => {
          const item = run.summary_json || {};
          return sum + Number(item.absenceDeduction || 0) + Number(item.leaveDeduction || 0) + Number(item.penalties || 0);
        }, 0),
        employeeCount: summary.employeeCount,
        observations: this.buildAnnualMonthObservation(runs, summary)
      };
    });

    const departmentDistribution = Array.from(
      annualRuns.reduce((map, run) => {
        const key = run.department || "Sem departamento";
        map.set(key, (map.get(key) || 0) + Number(run.summary_json?.employerCost || run.gross_salary || 0));
        return map;
      }, new Map()).entries()
    )
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const topJobTitles = Array.from(
      annualRuns.reduce((map, run) => {
        const key = run.job_title || run.contract_type || "Sem cargo";
        const current = map.get(key) || { title: key, amount: 0 };
        current.amount += Number(run.summary_json?.employerCost || run.gross_salary || 0);
        map.set(key, current);
        return map;
      }, new Map()).values()
    ).sort((a, b) => b.amount - a.amount).slice(0, 10);

    const orderedAnnualRuns = [...annualRuns].sort((left, right) => {
      if (left.employee_id !== right.employee_id) {
        return Number(left.employee_id) - Number(right.employee_id);
      }
      return String(left.month_ref).localeCompare(String(right.month_ref));
    });

    const employeeRows = Array.from(
      orderedAnnualRuns.reduce((map, run) => {
        const current = map.get(run.employee_id) || {
          employeeId: run.employee_id,
          name: run.full_name,
          jobTitle: run.job_title || run.contract_type || "-",
          department: run.department || "-",
          firstBaseSalary: Number(run.summary_json?.baseSalary || 0),
          lastBaseSalary: Number(run.summary_json?.baseSalary || 0),
          grossTotal: 0,
          netTotal: 0,
          allowancesTotal: 0,
          overtimeTotal: 0,
          deductionsTotal: 0,
          months: 0,
          observations: []
        };
          current.grossTotal += Number(run.gross_salary || 0);
          current.netTotal += Number(run.net_salary || 0);
          current.allowancesTotal += Number(run.summary_json?.allowancesTotal || run.allowances_total || 0);
          current.overtimeTotal += Number(run.summary_json?.overtimeTotal || 0);
        current.deductionsTotal += Number(run.irt_amount || 0) + Number(run.inss_amount || 0) + Number(run.summary_json?.absenceDeduction || 0) + Number(run.summary_json?.leaveDeduction || 0) + Number(run.summary_json?.penalties || 0);
        current.lastBaseSalary = Number(run.summary_json?.baseSalary || current.lastBaseSalary);
        current.months += 1;
        if (Number(run.bonuses_total || 0) > 0) {
          current.observations.push("Bonificação");
        }
        map.set(run.employee_id, current);
        return map;
      }, new Map()).values()
    ).map((row, index) => ({
      index: index + 1,
      name: row.name,
      jobTitle: row.jobTitle,
      department: row.department,
      initialSalary: row.firstBaseSalary,
      finalSalary: row.lastBaseSalary,
      annualSalary: row.grossTotal,
      annualAllowances: row.allowancesTotal,
      overtimeTotal: row.overtimeTotal,
      deductionsTotal: row.deductionsTotal,
      netTotal: row.netTotal,
      observations: Array.from(new Set(row.observations)).join(", ") || this.buildEmployeeAnnualObservation(row.employeeId, employees, year)
    }));

    const admissions = employees.filter((employee) => String(employee.hire_date || "").startsWith(year));
    const inactiveEmployees = employees.filter((employee) => String(employee.status || "").toLowerCase() !== "ativo");
    const benefitChanges = annualRuns.filter((run) => Number(run.allowances_total || 0) > 0);
    const salaryChanges = employeeRows.filter((row) => Number(row.initialSalary || 0) !== Number(row.finalSalary || 0));

    const rhCosts = [
      { label: "Benefícios", value: totalAllowances },
      { label: "Bonificações", value: totalBonuses },
      { label: "Treinamentos", value: 0 },
      { label: "Indemnizações", value: 0 },
      { label: "Recrutamento", value: 0 }
    ];

    return {
      company,
      year,
      previousYear,
      annualRuns,
      annualSummary,
      previousSummary,
      totalAllowances,
      totalBonuses,
      totalOtherDiscounts,
      totalDeductions,
      variation,
      averageAnnualSalary,
      monthly,
      departmentDistribution,
      topJobTitles,
      employeeRows,
      admissions,
      inactiveEmployees,
      benefitChanges,
      salaryChanges,
      rhCosts
    };
  }

  buildAnnualMonthObservation(runs, summary) {
    if (!runs.length) {
      return "Sem processamento salarial neste mês.";
    }
    const notes = [];
    if (summary.totalGross > 0 && summary.employeeCount > 0) {
      notes.push(`Folha processada para ${summary.employeeCount} colaborador(es).`);
    }
    const bonusMonths = runs.filter((run) => Number(run.bonuses_total || 0) > 0).length;
    if (bonusMonths > 0) {
      notes.push(`Foram registadas ${bonusMonths} ocorrência(s) com bonificações.`);
    }
    const deductions = runs.reduce((sum, run) => sum + Number(run.summary_json?.absenceDeduction || 0) + Number(run.summary_json?.leaveDeduction || 0), 0);
    if (deductions > 0) {
      notes.push(`Existiram reduções por faltas/licenças no montante de ${this.currency(deductions)}.`);
    }
    return notes.join(" ");
  }

  buildAnnualMonthInsight(month, months) {
    const currentIndex = months.findIndex((item) => item.monthRef === month.monthRef);
    if (currentIndex <= 0) {
      return "Este é o primeiro mês com dados comparáveis no exercício.";
    }
    const previous = months[currentIndex - 1];
    if (!previous || Number(previous.gross || 0) === 0) {
      return "Não existe base comparável suficiente para calcular a variação mensal.";
    }
    const variation = ((Number(month.gross || 0) - Number(previous.gross || 0)) / Number(previous.gross || 0)) * 100;
    if (variation >= 10) {
      return `Verificou-se um aumento significativo da folha face a ${previous.label}, correspondente a ${this.formatPercentage(variation)}.`;
    }
    if (variation <= -10) {
      return `Verificou-se uma redução significativa da folha face a ${previous.label}, correspondente a ${this.formatPercentage(variation)}.`;
    }
    return `A variação da folha face a ${previous.label} manteve-se controlada em ${this.formatPercentage(variation)}.`;
  }

  buildEmployeeAnnualObservation(employeeId, employees, year) {
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) {
      return "Registo anual";
    }
    if (String(employee.hire_date || "").startsWith(year)) {
      return "Admissão no exercício";
    }
    if (String(employee.status || "").toLowerCase() !== "ativo") {
      return "Colaborador inativo";
    }
    return "Evolução regular";
  }

  percentageOf(value, total) {
    const numericTotal = Number(total || 0);
    if (!numericTotal) {
      return 0;
    }
    return (Number(value || 0) / numericTotal) * 100;
  }

  drawAnnualTaxTableOfContents({ page, data, font, bold, entries }) {
    const { width } = page.getSize();
    let y = 676;
    page.drawText("Estrutura do documento", {
      x: REPORT_MARGIN,
      y,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    y -= 28;

    entries.forEach((entry, index) => {
      const label = `${index + 1}. ${entry.label}`;
      page.drawText(label, {
        x: REPORT_MARGIN,
        y,
        font,
        size: 11,
        color: REPORT_COLORS.text
      });
      page.drawLine({
        start: { x: REPORT_MARGIN + 170, y: y + 4 },
        end: { x: width - REPORT_MARGIN - 34, y: y + 4 },
        thickness: 0.6,
        color: REPORT_COLORS.line
      });
      page.drawText(String(entry.page), {
        x: width - REPORT_MARGIN - 16,
        y,
        font: bold,
        size: 11,
        color: REPORT_COLORS.title
      });
      y -= 24;
    });

    page.drawRectangle({
      x: REPORT_MARGIN,
      y: 126,
      width: width - REPORT_MARGIN * 2,
      height: 112,
      color: REPORT_COLORS.altFill
    });
    this.drawWrappedText({
      page,
      text: `Documento preparado para consulta da gestão, contabilidade e direção. O relatório consolida os valores de ${data.shortLabel} do exercício de ${data.year}, com detalhe mensal e mapa por funcionário.`,
      x: REPORT_MARGIN + 18,
      y: 206,
      maxWidth: width - REPORT_MARGIN * 2 - 36,
      lineHeight: 16,
      font,
      size: 10.5,
      color: REPORT_COLORS.text
    });
  }

  drawAnnualTaxCoverPage({ page, data, font, bold, logo }) {
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: height - 238, width, height: 238, color: rgb(0.91, 0.95, 0.99) });
    page.drawRectangle({ x: 0, y: height - 250, width, height: 12, color: REPORT_COLORS.title });
    page.drawRectangle({ x: REPORT_MARGIN, y: 104, width: width - REPORT_MARGIN * 2, height: height - 212, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: REPORT_MARGIN, y: height - 352, width: width - REPORT_MARGIN * 2, height: 194, color: REPORT_COLORS.mutedFill });

    if (logo) {
      const scale = Math.min(124 / logo.width, 82 / logo.height, 1);
      page.drawImage(logo.image, {
        x: (width - logo.width * scale) / 2,
        y: height - 156,
        width: logo.width * scale,
        height: logo.height * scale
      });
    }

    this.drawCenteredText(page, data.company.name || "Empresa", REPORT_MARGIN, height - 246, width - REPORT_MARGIN * 2, bold, 16, REPORT_COLORS.text);
    this.drawCenteredText(page, data.title.toUpperCase(), REPORT_MARGIN, height - 284, width - REPORT_MARGIN * 2, bold, 21, REPORT_COLORS.title);
    this.drawCenteredText(page, `Exercício de ${data.year}`, REPORT_MARGIN, height - 314, width - REPORT_MARGIN * 2, font, 12, REPORT_COLORS.subtitle);

    const details = [
      ["Período de referência", `Janeiro a Dezembro de ${data.year}`],
      ["Data de emissão", this.formatDate(new Date().toISOString())],
      ["Documento", "Confidencial - Uso interno"],
      ["Ambito", isNaN(data.currentTotal) ? "-" : `${data.shortLabel} anual consolidado`]
    ];
    let y = height - 410;
    details.forEach(([label, value]) => {
      page.drawText(label, { x: REPORT_MARGIN + 32, y, font: bold, size: 10.5, color: REPORT_COLORS.subtitle });
      page.drawText(value, { x: 260, y, font, size: 10.5, color: REPORT_COLORS.text });
      page.drawLine({
        start: { x: REPORT_MARGIN + 28, y: y - 8 },
        end: { x: width - REPORT_MARGIN - 28, y: y - 8 },
        thickness: 0.7,
        color: REPORT_COLORS.line
      });
      y -= 38;
    });

    this.drawWrappedText({
      page,
      text: `Este relatório apresenta a consolidação anual de ${data.shortLabel}, com leitura executiva, evolução mensal e detalhe individual por colaborador, apoiando a verificação fiscal e a tomada de decisão da empresa.`,
      x: REPORT_MARGIN + 20,
      y: 178,
      maxWidth: width - REPORT_MARGIN * 2 - 40,
      lineHeight: 16,
      font,
      size: 11,
      color: REPORT_COLORS.text
    });

    page.drawText("Documento Confidencial - Uso Interno", {
      x: REPORT_MARGIN,
      y: 72,
      font: bold,
      size: 10.5,
      color: REPORT_COLORS.title
    });
  }

  drawAnnualTaxSummaryPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    const cards = data.taxType === "inss"
      ? [
          ["INSS total do ano", this.currency(data.currentTotal)],
          ["INSS colaboradores", this.currency(data.employeePortionTotal)],
          ["INSS empresa", this.currency(data.employerPortionTotal)],
          ["Colaboradores abrangidos", String(data.employeeCount)],
          ["Média anual por colaborador", this.currency(data.averagePerEmployee)],
          ["Peso sobre a folha", this.formatPercentage(this.percentageOf(data.currentTotal, data.totalGross))]
        ]
      : [
          ["IRT total do ano", this.currency(data.currentTotal)],
          ["Matéria coletável anual", this.currency(data.taxableBaseTotal)],
          ["Colaboradores abrangidos", String(data.employeeCount)],
          ["Média anual por colaborador", this.currency(data.averagePerEmployee)],
          ["Peso sobre a folha", this.formatPercentage(this.percentageOf(data.currentTotal, data.totalGross))],
          ["Variação face ao ano anterior", this.formatPercentage(data.variation)]
        ];

    cards.forEach(([label, value], index) => {
      this.drawMetricCard({
        page,
        x: REPORT_MARGIN + (index % 3) * 164,
        y: height - 188 - Math.floor(index / 3) * 94,
        width: 150,
        height: 78,
        label,
        value,
        font,
        bold
      });
    });

    page.drawText("Leitura anual", {
      x: REPORT_MARGIN,
      y: height - 396,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    this.drawWrappedText({
      page,
      text:
        data.taxType === "inss"
          ? `No exercício de ${data.year}, a empresa apurou ${this.currency(data.currentTotal)} em contribuições para a Segurança Social, das quais ${this.currency(data.employeePortionTotal)} correspondem aos colaboradores e ${this.currency(data.employerPortionTotal)} à componente patronal. O impacto desta obrigação sobre a folha anual foi de ${this.formatPercentage(this.percentageOf(data.currentTotal, data.totalGross))}.`
          : `No exercício de ${data.year}, a empresa apurou ${this.currency(data.currentTotal)} em IRT, incidindo sobre uma matéria coletável anual de ${this.currency(data.taxableBaseTotal)}. A variação face a ${data.previousYear} foi de ${this.formatPercentage(data.variation)}, com um impacto de ${this.formatPercentage(this.percentageOf(data.currentTotal, data.totalGross))} sobre a folha anual.`,
      x: REPORT_MARGIN,
      y: height - 424,
      maxWidth: width - REPORT_MARGIN * 2,
      lineHeight: 16,
      font,
      size: 10.8,
      color: REPORT_COLORS.text
    });

    page.drawText("Departamentos com maior impacto", {
      x: REPORT_MARGIN,
      y: height - 506,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    this.drawHorizontalBarChart({
      page,
      x: REPORT_MARGIN,
      y: height - 706,
      width: width - REPORT_MARGIN * 2,
      height: 156,
      data: data.departments,
      font,
      bold
    });
  }

  drawAnnualTaxMonthlyPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    this.drawMetricCard({
      page,
      x: REPORT_MARGIN,
      y: height - 188,
      width: 156,
      height: 74,
      label: "Total anual",
      value: this.currency(data.currentTotal),
      font,
      bold
    });
    this.drawMetricCard({
      page,
      x: REPORT_MARGIN + 172,
      y: height - 188,
      width: 156,
      height: 74,
      label: "Mês de maior impacto",
      value: data.peakMonth ? data.peakMonth.label : "-",
      font,
      bold
    });
    this.drawMetricCard({
      page,
      x: REPORT_MARGIN + 344,
      y: height - 188,
      width: 194,
      height: 74,
      label: "Valor do mês de pico",
      value: this.currency(data.peakMonth?.totalValue || 0),
      font,
      bold
    });

    page.drawText("Evolução mensal", {
      x: REPORT_MARGIN,
      y: height - 246,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    this.drawLineChart({
      page,
      x: REPORT_MARGIN,
      y: height - 458,
      width: 240,
      height: 154,
      data: data.monthly.map((month) => ({ label: month.shortLabel, total: month.totalValue })),
      font,
      bold
    });

    page.drawText("Mapa mensal resumido", {
      x: 322,
      y: height - 246,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    let y = height - 282;
    data.monthly.forEach((month, index) => {
      page.drawRectangle({
        x: 322,
        y: y - 8,
        width: width - 322 - REPORT_MARGIN,
        height: 24,
        color: index % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1)
      });
      page.drawText(month.shortLabel, { x: 336, y, font: bold, size: 10, color: REPORT_COLORS.text });
      if (data.taxType === "inss") {
        this.drawFittedText(page, `Func.: ${this.currency(month.employeeValue)}`, 386, y, font, 9.2, 110, REPORT_COLORS.text);
        this.drawFittedText(page, `Emp.: ${this.currency(month.employerValue)}`, 498, y, font, 9.2, 110, REPORT_COLORS.text);
        this.drawRightText(page, this.currency(month.totalValue), width - REPORT_MARGIN - 10, y, bold, 9.6);
      } else {
        this.drawFittedText(page, `Base: ${this.currency(month.taxableBase)}`, 386, y, font, 9.2, 170, REPORT_COLORS.text);
        this.drawRightText(page, this.currency(month.totalValue), width - REPORT_MARGIN - 10, y, bold, 9.6);
      }
      y -= 28;
    });
  }

  drawAnnualTaxEmployeeTablePages({ doc, company, data, font, bold, logo, startPageNumber }) {
    const pages = [];
    const pageCapacity = 14;
    for (let index = 0; index < data.rows.length || index === 0; index += pageCapacity) {
      const page = doc.addPage(A4_LANDSCAPE);
      pages.push(page);
      this.drawStandardReportPage({
        page,
        company,
        title: "Mapa por Funcionário",
        section: "3",
        font,
        bold,
        logo,
        pageNumber: startPageNumber + pages.length - 1
      });
      this.drawAnnualTaxEmployeeTable({
        page,
        rows: data.rows.slice(index, index + pageCapacity),
        data,
        font,
        bold
      });
      if (!data.rows.length) {
        break;
      }
    }
    return pages;
  }

  drawAnnualTaxEmployeeTable({ page, rows, data, font, bold }) {
    const { width, height } = page.getSize();
    const topY = height - 165;
    const rowHeight = 22;
    const columns = data.taxType === "inss"
      ? [
          { key: "index", label: "Nº", x: REPORT_MARGIN, width: 28, align: "center" },
          { key: "name", label: "Nome completo", x: REPORT_MARGIN + 32, width: 170 },
          { key: "department", label: "Departamento", x: REPORT_MARGIN + 206, width: 108 },
          { key: "jobTitle", label: "Cargo", x: REPORT_MARGIN + 318, width: 120 },
          { key: "months", label: "Meses", x: REPORT_MARGIN + 442, width: 44, align: "center" },
          { key: "employeeValue", label: "INSS Func.", x: REPORT_MARGIN + 490, width: 82, align: "right", money: true },
          { key: "employerValue", label: "INSS Emp.", x: REPORT_MARGIN + 576, width: 82, align: "right", money: true },
          { key: "totalValue", label: "Total", x: REPORT_MARGIN + 662, width: 82, align: "right", money: true },
          { key: "participation", label: "%", x: REPORT_MARGIN + 748, width: 36, align: "right", percent: true }
        ]
      : [
          { key: "index", label: "Nº", x: REPORT_MARGIN, width: 28, align: "center" },
          { key: "name", label: "Nome completo", x: REPORT_MARGIN + 32, width: 164 },
          { key: "department", label: "Departamento", x: REPORT_MARGIN + 200, width: 104 },
          { key: "jobTitle", label: "Cargo", x: REPORT_MARGIN + 308, width: 112 },
          { key: "months", label: "Meses", x: REPORT_MARGIN + 424, width: 44, align: "center" },
          { key: "taxableBaseTotal", label: "Matéria coletável", x: REPORT_MARGIN + 472, width: 110, align: "right", money: true },
          { key: "totalValue", label: "IRT anual", x: REPORT_MARGIN + 586, width: 84, align: "right", money: true },
          { key: "averageMonthly", label: "Média mensal", x: REPORT_MARGIN + 674, width: 88, align: "right", money: true },
          { key: "participation", label: "%", x: REPORT_MARGIN + 766, width: 24, align: "right", percent: true }
        ];

    page.drawRectangle({ x: REPORT_MARGIN, y: topY - 14, width: width - REPORT_MARGIN * 2, height: 22, color: REPORT_COLORS.title });
    columns.forEach((column) => {
      page.drawText(column.label, {
        x: column.x + 2,
        y: topY - 6,
        font: bold,
        size: 7.8,
        color: rgb(1, 1, 1)
      });
    });

    let y = topY - 36;
    rows.forEach((row, rowIndex) => {
      page.drawRectangle({
        x: REPORT_MARGIN,
        y: y - 4,
        width: width - REPORT_MARGIN * 2,
        height: rowHeight,
        color: rowIndex % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1)
      });

      columns.forEach((column) => {
        const rawValue = row[column.key];
        const text = column.money
          ? this.formatCompactNumber(rawValue)
          : column.percent
            ? this.formatPercentage(rawValue).replace("+", "")
            : String(rawValue ?? "");

        if (column.align === "right") {
          this.drawRightAlignedWithin(page, text, column.x + column.width - 2, y + 3, font, 8.1, column.width - 4);
          return;
        }
        if (column.align === "center") {
          this.drawCenteredText(page, text, column.x, y + 3, column.width, font, 8.1, REPORT_COLORS.text);
          return;
        }
        this.drawFittedText(page, text, column.x + 2, y + 3, font, 8.1, column.width - 4, REPORT_COLORS.text);
      });
      y -= rowHeight;
    });
  }

  drawAnnualTaxConclusionPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    page.drawText("Síntese fiscal do exercício", {
      x: REPORT_MARGIN,
      y: height - 164,
      font: bold,
      size: 14,
      color: REPORT_COLORS.title
    });
    this.drawWrappedText({
      page,
      text:
        data.taxType === "inss"
          ? `A contribuição anual para a Segurança Social totalizou ${this.currency(data.currentTotal)}, repartida entre ${this.currency(data.employeePortionTotal)} suportados pelos colaboradores e ${this.currency(data.employerPortionTotal)} suportados pela empresa. O mês com maior exigência foi ${data.peakMonth?.label || "-"}, com ${this.currency(data.peakMonth?.totalValue || 0)}. Recomenda-se a revisão periódica das bases de incidência e a conferência mensal do mapa submetido às entidades competentes.`
          : `O IRT anual apurado foi de ${this.currency(data.currentTotal)}, incidindo sobre uma matéria coletável agregada de ${this.currency(data.taxableBaseTotal)}. O mês com maior impacto foi ${data.peakMonth?.label || "-"}, com ${this.currency(data.peakMonth?.totalValue || 0)}. Recomenda-se a reconciliação mensal entre a matéria coletável, os descontos efetivamente processados e os mapas entregues para garantir consistência fiscal ao longo do exercício.`,
      x: REPORT_MARGIN,
      y: height - 198,
      maxWidth: width - REPORT_MARGIN * 2,
      lineHeight: 16,
      font,
      size: 11,
      color: REPORT_COLORS.text
    });

    page.drawRectangle({
      x: REPORT_MARGIN,
      y: 188,
      width: width - REPORT_MARGIN * 2,
      height: 164,
      color: REPORT_COLORS.altFill
    });
    page.drawText("Indicadores de controlo", {
      x: REPORT_MARGIN + 18,
      y: 326,
      font: bold,
      size: 12,
      color: REPORT_COLORS.title
    });

    const lines = data.taxType === "inss"
      ? [
          `Peso do INSS sobre a folha anual: ${this.formatPercentage(this.percentageOf(data.currentTotal, data.totalGross))}`,
          `Média anual por colaborador: ${this.currency(data.averagePerEmployee)}`,
          `Variação face a ${data.previousYear}: ${this.formatPercentage(data.variation)}`,
          `Departamentos com maior impacto: ${data.departments.slice(0, 3).map((item) => item.title).join(", ") || "-"}`
        ]
      : [
          `Peso do IRT sobre a folha anual: ${this.formatPercentage(this.percentageOf(data.currentTotal, data.totalGross))}`,
          `Matéria coletável consolidada: ${this.currency(data.taxableBaseTotal)}`,
          `Média anual por colaborador: ${this.currency(data.averagePerEmployee)}`,
          `Variação face a ${data.previousYear}: ${this.formatPercentage(data.variation)}`
        ];

    let y = 294;
    lines.forEach((line) => {
      page.drawCircle({ x: REPORT_MARGIN + 24, y: y + 4, size: 2.5, color: REPORT_COLORS.accent });
      this.drawFittedText(page, line, REPORT_MARGIN + 34, y, font, 10.5, width - REPORT_MARGIN * 2 - 54, REPORT_COLORS.text);
      y -= 26;
    });
  }

  drawAnnualCoverPage({ page, data, font, bold, logo }) {
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: height - 260, width, height: 260, color: rgb(0.91, 0.95, 0.99) });
    page.drawRectangle({ x: 0, y: height - 270, width, height: 12, color: REPORT_COLORS.title });
    page.drawRectangle({ x: REPORT_MARGIN, y: 96, width: width - REPORT_MARGIN * 2, height: height - 204, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: REPORT_MARGIN, y: height - 340, width: width - REPORT_MARGIN * 2, height: 188, color: REPORT_COLORS.mutedFill });

    if (logo) {
      const scale = Math.min(120 / logo.width, 80 / logo.height, 1);
      page.drawImage(logo.image, {
        x: (width - logo.width * scale) / 2,
        y: height - 158,
        width: logo.width * scale,
        height: logo.height * scale
      });
    }

    this.drawCenteredText(page, data.company.name || "Empresa", REPORT_MARGIN, height - 248, width - REPORT_MARGIN * 2, bold, 16, REPORT_COLORS.text);
    this.drawCenteredText(page, `RELATÓRIO ANUAL DE SALÁRIOS - ${data.year}`, REPORT_MARGIN, height - 282, width - REPORT_MARGIN * 2, bold, 22, REPORT_COLORS.title);
    this.drawCenteredText(page, "Compensações, benefícios e indicadores financeiros", REPORT_MARGIN, height - 312, width - REPORT_MARGIN * 2, font, 12, REPORT_COLORS.subtitle);

    const details = [
      ["Período de referência", `Janeiro a Dezembro de ${data.year}`],
      ["Data de emissão", this.formatDate(new Date().toISOString())],
      ["Classificação", "Documento Confidencial"]
    ];
    let detailY = height - 396;
    details.forEach(([label, value]) => {
      page.drawText(label, { x: REPORT_MARGIN + 28, y: detailY, font: bold, size: 10.5, color: REPORT_COLORS.title });
      page.drawText(value, { x: REPORT_MARGIN + 188, y: detailY, font, size: 10.5, color: REPORT_COLORS.text });
      page.drawLine({
        start: { x: REPORT_MARGIN + 28, y: detailY - 8 },
        end: { x: width - REPORT_MARGIN - 28, y: detailY - 8 },
        thickness: 0.8,
        color: REPORT_COLORS.line
      });
      detailY -= 36;
    });

    page.drawRectangle({
      x: REPORT_MARGIN + 28,
      y: 166,
      width: width - REPORT_MARGIN * 2 - 56,
      height: 78,
      color: REPORT_COLORS.altFill,
      borderColor: REPORT_COLORS.line,
      borderWidth: 0.8
    });
    this.drawWrappedText({
      page,
      text: "Relatório corporativo de circulação restrita, preparado para apoio à direção, à área financeira e à contabilidade, com consolidação anual da folha salarial e dos principais encargos do exercício.",
      x: REPORT_MARGIN + 44,
      y: 218,
      maxWidth: width - REPORT_MARGIN * 2 - 88,
      lineHeight: 16,
      font,
      size: 10.5,
      color: REPORT_COLORS.text
    });

    page.drawText(`Emitido em ${this.formatDate(new Date().toISOString())}`, {
      x: REPORT_MARGIN,
      y: 88,
      font,
      size: 10.5,
      color: REPORT_COLORS.subtitle
    });
    page.drawText("Documento Confidencial — Uso Interno", {
      x: width - REPORT_MARGIN - 180,
      y: 88,
      font,
      size: 10.5,
      color: REPORT_COLORS.subtitle
    });
  }

  drawAnnualSummaryPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    const cards = [
      ["Total anual de salários", this.currency(data.annualSummary.totalGross)],
      ["Total líquido pago", this.currency(data.annualSummary.totalNet)],
      ["Total anual de encargos", this.currency(data.annualSummary.totalEmployerInss + data.annualSummary.totalIrt + data.annualSummary.totalInss)],
      ["Total de subsídios", this.currency(data.totalAllowances)],
      ["Número de colaboradores", String(data.employeeRows.length)],
      ["Custo médio por colaborador", this.currency(data.averageAnnualSalary)]
    ];

    cards.forEach(([label, value], index) => {
      this.drawMetricCard({
        page,
        x: REPORT_MARGIN + (index % 3) * 164,
        y: height - 188 - Math.floor(index / 3) * 94,
        width: 150,
        height: 78,
        label,
        value,
        font,
        bold
      });
    });

    page.drawText("Leitura executiva do exercício", { x: REPORT_MARGIN, y: height - 392, font: bold, size: 14, color: REPORT_COLORS.title });
    this.drawWrappedText({
      page,
      text: `No exercício de ${data.year}, a organização processou ${this.currency(data.annualSummary.totalGross)} em remunerações ilíquidas, pagou ${this.currency(data.annualSummary.totalNet)} em valores líquidos e suportou ${this.currency(data.annualSummary.totalEmployerInss + data.annualSummary.totalIrt + data.annualSummary.totalInss)} em encargos legais. A folha apresentou uma variação de ${this.formatPercentage(data.variation)} face a ${data.previousYear}, com ${data.employeeRows.length} colaborador(es) abrangido(s) e um custo médio anual de ${this.currency(data.averageAnnualSalary)} por colaborador.`,
      x: REPORT_MARGIN,
      y: height - 420,
      maxWidth: width - REPORT_MARGIN * 2,
      lineHeight: 16,
      font,
      size: 10.8,
      color: REPORT_COLORS.text
    });

    page.drawText("Comparação entre bruto, líquido e encargos", { x: REPORT_MARGIN, y: height - 502, font: bold, size: 14, color: REPORT_COLORS.title });
    this.drawCostDistributionChart({
      page,
      x: REPORT_MARGIN + 20,
      y: height - 688,
      width: 280,
      height: 150,
      data: [
        { label: "Bruto", value: data.annualSummary.totalGross, color: REPORT_COLORS.title },
        { label: "Líquido", value: data.annualSummary.totalNet, color: REPORT_COLORS.accent },
        { label: "Encargos", value: data.annualSummary.totalEmployerInss + data.annualSummary.totalIrt + data.annualSummary.totalInss, color: REPORT_COLORS.gray }
      ],
      font,
      bold
    });

    page.drawRectangle({ x: 350, y: height - 688, width: width - 350 - REPORT_MARGIN, height: 170, color: REPORT_COLORS.altFill });
    page.drawText("Pontos de atenção para a gestão", { x: 366, y: height - 542, font: bold, size: 12, color: REPORT_COLORS.title });
    this.drawWrappedText({
      page,
      text: `Os dados anuais evidenciam a dimensão da folha, o peso dos encargos legais e a relevância dos subsídios na estrutura global dos custos. Este resumo deve ser usado como base para revisão orçamental, decisão de aumentos, controlo de benefícios e planeamento do exercício seguinte.`,
      x: 366,
      y: height - 566,
      maxWidth: width - 390 - REPORT_MARGIN,
      lineHeight: 15,
      font,
      size: 10.5,
      color: REPORT_COLORS.text
    });
  }

  drawAnnualIndicatorsPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    const chargesValue = data.annualSummary.totalEmployerInss + data.annualSummary.totalIrt + data.annualSummary.totalInss;
    const benefitsValue = data.totalAllowances + data.totalBonuses;
    const grossValue = Number(data.annualSummary.totalGross || 0);
    this.drawMetricCard({ page, x: REPORT_MARGIN, y: height - 188, width: 142, height: 74, label: "Custo médio mensal por colaborador", value: this.currency((data.annualSummary.totalEmployerCost || 0) / 12 || 0), font, bold });
    this.drawMetricCard({ page, x: REPORT_MARGIN + 156, y: height - 188, width: 142, height: 74, label: "Percentagem de encargos", value: this.formatPercentage(this.percentageOf(chargesValue, grossValue)), font, bold });
    this.drawMetricCard({ page, x: REPORT_MARGIN + 312, y: height - 188, width: 142, height: 74, label: "Percentagem de benefícios", value: this.formatPercentage(this.percentageOf(benefitsValue, grossValue)), font, bold });
    this.drawMetricCard({ page, x: REPORT_MARGIN + 468, y: height - 188, width: 70, height: 74, label: "Colab.", value: String(data.employeeRows.length), font, bold });

    page.drawText("Evolução mensal da folha", { x: REPORT_MARGIN, y: height - 246, font: bold, size: 14, color: REPORT_COLORS.title });
    this.drawLineChart({
      page,
      x: REPORT_MARGIN,
      y: height - 448,
      width: 230,
      height: 148,
      data: data.monthly.map((item) => ({ label: item.shortLabel, total: item.gross })),
      font,
      bold
    });

    page.drawText("Distribuição por departamento", { x: 310, y: height - 246, font: bold, size: 14, color: REPORT_COLORS.title });
    this.drawHorizontalBarChart({
      page,
      x: 310,
      y: height - 448,
      width: width - 310 - REPORT_MARGIN,
      height: 148,
      data: data.departmentDistribution.map((item) => ({ title: item.label, amount: item.value })),
      font,
      bold
    });

    page.drawText("Top cargos com maior impacto financeiro", { x: REPORT_MARGIN, y: height - 490, font: bold, size: 14, color: REPORT_COLORS.title });
    this.drawHorizontalBarChart({
      page,
      x: REPORT_MARGIN,
      y: height - 690,
      width: width - REPORT_MARGIN * 2,
      height: 160,
      data: data.topJobTitles,
      font,
      bold
    });
  }

  drawAnnualConsolidationPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    const lines = [
      ["Total anual de salários", data.annualSummary.totalGross],
      ["Total anual de subsídios", data.totalAllowances],
      ["Total anual de horas extras", data.employeeRows.reduce((sum, row) => sum + Number(row.overtimeTotal || 0), 0)],
      ["Total anual de descontos", data.totalDeductions],
      ["Total líquido pago", data.annualSummary.totalNet],
      ["INSS empresa", data.annualSummary.totalEmployerInss],
      ["INSS colaboradores", data.annualSummary.totalInss],
      ["IRT", data.annualSummary.totalIrt]
    ];

    page.drawText("Mapa de consolidação anual", { x: REPORT_MARGIN, y: height - 162, font: bold, size: 14, color: REPORT_COLORS.title });
    let y = height - 198;
    lines.forEach(([label, value], index) => {
      page.drawRectangle({ x: REPORT_MARGIN, y: y - 8, width: width - REPORT_MARGIN * 2, height: 26, color: index % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1) });
      page.drawText(label, { x: REPORT_MARGIN + 14, y, font: index === 0 || index === 3 || index === 4 ? bold : font, size: 11, color: REPORT_COLORS.text });
      this.drawRightText(page, this.formatCompactNumber(value), width - REPORT_MARGIN - 14, y, index === 0 || index === 3 || index === 4 ? bold : font, 11);
      y -= 30;
    });
  }

  drawAnnualMonthPage({ page, month, data, font, bold }) {
    const { width, height } = page.getSize();
    this.drawMetricCard({ page, x: REPORT_MARGIN, y: height - 192, width: 146, height: 72, label: "Bruto", value: this.currency(month.gross), font, bold });
    this.drawMetricCard({ page, x: REPORT_MARGIN + 162, y: height - 192, width: 146, height: 72, label: "Descontos", value: this.currency(month.deductions), font, bold });
    this.drawMetricCard({ page, x: REPORT_MARGIN + 324, y: height - 192, width: 146, height: 72, label: "Líquido", value: this.currency(month.net), font, bold });

    page.drawText("Leitura mensal", { x: REPORT_MARGIN, y: height - 250, font: bold, size: 14, color: REPORT_COLORS.title });
    this.drawCostDistributionChart({
      page,
      x: REPORT_MARGIN + 12,
      y: height - 462,
      width: 250,
      height: 140,
      data: [
        { label: "Bruto", value: month.gross, color: REPORT_COLORS.title },
        { label: "Descontos", value: month.deductions, color: REPORT_COLORS.gray },
        { label: "Líquido", value: month.net, color: REPORT_COLORS.accent }
      ],
      font,
      bold
    });

    const monthInsight = this.buildAnnualMonthInsight(month, data.monthly);
    page.drawRectangle({ x: 320, y: height - 470, width: width - 320 - REPORT_MARGIN, height: 160, color: REPORT_COLORS.altFill });
    page.drawText("Comentário automático do mês", { x: 338, y: height - 334, font: bold, size: 12, color: REPORT_COLORS.title });
    this.drawWrappedText({
      page,
      text: `${month.observations} ${monthInsight}`.trim(),
      x: 338,
      y: height - 358,
      maxWidth: width - 320 - REPORT_MARGIN - 18,
      lineHeight: 15,
      font,
      size: 10.5,
      color: REPORT_COLORS.text
    });
  }

  drawAnnualEmployeeTablePages({ doc, company, data, font, bold, logo, startPageNumber }) {
    const pages = [];
    const pageCapacity = 18;
    for (let index = 0; index < data.employeeRows.length || index === 0; index += pageCapacity) {
      const page = doc.addPage(A4_LANDSCAPE);
      pages.push(page);
      this.drawStandardReportPage({
        page,
        company,
        title: "Tabela Geral de Funcionários",
        section: "5",
        font,
        bold,
        logo,
        pageNumber: startPageNumber + pages.length - 1
      });
      this.drawAnnualEmployeeTable({ page, rows: data.employeeRows.slice(index, index + pageCapacity), font, bold });
      if (!data.employeeRows.length) {
        break;
      }
    }
    return pages;
  }

  drawAnnualEmployeeTable({ page, rows, font, bold }) {
    const { width, height } = page.getSize();
    const topY = height - 165;
    const rowHeight = 19;
    const columns = this.normalizeTabularColumns([
      { key: "index", label: "Nº", x: REPORT_MARGIN, width: 28, align: "center" },
      { key: "name", label: "Nome completo", x: REPORT_MARGIN + 32, width: 164 },
      { key: "jobTitle", label: "Cargo", x: REPORT_MARGIN + 200, width: 118 },
      { key: "department", label: "Departamento", x: REPORT_MARGIN + 322, width: 100 },
      { key: "annualSalary", label: "Salário anual", x: REPORT_MARGIN + 426, width: 78, align: "right", money: true },
      { key: "annualAllowances", label: "Subsídios", x: REPORT_MARGIN + 508, width: 72, align: "right", money: true },
      { key: "overtimeTotal", label: "Horas extras", x: REPORT_MARGIN + 584, width: 76, align: "right", money: true },
      { key: "deductionsTotal", label: "Descontos", x: REPORT_MARGIN + 664, width: 74, align: "right", money: true },
      { key: "netTotal", label: "Líquido anual", x: REPORT_MARGIN + 742, width: 78, align: "right", money: true }
    ], REPORT_MARGIN, width - REPORT_MARGIN * 2);
    const tableRightX = columns[columns.length - 1].x + columns[columns.length - 1].width;
    const tableWidth = tableRightX - REPORT_MARGIN;

    page.drawRectangle({ x: REPORT_MARGIN, y: topY - 14, width: tableWidth, height: 20, color: REPORT_COLORS.title });
    columns.forEach((column) => {
      this.drawFittedText(page, column.label, column.x + 2, topY - 6, bold, 7.1, column.width - 4, rgb(1, 1, 1), 5.2);
    });

    let y = topY - 36;
    rows.forEach((row, rowIndex) => {
      page.drawRectangle({ x: REPORT_MARGIN, y: y - 4, width: tableWidth, height: rowHeight, color: rowIndex % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1) });
      columns.forEach((column) => {
        const raw = row[column.key];
        const text = column.money ? this.formatCompactNumber(raw) : String(raw ?? "");
        if (column.align === "right") {
          this.drawRightAlignedWithin(page, text, column.x + column.width - 2, y + 3, font, 7.1, column.width - 4);
          return;
        }
        if (column.align === "center") {
          this.drawCenteredText(page, text, column.x, y + 3, column.width, font, 7.1, REPORT_COLORS.text);
          return;
        }
        this.drawFittedText(page, text, column.x + 2, y + 3, font, 7.1, column.width - 4, REPORT_COLORS.text, 5.2);
      });
      y -= rowHeight;
    });
  }

  drawAnnualChargesPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    const totalGross = Number(data.annualSummary.totalGross || 0);
    const legal = [
      ["INSS empresa", data.annualSummary.totalEmployerInss],
      ["INSS funcionários", data.annualSummary.totalInss],
      ["IRT", data.annualSummary.totalIrt],
      ["Outros encargos", data.totalOtherDiscounts]
    ];
    page.drawText("Encargos anuais e obrigações legais", { x: REPORT_MARGIN, y: height - 164, font: bold, size: 14, color: REPORT_COLORS.title });
    let y = height - 198;
    legal.forEach(([label, value], index) => {
      page.drawRectangle({ x: REPORT_MARGIN, y: y - 8, width: 280, height: 26, color: index % 2 === 0 ? REPORT_COLORS.altFill : rgb(1, 1, 1) });
      page.drawText(label, { x: REPORT_MARGIN + 12, y, font, size: 11, color: REPORT_COLORS.text });
      this.drawRightText(page, this.formatCompactNumber(value), REPORT_MARGIN + 216, y, bold, 11);
      this.drawRightText(page, this.formatPercentage(this.percentageOf(value, totalGross)), REPORT_MARGIN + 268, y, font, 10.2);
      y -= 30;
    });
    page.drawText("% sobre a folha", { x: REPORT_MARGIN + 198, y: height - 176, font: bold, size: 9.5, color: REPORT_COLORS.subtitle });
    this.drawLineChart({
      page,
      x: 332,
      y: height - 430,
      width: width - 332 - REPORT_MARGIN,
      height: 190,
      data: data.monthly.map((item) => ({ label: item.shortLabel, total: item.charges })),
      font,
      bold
    });
  }

  drawAnnualRhCostsPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    const costComposition = [
      { label: "Salários", value: data.annualSummary.totalGross },
      ...data.rhCosts
    ];
    page.drawText("Composição anual dos custos de RH", { x: REPORT_MARGIN, y: height - 164, font: bold, size: 14, color: REPORT_COLORS.title });
    this.drawHorizontalBarChart({
      page,
      x: REPORT_MARGIN,
      y: height - 438,
      width: width - REPORT_MARGIN * 2,
      height: 200,
      data: costComposition.map((item) => ({ title: item.label, amount: item.value })),
      font,
      bold
    });
    let y = height - 476;
    costComposition.forEach((item, index) => {
      page.drawText(`${index + 1}. ${item.label}: ${this.currency(item.value)}`, { x: REPORT_MARGIN, y, font, size: 10.5, color: REPORT_COLORS.text });
      y -= 18;
    });
  }

  drawAnnualEventsPage({ page, data, font, bold }) {
    const { height } = page.getSize();
    const sections = [
      ["Admissões", data.admissions.length ? data.admissions.slice(0, 8).map((item) => `${item.full_name} | ${item.job_title || item.contract_type || "-"}`) : ["Sem admissões registadas."]],
      ["Demissões", data.inactiveEmployees.length ? data.inactiveEmployees.slice(0, 8).map((item) => `${item.full_name} | ${item.department || "-"}`) : ["Sem demissões identificadas no período."]],
      ["Promoções / alterações salariais", data.salaryChanges.length ? data.salaryChanges.slice(0, 8).map((item) => `${item.name} | ${this.currency(item.initialSalary)} para ${this.currency(item.finalSalary)}`) : ["Sem alterações salariais significativas detetadas."]],
      ["Alterações de benefícios", data.benefitChanges.length ? data.benefitChanges.slice(0, 8).map((item) => `${item.full_name} | ${this.currency(item.allowances_total)}`) : ["Sem alterações relevantes de benefícios."]]
    ];
    let y = height - 164;
    sections.forEach(([title, lines]) => {
      page.drawText(title, { x: REPORT_MARGIN, y, font: bold, size: 13, color: REPORT_COLORS.title });
      page.drawText(`Total: ${lines[0]?.startsWith("Sem ") ? 0 : lines.length}`, { x: 430, y, font, size: 10.2, color: REPORT_COLORS.subtitle });
      y -= 18;
      lines.forEach((line) => {
        this.drawFittedText(page, line, REPORT_MARGIN + 8, y, font, 10.3, 470, REPORT_COLORS.text);
        y -= 16;
      });
      y -= 20;
    });
  }

  drawAnnualConclusionPage({ page, data, font, bold }) {
    const { width, height } = page.getSize();
    page.drawText("Análise final do exercício", { x: REPORT_MARGIN, y: height - 164, font: bold, size: 14, color: REPORT_COLORS.title });
    this.drawWrappedText({
      page,
      text: `No exercício de ${data.year}, a folha salarial registou ${this.currency(data.annualSummary.totalGross)} em remunerações ilíquidas e ${this.currency(data.annualSummary.totalNet)} em pagamentos líquidos, com um custo patronal consolidado de ${this.currency(data.annualSummary.totalEmployerCost)}. Face a ${data.previousYear}, a variação apurada foi de ${this.formatPercentage(data.variation)}, evidenciando a necessidade de acompanhamento permanente da evolução dos encargos, dos benefícios e do impacto financeiro por área funcional.`,
      x: REPORT_MARGIN,
      y: height - 198,
      maxWidth: width - REPORT_MARGIN * 2,
      lineHeight: 16,
      font,
      size: 11,
      color: REPORT_COLORS.text
    });
    page.drawRectangle({ x: REPORT_MARGIN, y: height - 412, width: width - REPORT_MARGIN * 2, height: 120, color: REPORT_COLORS.altFill });
    page.drawText("Recomendações para o próximo ano", { x: REPORT_MARGIN + 16, y: height - 320, font: bold, size: 12, color: REPORT_COLORS.title });
    [
      "Rever a distribuição da folha por departamento e por função crítica.",
      "Acompanhar mensalmente a evolução do custo médio por colaborador e o peso dos encargos legais.",
      "Formalizar o registo de custos de RH não salariais para maior completude analítica."
    ].forEach((line, index) => {
      page.drawText(`${index + 1}. ${line}`, { x: REPORT_MARGIN + 16, y: height - 348 - index * 18, font, size: 10.5, color: REPORT_COLORS.text });
    });
  }

  drawAnnualSignaturesPage({ page, font, bold }) {
    const { width, height } = page.getSize();
    page.drawText("Aprovação do relatório anual", { x: REPORT_MARGIN, y: height - 164, font: bold, size: 14, color: REPORT_COLORS.title });
    page.drawText(`Data: ${this.formatDate(new Date().toISOString())}`, { x: REPORT_MARGIN, y: height - 188, font, size: 10.5, color: REPORT_COLORS.subtitle });
    [
      { label: "Diretor Financeiro", x: REPORT_MARGIN, y: height - 330 },
      { label: "Responsável de RH", x: REPORT_MARGIN + 260, y: height - 330 },
      { label: "Diretor Executivo", x: REPORT_MARGIN, y: height - 500 }
    ].forEach((block) => {
      page.drawRectangle({ x: block.x, y: block.y, width: 220, height: 118, color: REPORT_COLORS.altFill });
      page.drawText(block.label, { x: block.x + 16, y: block.y + 88, font: bold, size: 11, color: REPORT_COLORS.title });
      page.drawText("Assinatura", { x: block.x + 16, y: block.y + 48, font, size: 10, color: REPORT_COLORS.subtitle });
      page.drawLine({ start: { x: block.x + 16, y: block.y + 40 }, end: { x: block.x + 204, y: block.y + 40 }, thickness: 0.8, color: REPORT_COLORS.gray });
      page.drawText("Nome", { x: block.x + 16, y: block.y + 22, font, size: 10, color: REPORT_COLORS.subtitle });
      page.drawLine({ start: { x: block.x + 54, y: block.y + 18 }, end: { x: block.x + 204, y: block.y + 18 }, thickness: 0.8, color: REPORT_COLORS.gray });
    });
    page.drawText("Documento Confidencial — Uso Interno", { x: width - REPORT_MARGIN - 180, y: 82, font, size: 10, color: REPORT_COLORS.subtitle });
  }
}

module.exports = {
  PdfService
};



