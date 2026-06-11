// Ujimu — área de administração (/admin) com subpáginas
const { useState: useAdmState } = React;

/* ---------- Dados administrativos de demonstração ---------- */
const WIKI_PRESETS = [
  { value: 'research-project', label: 'Projecto de investigação' },
  { value: 'book-companion', label: 'Companheiro de livro' },
  { value: 'personal-journal-backed', label: 'Diário pessoal' },
  { value: 'business-team-knowledge', label: 'Conhecimento de equipa' },
  { value: 'help-desk-faq-customer-support', label: 'Apoio ao cliente / FAQ' },
  { value: 'engineering-internal-technical-documentation', label: 'Documentação técnica interna' },
  { value: 'legislation-regulatory', label: 'Legislação e regulação' },
  { value: 'custom-domain', label: 'Domínio personalizado' },
];
const presetLabel = (v) => (WIKI_PRESETS.find((p) => p.value === v) || { label: v }).label;
const companyName = (companies, id) => ((companies || []).find((c) => c.id === id) || { name: id }).name;

const ADMIN_SEED = [
  {
    id: 'facturacao', name: 'Facturação', letter: 'F',
    description: 'Regime jurídico das facturas e documentos equivalentes.',
    wikiPreset: 'legislation-regulatory', requireCitations: true, streamingEnabled: true, suspended: false, accessCompanyId: '',
    prompt: 'És um assistente especializado em facturação em Angola. Responde APENAS com base nos excertos da wiki fornecidos no contexto. Cita sempre as fontes relevantes. Se o contexto for insuficiente, di-lo claramente e não especules.',
    sources: [
      { id: 'f1', name: 'Decreto Presidencial n.º 292/18, de 3 de Dezembro.pdf', status: 'ingerido', docs: 31, updated: 'há 12 dias' },
      { id: 'f2', name: 'Regime Jurídico das Facturas — consolidado.pdf', status: 'ingerido', docs: 18, updated: 'há 2 meses' },
    ],
  },
  {
    id: 'iva', name: 'IVA', letter: 'I',
    description: 'Código do Imposto sobre o Valor Acrescentado.',
    wikiPreset: 'legislation-regulatory', requireCitations: true, streamingEnabled: true, suspended: false, accessCompanyId: '',
    prompt: 'És um assistente especializado em IVA em Angola. Responde APENAS com base nos excertos da wiki fornecidos no contexto. Cita sempre as fontes relevantes. Se o contexto for insuficiente, di-lo claramente e não especules.',
    sources: [
      { id: 'i1', name: 'Lei n.º 7/19 — Código do IVA.pdf', status: 'ingerido', docs: 64, updated: 'há 12 dias' },
      { id: 'i2', name: 'Alterações ao Código do IVA — 2024.pdf', status: 'em processamento', docs: 0, updated: 'agora' },
      { id: 'i3', name: 'Circular AGT n.º 4-22.pdf', status: 'bloqueado', docs: 0, updated: 'há 5 dias', error: 'Documento protegido por palavra-passe — desbloqueie e volte a carregar.' },
    ],
  },
  {
    id: 'laboral', name: 'Legislação Laboral', letter: 'L',
    description: 'Lei Geral do Trabalho e regulamentação conexa.',
    wikiPreset: 'legislation-regulatory', requireCitations: true, streamingEnabled: true, suspended: false, accessCompanyId: '',
    prompt: 'És um assistente especializado em legislação laboral em Angola. Responde APENAS com base nos excertos da wiki fornecidos no contexto. Cita sempre as fontes relevantes. Se o contexto for insuficiente, di-lo claramente e não especules.',
    sources: [
      { id: 'l1', name: 'Lei n.º 12/23 — Lei Geral do Trabalho.pdf', status: 'convertido', docs: 87, updated: 'há 3 horas' },
    ],
  },
  {
    id: 'aduaneira', name: 'Pauta Aduaneira', letter: 'P',
    description: 'Direitos de importação e exportação.',
    wikiPreset: 'custom-domain', requireCitations: true, streamingEnabled: false, suspended: false,
    accessCompanyId: 'transatlantico',
    prompt: 'És um assistente especializado na pauta aduaneira de Angola. Responde APENAS com base nos excertos da wiki fornecidos. Indica sempre o código pautal quando aplicável. Se o contexto for insuficiente, di-lo claramente.',
    sources: [
      { id: 'a1', name: 'Pauta Aduaneira — nomenclatura SH 2022.xlsx', status: 'falhado', docs: 0, updated: 'há 1 dia', error: 'Conversão falhou: folha «Anexo III» com células unidas não suportadas (linha 1.204).' },
      { id: 'a2', name: 'Instrutivo de aplicação da Pauta.pdf', status: 'pendente', docs: 0, updated: 'há 1 dia' },
    ],
  },
  {
    id: 'cambial', name: 'Regime Cambial', letter: 'R',
    description: 'Operações cambiais e pagamentos ao estrangeiro.',
    wikiPreset: 'legislation-regulatory', requireCitations: true, streamingEnabled: true, suspended: false,
    accessCompanyId: 'transatlantico',
    prompt: 'És um assistente especializado no regime cambial de Angola. Responde APENAS com base nos excertos da wiki fornecidos no contexto. Cita sempre as fontes relevantes. Se o contexto for insuficiente, di-lo claramente e não especules.',
    sources: [
      { id: 'r1', name: 'Lei n.º 5/97 — Lei Cambial.pdf', status: 'ingerido', docs: 22, updated: 'há 1 mês' },
      { id: 'r2', name: 'Aviso BNA n.º 10-23 — operações de mercadorias.pdf', status: 'pendente', docs: 0, updated: 'há 2 dias', addedBy: 'empresa' },
    ],
  },
];

