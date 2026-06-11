// Ujimu — shell: ícones, barra superior, drawer, barra de prompt, modal OTP
const { useState, useRef, useEffect } = React;

/* ---------- Ícones (traço simples, 20px) ---------- */
function Icon({ name, size = 18 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    menu: <g><line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="17" x2="14" y2="17"></line></g>,
    send: <g><path d="M5 12 L20 5 L14 20 L11.5 13.5 L5 12 Z"></path></g>,
    plus: <g><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></g>,
    chevDown: <g><polyline points="6 9 12 15 18 9"></polyline></g>,
    chevUp: <g><polyline points="6 15 12 9 18 15"></polyline></g>,
    copy: <g><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15 V6 a2 2 0 0 1 2 -2 h9"></path></g>,
    chevLeft: <g><polyline points="14 6 8 12 14 18"></polyline></g>,
    close: <g><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></g>,
    doc: <g><path d="M7 3 H14 L19 8 V21 H7 Z"></path><polyline points="14 3 14 8 19 8"></polyline></g>,
    trash: <g><path d="M5 7 H19"></path><path d="M9 7 V5 H15 V7"></path><path d="M7 7 L8 20 H16 L17 7"></path></g>,
    edit: <g><path d="M14 5 L19 10 L9 20 H4 V15 Z"></path></g>,
    user: <g><circle cx="12" cy="8.5" r="3.5"></circle><path d="M4.5 20 C5.5 16 8.5 14.5 12 14.5 C15.5 14.5 18.5 16 19.5 20"></path></g>,
    spark: <g><path d="M12 4 L13.8 10.2 L20 12 L13.8 13.8 L12 20 L10.2 13.8 L4 12 L10.2 10.2 Z"></path></g>,
    mail: <g><rect x="4" y="6" width="16" height="13" rx="2"></rect><polyline points="4 8 12 14 20 8"></polyline></g>,
    phone: <g><rect x="8" y="3" width="8" height="18" rx="2"></rect><line x1="11" y1="18" x2="13" y2="18"></line></g>,
    star: <g><path d="M12 4 L14.2 9.4 L20 9.8 L15.6 13.6 L17 19.3 L12 16.2 L7 19.3 L8.4 13.6 L4 9.8 L9.8 9.4 Z"></path></g>,
    check: <g><polyline points="5 13 10 18 19 7"></polyline></g>,
    refresh: <g><path d="M19 12 a7 7 0 1 1 -2 -4.9"></path><polyline points="19.5 3.5 19.5 8 15 8"></polyline></g>,
    upload: <g><line x1="12" y1="15" x2="12" y2="4.5"></line><polyline points="7.5 8.5 12 4 16.5 8.5"></polyline><line x1="5" y1="19.5" x2="19" y2="19.5"></line></g>,
    pause: <g><line x1="9.5" y1="5" x2="9.5" y2="19"></line><line x1="14.5" y1="5" x2="14.5" y2="19"></line></g>,
    info: <g><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16"></line><circle cx="12" cy="8" r="0.5" fill="currentColor"></circle></g>,
  };
  return <svg {...p} aria-hidden="true">{paths[name] || null}</svg>;
}

/* ---------- Wordmark ---------- */
function Wordmark() {
  return (
    <span className="wordmark">Ujimu<span className="wordmark-dot"></span></span>
  );
}

/* ---------- Barra superior ---------- */
function TopBar({ onMenu, user, quotaUsed, quotaLimit, onLogin, isSubscriber }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="iconbtn" onClick={onMenu} aria-label="Abrir menu"><Icon name="menu" size={20} /></button>
        <Wordmark />
      </div>
      <div className="topbar-right">
        {!isSubscriber && (
          <span className={'quota-pill' + (quotaUsed >= quotaLimit ? ' quota-pill--full' : '')} title="Pedidos usados hoje">
            {quotaUsed}/{quotaLimit} hoje
          </span>
        )}
        {isSubscriber && <span className="quota-pill quota-pill--sub"><Icon name="star" size={13} /> Subscritor</span>}
        {user
          ? <span className="avatar" title={user.contact}>{user.initials}</span>
          : <button className="btn btn--ghost" onClick={onLogin}>Entrar</button>}
      </div>
    </header>
  );
}

