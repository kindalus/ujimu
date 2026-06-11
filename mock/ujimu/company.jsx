// Ujimu — área do administrador corporativo (/empresa/especialistas)
// Gestão limitada dos especialistas reservados à empresa: prompt, fontes e estados.
// A conversão e a ingestão das fontes continuam a cargo da equipa Ujimu.
const { useState: useCoState } = React;

/* ---------- Gate ---------- */
function CompanyGate({ user, onLogin, onExit, reason }) {
  return (
    <div className="adm-page adm-gate" data-screen-label="Empresa — Acesso negado">
      <span className="adm-gate-icon"><Icon name="user" size={26} /></span>
      <h1 className="adm-title">Gestão de especialistas da empresa</h1>
      <p className="adm-sub">{reason}</p>
      <div className="adm-row-actions" style={{ justifyContent: 'center' }}>
        <button className="btn btn--ghost" onClick={onExit}>Voltar à consulta</button>
        {!user && <button className="btn btn--primary" onClick={onLogin}>Entrar por OTP</button>}
      </div>
    </div>
  );
}

/* ---------- Lista de especialistas da empresa ---------- */
function CompanySpecList({ company, specs, onOpen, onExit }) {
  return (
    <div className="adm-page" data-screen-label="Empresa — Especialistas">
      <button className="btn btn--ghost btn--back" onClick={onExit}><Icon name="chevLeft" size={16} /> Voltar à consulta</button>
      <div className="adm-pagehead">
        <div>
          <h1 className="adm-title">Especialistas da empresa</h1>
          <p className="adm-sub">Reservados a <strong>{company.name}</strong>. Pode ajustar o prompt e adicionar fontes; a ingestão é executada pela equipa Ujimu.</p>
        </div>
      </div>

      <div className="adm-list">
        {specs.map((s) => {
          const pending = s.sources.filter((x) => x.status !== 'ingerido').length;
          return (
            <div className="adm-card adm-spec" key={s.id}>
              <button className="adm-spec-main" onClick={() => onOpen(s.id)}>
                <span className="spec-chip-letter">{s.letter}</span>
                <span className="adm-spec-meta">
                  <span className="adm-spec-name">{s.name}</span>
                  <span className="adm-spec-desc">{s.description}</span>
                </span>
                <span className="adm-spec-stats">
                  <span className="adm-stat">{s.sources.length} fontes</span>
                  {pending > 0
                    ? <span className="badge badge--warn"><span className="badge-dot"></span>{pending} por ingerir</span>
                    : <span className="badge badge--ok"><span className="badge-dot"></span>Tudo ingerido</span>}
                </span>
              </button>
            </div>
          );
        })}
        {specs.length === 0 && (
          <div className="adm-card">
            <p className="adm-sub">Ainda não há especialistas reservados à sua empresa. Contacte a equipa Ujimu para criar um.</p>
          </div>
        )}
      </div>
      <p className="adm-foot-note">Para criar ou remover especialistas, alterar metadados ou comportamento, contacte a equipa Ujimu.</p>
    </div>
  );
}

