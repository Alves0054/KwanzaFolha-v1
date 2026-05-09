const leaveTypeOptions = [
  { value: "justified_absence", label: "Ausência justificada" },
  { value: "unjustified_absence", label: "Falta injustificada" },
  { value: "leave_with_pay", label: "Licença com vencimento" },
  { value: "leave_without_pay", label: "Licença sem vencimento" },
  { value: "medical_leave", label: "Licença médica" },
  { value: "maternity_leave", label: "Licença de maternidade" },
  { value: "paternity_leave", label: "Licença de paternidade" },
  { value: "family_leave", label: "Licença por motivo familiar" },
  { value: "other_leave", label: "Outro tipo de licença" }
];

const attendanceStatusOptions = [
  { value: "present", label: "Presente" },
  { value: "delay", label: "Atraso" },
  { value: "absent", label: "Falta" },
  { value: "half_absence", label: "Meia falta" },
  { value: "leave", label: "Licença" },
  { value: "vacation", label: "Férias" }
];

const vacationStatusLabels = {
  approved: "Aprovadas",
  rejected: "Rejeitadas",
  taken: "Gozadas",
  pending: "Pendentes"
};

const financialEntryTypeLabels = {
  advance: "Adiantamento",
  loan: "Empréstimo"
};

module.exports = {
  leaveTypeOptions,
  attendanceStatusOptions,
  vacationStatusLabels,
  financialEntryTypeLabels
};