const ANALYTICS = {
  distinctVisitors: 3470,
  noContextRecent: 12,
  visitors: [
    { m: 'Jan', v: 1240 }, { m: 'Fev', v: 1810 }, { m: 'Mar', v: 2390 },
    { m: 'Abr', v: 2150 }, { m: 'Mai', v: 3470 }, { m: 'Jun', v: 1980 },
  ],
  recent: [
    { q: 'Qual é a taxa de IVA para serviços digitais?', spec: 'iva', noContext: false, when: 'há 4 min' },
    { q: 'Posso despedir durante o período experimental?', spec: 'laboral', noContext: false, when: 'há 11 min' },
    { q: 'Regime de IVA para criptoactivos', spec: 'iva', noContext: true, when: 'há 19 min' },
    { q: 'Factura proforma serve para alfândega?', spec: 'aduaneira', noContext: true, when: 'há 26 min' },
    { q: 'Prazo para emitir nota de crédito', spec: 'facturacao', noContext: false, when: 'há 41 min' },
    { q: 'IVA na importação de medicamentos', spec: 'iva', noContext: false, when: 'há 1 h' },
  ],
  gaps: [
    { id: 'g1', q: 'Regime de IVA para criptoactivos', spec: 'iva', count: 14 },
    { id: 'g2', q: 'Teletrabalho transfronteiriço', spec: 'laboral', count: 9 },
    { id: 'g3', q: 'Facturação em moeda estrangeira', spec: 'facturacao', count: 7 },
    { id: 'g4', q: 'Isenções na importação de painéis solares', spec: 'aduaneira', count: 5 },
  ],
};

const OPS_CHECKS = [
  { name: 'Base de dados', value: 'Ligada', ok: true },
  { name: 'Directoria de dados', value: 'Gravável', ok: true },
  { name: 'Logs operacionais', value: 'Graváveis', ok: true },
  { name: 'Migrações aplicadas', value: '23', ok: true },
  { name: 'Segredos obrigatórios', value: '4 de 4 configurados', ok: true },
  { name: 'Passkeys', value: 'Não configurado', ok: false },
];

const STATUS_META = {
  'pendente': { label: 'Pendente', cls: 'mute' },
  'em processamento': { label: 'Em processamento', cls: 'warn' },
  'substituída': { label: 'Substituída', cls: 'mid' },
  'convertido': { label: 'Convertido', cls: 'mid' },
  'ingerido': { label: 'Ingerido', cls: 'ok' },
  'bloqueado': { label: 'Bloqueado', cls: 'err' },
  'falhado': { label: 'Falhado', cls: 'err' },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, cls: 'ok' };
  return <span className={'badge badge--' + m.cls}><span className="badge-dot"></span>{m.label}</span>;
}

