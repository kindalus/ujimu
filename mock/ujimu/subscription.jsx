// Ujimu — página de subscrição (/subscription): planos, fluxo corporativo, pagamento e gestão da Empresa
const { useState: useSubState } = React;

const PRICE_INDIVIDUAL = 4500;
const PRICE_PER_SEAT = 3800;
const fmtKz = (n) => n.toLocaleString('pt') + ' Kz';
const parseEmails = (txt) => [...new Set(txt.split('\n').map((x) => x.trim().toLowerCase()).filter(Boolean))];
const seatAllowance = (seats) => Math.floor(seats * 1.1);

function ErrBar({ children }) {
  return (
    <div className="errbar" role="alert">
      <Icon name="info" size={16} />
      <span>{children}</span>
    </div>
  );
}

/* ---------- Passo 1: configuração da conta corporativa ---------- */
function CompanySetup({ user, onBack, onContinue }) {
  const [name, setName] = useSubState('');
  const [seats, setSeats] = useSubState(10);
  const [members, setMembers] = useSubState('');
  const [admins, setAdmins] = useSubState(user ? user.contact : '');
  const [error, setError] = useSubState(null);

  const memberList = parseEmails(members);
  const adminList = parseEmails(admins);
  const specified = new Set([...memberList, ...adminList]).size;
  const allowed = seatAllowance(seats || 0);
  const over = specified > allowed;

  function next() {
    if (!name.trim()) { setError('Indique o nome da empresa.'); return; }
    if (!seats || seats < 2) { setError('Uma conta corporativa precisa de pelo menos 2 utilizadores.'); return; }
    if (adminList.length === 0) { setError('Indique pelo menos um administrador da Empresa.'); return; }
    if (over) { setError('Especificou ' + specified + ' contas (membros + administradores) para ' + seats + ' lugares. O máximo permitido é ' + allowed + ' — número de lugares mais 10%.'); return; }
    setError(null);
    onContinue({ name: name.trim(), seats, members: memberList, admins: adminList });
  }

  return (
    <div className="subpage" data-screen-label="Subscrição — Configurar Empresa">
      <button className="btn btn--ghost btn--back" onClick={onBack}><Icon name="chevLeft" size={16} /> Planos</button>
      <h1 className="subpage-title">Conta corporativa</h1>
      <p className="subpage-sub">Passo 1 de 2 — dados da Empresa e utilizadores.</p>

      {error && <ErrBar>{error}</ErrBar>}

      <div className="adm-card">
        <div className="adm-formgrid">
          <label className="adm-field">
            <span className="adm-field-label">Nome da empresa</span>
            <input className="field" placeholder="ex: Transitários Atlântico, Lda." value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="adm-field">
            <span className="adm-field-label">Número de utilizadores</span>
            <input className="field" type="number" min="2" max="5000" value={seats} onChange={(e) => setSeats(parseInt(e.target.value, 10) || 0)} />
          </label>
        </div>
        <div className="seat-meter-row">
          <span className={'seat-meter' + (over ? ' seat-meter--over' : '')}>
            {specified} de {allowed} contas especificadas
          </span>
          <span className="adm-foot-note">Pode especificar até mais 10% do que os lugares subscritos ({seats || 0} + 10% = {allowed}), contando com os administradores.</span>
        </div>
      </div>

      <div className="adm-card">
        <h2 className="adm-card-title">Utilizadores da conta <span className="adm-stat">opcional</span></h2>
        <p className="adm-card-note">Um email por linha. Pode deixar em branco e especificar os utilizadores mais tarde, na gestão da Empresa.</p>
        <label className="adm-field">
          <span className="adm-field-label">Membros</span>
          <textarea className="field adm-prompt" rows={4} placeholder={'maria@empresa.co.ao\njoao@empresa.co.ao'} value={members} onChange={(e) => setMembers(e.target.value)}></textarea>
        </label>
        <label className="adm-field">
          <span className="adm-field-label">Administradores da Empresa</span>
          <textarea className="field adm-prompt" rows={2} value={admins} onChange={(e) => setAdmins(e.target.value)}></textarea>
        </label>
      </div>

      <div className="adm-row-actions">
        <button className="btn btn--ghost" onClick={onBack}>Cancelar</button>
        <button className="btn btn--primary" onClick={next}>Continuar para pagamento</button>
      </div>
    </div>
  );
}

