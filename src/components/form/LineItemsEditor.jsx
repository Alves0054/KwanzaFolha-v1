function createLineItem(withSchedule = false) {
  return withSchedule
    ? { label: "", amount: "", fiscalMode: "taxable", month: "", auto: false }
    : { label: "", amount: "", fiscalMode: "taxable" };
}

const fiscalModeOptions = [
  { value: "taxable", label: "INSS + IRT" },
  { value: "irt_only", label: "So IRT" },
  { value: "inss_only", label: "So INSS" },
  { value: "exempt", label: "Não sujeito / isento" }
];

export default function LineItemsEditor({
  title,
  subtitle,
  items,
  onChange,
  withSchedule = false,
  amountLabel = "Valor",
  enableFiscalMode = false
}) {
  function updateItem(index, key, value) {
    onChange(
      items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item))
    );
  }

  function addItem() {
    onChange([...(items || []), createLineItem(withSchedule)]);
  }

  function removeItem(index) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="line-editor">
      <div className="line-editor__header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="secondary-btn" onClick={addItem}>Adicionar</button>
      </div>

      <div className="line-editor__list">
        {(items || []).map((item, index) => (
          <div
            className={`line-editor__row${withSchedule ? " line-editor__row--schedule" : ""}${enableFiscalMode ? " line-editor__row--fiscal" : ""}`}
            key={`${title}-${index}`}
          >
            <label>
              Descrição
              <input
                value={item.label || ""}
                onChange={(event) => updateItem(index, "label", event.target.value)}
                placeholder="Ex.: Alimentação"
              />
            </label>

            <label>
              {amountLabel}
              <input
                type="number"
                value={item.amount ?? ""}
                onChange={(event) => updateItem(index, "amount", event.target.value)}
                placeholder="0.00"
              />
            </label>

            {enableFiscalMode && (
              <label>
                Tratamento fiscal
                <select
                  value={item.fiscalMode || "taxable"}
                  onChange={(event) => updateItem(index, "fiscalMode", event.target.value)}
                >
                  {fiscalModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {withSchedule && (
              <>
                <label>
                  Mês
                  <select value={item.month ?? ""} onChange={(event) => updateItem(index, "month", event.target.value)}>
                    <option value="">Selecionar</option>
                    {Array.from({ length: 12 }, (_, monthIndex) => (
                      <option key={monthIndex + 1} value={monthIndex + 1}>{monthIndex + 1}</option>
                    ))}
                  </select>
                </label>

                <label className="line-editor__checkbox">
                  <span>Aplicar automaticamente</span>
                  <input
                    type="checkbox"
                    checked={Boolean(item.auto)}
                    onChange={(event) => updateItem(index, "auto", event.target.checked)}
                  />
                </label>
              </>
            )}

            <button type="button" className="link-btn danger" onClick={() => removeItem(index)}>Remover</button>
          </div>
        ))}

        {(!items || items.length === 0) && (
          <div className="line-editor__empty">
            <strong>Sem itens adicionados.</strong>
            <small>Use o botão "Adicionar" para compor esta parte da remuneração.</small>
          </div>
        )}
      </div>
    </div>
  );
}