function AdmToggle({ label, hint, value, onChange }) {
  return (
    <button className="adm-toggle" onClick={() => onChange(!value)} role="switch" aria-checked={value}>
      <span className="adm-toggle-meta">
        <span className="adm-toggle-label">{label}</span>
        {hint && <span className="adm-toggle-hint">{hint}</span>}
      </span>
      <span className={'switch' + (value ? ' switch--on' : '')}><span className="switch-knob"></span></span>
    </button>
  );
}

function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* ---------- Painel principal /admin ---------- */
function AdminHome({ specs, onGo, user }) {
  const issues = specs.reduce((n, s) => n + s.sources.filter((x) => x.status === 'falhado' || x.status === 'bloqueado').length, 0);
  const CARDS = [
    { id: 'specs', path: '/admin/specialists', title: 'Especialidades e fontes', desc: specs.length + ' especialidades · ' + (issues ? issues + ' fontes com problemas' : 'fontes sem problemas') },
    { id: 'analytics', path: '/admin/analytics', title: 'Analytics', desc: ANALYTICS.distinctVisitors.toLocaleString('pt') + ' visitantes distintos este mês · ' + ANALYTICS.gaps.length + ' lacunas por rever' },
    { id: 'ops', path: '/admin/ops', title: 'Operações / readiness', desc: OPS_CHECKS.every((c) => c.ok) ? 'Tudo operacional' : '1 item por configurar' },
  ];
  return (
    <div className="adm-page" data-screen-label="Admin — Painel">
      <div className="adm-pagehead">
        <div>
          <h1 className="adm-title">Administração</h1>
          <p className="adm-sub">Sessão de <strong>{user.contact}</strong> verificada com permissões de administrador.</p>
        </div>
      </div>
      <div className="adm-homegrid">
        {CARDS.map((c) => (
          <button key={c.id} className="adm-card adm-homecard" onClick={() => onGo(c.id)}>
            <span className="adm-homecard-path">{c.path}</span>
            <span className="adm-homecard-title">{c.title}</span>
            <span className="adm-homecard-desc">{c.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Gate de permissões ---------- */
function AdminGate({ user, onLogin, onExit }) {
  return (
    <div className="adm-page adm-gate" data-screen-label="Admin — Acesso negado">
      <span className="adm-gate-icon"><Icon name="user" size={26} /></span>
      <h1 className="adm-title">Área reservada</h1>
      <p className="adm-sub">{user ? 'A sua conta não tem permissões de administrador.' : 'Inicie sessão com uma conta de administrador para aceder a /admin.'}</p>
      <div className="adm-row-actions" style={{ justifyContent: 'center' }}>
        <button className="btn btn--ghost" onClick={onExit}>Voltar à consulta</button>
        {!user && <button className="btn btn--primary" onClick={onLogin}>Entrar por OTP</button>}
      </div>
      <p className="adm-foot-note">Neste protótipo, qualquer sessão iniciada é tratada como administrador.</p>
    </div>
  );
}

/* ---------- /admin/specialists — lista + criação ---------- */
function AdminSpecialties({ specs, companies, onOpen, onCreate }) {
  const [creating, setCreating] = useAdmState(false);
  const [form, setForm] = useAdmState({ name: '', id: '', description: '', wikiPreset: 'legislation-regulatory', prompt: '', requireCitations: true, streamingEnabled: true });
  const [idTouched, setIdTouched] = useAdmState(false);
  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v, ...(k === 'name' && !idTouched ? { id: slugify(v) } : {}) }));
  }
  const valid = form.name.trim() && form.id.trim();
  function create() {
    if (!valid) return;
    onCreate(form);
    setForm({ name: '', id: '', description: '', wikiPreset: 'legislation-regulatory', prompt: '', requireCitations: true, streamingEnabled: true });
    setIdTouched(false);
    setCreating(false);
  }
  return (
    <div className="adm-page" data-screen-label="Admin — Especialidades">
      <div className="adm-pagehead">
        <div>
          <h1 className="adm-title">Especialidades</h1>
          <p className="adm-sub">{specs.length} especialidades activas na plataforma.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setCreating(!creating)}><Icon name="plus" size={15} /> Criar especialidade</button>
      </div>

      {creating && (
        <div className="adm-card adm-create">
          <h2 className="adm-card-title">Nova especialidade</h2>
          <div className="adm-formgrid">
            <label className="adm-field">
              <span className="adm-field-label">Nome</span>
              <input className="field" placeholder="ex: Imposto Industrial" value={form.name} autoFocus onChange={(e) => set('name', e.target.value)} />
            </label>
            <label className="adm-field">
              <span className="adm-field-label">ID</span>
              <input className="field mono-field" placeholder="imposto-industrial" value={form.id} onChange={(e) => { setIdTouched(true); set('id', slugify(e.target.value)); }} />
            </label>
          </div>
          <label className="adm-field">
            <span className="adm-field-label">Descrição</span>
            <input className="field" placeholder="Descrição curta apresentada aos utilizadores" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <div className="adm-formgrid">
            <label className="adm-field">
              <span className="adm-field-label">Preset da wiki</span>
              <select className="field" value={form.wikiPreset} onChange={(e) => set('wikiPreset', e.target.value)}>
                {WIKI_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <span className="adm-preset-id">{form.wikiPreset}</span>
            </label>
            <div className="adm-field">
              <span className="adm-field-label">Comportamento</span>
              <div className="adm-togglerow">
                <AdmToggle label="Exige citações" value={form.requireCitations} onChange={(v) => set('requireCitations', v)} />
                <AdmToggle label="Responde em fluxo" value={form.streamingEnabled} onChange={(v) => set('streamingEnabled', v)} />
              </div>
            </div>
          </div>
          <label className="adm-field">
            <span className="adm-field-label">Prompt do especialista</span>
            <textarea className="field adm-prompt" rows={3} placeholder="És um assistente especializado em…" value={form.prompt} onChange={(e) => set('prompt', e.target.value)}></textarea>
          </label>
          <div className="adm-row-actions">
            <button className="btn btn--ghost btn--xs" onClick={() => setCreating(false)}>Cancelar</button>
            <button className={'btn btn--primary btn--xs' + (valid ? '' : ' btn--off')} onClick={create}>Criar especialidade</button>
          </div>
        </div>
      )}

      <div className="adm-list">
        {specs.map((s) => {
          const issue = s.sources.find((x) => x.status === 'falhado' || x.status === 'bloqueado');
          const working = s.sources.find((x) => x.status === 'em processamento' || x.status === 'pendente' || x.status === 'convertido');
          return (
            <div className="adm-card adm-spec" key={s.id}>
              <button className="adm-spec-main" onClick={() => onOpen(s.id)}>
                <span className="spec-chip-letter">{s.letter}</span>
                <span className="adm-spec-meta">
                  <span className="adm-spec-name">{s.name} <span className="adm-spec-id">/{s.id}</span></span>
                  <span className="adm-spec-desc">{s.description}</span>
                </span>
                <span className="adm-spec-stats">
                  {s.suspended && <span className="badge badge--mute"><span className="badge-dot"></span>Suspensa</span>}
                  {s.accessCompanyId !== '' && <span className="adm-stat">empresa: {companyName(companies, s.accessCompanyId)}</span>}
                  <span className="adm-stat">{presetLabel(s.wikiPreset)}</span>
                  <span className="adm-stat">{s.sources.length} fontes</span>
                  <StatusBadge status={issue ? issue.status : working ? working.status : 'ingerido'} />
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- /admin/specialists/[id] — ficha ---------- */
const INGESTABLE = ['pendente', 'substituída', 'convertido'];
function AdminSpecialtyDetail({ spec, companies, onBack, onUpdate, onDelete }) {
  const [confirmDel, setConfirmDel] = useAdmState(false);
  // Snapshot local das fontes — o estado real evolui no «servidor» em background;
  // só é reflectido aqui quando o utilizador escolhe Actualizar.
  const [viewSrcs, setViewSrcs] = useAdmState(spec.sources);
  const [ingestNote, setIngestNote] = useAdmState(null);
  const fileRef = React.useRef(null);
  const replaceTarget = React.useRef(null);

  function patch(p) { onUpdate(spec.id, p); }

  function pickNew() { replaceTarget.current = null; fileRef.current.click(); }
  function pickReplace(srcId) { replaceTarget.current = srcId; fileRef.current.click(); }

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (replaceTarget.current) {
      const id = replaceTarget.current;
      const next = spec.sources.map((s) => s.id === id
        ? { ...s, name: file.name, status: 'substituída', docs: 0, updated: 'agora', error: undefined }
        : s);
      patch({ sources: next });
      setViewSrcs(next);
    } else {
      const n = { id: spec.id + '-' + Date.now(), name: file.name, status: 'pendente', docs: 0, updated: 'agora' };
      const next = [...spec.sources, n];
      patch({ sources: next });
      setViewSrcs(next);
    }
    replaceTarget.current = null;
  }

  function refresh() {
    setViewSrcs(spec.sources);
    if (!spec.sources.some((s) => ['em processamento', 'pendente', 'substituída', 'convertido'].includes(s.status))) setIngestNote(null);
  }

  function runIngest() {
    setIngestNote('Comando enviado. A conversão e a ingestão decorrem em background — use Actualizar para acompanhar o estado.');
    // O «servidor» processa de forma assíncrona: conversão automática e depois ingestão.
    onUpdate(spec.id, (s) => ({ sources: s.sources.map((x) => INGESTABLE.includes(x.status) && x.status !== 'convertido' ? { ...x, status: 'em processamento' } : x) }));
    setTimeout(() => {
      onUpdate(spec.id, (s) => ({ sources: s.sources.map((x) => x.status === 'em processamento' ? { ...x, status: 'convertido', docs: x.docs || 7 + Math.floor(Math.random() * 30), updated: 'agora' } : x) }));
    }, 2200);
    setTimeout(() => {
      onUpdate(spec.id, (s) => ({ sources: s.sources.map((x) => x.status === 'convertido' ? { ...x, status: 'ingerido', updated: 'agora' } : x) }));
    }, 4500);
  }

  const canIngest = spec.sources.some((s) => INGESTABLE.includes(s.status));

  return (
    <div className="adm-page" data-screen-label="Admin — Ficha de especialidade">
      <button className="btn btn--ghost btn--back" onClick={onBack}><Icon name="chevLeft" size={16} /> Especialidades</button>
      <div className="adm-pagehead">
        <div className="adm-detail-head">
          <span className="spec-chip-letter spec-chip-letter--lg">{spec.letter}</span>
          <div>
            <h1 className="adm-title">{spec.name} {spec.suspended && <span className="badge badge--mute"><span className="badge-dot"></span>Suspensa</span>}</h1>
            <p className="adm-sub mono-field">/admin/specialists/{spec.id}</p>
          </div>
        </div>
      </div>

      <div className="adm-card">
        <h2 className="adm-card-title">Metadados</h2>
        <label className="adm-field">
          <span className="adm-field-label">Nome</span>
          <input className="field" value={spec.name} onChange={(e) => patch({ name: e.target.value })} />
        </label>
        <label className="adm-field">
          <span className="adm-field-label">Descrição</span>
          <input className="field" value={spec.description} onChange={(e) => patch({ description: e.target.value })} />
        </label>
        <label className="adm-field">
          <span className="adm-field-label">Preset da wiki</span>
          <select className="field" value={spec.wikiPreset} onChange={(e) => patch({ wikiPreset: e.target.value })}>
            {WIKI_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <span className="adm-preset-id">{spec.wikiPreset}</span>
        </label>
        <label className="adm-field">
          <span className="adm-field-label">Prompt do especialista</span>
          <textarea className="field adm-prompt" rows={4} value={spec.prompt} onChange={(e) => patch({ prompt: e.target.value })}></textarea>
        </label>
        <div className="adm-togglerow">
          <AdmToggle label="Exige citações" hint="Respostas devem citar as fontes da wiki" value={spec.requireCitations} onChange={(v) => patch({ requireCitations: v })} />
          <AdmToggle label="Responde em fluxo" hint="Streaming de tokens no chat" value={spec.streamingEnabled} onChange={(v) => patch({ streamingEnabled: v })} />
        </div>
      </div>

      <div className="adm-card">
        <div className="adm-card-toprow">
          <h2 className="adm-card-title">Fontes oficiais</h2>
          <div className="adm-row-actions">
            <button className="btn btn--ghost btn--xs" onClick={pickNew}><Icon name="upload" size={13} /> Carregar fonte</button>
            <button className="btn btn--ghost btn--xs" onClick={refresh}><Icon name="refresh" size={13} /> Actualizar</button>
            <button className={'btn btn--primary btn--xs' + (canIngest ? '' : ' btn--off')} onClick={runIngest}>Executar ingestão</button>
          </div>
        </div>
        <input type="file" ref={fileRef} style={{ display: 'none' }} accept=".pdf,.docx,.xlsx,.html,.txt" onChange={onFile} />
        {ingestNote && <p className="adm-ingest-note"><Icon name="info" size={14} /> {ingestNote}</p>}
        <div className="adm-srcs">
          {viewSrcs.map((src) => (
            <div className={'adm-src' + (src.error ? ' adm-src--err' : '')} key={src.id}>
              <div className="adm-src-row">
                <Icon name="doc" size={16} />
                <div className="adm-src-meta">
                  <span className="adm-src-name">{src.name}</span>
                  <span className="adm-src-sub">{src.docs > 0 ? src.docs + ' fragmentos na wiki · ' : ''}{src.addedBy === 'empresa' ? 'adicionada pelo admin corporativo · ' : ''}actualizada {src.updated}</span>
                </div>
                <StatusBadge status={src.status} />
                <button className="btn btn--ghost btn--xs" title="Substituir esta fonte por um novo ficheiro" onClick={() => pickReplace(src.id)}>Recarregar</button>
              </div>
              {src.error && <p className="adm-src-error">{src.error}</p>}
            </div>
          ))}
          {viewSrcs.length === 0 && <p className="adm-sub">Ainda não há fontes carregadas para esta especialidade.</p>}
        </div>
        <p className="adm-foot-note">A conversão dos ficheiros é automática e acontece durante a ingestão. «Recarregar» substitui o ficheiro de uma fonte; a fonte fica marcada como substituída até à próxima ingestão.</p>
      </div>

      <div className="adm-card">
        <h2 className="adm-card-title">Acesso restrito por empresa</h2>
        <p className="adm-card-note">Reserve este especialista a uma única empresa com conta corporativa. Com «Todos», fica disponível ao público.</p>
        <label className="adm-field">
          <span className="adm-field-label">Empresa com acesso</span>
          <select className="field" value={spec.accessCompanyId} onChange={(e) => patch({ accessCompanyId: e.target.value })}>
            <option value="">Todos — disponível ao público</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.seats} utilizadores</option>)}
          </select>
        </label>
        <p className="adm-foot-note">{spec.accessCompanyId ? 'Apenas as contas especificadas pela ' + companyName(companies, spec.accessCompanyId) + ' vêem e consultam este especialista.' : 'Disponível para todos os utilizadores.'}</p>
      </div>

      <div className="adm-card adm-dangerzone">
        <div className="adm-card-toprow">
          <div>
            <h2 className="adm-card-title">{spec.suspended ? 'Especialidade suspensa' : 'Suspender especialidade'}</h2>
            <p className="adm-card-note">{spec.suspended ? 'Não aparece aos utilizadores. A wiki e o histórico mantêm-se intactos.' : 'Retira a especialidade do selector dos utilizadores, sem apagar dados.'}</p>
          </div>
          <button className="btn btn--ghost btn--xs" onClick={() => patch({ suspended: !spec.suspended })}>
            <Icon name={spec.suspended ? 'check' : 'pause'} size={13} /> {spec.suspended ? 'Reactivar' : 'Suspender'}
          </button>
        </div>
        <div className="adm-card-toprow" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div>
            <h2 className="adm-card-title">Apagar especialidade</h2>
            <p className="adm-card-note">Apaga a wiki e todo o histórico de clientes associado, permanentemente.</p>
          </div>
          <button className="btn btn--danger btn--xs" onClick={() => setConfirmDel(true)}>Apagar</button>
        </div>
      </div>

      {confirmDel && (
        <div className="modal-scrim" onClick={() => setConfirmDel(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body" style={{ paddingTop: 18, paddingBottom: 6 }}>
              <h2 className="modal-title">Apagar «{spec.name}»?</h2>
              <p className="modal-sub">Esta acção apaga a especialidade, a respectiva wiki e <strong>todo o histórico de conversas dos clientes</strong> associado, de forma permanente.</p>
              <div className="adm-row-actions">
                <button className="btn btn--ghost" onClick={() => setConfirmDel(false)}>Cancelar</button>
                <button className="btn btn--danger" onClick={() => { setConfirmDel(false); onDelete(spec.id); }}>Apagar permanentemente</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- /admin/analytics ---------- */
function AdminAnalytics({ specs }) {
  const [reviewed, setReviewed] = useAdmState([]);
  const [filter, setFilter] = useAdmState('all');
  const max = Math.max(...ANALYTICS.visitors.map((x) => x.v));
  const specName = (id) => (specs.find((s) => s.id === id) || {}).name || id;
  const recent = ANALYTICS.recent.filter((r) => filter === 'all' || r.spec === filter);
  const gaps = ANALYTICS.gaps.filter((g) => filter === 'all' || g.spec === filter);
  return (
    <div className="adm-page" data-screen-label="Admin — Analytics">
      <div className="adm-pagehead">
        <div>
          <h1 className="adm-title">Analytics</h1>
          <p className="adm-sub">Sinais de produto e conteúdo, para revisão editorial. <strong>Não são usados como fonte de respostas do chat.</strong></p>
        </div>
        <select className="field adm-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Todas as especialidades</option>
          {specs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="adm-statrow">
        <div className="adm-card adm-statcard">
          <span className="adm-stat-big">{ANALYTICS.distinctVisitors.toLocaleString('pt')}</span>
          <span className="adm-stat-label">Visitantes distintos este mês</span>
        </div>
        <div className="adm-card adm-statcard">
          <span className="adm-stat-big">{ANALYTICS.noContextRecent}</span>
          <span className="adm-stat-label">Perguntas recentes sem contexto suficiente</span>
        </div>
        <div className="adm-card adm-statcard">
          <span className="adm-stat-big">{gaps.filter((g) => !reviewed.includes(g.id)).length}</span>
          <span className="adm-stat-label">Lacunas por rever</span>
        </div>
      </div>

      <div className="adm-card">
        <h2 className="adm-card-title">Visitantes distintos por mês</h2>
        <div className="chart">
          {ANALYTICS.visitors.map((x, i) => (
            <div className="chart-col" key={i}>
              <span className="chart-val">{x.v.toLocaleString('pt')}</span>
              <div className={'chart-bar' + (i === ANALYTICS.visitors.length - 1 ? ' chart-bar--now' : '')} style={{ height: Math.round((x.v / max) * 120) + 'px' }}></div>
              <span className="chart-lbl">{x.m}</span>
            </div>
          ))}
        </div>
        <p className="adm-foot-note">Junho em curso (até dia 10).</p>
      </div>

      <div className="adm-twocol">
        <div className="adm-card">
          <h2 className="adm-card-title">Perguntas recentes</h2>
          <div className="adm-feed">
            {recent.map((r, i) => (
              <div className="adm-feed-row" key={i}>
                <span className="adm-feed-q">{r.q} {r.noContext && <span className="nocontext-tag nocontext-tag--inline">sem contexto</span>}</span>
                <span className="adm-feed-meta">{specName(r.spec)} · {r.when}</span>
              </div>
            ))}
            {recent.length === 0 && <p className="adm-sub">Sem perguntas recentes nesta especialidade.</p>}
          </div>
        </div>
        <div className="adm-card">
          <h2 className="adm-card-title">Lacunas de conteúdo repetidas</h2>
          <p className="adm-card-note">Perguntas sem contexto suficiente, agrupadas por tema.</p>
          <div className="adm-feed">
            {gaps.map((g) => {
              const done = reviewed.includes(g.id);
              return (
                <div className={'adm-feed-row adm-gap' + (done ? ' adm-gap--done' : '')} key={g.id}>
                  <div className="adm-gap-main">
                    <span className="adm-feed-q">{g.q}</span>
                    <span className="adm-feed-meta">{specName(g.spec)} · {g.count}× esta semana</span>
                  </div>
                  <button className={'btn btn--xs ' + (done ? 'btn--ghost btn--off' : 'btn--ghost')} onClick={() => setReviewed([...reviewed, g.id])}>
                    {done ? <React.Fragment><Icon name="check" size={13} /> Revista</React.Fragment> : 'Marcar como revista'}
                  </button>
                </div>
              );
            })}
            {gaps.length === 0 && <p className="adm-sub">Sem lacunas registadas nesta especialidade.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- /admin/ops ---------- */
function AdminOps() {
  const issues = OPS_CHECKS.filter((c) => !c.ok).length;
  return (
    <div className="adm-page" data-screen-label="Admin — Ops">
      <div className="adm-pagehead">
        <div>
          <h1 className="adm-title">Readiness operacional</h1>
          <p className="adm-sub">Apenas booleanos e contagens seguras — sem valores secretos, caminhos internos ou variáveis sensíveis.</p>
        </div>
        <span className={'badge ' + (issues ? 'badge--warn' : 'badge--ok')}><span className="badge-dot"></span>{issues ? issues + ' item por configurar' : 'Tudo operacional'}</span>
      </div>
      <div className="adm-card">
        <div className="adm-srcs">
          {OPS_CHECKS.map((c, i) => (
            <div className="adm-src" key={i}>
              <div className="adm-src-row">
                <span className={'ops-dot ops-dot--' + (c.ok ? 'ok' : 'warn')}></span>
                <div className="adm-src-meta">
                  <span className="adm-src-name">{c.name}</span>
                </div>
                <span className="adm-ops-val">{c.value}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="adm-foot-note">Última verificação: hoje às 09:42 · actualização automática a cada 5 min.</p>
      </div>
    </div>
  );
}

/* ---------- Shell da administração ---------- */
function AdminArea({ onExit, user, onLogin, companies, specs, setSpecs }) {
  const [page, setPage] = useAdmState('home'); // home | specs | analytics | ops
  const [openId, setOpenId] = useAdmState(null);

  if (!user) return <AdminGate user={user} onLogin={onLogin} onExit={onExit} />;

  function updateSpec(id, p) { setSpecs((xs) => xs.map((s) => (s.id === id ? { ...s, ...(typeof p === 'function' ? p(s) : p) } : s))); }
  function createSpec(form) {
    setSpecs((xs) => [...xs, {
      id: form.id, name: form.name, description: form.description || '',
      letter: form.name.charAt(0).toUpperCase(),
      wikiPreset: form.wikiPreset, requireCitations: form.requireCitations, streamingEnabled: form.streamingEnabled,
      prompt: form.prompt || ('És um assistente especializado em ' + form.name.toLowerCase() + ' em Angola. Responde apenas com base na wiki.'),
      suspended: false, accessCompanyId: '',
      sources: [],
    }]);
  }
  function deleteSpec(id) { setSpecs((xs) => xs.filter((s) => s.id !== id)); setOpenId(null); }

  const openSpec = specs.find((s) => s.id === openId);
  const NAV = [
    { id: 'home', label: 'Painel', path: '/admin' },
    { id: 'specs', label: 'Especialidades', path: '/admin/specialists' },
    { id: 'analytics', label: 'Analytics', path: '/admin/analytics' },
    { id: 'ops', label: 'Ops', path: '/admin/ops' },
  ];
  return (
    <div className="adm">
      <aside className="adm-nav">
        <span className="adm-nav-label">/admin</span>
        {NAV.map((n) => (
          <button key={n.id} className={'adm-nav-item' + (page === n.id ? ' adm-nav-item--on' : '')} title={n.path} onClick={() => { setPage(n.id); setOpenId(null); }}>
            {n.label}
          </button>
        ))}
        <div className="adm-nav-spacer"></div>
        <button className="adm-nav-item" onClick={onExit}><Icon name="chevLeft" size={14} /> Sair da administração</button>
      </aside>
      <div className="adm-content">
        {page === 'home' && <AdminHome specs={specs} user={user} onGo={setPage} />}
        {page === 'specs' && !openSpec && <AdminSpecialties specs={specs} companies={companies} onOpen={setOpenId} onCreate={createSpec} />}
        {page === 'specs' && openSpec && <AdminSpecialtyDetail key={openSpec.id} spec={openSpec} companies={companies} onBack={() => setOpenId(null)} onUpdate={updateSpec} onDelete={deleteSpec} />}
        {page === 'analytics' && <AdminAnalytics specs={specs} />}
        {page === 'ops' && <AdminOps />}
      </div>
    </div>
  );
}

Object.assign(window, { AdminArea, ADMIN_SEED, StatusBadge });
