const shiftProfileOptions = [
  { value: "general", label: "Geral" },
  { value: "docente_morning", label: "Docente - Manha" },
  { value: "docente_afternoon", label: "Docente - Tarde" },
  { value: "docente_evening", label: "Docente - Noite" },
  { value: "docente_flexible", label: "Docente - Flexivel" }
];

const weekdayOptions = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
  { value: 7, label: "Dom" }
];

module.exports = {
  shiftProfileOptions,
  weekdayOptions
};