/* ---------- Drawer ---------- */
function Drawer({ open, onClose, user, history, specialties, onNew, onResume, onDelete, onLogin, onLogout, onGoSubscription, onGoProfile, onGoAdmin, onGoCompany, memberships, activeCompanyId, onSelectCompany, activeConvId }) {
  const activeMembership = (memberships || []).find((m) => m.id === activeCompanyId);
  const isCompanyAdmin = !!(activeMembership && activeMembership.role === 'admin');
  const bySpec = {};
  history.forEach((h) => { (bySpec[h.specialty] = bySpec[h.specialty] || []).push(h); });
  return (
    <React.Fragment>
      <div className={'scrim' + (open ? ' scrim--on' : '')} onClick={onClose}></div>
      <aside className={'drawer' + (open ? ' drawer--open' : '')} aria-hidden={!open}>
        <div className="drawer-head">
          <Wordmark />
          <button className="iconbtn" onClick={onClose} aria-label="Fechar menu"><Icon name="close" size={18} /></button>
        </div>
        <button className="btn btn--new" onClick={onNew}><Icon name="plus" size={16} /> Nova consulta</button>

        <div className="drawer-scroll">
          {!user && (
            <div className="drawer-empty">
              <p>O histórico de conversas fica disponível depois de iniciar sessão.</p>
              <button className="btn btn--primary" onClick={onLogin}>Entrar por OTP</button>
            </div>
          )}
          {user && Object.keys(bySpec).length === 0 && (
            <div className="drawer-empty"><p>Ainda não tem conversas guardadas.</p></div>
          )}
          {user && specialties.map((s) => bySpec[s.id] ? (
            <div className="hist-group" key={s.id}>
              <div className="hist-group-label">{s.name}</div>
              {bySpec[s.id].map((h) => (
                <div className={'hist-item' + (h.id === activeConvId ? ' hist-item--active' : '')} key={h.id}>
                  <button className="hist-item-main" onClick={() => onResume(h)}>
                    <span className="hist-item-title">{h.title}</span>
                    <span className="hist-item-when">{h.when}</span>
                  </button>
                  <button className="iconbtn iconbtn--danger" title="Apagar permanentemente" onClick={() => onDelete(h.id)}><Icon name="trash" size={15} /></button>
                </div>
              ))}
            </div>
          ) : null)}
        </div>

        {user && memberships && memberships.length > 0 && (
          <div className="drawer-company">
            <span className="drawer-company-label">Empresa activa</span>
            <select className="field drawer-company-sel" value={activeCompanyId} onChange={(e) => onSelectCompany(e.target.value)}>
              {memberships.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              <option value="">Sem empresa</option>
            </select>
            <span className="drawer-company-note">{activeCompanyId ? 'Especialidades públicas + as reservadas a esta empresa.' : 'Apenas especialidades públicas.'}</span>
            {isCompanyAdmin && (
              <button className="btn btn--ghost btn--xs" onClick={onGoCompany}><Icon name="doc" size={13} /> Gerir especialistas da empresa</button>
            )}
          </div>
        )}

        <div className="drawer-foot">
          {user && <button className="drawer-foot-link" onClick={onGoProfile}><Icon name="user" size={16} /> O meu perfil</button>}
          <button className="drawer-foot-link" onClick={onGoSubscription}><Icon name="star" size={16} /> Subscrição</button>
          <button className="drawer-foot-link" onClick={onGoAdmin}><Icon name="spark" size={16} /> Administração <span className="drawer-foot-tag">/admin</span></button>
          {user ? (
            <div className="drawer-user">
              <span className="avatar avatar--sm">{user.initials}</span>
              <div className="drawer-user-meta">
                <span className="drawer-user-contact">{user.contact}</span>
                <button className="drawer-user-out" onClick={onLogout}>Terminar sessão</button>
              </div>
            </div>
          ) : (
            <button className="drawer-foot-link" onClick={onLogin}><Icon name="user" size={16} /> Iniciar sessão</button>
          )}
        </div>
      </aside>
    </React.Fragment>
  );
}

/* ---------- Selector de especialidade (dentro do prompt) ---------- */
function SpecialtySelector({ specialties, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const sel = specialties.find((s) => s.id === value);
  return (
    <div className="spec-sel" ref={ref}>
      <button className={'spec-chip' + (sel ? ' spec-chip--set' : '')} onClick={() => !disabled && setOpen(!open)} disabled={disabled}>
        {sel ? <span className="spec-chip-letter">{sel.letter}</span> : <Icon name="spark" size={15} />}
        <span>{sel ? sel.name : 'Escolher especialidade'}</span>
        <Icon name="chevDown" size={14} />
      </button>
      {open && (
        <div className="spec-pop" role="listbox">
          <div className="spec-pop-label">Especialidades</div>
          {specialties.map((s) => (
            <button key={s.id} className={'spec-opt' + (s.id === value ? ' spec-opt--on' : '')} role="option" aria-selected={s.id === value}
              onClick={() => { onChange(s.id); setOpen(false); }}>
              <span className="spec-chip-letter">{s.letter}</span>
              <span className="spec-opt-text">
                <span className="spec-opt-name">{s.name}</span>
                <span className="spec-opt-short">{s.short}</span>
              </span>
              {s.id === value && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Barra de prompt (estilo Gemini) ---------- */
function PromptBar({ specialties, specialty, onSpecialty, onSend, disabled, disabledReason, streaming, queueCount }) {
  const [text, setText] = useState('');
  const taRef = useRef(null);
  const queueFull = streaming && (queueCount || 0) >= 3;
  const canSend = !!specialty && text.trim().length > 0 && !disabled && !queueFull;
  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
    if (taRef.current) taRef.current.style.height = 'auto';
  }
  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }
  function onInput(e) {
    setText(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }
  return (
    <div className="promptwrap">
      {disabled && disabledReason}
      <div className={'prompt' + (disabled ? ' prompt--off' : '')}>
        <div className="prompt-toprow">
          <SpecialtySelector specialties={specialties} value={specialty} onChange={onSpecialty} disabled={disabled} />
        </div>
        <div className="prompt-row">
          <textarea
            ref={taRef}
            className="prompt-ta"
            rows={1}
            placeholder={!specialty ? 'Escolha primeiro uma especialidade' : queueFull ? 'Fila cheia — aguarde a resposta em curso' : streaming ? 'Pergunte já — entra na fila (máx. 3)' : 'Faça a sua pergunta…'}
            value={text}
            disabled={disabled}
            onChange={onInput}
            onKeyDown={onKey}
          ></textarea>
          <button className={'sendbtn' + (canSend ? ' sendbtn--on' : '')} onClick={submit} disabled={!canSend} aria-label="Enviar pergunta">
            <Icon name="send" size={18} />
          </button>
        </div>
      </div>
      <p className="prompt-legal">As respostas são geradas por IA com base nas fontes oficiais de cada especialidade e podem conter imprecisões. Não dispensam aconselhamento profissional.</p>
    </div>
  );
}

/* ---------- Modal de início de sessão por OTP ---------- */
function LoginModal({ open, onClose, onSuccess }) {
  const [mode, setMode] = useState('email'); // email | phone
  const [step, setStep] = useState('contact'); // contact | code
  const [contact, setContact] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const codeRefs = useRef([]);

  useEffect(() => {
    if (open) { setStep('contact'); setContact(''); setCode(['', '', '', '', '', '']); }
  }, [open]);

  if (!open) return null;

  const contactValid = mode === 'email'
    ? /.+@.+\..+/.test(contact)
    : contact.replace(/\D/g, '').length >= 9;

  function sendCode() { if (contactValid) setStep('code'); }

  function onCodeChange(i, v) {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = code.slice();
    next[i] = d;
    setCode(next);
    if (d && i < 5 && codeRefs.current[i + 1]) codeRefs.current[i + 1].focus();
    if (next.every((x) => x !== '')) {
      setTimeout(() => onSuccess(mode, contact), 350);
    }
  }
  function onCodeKey(i, e) {
    if (e.key === 'Backspace' && !code[i] && i > 0 && codeRefs.current[i - 1]) codeRefs.current[i - 1].focus();
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Iniciar sessão" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {step === 'code'
            ? <button className="iconbtn" onClick={() => setStep('contact')} aria-label="Voltar"><Icon name="chevLeft" size={18} /></button>
            : <span></span>}
          <button className="iconbtn" onClick={onClose} aria-label="Fechar"><Icon name="close" size={18} /></button>
        </div>

        {step === 'contact' && (
          <div className="modal-body">
            <h2 className="modal-title">Entrar na Ujimu</h2>
            <p className="modal-sub">Sem palavra-passe — enviamos-lhe um código de utilização única.</p>
            <div className="seg">
              <button className={'seg-opt' + (mode === 'email' ? ' seg-opt--on' : '')} onClick={() => setMode('email')}><Icon name="mail" size={15} /> Email</button>
              <button className={'seg-opt' + (mode === 'phone' ? ' seg-opt--on' : '')} onClick={() => setMode('phone')}><Icon name="phone" size={15} /> Telemóvel</button>
            </div>
            <input
              className="field"
              type={mode === 'email' ? 'email' : 'tel'}
              placeholder={mode === 'email' ? 'o.seu@email.com' : '+244 9XX XXX XXX'}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendCode()}
              autoFocus
            />
            <button className={'btn btn--primary btn--block' + (contactValid ? '' : ' btn--off')} onClick={sendCode} disabled={!contactValid}>
              Enviar código
            </button>
          </div>
        )}

        {step === 'code' && (
          <div className="modal-body">
            <h2 className="modal-title">Introduza o código</h2>
            <p className="modal-sub">Enviámos um código de 6 dígitos para <strong>{contact}</strong>.</p>
            <div className="otp-row">
              {code.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { codeRefs.current[i] = el; }}
                  className="otp-cell"
                  inputMode="numeric"
                  maxLength={1}
                  value={d}
                  onChange={(e) => onCodeChange(i, e.target.value)}
                  onKeyDown={(e) => onCodeKey(i, e)}
                  autoFocus={i === 0}
                />
              ))}
            </div>
            <p className="modal-hint">Qualquer combinação serve neste protótipo.</p>
            <button className="btn-link">Reenviar código</button>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { Icon, Wordmark, TopBar, Drawer, SpecialtySelector, PromptBar, LoginModal });