/* ---------- Passo 2: pagamento ---------- */
function PaymentScreen({ order, onBack, onPaid }) {
  const [method, setMethod] = useSubState('multicaixa');
  const [paying, setPaying] = useSubState(false);
  const total = order.seats * PRICE_PER_SEAT;

  function pay() {
    if (paying) return;
    setPaying(true);
    setTimeout(onPaid, 1800);
  }

  return (
    <div className="subpage" data-screen-label="Subscrição — Pagamento">
      <button className="btn btn--ghost btn--back" onClick={onBack} disabled={paying}><Icon name="chevLeft" size={16} /> Dados da Empresa</button>
      <h1 className="subpage-title">Pagamento</h1>
      <p className="subpage-sub">Passo 2 de 2 — a subscrição fica activa assim que o pagamento for confirmado.</p>

      <div className="adm-card">
        <h2 className="adm-card-title">Resumo</h2>
        <div className="pay-row"><span>Empresa</span><strong>{order.name}</strong></div>
        <div className="pay-row"><span>Plano</span><strong>Empresa · mensal</strong></div>
        <div className="pay-row"><span>Utilizadores</span><strong>{order.seats} × {fmtKz(PRICE_PER_SEAT)}</strong></div>
        <div className="pay-row pay-row--total"><span>Total mensal</span><strong>{fmtKz(total)}</strong></div>
      </div>

      <div className="adm-card">
        <h2 className="adm-card-title">Método de pagamento</h2>
        <div className="pay-methods">
          <button className={'pay-method' + (method === 'multicaixa' ? ' pay-method--on' : '')} onClick={() => setMethod('multicaixa')}>
            <span className="pay-method-name">Multicaixa Express</span>
            <span className="pay-method-sub">Confirmação na app</span>
          </button>
          <button className={'pay-method' + (method === 'card' ? ' pay-method--on' : '')} onClick={() => setMethod('card')}>
            <span className="pay-method-name">Cartão bancário</span>
            <span className="pay-method-sub">Visa · Mastercard</span>
          </button>
          <button className={'pay-method' + (method === 'transfer' ? ' pay-method--on' : '')} onClick={() => setMethod('transfer')}>
            <span className="pay-method-name">Transferência</span>
            <span className="pay-method-sub">Referência bancária</span>
          </button>
        </div>
        {method === 'multicaixa' && (
          <label className="adm-field">
            <span className="adm-field-label">Telemóvel associado</span>
            <input className="field" placeholder="9XX XXX XXX" defaultValue="923 456 789" />
          </label>
        )}
        {method === 'card' && (
          <div className="adm-formgrid">
            <label className="adm-field">
              <span className="adm-field-label">Número do cartão</span>
              <input className="field mono-field" placeholder="0000 0000 0000 0000" />
            </label>
            <div className="adm-formgrid">
              <label className="adm-field">
                <span className="adm-field-label">Validade</span>
                <input className="field mono-field" placeholder="MM/AA" />
              </label>
              <label className="adm-field">
                <span className="adm-field-label">CVC</span>
                <input className="field mono-field" placeholder="123" />
              </label>
            </div>
          </div>
        )}
        {method === 'transfer' && (
          <p className="adm-foot-note">Será gerada uma referência bancária após confirmar. A subscrição activa quando o pagamento for reconciliado.</p>
        )}
      </div>

      <div className="adm-row-actions">
        <button className={'btn btn--primary' + (paying ? ' btn--off' : '')} onClick={pay}>
          {paying ? 'A processar pagamento…' : 'Pagar ' + fmtKz(total)}
        </button>
      </div>
    </div>
  );
}

