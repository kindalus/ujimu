// Ujimu — página de perfil do utilizador registado
const { useState: useProfState } = React;

function ProfilePage({ user, subscriber, company, memberships, activeCompanyId, onBack, onUpdateUser, onGoSubscription, onLogin, onLogout }) {
  const [name, setName] = useProfState(user ? (user.name || '') : '');
  const [phone, setPhone] = useProfState(user ? (user.phone || '') : '');
  const [saved, setSaved] = useProfState(false);
  const [confirmDel, setConfirmDel] = useProfState(false);

  if (!user) {
    return (
      <div className="subpage adm-gate" data-screen-label="Perfil — sem sessão">
        <span className="adm-gate-icon"><Icon name="user" size={26} /></span>
        <h1 className="subpage-title">O meu perfil</h1>
        <p className="subpage-sub" style={{ marginTop: 0 }}>Inicie sessão para gerir o seu perfil.</p>
        <div className="adm-row-actions" style={{ justifyContent: 'center' }}>
          <button className="btn btn--ghost" onClick={onBack}>Voltar à consulta</button>
          <button className="btn btn--primary" onClick={onLogin}>Entrar por OTP</button>
        </div>
      </div>
    );
  }

  const isEmail = user.contact.includes('@');
  const companyRole = company && company.accounts.find((a) => a.email === user.contact.toLowerCase());
  const ms = memberships || [];
  const activeM = ms.find((m) => m.id === activeCompanyId);
  const planLabel = company
    ? 'Empresa — ' + company.name + (companyRole && companyRole.role === 'admin' ? ' (administrador)' : ' (membro)')
    : ms.length > 0 ? 'Empresa — ' + (activeM ? activeM.name : 'sem empresa activa')
    : subscriber ? 'Subscritor individual' : 'Gratuito';

  function save() {
    onUpdateUser({ name: name.trim(), phone: phone.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="subpage" data-screen-label="Perfil">
      <button className="btn btn--ghost btn--back" onClick={onBack}><Icon name="chevLeft" size={16} /> Voltar à consulta</button>
      <div className="prof-head">
        <span className="avatar prof-avatar">{user.initials}</span>
        <div>
          <h1 className="subpage-title" style={{ marginTop: 0 }}>{user.name || 'O meu perfil'}</h1>
          <p className="subpage-sub" style={{ marginTop: -4 }}>{user.contact}</p>
        </div>
      </div>

      <div className="adm-card">
        <h2 className="adm-card-title">Dados pessoais</h2>
        <div className="adm-formgrid">
          <label className="adm-field">
            <span className="adm-field-label">Nome</span>
            <input className="field" placeholder="O seu nome" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="adm-field">
            <span className="adm-field-label">{isEmail ? 'Email' : 'Telemóvel'}</span>
            <input className="field" value={user.contact} readOnly />
          </label>
        </div>
        <label className="adm-field">
          <span className="adm-field-label">{isEmail ? 'Telemóvel · opcional' : 'Email · opcional'}</span>
          <input className="field" type={isEmail ? 'tel' : 'email'} placeholder={isEmail ? '9XX XXX XXX' : 'nome@exemplo.co.ao'} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <div className="adm-row-actions">
          {saved && <span className="plan-current--on" style={{ fontSize: 12.5 }}><Icon name="check" size={13} /> Guardado</span>}
          <button className="btn btn--primary btn--xs" onClick={save}>Guardar alterações</button>
        </div>
        <p className="adm-foot-note">Para alterar o {isEmail ? 'email' : 'número'} de entrada será pedido um código OTP enviado para o novo contacto. O {isEmail ? 'telemóvel' : 'email'} é opcional e pode ser usado como contacto alternativo para OTP.</p>
      </div>

      <div className="adm-card">
        <div className="adm-card-toprow">
          <div>
            <h2 className="adm-card-title">Subscrição</h2>
            <p className="adm-card-note">Plano actual: <strong>{planLabel}</strong></p>
          </div>
          <button className="btn btn--ghost btn--xs" onClick={onGoSubscription}>Gerir</button>
        </div>
        {ms.length > 0 && (
          <div className="adm-srcs">
            {ms.map((m) => (
              <div className="adm-src" key={m.id}>
                <div className="adm-src-row">
                  <div className="adm-src-meta">
                    <span className="adm-src-name">{m.name}</span>
                    <span className="adm-src-sub">{m.role === 'admin' ? 'Administrador da Empresa · membro' : 'Membro'}</span>
                  </div>
                  {m.id === activeCompanyId
                    ? <span className="badge badge--ok"><span className="badge-dot"></span>Activa</span>
                    : <span className="badge badge--mute"><span className="badge-dot"></span>Inactiva</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {ms.length > 1 && <p className="adm-foot-note">Pertence a {ms.length} empresas — só uma pode estar activa de cada vez. Escolha a empresa activa no menu lateral.</p>}
      </div>

      <div className="adm-card">
        <h2 className="adm-card-title">Segurança</h2>
        <div className="adm-srcs">
          <div className="adm-src">
            <div className="adm-src-row">
              <div className="adm-src-meta">
                <span className="adm-src-name">Entrada por código OTP</span>
                <span className="adm-src-sub">Cada início de sessão exige um código enviado por {isEmail ? 'email' : 'SMS'}. Não há palavra-passe a memorizar.</span>
              </div>
              <span className="badge badge--ok"><span className="badge-dot"></span>Activo</span>
            </div>
          </div>
          <div className="adm-src">
            <div className="adm-src-row">
              <div className="adm-src-meta">
                <span className="adm-src-name">Sessões activas</span>
                <span className="adm-src-sub">Este dispositivo (Luanda, agora) · Chrome em Windows (há 2 dias)</span>
              </div>
              <button className="btn btn--ghost btn--xs" onClick={onLogout}>Terminar todas</button>
            </div>
          </div>
        </div>
      </div>

      <div className="adm-card adm-dangerzone">
        <div className="adm-card-toprow">
          <div>
            <h2 className="adm-card-title">Apagar conta</h2>
            <p className="adm-card-note">Apaga a conta e todo o histórico de conversas, permanentemente.</p>
          </div>
          <button className="btn btn--danger btn--xs" onClick={() => setConfirmDel(true)}>Apagar</button>
        </div>
      </div>

      {confirmDel && (
        <div className="modal-scrim" onClick={() => setConfirmDel(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body" style={{ paddingTop: 18, paddingBottom: 6 }}>
              <h2 className="modal-title">Apagar a sua conta?</h2>
              <p className="modal-sub">Todo o histórico de conversas será apagado permanentemente. {company ? 'A conta deixa de contar para os lugares da ' + company.name + '.' : ''}</p>
              <div className="adm-row-actions">
                <button className="btn btn--ghost" onClick={() => setConfirmDel(false)}>Cancelar</button>
                <button className="btn btn--danger" onClick={() => { setConfirmDel(false); onLogout(); }}>Apagar permanentemente</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ProfilePage });
