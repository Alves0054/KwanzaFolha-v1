import AppIcon from "./AppIcon";
import brandLogo from "../assets/logos/logo-light.png";

const highlights = [
  { icon: "payroll", title: "Folha salarial completa", text: "Processamento mensal, impostos, descontos e fecho de período." },
  { icon: "receipt", title: "Recibos e relatórios", text: "Documentos profissionais em PDF, Excel e mapas anuais." },
  { icon: "dashboard", title: "Controlo operacional", text: "Assiduidade, férias, licenças, turnos e exportações bancárias." }
];

export default function LoginScreen({
  authMode,
  setAuthMode,
  accessState,
  loginForm,
  setLoginForm,
  forgotPasswordForm,
  setForgotPasswordForm,
  registrationForm,
  setRegistrationForm,
  handleLogin,
  handlePasswordResetRequest,
  handlePasswordResetCompletion,
  handleRegister,
  feedback
}) {
  const setupRequired = Boolean(accessState?.setupRequired);
  const canRegister = Boolean(accessState?.canRegister);

  return (
    <div className="auth-shell">
      <div className="auth-card auth-card--split">
        <div className="auth-card__brand">
          <span className="topbar-eyebrow">Plataforma empresarial de RH</span>
          <img className="brand-logo auth-brand-logo" src={brandLogo} alt="Kwanza Folha" />
          <h1>Kwanza Folha</h1>
          <p>Uma experiência moderna para gerir salários, encargos legais, documentos e operações de RH com mais clareza.</p>
          <small className="auth-brand-credit">Criado por Adérito Alves e pela empresa Alves Estúdio.</small>

          <div className="auth-highlights">
            {highlights.map((item) => (
              <div className="auth-highlight" key={item.title}>
                <span className="auth-highlight__icon">
                  <AppIcon name={item.icon} size={18} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.text}</small>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="auth-card__form">
          <div className="auth-tabs" role="tablist" aria-label="Acesso">
            <button
              type="button"
              className={authMode === "login" ? "auth-tab auth-tab--active" : "auth-tab"}
              onClick={() => setAuthMode("login")}
              disabled={setupRequired}
            >
              Iniciar sessão
            </button>
            <button
              type="button"
              className={authMode === "register" ? "auth-tab auth-tab--active" : "auth-tab"}
              onClick={() => setAuthMode("register")}
              disabled={!canRegister}
            >
              Registar empresa
            </button>
          </div>

          {authMode === "register" ? (
            <>
              <div className="section-heading compact">
                <h3>Registo inicial</h3>
                <p>Registe a empresa e defina o primeiro administrador do sistema.</p>
              </div>

              <form className="auth-form auth-form--register" onSubmit={handleRegister}>
                <div className="auth-form-grid">
                  <label>
                    Nome da empresa
                    <input
                      value={registrationForm.company_name}
                      onChange={(event) =>
                        setRegistrationForm((current) => ({ ...current, company_name: event.target.value }))
                      }
                      placeholder="Introduza o nome da empresa"
                    />
                  </label>
                  <label>
                    NIF
                    <input
                      value={registrationForm.company_nif}
                      onChange={(event) =>
                        setRegistrationForm((current) => ({ ...current, company_nif: event.target.value }))
                      }
                      placeholder="Introduza o NIF"
                    />
                  </label>
                  <label>
                    E-mail
                    <input
                      value={registrationForm.company_email}
                      onChange={(event) =>
                        setRegistrationForm((current) => ({ ...current, company_email: event.target.value }))
                      }
                      placeholder="Introduza o e-mail da empresa"
                    />
                  </label>
                  <label>
                    Contacto telefónico
                    <input
                      value={registrationForm.company_phone}
                      onChange={(event) =>
                        setRegistrationForm((current) => ({ ...current, company_phone: event.target.value }))
                      }
                      placeholder="Introduza o contacto telefónico"
                    />
                  </label>
                  <label className="full-span">
                    Morada
                    <input
                      value={registrationForm.company_address}
                      onChange={(event) =>
                        setRegistrationForm((current) => ({ ...current, company_address: event.target.value }))
                      }
                      placeholder="Introduza a morada da empresa"
                    />
                  </label>
                  <label>
                    Nome do administrador
                    <input
                      value={registrationForm.full_name}
                      onChange={(event) =>
                        setRegistrationForm((current) => ({ ...current, full_name: event.target.value }))
                      }
                      placeholder="Introduza o nome completo"
                    />
                  </label>
                  <label>
                    E-mail do administrador
                    <input
                      value={registrationForm.admin_email}
                      onChange={(event) =>
                        setRegistrationForm((current) => ({ ...current, admin_email: event.target.value }))
                      }
                      placeholder="Introduza o e-mail do administrador"
                    />
                  </label>
                  <label>
                    Utilizador
                    <input
                      value={registrationForm.username}
                      onChange={(event) =>
                        setRegistrationForm((current) => ({ ...current, username: event.target.value }))
                      }
                      placeholder="Defina o utilizador"
                    />
                  </label>
                  <label>
                    Palavra-passe
                    <input
                      type="password"
                      value={registrationForm.password}
                      onChange={(event) =>
                        setRegistrationForm((current) => ({ ...current, password: event.target.value }))
                      }
                      placeholder="Defina a palavra-passe"
                    />
                  </label>
                  <label>
                    Confirmar palavra-passe
                    <input
                      type="password"
                      value={registrationForm.confirmPassword}
                      onChange={(event) =>
                        setRegistrationForm((current) => ({ ...current, confirmPassword: event.target.value }))
                      }
                      placeholder="Repita a palavra-passe"
                    />
                  </label>
                </div>

                <button type="submit">Concluir registo inicial</button>
              </form>
            </>
          ) : (
            <>
              <div className="section-heading compact">
                <h3>Início de sessão</h3>
                <p>Introduza as credenciais criadas para aceder ao sistema.</p>
              </div>

              <form className="auth-form" onSubmit={handleLogin}>
                <label>
                  Utilizador ou e-mail
                  <input
                    value={loginForm.username}
                    onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                    placeholder="Introduza o utilizador ou o e-mail"
                    disabled={setupRequired}
                  />
                </label>
                <label>
                  Palavra-passe
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                    placeholder="Introduza a palavra-passe"
                    disabled={setupRequired}
                  />
                </label>
                <button type="submit" disabled={setupRequired}>
                  Entrar no sistema
                </button>
              </form>

              {!setupRequired && (
                <>
                  <form className="auth-form auth-form--helper" onSubmit={handlePasswordResetRequest}>
                    <label>
                      Recuperar acesso por e-mail
                      <input
                        value={forgotPasswordForm.identifier}
                        onChange={(event) =>
                          setForgotPasswordForm((current) => ({ ...current, identifier: event.target.value }))
                        }
                        placeholder="Introduza o utilizador ou o e-mail"
                      />
                    </label>
                    <button type="submit" className="secondary-btn">
                      Enviar codigo de redefinicao
                    </button>
                  </form>

                  <form className="auth-form auth-form--helper" onSubmit={handlePasswordResetCompletion}>
                    <label>
                      Codigo de redefinicao
                      <input
                        value={forgotPasswordForm.resetToken}
                        onChange={(event) =>
                          setForgotPasswordForm((current) => ({ ...current, resetToken: event.target.value }))
                        }
                        placeholder="Introduza o codigo recebido"
                      />
                    </label>
                    <label>
                      Nova palavra-passe
                      <input
                        type="password"
                        value={forgotPasswordForm.newPassword}
                        onChange={(event) =>
                          setForgotPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
                        }
                        placeholder="Defina a nova palavra-passe"
                      />
                    </label>
                    <label>
                      Confirmar nova palavra-passe
                      <input
                        type="password"
                        value={forgotPasswordForm.confirmPassword}
                        onChange={(event) =>
                          setForgotPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))
                        }
                        placeholder="Repita a nova palavra-passe"
                      />
                    </label>
                    <button type="submit" className="secondary-btn">
                      Concluir redefinicao
                    </button>
                  </form>
                </>
              )}

              {setupRequired && (
                <div className="auth-note">
                  <small>Conclua primeiro o registo inicial da empresa para ativar o início de sessão.</small>
                </div>
              )}
            </>
          )}

          {feedback && <div className={`feedback feedback--${setupRequired && authMode === "register" ? "info" : "info"}`}>{feedback}</div>}
        </div>
      </div>
    </div>
  );
}