/* ---------- Gestão da Empresa (administradores corporativos) ---------- */
function CompanyManage({ company, user, justPaid, onUpdate, onCancel, onBack }) {
  const [newEmail, setNewEmail] = useSubState('');
  const [newRole, setNewRole] = useSubState('member');
  const [error, setError] = useSubState(null);

  const allowed = seatAllowance(company.seats);

  function addAccount() {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('«' + email + '» não é um email válido.'); return; }
    if (company.accounts.some((a) => a.email === email)) { setError('A conta ' + email + ' já está especificada.'); return; }
    if (company.accounts.length + 1 > allowed) {
      setError('Limite atingido: a subscrição de ' + company.seats + ' utilizadores permite especificar no máximo ' + allowed + ' contas (lugares + 10%, contando com administradores). Aumente o número de utilizadores para adicionar mais.');
      return;
    }
    setError(null);
    onUpdate({ accounts: [...company.accounts, { email, role: newRole }] });
    setNewEmail('');
  }
  function removeAccount(email) {
    setError(null);
    onUpdate({ accounts: company.accounts.filter((a) => a.email !== email) });
  }
  function toggleRole(email) {
    setError(null);
    onUpdate({ accounts: company.accounts.map((a) => a.email === email ? { ...a, role: a.role === 'admin' ? 'member' : 'admin' } : a) });
  }

  return (
    <div className="subpage" data-screen-label="Subscrição — Gestão da Empresa">
      <button className="btn btn--ghost btn--back" onClick={onBack}><Icon name="chevLeft" size={16} /> Voltar à consulta</button>
      <h1 className="subpage-title">{company.name}</h1>
      <p className="subpage-sub">Conta corporativa · <span className="plan-current--on" style={{ fontSize: 13 }}><Icon name="check" size={13} /> Subscrição activa</span></p>

      {justPaid && (
        <div className="warnbar" style={{ borderColor: 'transparent' }}>
          <Icon name="check" size={16} />
          <span>Pagamento confirmado. A subscrição da <strong>{company.name}</strong> está activa — os utilizadores especificados já têm acesso sem publicidade.</span>
        </div>
      )}

      <div className="adm-statrow">
        <div className="adm-card adm-statcard">
          <span className="adm-stat-big">{company.seats}</span>
          <span className="adm-stat-label">Utilizadores subscritos</span>
        </div>
        <div className="adm-card adm-statcard">
          <span className="adm-stat-big">{company.accounts.length}</span>
          <span className="adm-stat-label">Contas especificadas</span>
        </div>
        <div className="adm-card adm-statcard">
          <span className="adm-stat-big">{allowed}</span>
          <span className="adm-stat-label">Máximo permitido (+10%)</span>
        </div>
      </div>

      {error && <ErrBar>{error}</ErrBar>}

      <div className="adm-card">
        <h2 className="adm-card-title">Quota e utilização da empresa</h2>
        <div className="pay-row"><span>Limite semanal partilhado</span><strong>{(company.seats * 5000).toLocaleString('pt')} pedidos ({company.seats} × 5.000)</strong></div>
        <div className="usage-bar" role="img" aria-label="Utilização semanal"><div className="usage-bar-fill" style={{ width: (173 / 5000 * 100).toFixed(1) + '%' }}></div></div>
        <div className="pay-row"><span>Usados esta semana</span><strong>{(company.seats * 173).toLocaleString('pt')} pedidos · {(173 / 5000 * 100).toFixed(1).replace('.', ',')}%</strong></div>
        <div className="pay-row"><span>Limite diário</span><strong>Sem limite</strong></div>
        <p className="adm-foot-note">Visível apenas para administradores da Empresa. A semana renova à segunda-feira, 00:00 (hora de Luanda).</p>
      </div>

      <div className="adm-card">
        <div className="adm-card-toprow">
          <div>
            <h2 className="adm-card-title">Utilizadores da Empresa</h2>
            <p className="adm-card-note">Um administrador da Empresa é automaticamente membro: conta para o limite de lugares e pode consultar como qualquer outro utilizador. Além disso, gere contas e a subscrição.</p>
          </div>
        </div>
        <div className="member-add">
          <input className="field" placeholder="email@empresa.co.ao" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAccount()} />
          <select className="field member-add-role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            <option value="member">Membro</option>
            <option value="admin">Administrador</option>
          </select>
          <button className="btn btn--primary" onClick={addAccount}>Adicionar</button>
        </div>
        <div className="adm-srcs">
          {company.accounts.map((a) => (
            <div className="adm-src" key={a.email}>
              <div className="adm-src-row">
                <span className="avatar avatar--sm">{a.email.charAt(0).toUpperCase()}</span>
                <div className="adm-src-meta">
                  <span className="adm-src-name">{a.email}{user && a.email === user.contact.toLowerCase() ? ' (você)' : ''}</span>
                  <span className="adm-src-sub">{a.role === 'admin' ? 'Administrador da Empresa · membro' : 'Membro'}</span>
                </div>
                {a.role === 'admin' && <span className="badge badge--mid"><span className="badge-dot"></span>Admin</span>}
                <button className="btn btn--ghost btn--xs" onClick={() => toggleRole(a.email)}>{a.role === 'admin' ? 'Tornar membro' : 'Tornar admin'}</button>
                <button className="iconbtn iconbtn--danger" title="Remover conta" onClick={() => removeAccount(a.email)}><Icon name="trash" size={15} /></button>
              </div>
            </div>
          ))}
          {company.accounts.length === 0 && <p className="adm-sub">Nenhuma conta especificada — qualquer pessoa da empresa pode ser adicionada até {allowed} contas.</p>}
        </div>
      </div>

      <div className="sub-manage">
        <h2 className="sub-manage-title">Subscrição</h2>
        <div className="sub-manage-row">
          <span>Plano Empresa · {company.seats} utilizadores · <strong>{fmtKz(company.seats * PRICE_PER_SEAT)}/mês</strong></span>
        </div>
        <div className="sub-manage-row">
          <span>Renovação automática a <strong>11 de Julho de 2026</strong></span>
          <button className="btn btn--ghost btn--xs" onClick={onCancel}>Cancelar subscrição</button>
        </div>
        <div className="sub-manage-row">
          <span>Sem limite diário · limite semanal partilhado: <strong>5.000 pedidos × {company.seats}</strong></span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Página principal /subscription ---------- */
