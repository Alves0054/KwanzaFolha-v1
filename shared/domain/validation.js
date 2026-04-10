function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function todayMonth() {
  return new Date().toISOString().slice(0, 7);
}

module.exports = {
  parseCommaList,
  todayMonth
};
