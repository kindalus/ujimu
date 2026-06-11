// Ujimu — aplicação principal
const { useState: useAppState, useEffect: useAppEffect, useRef: useAppRef } = React;
const D = window.UJIMU_DATA;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": true,
  "yellow": "moderado",
  "adFormat": "cartão",
  "streamSpeed": 60
}/*EDITMODE-END*/;

let _id = 0;
const nid = () => 'm' + (++_id);

const COMPANIES_SEED = [
  { id: 'transatlantico', name: 'Transitários Atlântico, Lda.', seats: 25 },
  { id: 'kudibanga', name: 'Kudibanga Logística', seats: 8 },
];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [view, setView] = useAppState('chat'); // chat | subscription | admin | profile
  const [drawerOpen, setDrawerOpen] = useAppState(false);
  const [loginOpen, setLoginOpen] = useAppState(false);

  const [user, setUser] = useAppState(null);
  const [subscriber, setSubscriber] = useAppState(false);
  const [expiringSoon, setExpiringSoon] = useAppState(false);
  const [company, setCompany] = useAppState(null);
  const [companies, setCompanies] = useAppState(COMPANIES_SEED);
  const [specs, setSpecs] = useAppState(window.ADMIN_SEED); // especialistas (partilhado entre /admin e área corporativa)
  const [memberships, setMemberships] = useAppState([]); // empresas a que o utilizador pertence
  const [activeCompanyId, setActiveCompanyId] = useAppState(''); // só uma activa de cada vez

  const [specialty, setSpecialty] = useAppState(null);
  const [messages, setMessages] = useAppState([]);
  const [queue, setQueue] = useAppState([]); // perguntas em fila durante o streaming (máx. 3)
  const [quotaUsed, setQuotaUsed] = useAppState(2); // já usou 2 hoje — mostra a quota a meio
  const [history, setHistory] = useAppState([]);
  const [activeConvId, setActiveConvId] = useAppState(null);

  const answerCount = useAppRef(0);
  const adIdx = useAppRef(0);
  const scrollRef = useAppRef(null);
  const streaming = messages.some((m) => m.kind === 'ai' && !m.done);

  const isSub = subscriber || !!company || memberships.length > 0;
  const activeMembership = memberships.find((m) => m.id === activeCompanyId) || null;
  const isCompanyAdmin = !!(activeMembership && activeMembership.role === 'admin');
  const quotaLimit = isSub ? Infinity : user ? 20 : 5;
  const quotaFull = quotaUsed >= quotaLimit;
  const specObj = D.SPECIALTIES.find((s) => s.id === specialty) || null;
  // Apenas especialidades públicas + as reservadas à empresa activa
  const availableSpecs = D.SPECIALTIES.filter((s) => !s.accessCompanyId || s.accessCompanyId === activeCompanyId);

  // Scroll suave para o fundo quando chegam mensagens
  useAppEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  function askNow(text) {
    const answer = D.findAnswer(specialty, text);
    const userMsg = { kind: 'user', id: nid(), text };
    const aiMsg = { kind: 'ai', id: nid(), answer, done: false };
    setMessages((m) => [...m, userMsg, aiMsg]);
    setQuotaUsed((q) => q + 1);
    if (user && !activeConvId) {
      const conv = { id: 'c' + Date.now(), specialty, title: text.length > 42 ? text.slice(0, 42) + '…' : text, when: 'Agora' };
      setHistory((h) => {
        // Máximo de 20 conversas guardadas por especialidade — as mais antigas caem.
        const next = [conv, ...h];
        const seen = {};
        return next.filter((x) => ((seen[x.specialty] = (seen[x.specialty] || 0) + 1) <= 20));
      });
      setActiveConvId(conv.id);
    }
  }

  function ask(text) {
    if (!specialty || quotaFull) return;
    if (streaming) {
      // Resposta em curso: a pergunta entra na fila (máximo 3)
      setQueue((q) => (q.length >= 3 ? q : [...q, { id: 'q' + Date.now() + '-' + q.length, text }]));
      return;
    }
    askNow(text);
  }

  // Quando a resposta termina, envia a próxima pergunta da fila
  useAppEffect(() => {
    if (streaming || queue.length === 0) return;
    if (quotaFull) { setQueue([]); return; }
    const next = queue[0];
    setQueue((q) => q.slice(1));
    askNow(next.text);
  }, [streaming, queue.length]);

  function onAnswerDone(msgId) {
    setMessages((m) => {
      const next = m.map((x) => (x.id === msgId ? { ...x, done: true } : x));
      answerCount.current += 1;
      // Publicidade inline após respostas alternadas (nunca para subscritores)
      if (!isSub && answerCount.current % 2 === 1) {
        const ad = D.ADS[adIdx.current % D.ADS.length];
        adIdx.current += 1;
        return [...next, { kind: 'ad', id: nid(), ad }];
      }
      return next;
    });
  }

  function editMessage(msgId, newText) {
    setMessages((m) => {
      const i = m.findIndex((x) => x.id === msgId);
      if (i < 0) return m;
      const answer = D.findAnswer(specialty, newText);
      return [...m.slice(0, i), { kind: 'user', id: nid(), text: newText }, { kind: 'ai', id: nid(), answer, done: false }];
    });
    setQuotaUsed((q) => q + 1);
  }

  function newConversation() {
    setMessages([]);
    setQueue([]);
    setActiveConvId(null);
    setSpecialty(null);
    setView('chat');
    setDrawerOpen(false);
  }

  function resumeConversation(h) {
    const answer = (D.ANSWERS[h.specialty] && D.ANSWERS[h.specialty][0]) || D.NO_CONTEXT;
    setSpecialty(h.specialty);
    setActiveConvId(h.id);
    setQueue([]);
    setMessages([
      { kind: 'user', id: nid(), text: h.title },
      { kind: 'ai', id: nid(), answer, done: true },
    ]);
    setView('chat');
    setDrawerOpen(false);
  }

  function deleteConversation(id) {
    setHistory((h) => h.filter((x) => x.id !== id));
    if (id === activeConvId) { setMessages([]); setActiveConvId(null); }
  }

  function onLoginSuccess(mode, contact) {
    const initials = contact.trim().charAt(0).toUpperCase() || 'U';
    setUser({ contact, initials });
    setHistory((h) => [...h, ...D.SEED_HISTORY]);
    // Demonstração: o utilizador é admin corporativo da Transatlântico e membro da Kudibanga
    setMemberships([
      { id: 'transatlantico', name: 'Transitários Atlântico, Lda.', role: 'admin' },
      { id: 'kudibanga', name: 'Kudibanga Logística', role: 'member' },
    ]);
    setActiveCompanyId('transatlantico');
    setLoginOpen(false);
  }

  function logout() {
    setUser(null);
    setSubscriber(false);
    setCompany(null);
    setMemberships([]);
    setActiveCompanyId('');
    setHistory([]);
    setActiveConvId(null);
    setQueue([]);
    setDrawerOpen(false);
    setView('chat');
  }

  function selectCompany(id) {
    setActiveCompanyId(id);
    // Se a especialidade actual deixar de estar disponível, recomeça a consulta
    const sp = D.SPECIALTIES.find((x) => x.id === specialty);
    if (sp && sp.accessCompanyId && sp.accessCompanyId !== id) {
      setMessages([]);
      setQueue([]);
      setActiveConvId(null);
      setSpecialty(null);
    }
  }

  function activateCompany(order) {
    const accounts = [
      ...order.admins.map((email) => ({ email, role: 'admin' })),
      ...order.members.filter((e) => !order.admins.includes(e)).map((email) => ({ email, role: 'member' })),
    ];
    const c = { id: 'c' + Date.now(), name: order.name, seats: order.seats, accounts };
    setCompany(c);
    setCompanies((xs) => [...xs, { id: c.id, name: c.name, seats: c.seats }]);
    setMemberships((ms) => [...ms, { id: c.id, name: c.name, role: 'admin' }]);
    setActiveCompanyId(c.id);
  }

  function cancelCompany() {
    if (company) {
      setCompanies((xs) => xs.filter((x) => x.id !== company.id));
      setMemberships((ms) => {
        const next = ms.filter((m) => m.id !== company.id);
        if (activeCompanyId === company.id) selectCompany(next.length ? next[0].id : '');
        return next;
      });
    }
    setCompany(null);
  }

  function updateSpec(id, p) {
    setSpecs((xs) => xs.map((s) => (s.id === id ? { ...s, ...(typeof p === 'function' ? p(s) : p) } : s)));
  }

  const disabledReason = quotaFull
    ? <QuotaNotice user={user} onLogin={() => setLoginOpen(true)} onGoSubscription={() => setView('subscription')} />
    : null;

  return (
    <div className="app" data-theme={t.dark ? 'dark' : 'light'} data-yellow={t.yellow} data-screen-label={view === 'chat' ? 'Consulta' : view === 'admin' ? 'Administração' : view === 'company' ? 'Empresa' : view === 'profile' ? 'Perfil' : 'Subscrição'}>
      <TopBar
        onMenu={() => setDrawerOpen(true)}
        user={user}
        quotaUsed={quotaUsed}
        quotaLimit={quotaLimit === Infinity ? 0 : quotaLimit}
        isSubscriber={isSub}
        onLogin={() => setLoginOpen(true)}
      />

      {view === 'chat' && (
        <main className="stage">
          <div className="scroll" ref={scrollRef}>
            <div className="thread">
              {messages.length === 0 && (
                <EmptyState
                  specialties={availableSpecs}
                  specialty={specialty}
                  onPick={setSpecialty}
                  suggestions={D.SUGGESTIONS}
                  onAsk={ask}
                />
              )}
              {messages.map((m) => {
                if (m.kind === 'user') return <UserMessage key={m.id} msg={m} canEdit={!!user && !streaming} onEdit={editMessage} />;
                if (m.kind === 'ai') return <AssistantMessage key={m.id} msg={m} specialty={specObj} streamSpeed={t.streamSpeed} onDone={onAnswerDone} />;
                return <AdCard key={m.id} ad={m.ad} format={t.adFormat === 'banner' ? 'banner' : 'card'} />;
              })}
            </div>
          </div>
          {subscriber && expiringSoon && (
            <div className="chat-warnwrap">
              <div className="warnbar">
                <Icon name="info" size={16} />
                <span>A sua subscrição termina em <strong>5 dias</strong>. Renove para manter o acesso sem limite diário e sem publicidade.</span>
                <button className="btn btn--primary btn--xs" onClick={() => setView('subscription')}>Renovar</button>
              </div>
            </div>
          )}
          <QueueList
            queue={queue}
            onRemove={(id) => setQueue((q) => q.filter((x) => x.id !== id))}
            onMove={(i, dir) => setQueue((q) => {
              const j = i + dir;
              if (j < 0 || j >= q.length) return q;
              const next = q.slice();
              [next[i], next[j]] = [next[j], next[i]];
              return next;
            })}
          />
          <PromptBar
            specialties={availableSpecs}
            specialty={specialty}
            onSpecialty={(id) => { setSpecialty(id); if (messages.length) { setMessages([]); setQueue([]); setActiveConvId(null); } }}
            onSend={ask}
            disabled={quotaFull}
            disabledReason={disabledReason}
            streaming={streaming}
            queueCount={queue.length}
          />
        </main>
      )}

      {view === 'admin' && (
        <main className="stage">
          <AdminArea onExit={() => setView('chat')} user={user} onLogin={() => setLoginOpen(true)} companies={companies} specs={specs} setSpecs={setSpecs} />
        </main>
      )}

      {view === 'company' && (
        <main className="stage stage--page">
          <CompanyAdminArea
            user={user}
            membership={isCompanyAdmin ? activeMembership : null}
            specs={specs}
            onUpdateSpec={updateSpec}
            onExit={() => setView('chat')}
            onLogin={() => setLoginOpen(true)}
          />
        </main>
      )}

      {view === 'profile' && (
        <main className="stage stage--page">
          <ProfilePage
            user={user}
            subscriber={subscriber}
            company={company}
            memberships={memberships}
            activeCompanyId={activeCompanyId}
            onBack={() => setView('chat')}
            onUpdateUser={(p) => setUser((u) => ({ ...u, ...p, initials: ((p.name && p.name.trim()) || u.contact).charAt(0).toUpperCase() }))}
            onGoSubscription={() => setView('subscription')}
            onLogin={() => setLoginOpen(true)}
            onLogout={logout}
          />
        </main>
      )}

      {view === 'subscription' && (
        <main className="stage stage--page">
          <SubscriptionPage
            user={user}
            subscriber={subscriber}
            company={company}
            expiringSoon={expiringSoon}
            onSubscribe={() => setSubscriber(true)}
            onActivateCompany={activateCompany}
            onUpdateCompany={(p) => setCompany((c) => ({ ...c, ...p }))}
            onCancelCompany={cancelCompany}
            onCancel={() => { setSubscriber(false); setExpiringSoon(false); }}
            onToggleExpiring={() => setExpiringSoon((x) => !x)}
            onBack={() => setView('chat')}
            onLogin={() => setLoginOpen(true)}
          />
        </main>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        user={user}
        history={history}
        specialties={D.SPECIALTIES}
        memberships={memberships}
        activeCompanyId={activeCompanyId}
        onSelectCompany={selectCompany}
        activeConvId={activeConvId}
        onNew={newConversation}
        onResume={resumeConversation}
        onDelete={deleteConversation}
        onLogin={() => { setDrawerOpen(false); setLoginOpen(true); }}
        onLogout={logout}
        onGoSubscription={() => { setView('subscription'); setDrawerOpen(false); }}
        onGoProfile={() => { setView('profile'); setDrawerOpen(false); }}
        onGoAdmin={() => { setView('admin'); setDrawerOpen(false); }}
        onGoCompany={() => { setView('company'); setDrawerOpen(false); }}
      />

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={onLoginSuccess} />

      <TweaksPanel>
        <TweakSection label="Tema" />
        <TweakToggle label="Modo escuro" value={t.dark} onChange={(v) => setTweak('dark', v)} />
        <TweakRadio label="Amarelo" value={t.yellow} options={['subtil', 'moderado', 'forte']} onChange={(v) => setTweak('yellow', v)} />
        <TweakSection label="Conversa" />
        <TweakRadio label="Publicidade" value={t.adFormat} options={['cartão', 'banner']} onChange={(v) => setTweak('adFormat', v)} />
        <TweakSlider label="Streaming" value={t.streamSpeed} min={20} max={200} unit=" cps" onChange={(v) => setTweak('streamSpeed', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
