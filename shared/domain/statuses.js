const leaveTypeOptions = [
  { value: "justified_absence", label: "Ausencia justificada" },
  { value: "unjustified_absence", label: "Falta injustificada" },
  { value: "leave_with_pay", label: "Licenca com vencimento" },
  { value: "leave_without_pay", label: "Licenca sem vencimento" },
  { value: "medical_leave", label: "Licenca medica" },
  { value: "maternity_leave", label: "Licenca de maternidade" },
  { value: "paternity_leave", label: "Licenca de paternidade" },
  { value: "family_leave", label: "Licenca por motivo familiar" },
  { value: "other_leave", label: "Outro tipo de licenca" }
];

const attendanceStatusOptions = [
  { value: "present", label: "Presente" },
  { value: "delay", label: "Atraso" },
  { value: "absent", label: "Falta" },
  { value: "half_absence", label: "Meia falta" },
  { value: "leave", label: "Licenca" },
  { value: "vacation", label: "Ferias" }
];

const vacationStatusLabels = {
  approved: "Aprovadas",
  rejected: "Rejeitadas",
  taken: "Gozadas",
  pending: "Pendentes"
};

const financialEntryTypeLabels = {
  advance: "Adiantamento",
  loan: "Emprestimo"
};

module.exports = {
  leaveTypeOptions,
  attendanceStatusOptions,
  vacationStatusLabels,
  financialEntryTypeLabels
};
