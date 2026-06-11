// Ujimu — área de conversa: estado vazio, mensagens, streaming, citações, publicidade, quota, fila
const { useState: useChatState, useEffect: useChatEffect, useRef: useChatRef } = React;

/* Cópia para o clipboard com fallback para ambientes sem permissão */
function copyTextToClipboard(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(t).catch(() => copyTextFallback(t));
  }
  return Promise.resolve(copyTextFallback(t));
}
function copyTextFallback(t) {
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* sem clipboard disponível */ }
  document.body.removeChild(ta);
}

/* ---------- Estado vazio / escolha de especialidade ---------- */
function EmptyState({ specialties, specialty, onPick, suggestions, onAsk }) {
  const sel = specialties.find((s) => s.id === specialty);
  return (
    <div className="empty">
      {!sel && (
        <React.Fragment>
          <h1 className="empty-title">O que deseja consultar?</h1>
          <p className="empty-sub">Escolha uma especialidade. Cada assistente responde apenas com base nas fontes oficiais dessa área.</p>
          <div className="spec-grid">
            {specialties.map((s) => (
              <button key={s.id} className="spec-card" onClick={() => onPick(s.id)}>
                <span className="spec-chip-letter spec-chip-letter--lg">{s.letter}</span>
                <span className="spec-card-name">{s.name}</span>
                <span className="spec-card-short">{s.short}</span>
              </button>
            ))}
          </div>
        </React.Fragment>
      )}
      {sel && (
        <React.Fragment>
          <span className="spec-chip-letter spec-chip-letter--xl">{sel.letter}</span>
          <h1 className="empty-title">{sel.name}</h1>
          <p className="empty-sub">{sel.short}. Respostas fundamentadas nas fontes oficiais desta especialidade.</p>
          <div className="sugg-row">
            {(suggestions[sel.id] || []).map((q, i) => (
              <button key={i} className="sugg" onClick={() => onAsk(q)}>{q}</button>
            ))}
          </div>
          <div className="empty-sources">
            <span className="empty-sources-label">Fontes carregadas</span>
            {sel.sources.map((src, i) => (
              <span key={i} className="empty-source"><Icon name="doc" size={13} /> {src}</span>
            ))}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

/* ---------- Mensagem do utilizador ---------- */
function UserMessage({ msg, canEdit, onEdit }) {
  const [editing, setEditing] = useChatState(false);
  const [draft, setDraft] = useChatState(msg.text);
  function save() {
    const t = draft.trim();
    if (t && t !== msg.text) onEdit(msg.id, t); 
    setEditing(false);
  }
  if (editing) {
    return (
      <div className="msg msg--user">
        <div className="bubble bubble--edit">
          <textarea className="bubble-ta" value={draft} autoFocus rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') setEditing(false); }}
          ></textarea>
          <div className="bubble-edit-row">
            <span className="bubble-edit-note">Ao guardar, as respostas seguintes serão removidas.</span>
            <button className="btn btn--ghost btn--xs" onClick={() => setEditing(false)}>Cancelar</button>
            <button className="btn btn--primary btn--xs" onClick={save}>Guardar e reenviar</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="msg msg--user">
      <div className="bubble">{msg.text}</div>
      {canEdit && (
        <button className="iconbtn msg-edit" title="Editar pergunta" onClick={() => { setDraft(msg.text); setEditing(true); }}>
          <Icon name="edit" size={14} />
        </button>
      )}
    </div>
  );
}

/* ---------- Resposta do assistente (com streaming) ---------- */
function AssistantMessage({ msg, specialty, streamSpeed, onDone }) {
  // msg.answer: { parts: [{t, c?}], citations, noContext? }
  const full = msg.answer.parts.map((p) => p.t).join('');
  const [shown, setShown] = useChatState(msg.done ? full.length : 0);
  const [copied, setCopied] = useChatState(false);
  const doneRef = useChatRef(msg.done);

  function copyAnswer() {
    const cites = msg.answer.citations || [];
    let text = full;
    if (cites.length > 0) {
      text += '\n\nFontes:\n' + cites.map((c, i) => (i + 1) + '. ' + c.source + ' — ' + c.ref).join('\n');
    }
    copyTextToClipboard(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  useChatEffect(() => {
    if (msg.done) return;
    let i = 0;
    const step = Math.max(1, Math.round(streamSpeed / 10));
    const iv = setInterval(() => {
      i += step;
      if (i >= full.length) {
        clearInterval(iv);
        setShown(full.length);
        if (!doneRef.current) { doneRef.current = true; onDone(msg.id); }
      } else {
        setShown(i);
      }
    }, 24);
    return () => clearInterval(iv);
  }, []);

  const streaming = shown < full.length;

  // Constrói os segmentos visíveis com marcadores de citação
  let acc = 0;
  const rendered = [];
  msg.answer.parts.forEach((p, idx) => {
    const start = acc; acc += p.t.length;
    if (shown <= start) return;
    const visible = p.t.slice(0, Math.min(p.t.length, shown - start));
    rendered.push(<span key={idx}>{visible}</span>);
    if (p.c && shown >= acc) rendered.push(<sup key={'c' + idx} className="cite-mark">{p.c}</sup>);
  });

  return (
    <div className={'msg msg--ai' + (msg.answer.noContext ? ' msg--nocontext' : '')}>
      <span className="ai-mark" aria-hidden="true">U</span>
      <div className="ai-body">
        {msg.answer.noContext && !streaming && (
          <span className="nocontext-tag"><Icon name="info" size={13} /> Contexto insuficiente</span>
        )}
        <p className="ai-text">
          {rendered}
          {streaming && <span className="caret"></span>}
        </p>
        {!streaming && msg.answer.citations.length > 0 && (
          <div className="sources">
            <span className="sources-label">Fontes</span>
            {msg.answer.citations.map((c, i) => (
              <button key={i} className="source-row" title="Abrir fonte (protótipo)">
                <span className="cite-mark cite-mark--list">{i + 1}</span>
                <span className="source-meta">
                  <span className="source-name">{c.source}</span>
                  <span className="source-ref">{c.ref}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {!streaming && msg.answer.noContext && specialty && (
          <div className="sources">
            <span className="sources-label">Fontes desta especialidade</span>
            {specialty.sources.map((s, i) => (
              <span key={i} className="source-row source-row--plain">
                <Icon name="doc" size={14} />
                <span className="source-meta"><span className="source-name">{s}</span></span>
              </span>
            ))}
          </div>
        )}
        {!streaming && (
          <div className="ai-actions">
            <button className={'copybtn' + (copied ? ' copybtn--done' : '')} onClick={copyAnswer} title="Copiar resposta e fontes">
              <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copiado' : 'Copiar'}
            </button>
            <p className="ai-note">Gerado por IA · pode conter imprecisões</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Publicidade inline ---------- */
function AdCard({ ad, format }) {
  if (format === 'banner') {
    return (
      <div className="ad ad--banner">
        <span className="ad-label">Publicidade</span>
        <span className="ad-brand">{ad.brand}</span>
        <span className="ad-body-inline">{ad.body}</span>
        <button className="ad-cta">{ad.cta}</button>
      </div>
    );
  }
  return (
    <div className="ad ad--card">
      <div className="ad-toprow">
        <span className="ad-label">Publicidade</span>
      </div>
      <div className="ad-main">
        <span className="ad-logo">{ad.brand.charAt(0)}</span>
        <div className="ad-text">
          <span className="ad-brand">{ad.brand} <span className="ad-tag">· {ad.tag}</span></span>
          <span className="ad-bodytext">{ad.body}</span>
        </div>
        <button className="ad-cta">{ad.cta}</button>
      </div>
    </div>
  );
}

/* ---------- Fila de perguntas (enquanto há resposta em curso) ---------- */
function QueueList({ queue, onRemove, onMove }) {
  if (queue.length === 0) return null;
  return (
    <div className="queue">
      <span className="queue-label">Em fila · {queue.length}/3{queue.length >= 3 ? ' — máximo atingido' : ''}</span>
      {queue.map((q, i) => (
        <div className="queue-item" key={q.id}>
          <span className="queue-pos">{i + 1}</span>
          <span className="queue-item-text">{q.text}</span>
          <button className="iconbtn iconbtn--queue" disabled={i === 0} title="Mover para cima" onClick={() => onMove(i, -1)}><Icon name="chevUp" size={14} /></button>
          <button className="iconbtn iconbtn--queue" disabled={i === queue.length - 1} title="Mover para baixo" onClick={() => onMove(i, 1)}><Icon name="chevDown" size={14} /></button>
          <button className="iconbtn iconbtn--danger" title="Remover da fila" onClick={() => onRemove(q.id)}><Icon name="trash" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Aviso de quota esgotada ---------- */
function QuotaNotice({ user, onLogin, onGoSubscription }) {
  return (
    <div className="quota-notice">
      <strong>{user ? 'Atingiu o limite diário de 20 pedidos.' : 'Atingiu o limite gratuito de 5 pedidos diários.'}</strong>
      <span>
        {user
          ? 'Subscreva para consultar sem limite diário e sem publicidade.'
          : 'Inicie sessão para usar 20 pedidos por dia — ou subscreva para não ter limite diário.'}
      </span>
      <div className="quota-notice-row">
        {!user && <button className="btn btn--primary btn--xs" onClick={onLogin}>Entrar por OTP</button>}
        <button className={'btn btn--xs ' + (user ? 'btn--primary' : 'btn--ghost')} onClick={onGoSubscription}>Ver subscrição</button>
      </div>
    </div>
  );
}

Object.assign(window, { EmptyState, UserMessage, AssistantMessage, AdCard, QuotaNotice, QueueList });