/* ---------- Ficha de um especialista (gestão limitada) ---------- */
function CompanySpecDetail({ spec, company, onBack, onUpdate }) {
  const fileRef = React.useRef(null);
  const [promptSaved, setPromptSaved] = useCoState(false);

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const n = { id: spec.id + '-co-' + Date.now(), name: file.name, status: 'pendente', docs: 0, updated: 'agora', addedBy: 'empresa' };
    onUpdate(spec.id, { sources: [...spec.sources, n] });
  }

  function onPrompt(v) {
    onUpdate(spec.id, { prompt: v });
    setPromptSaved(true);
  }

  const pendingCount = spec.sources.filter((x) => x.status !== 'ingerido').length;

  return (
    <div className="adm-page" data-screen-label="Empresa — Ficha de especialista">
      <button className="btn btn--ghost btn--back" onClick={onBack}><Icon name="chevLeft" size={16} /> Especialistas da empresa</button>
      <div className="adm-pagehead">
        <div className="adm-detail-head">
          <span className="spec-chip-letter spec-chip-letter--lg">{spec.letter}</span>
          <div>
            <h1 className="adm-title">{spec.name}</h1>
            <p className="adm-sub">Reservado a {company.name} · gestão limitada</p>
          </div>
        </div>
      </div>

      <div className="adm-card">
        <h2 className="adm-card-title">Prompt do especialista</h2>
        <p className="adm-card-note">Define o comportamento das respostas. As alterações aplicam-se de imediato às novas consultas.</p>
        <label className="adm-field">
          <textarea className="field adm-prompt" rows={5} value={spec.prompt} onChange={(e) => onPrompt(e.target.value)}></textarea>
        </label>
        {promptSaved && <p className="adm-foot-note"><Icon name="check" size={11} /> Alterações guardadas automaticamente.</p>}
      </div>

      <div className="adm-card">
        <div className="adm-card-toprow">
          <h2 className="adm-card-title">Fontes</h2>
          <button className="btn btn--primary btn--xs" onClick={() => fileRef.current.click()}><Icon name="upload" size={13} /> Adicionar fonte</button>
        </div>
        <input type="file" ref={fileRef} style={{ display: 'none' }} accept=".pdf,.docx,.xlsx,.html,.txt" onChange={onFile} />
        {pendingCount > 0 && (
          <p className="adm-ingest-note"><Icon name="info" size={14} /> {pendingCount === 1 ? '1 fonte aguarda' : pendingCount + ' fontes aguardam'} ingestão pela equipa Ujimu.</p>
        )}
        <div className="adm-srcs">
          {spec.sources.map((src) => (
            <div className={'adm-src' + (src.error ? ' adm-src--err' : '')} key={src.id}>
              <div className="adm-src-row">
                <Icon name="doc" size={16} />
                <div className="adm-src-meta">
                  <span className="adm-src-name">{src.name}</span>
                  <span className="adm-src-sub">
                    {src.docs > 0 ? src.docs + ' fragmentos na wiki · ' : ''}
                    {src.addedBy === 'empresa' ? 'adicionada pela empresa · ' : ''}
                    actualizada {src.updated}
                  </span>
                </div>
                <StatusBadge status={src.status} />
              </div>
              {src.error && <p className="adm-src-error">{src.error}</p>}
            </div>
          ))}
          {spec.sources.length === 0 && <p className="adm-sub">Ainda não há fontes carregadas para este especialista.</p>}
        </div>
        <p className="adm-foot-note">As fontes adicionadas ficam «Pendentes» até a equipa Ujimu executar a conversão e a ingestão. Não é possível remover nem substituir fontes a partir desta área.</p>
      </div>
    </div>
  );
}

/* ---------- Área corporativa ---------- */
function CompanyAdminArea({ user, membership, specs, onUpdateSpec, onExit, onLogin }) {
  const [openId, setOpenId] = useCoState(null);

  if (!user) return <CompanyGate user={user} onLogin={onLogin} onExit={onExit} reason="Inicie sessão com uma conta de administrador corporativo para gerir os especialistas da sua empresa." />;
  if (!membership) return <CompanyGate user={user} onLogin={onLogin} onExit={onExit} reason="A sua conta não tem permissões de administrador na empresa activa. Mude de empresa no menu lateral ou contacte o administrador da sua empresa." />;

  const mySpecs = specs.filter((s) => s.accessCompanyId === membership.id);
  const openSpec = mySpecs.find((s) => s.id === openId);

  return openSpec
    ? <CompanySpecDetail key={openSpec.id} spec={openSpec} company={membership} onBack={() => setOpenId(null)} onUpdate={onUpdateSpec} />
    : <CompanySpecList company={membership} specs={mySpecs} onOpen={setOpenId} onExit={onExit} />;
}

Object.assign(window, { CompanyAdminArea });