function SubscriptionPage({ user, subscriber, company, expiringSoon, onSubscribe, onActivateCompany, onUpdateCompany, onCancelCompany, onCancel, onToggleExpiring, onBack, onLogin }) {
  const [step, setStep] = useSubState('plans'); // plans | setup | payment
  const [order, setOrder] = useSubState(null);
  const [justPaid, setJustPaid] = useSubState(false);

  if (company) {
    return <CompanyManage company={company} user={user} justPaid={justPaid} onUpdate={onUpdateCompany} onCancel={() => { setJustPaid(false); setStep('plans'); onCancelCompany(); }} onBack={onBack} />;
  }
  if (step === 'setup') {
    return <CompanySetup user={user} onBack={() => setStep('plans')} onContinue={(o) => { setOrder(o); setStep('payment'); }} />;
  }
  if (step === 'payment' && order) {
    return <PaymentScreen order={order} onBack={() => setStep('setup')} onPaid={() => { setJustPaid(true); setStep('plans'); onActivateCompany(order); }} />;
  }

  return (
    <div className="subpage" data-screen-label="Subscrição — Planos">
      <button className="btn btn--ghost btn--back" onClick={onBack}><Icon name="chevLeft" size={16} /> Voltar à consulta</button>
      <h1 className="subpage-title">Subscrição</h1>
      <p className="subpage-sub">Consulte sem limite diário e sem publicidade.</p>

      {subscriber && expiringSoon && (
        <div className="warnbar">
          <Icon name="info" size={16} />
          <span>A sua subscrição termina em <strong>5 dias</strong>. Renove para manter o acesso sem publicidade.</span>
          <button className="btn btn--primary btn--xs">Renovar agora</button>
        </div>
      )}

      <div className="plans plans--three">
        <div className="plan">
          <span className="plan-name">Gratuito</span>
          <span className="plan-price">0 Kz</span>
          <ul className="plan-list">
            <li>5 pedidos/dia · 20/semana (anónimo)</li>
            <li>20 pedidos/dia · 100/semana (com sessão)</li>
            <li>Publicidade no fluxo da conversa</li>
            <li>Histórico por especialidade (com sessão)</li>
          </ul>
          {!subscriber && <span className="plan-current">Plano actual</span>}
        </div>
        <div className={'plan plan--featured' + (subscriber ? ' plan--active' : '')}>
          <span className="plan-name">Subscritor</span>
          <span className="plan-price">{fmtKz(PRICE_INDIVIDUAL)}<span className="plan-per">/mês</span></span>
          <ul className="plan-list">
            <li>Sem limite diário</li>
            <li>5.000 pedidos/semana</li>
            <li>Sem publicidade</li>
            <li>Tudo o que tem o plano gratuito</li>
          </ul>
          {subscriber
            ? <span className="plan-current plan-current--on"><Icon name="check" size={14} /> Subscrição activa</span>
            : (user
                ? <button className="btn btn--primary btn--block" onClick={onSubscribe}>Subscrever</button>
                : <button className="btn btn--primary btn--block" onClick={onLogin}>Entrar para subscrever</button>)}
        </div>
        <div className="plan">
          <span className="plan-name">Empresa</span>
          <span className="plan-price">{fmtKz(PRICE_PER_SEAT)}<span className="plan-per">/utilizador/mês</span></span>
          <ul className="plan-list">
            <li>Tudo o que tem o plano Subscritor</li>
            <li>Lugares para toda a equipa</li>
            <li>Gestão centralizada de contas e administradores</li>
            <li>Acesso a especialistas reservados à empresa</li>
          </ul>
          {user
            ? <button className="btn btn--primary btn--block" onClick={() => setStep('setup')}>Configurar empresa</button>
            : <button className="btn btn--primary btn--block" onClick={onLogin}>Entrar para configurar</button>}
        </div>
      </div>

      {subscriber && (
        <div className="sub-manage">
          <h2 className="sub-manage-title">Gerir subscrição</h2>
          <div className="sub-manage-row">
            <span>Renovação automática a <strong>{expiringSoon ? '15 de Junho de 2026' : '10 de Julho de 2026'}</strong></span>
            <button className="btn btn--ghost btn--xs" onClick={onCancel}>Cancelar subscrição</button>
          </div>
          <div className="sub-manage-row">
            <span>Limite semanal: <strong>5.000 pedidos</strong> · usados esta semana: <strong>37</strong></span>
          </div>
          <div className="sub-manage-row sub-manage-row--demo">
            <span>Demonstração: simular subscrição prestes a expirar</span>
            <button className="btn btn--ghost btn--xs" onClick={onToggleExpiring}>{expiringSoon ? 'Repor' : 'Simular'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { SubscriptionPage });
