import React from "react";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || "O renderer encontrou um erro inesperado."
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Erro fatal no renderer do Kwanza Folha.", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="splash-screen app-error-screen">
        <div className="panel app-error-screen__card">
          <div className="section-heading">
            <h2>O Kwanza Folha encontrou um erro ao abrir</h2>
            <p>
              A interface foi interrompida para evitar um ecrã em branco. Pode recarregar a aplicação e, se o erro
              persistir, validar a base local e os últimos dados processados.
            </p>
          </div>
          <div className="feedback feedback--error">
            {this.state.message}
          </div>
          <div className="inline-actions">
            <button type="button" onClick={this.handleReload}>
              Recarregar aplicação
            </button>
          </div>
        </div>
      </div>
    );
  }
}
