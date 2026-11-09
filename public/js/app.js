/* =====================================================================
 * App de Autoavaliacao CoE Zeev - telas (SPA com rotas por #)
 * ===================================================================== */
(function () {
  'use strict';
  var E = window.CoeEval;
  var S = { me: null, draft: null, lastFiles: null };
  var $app = document.getElementById('app');

  /* ------------------------------ utilitarios ------------------------------ */
  function h(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function on(sel, ev, fn) { var el = $(sel); if (el) el.addEventListener(ev, fn); }
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('on'); }, 4200);
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function dataBR(iso, comHora) {
    if (!iso) return '';
    var d = new Date(iso);
    var s = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return comHora ? s + ' ' + d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : s;
  }
  function iniciais(n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase(); }
  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      if (opts.raw) { init.body = opts.body; init.headers['content-type'] = opts.type; }
      else { init.body = JSON.stringify(opts.body); init.headers['content-type'] = 'application/json'; }
    }
    // tempo limite: sem resposta do servidor, a tela avisa em vez de ficar parada
    var limite = opts.timeout || 30000, ctl = new AbortController(), tm = setTimeout(function () { ctl.abort(); }, limite);
    init.signal = ctl.signal;
    var r;
    try { r = await fetch(path, init); }
    catch (e) {
      var er = new Error(e.name === 'AbortError'
        ? 'O servidor não respondeu em ' + Math.round(limite / 1000) + ' segundos.'
        : 'Não foi possível comunicar com o servidor. Verifique sua conexão com a internet.');
      er.rede = true; throw er;
    } finally { clearTimeout(tm); }
    var j = null;
    try { j = await r.json(); } catch (e) { j = {}; }
    if (r.status === 401 && !opts.allow401) { S.me = null; go('#/login'); throw new Error(j.error || 'Sessão expirada.'); }
    if (!r.ok) { var err = new Error(j.error || (r.status >= 500 ? 'O servidor teve um erro interno (' + r.status + ').' : 'Erro ' + r.status)); err.status = r.status; err.data = j; throw err; }
    return j;
  }
  // Janela de andamento que bloqueia a tela durante operacoes demoradas
  var Esp = null;
  function espera(titulo) {
    fecharEspera();
    var d = document.createElement('div');
    d.className = 'espera'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', titulo);
    d.innerHTML = '<div class="espera-card"><h2>' + h(titulo) + '</h2><ol class="esp-passos" aria-live="polite"></ol><p class="esp-dica small muted"></p><div class="row end esp-acoes"></div></div>';
    document.body.appendChild(d);
    Esp = { el: d, passos: [], ini: Date.now() };
    Esp.tick = setInterval(function () {
      if (!Esp) return;
      var atual = Esp.passos.filter(function (p) { return p.cls === 'run'; })[0];
      if (!atual) return;
      var seg = Math.round((Date.now() - atual.ini) / 1000);
      var t = Esp.el.querySelector('[data-p="' + Esp.passos.indexOf(atual) + '"] .esp-t'); if (t) t.textContent = seg + ' s';
      var dica = Esp.el.querySelector('.esp-dica');
      dica.textContent = seg >= (atual.lento || 45) ? 'Está demorando mais que o normal. Aguarde: se o servidor não responder, aparece um aviso aqui.' : '';
    }, 1000);
    window.addEventListener('beforeunload', avisoSaida);
    return {
      passo: function (txt, lento) { Esp.passos.push({ txt: txt, cls: 'run', ini: Date.now(), lento: lento }); desenharEspera(); return Esp.passos.length - 1; },
      ok: function (i, txt) { var p = Esp.passos[i]; p.cls = 'done'; if (txt) p.txt = txt; desenharEspera(); },
      falha: function (i, txt) { var p = Esp.passos[i]; p.cls = 'err'; if (txt) p.txt = txt; desenharEspera(); },
      aviso: function (i, txt) { var p = Esp.passos[i]; p.cls = 'warn'; if (txt) p.txt = txt; desenharEspera(); }
    };
  }
  function desenharEspera() {
    Esp.el.querySelector('.esp-passos').innerHTML = Esp.passos.map(function (p, i) {
      return '<li class="' + p.cls + '" data-p="' + i + '"><span class="esp-i">' + (p.cls === 'run' ? '<i class="spin"></i>' : p.cls === 'done' ? '✓' : p.cls === 'warn' ? '!' : '×') + '</span><span>' + h(p.txt) + '</span>' + (p.cls === 'run' ? '<span class="esp-t">0 s</span>' : '') + '</li>';
    }).join('');
  }
  // Mostra o problema na propria janela, com botoes de acao (ex.: tentar de novo)
  function problemaEspera(msg, botoes) {
    if (!Esp) return;
    Esp.passos.forEach(function (p) { if (p.cls === 'run') p.cls = 'err'; });
    desenharEspera();
    var card = Esp.el.querySelector('.espera-card');
    card.classList.add('com-erro');
    Esp.el.querySelector('.esp-dica').innerHTML = '<span class="esp-erro"><b>Ocorreu um problema.</b> ' + h(msg) + '</span>';
    var ac = Esp.el.querySelector('.esp-acoes'); ac.innerHTML = '';
    (botoes || [{ txt: 'Fechar', fn: fecharEspera }]).forEach(function (b, i) {
      var bt = document.createElement('button'); bt.className = 'btn' + (i === 0 ? ' primary' : ''); bt.textContent = b.txt;
      bt.addEventListener('click', b.fn); ac.appendChild(bt);
    });
    ac.querySelector('button').focus();
  }
  function fecharEspera() {
    if (!Esp) return;
    clearInterval(Esp.tick); Esp.el.remove(); Esp = null;
    window.removeEventListener('beforeunload', avisoSaida);
  }
  function avisoSaida(e) { e.preventDefault(); e.returnValue = ''; }
  // Operacao simples com janela de espera (enviar, registrar decisao, excluir)
  async function comEspera(titulo, txt, fn) {
    var w = espera(titulo), i = w.passo(txt, 20);
    try { var r = await fn(); fecharEspera(); return r; }
    catch (e) {
      // erro de validacao (4xx) volta para a tela; falha de comunicacao ou do servidor fica na janela
      if (e.status && e.status < 500) { fecharEspera(); throw e; }
      w.falha(i); problemaEspera(e.message + ' Nada foi gravado: tente de novo em instantes.'); throw e;
    }
  }
  // Aviso fixo quando o computador perde a conexao
  window.addEventListener('offline', function () {
    var b = document.getElementById('offline') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'offline', role: 'alert' }));
    b.textContent = 'Sem conexão com a internet. O app não consegue falar com o servidor até a conexão voltar.';
  });
  window.addEventListener('online', function () { var b = document.getElementById('offline'); if (b) b.remove(); toast('Conexão restabelecida.'); });

  function readText(file) {
    return file.arrayBuffer().then(function (buf) {
      var t = new TextDecoder('utf-8').decode(buf);
      if (t.indexOf('�') >= 0) t = new TextDecoder('iso-8859-1').decode(buf);
      return t;
    });
  }
  var scriptsCarregados = {};
  function loadScript(src) {
    if (!scriptsCarregados[src]) scriptsCarregados[src] = new Promise(function (ok, ko) {
      var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { ko(new Error('Falha ao carregar ' + src)); };
      document.head.appendChild(s);
    });
    return scriptsCarregados[src];
  }
  function blobToDataUrl(b) { return new Promise(function (ok) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.readAsDataURL(b); }); }
  function baixar(blob, nome) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function slug(s) { return E.key(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'relatorio'; }

  var STATUS = { conforme: 'Conforme', aberto: 'Aberto', confirmar: 'Confirmar', confirmado: 'Confirmado', liberado: 'Liberado p/ homologação',
    verificar: 'A verificar', na: 'Não se aplica' };
  function st(s, label) { return '<span class="st st-' + h(s) + '">' + h(label || STATUS[s] || s) + '</span>'; }
  // Recomendado em aberto nao bloqueia: aparece como melhoria sugerida
  function rotulo(i) { return i.status === 'aberto' && i.sev === 'R' ? 'Melhoria sugerida' : (STATUS[i.status] || i.status); }
  function stItem(i) { return i.status === 'aberto' && i.sev === 'R' ? st('melhoria', 'Melhoria sugerida') : st(i.status); }
  var COE_ST = { rascunho: 'Não enviada ao CoE', enviado: 'Aguardando CoE', em_analise: 'Em análise pelo CoE', aprovado: 'Aprovado pelo CoE', aprovado_ressalva: 'Aprovado com ressalva', devolvido: 'Devolvido para correção' };
  var DEC_ITEM = { aceito: 'Justificativa aceita', ressalva: 'Aceito com ressalva', nao_aceito: 'Não aceito' };
  function stCoe(s) { return st('coe-' + (s || 'rascunho'), COE_ST[s || 'rascunho']); }
  function aguardandoCoe(s) { return s === 'enviado' || s === 'em_analise'; }
  // Barra de progresso da rodada no CoE: autoavaliacao > enviado > em analise > decisao
  function progressoCoe(ev) {
    var s = ev.coe_status || 'rascunho', op = ev.coe_opinion;
    var decidido = ['aprovado', 'aprovado_ressalva', 'devolvido'].indexOf(s) >= 0;
    var nivel = decidido ? 4 : s === 'em_analise' ? 3 : s === 'enviado' ? 2 : 1;
    var etapas = [
      ['Autoavaliação', dataBR(ev.created_at, true)],
      ['Enviado ao CoE', ev.submitted_at ? dataBR(ev.submitted_at, true) : 'pendente'],
      ['Em análise pelo CoE', ev.review_started_at ? dataBR(ev.review_started_at, true) + (ev.revisor ? ' · ' + ev.revisor : '') : nivel >= 3 ? '' : 'aguardando'],
      [decidido ? COE_ST[s] : 'Decisão do CoE', decidido && op ? dataBR(op.em, true) + ' · ' + op.por : 'aguardando']
    ];
    var cor = s === 'devolvido' ? 'bad' : s === 'aprovado_ressalva' ? 'warn' : 'ok';
    var pct = [0, 0, 34, 67, 100][nivel];
    return '<section class="card progresso" aria-label="Andamento no CoE"><div class="pg-trilho"><i class="pg-' + (decidido ? cor : 'and') + '" style="width:' + pct + '%"></i></div>' +
      '<ol class="pg-etapas">' + etapas.map(function (e, i) {
        var n = i + 1, est = n < nivel || (n === nivel && (decidido || n === 1)) ? 'feito' : n === nivel ? 'atual' : 'futuro';
        if (n === 4 && decidido) est += ' ' + cor;
        return '<li class="' + est + '"' + (n === nivel ? ' aria-current="step"' : '') + '><span class="pg-ponto">' + (est.indexOf('feito') === 0 ? '✓' : n) + '</span><b>' + h(e[0]) + '</b><small>' + h(e[1]) + '</small></li>';
      }).join('') + '</ol></section>';
  }
  // Mensagem em janela (enviado ao CoE, decisao do CoE)
  function mensagem(titulo, corpoHtml, classe, botao) {
    return new Promise(function (ok) {
      var d = document.createElement('dialog');
      d.className = 'msg ' + (classe || '');
      d.innerHTML = '<h2>' + h(titulo) + '</h2><div class="msg-corpo">' + corpoHtml + '</div><div class="row end"><button class="btn primary" value="ok">' + h(botao || 'Entendi') + '</button></div>';
      document.body.appendChild(d);
      d.querySelector('button').addEventListener('click', function () { d.close(); });
      d.addEventListener('close', function () { d.remove(); ok(); });
      d.showModal();
    });
  }
  // Pendencia que impede o envio sem justificativa (mesma regra do servidor)
  function exigeJust(i) { return (i.status === 'aberto' && i.sev === 'B') || i.status === 'confirmar'; }
  var MIN_JUST = 15;
  var ORDEM = { aberto: 1, confirmar: 2, verificar: 3, liberado: 4, confirmado: 5, conforme: 6, na: 7 };

  /* ------------------------------ estrutura ------------------------------ */
  function layout(ativo, conteudo) {
    var me = S.me, u = me.uso, lim = me.limites;
    var pct = lim.ativo && lim.porAnalista ? Math.min(100, Math.round(u.meu / lim.porAnalista * 100)) : 0;
    function item(href, txt) { return '<a href="' + href + '" class="' + (ativo === href ? 'active' : '') + '">' + txt + '</a>'; }
    var admin = me.user.role === 'admin';
    return '<div class="shell"><aside class="side">' +
      '<div class="brand"><div class="brand-mark">CoE</div><div><b>Autoavaliação Zeev</b><small>Padrões CoE Vitru</small></div></div>' +
      '<nav class="nav" aria-label="Menu principal"><span class="nav-title">Analista</span>' +
      item('#/nova', 'Nova autoavaliação') + item('#/historico', 'Minhas autoavaliações' + (me.novidades && me.novidades.length ? ' <span class="badge">' + me.novidades.length + '</span>' : '')) +
      (admin ? '<span class="nav-title sep">Administração CoE</span>' +
        item('#/admin/avaliacoes', 'Avaliações recebidas' + (me.pendentesCoe ? ' <span class="badge">' + me.pendentesCoe + '</span>' : '')) +
        item('#/admin/padroes', 'Padrões do manual') + item('#/admin/orientacoes', 'Orientações à IA') +
        item('#/admin/conferencias', 'Conferências automáticas') + item('#/admin/relatorios', 'Relatórios') + item('#/admin/uso', 'IA, uso e limites') : '') +
      '</nav><div class="side-foot">' +
      '<div class="quota"><small>Análises com IA hoje</small><b>' + (lim.ativo ? u.meu + ' de ' + lim.porAnalista + ' usadas' : u.meu + ' (sem limite)') + '</b>' +
      (lim.ativo ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '<small>Renova à meia-noite</small></div>' +
      '<div class="me"><div class="avatar">' + h(iniciais(me.user.name)) + '</div><div><b>' + h(me.user.name) + '</b><small>' + (admin ? 'Admin CoE' : 'Analista') + '</small></div>' +
      '<button type="button" id="sair">Sair</button></div></div></aside>' +
      '<main class="main"><div class="wrap">' + avisoNovidades(ativo) + conteudo + '</div></main></div>';
  }
  // Aviso de decisao do CoE ainda nao vista (some quando o analista abre a rodada)
  function avisoNovidades(ativo) {
    var nv = S.me.novidades || [];
    if (!nv.length || /^#\/resultado/.test(location.hash)) return '';
    return '<div class="banner info aviso-coe" role="status"><div><b>O CoE concluiu a análise de ' + (nv.length === 1 ? 'uma autoavaliação sua' : nv.length + ' autoavaliações suas') + '</b>' +
      nv.map(function (n) { return '<a href="#/resultado/' + n.id + '">' + h(n.process_name) + ' · rodada ' + n.round + '</a>: ' + h(COE_ST[n.coe_status]); }).join('<br>') + '</div></div>';
  }
  function bindLayout() {
    on('#sair', 'click', async function () { await api('/api/logout', { method: 'POST', body: {} }).catch(function () {}); S.me = null; go('#/login'); });
  }
  async function carregarMe() { S.me = await api('/api/me'); return S.me; }

  /* ------------------------------ roteador ------------------------------ */
  var rotas = [
    [/^#\/login$/, viewLogin, null], [/^#\/setup$/, viewSetup, null], [/^#\/convite\/(.+)$/, viewConvite, null],
    [/^#\/nova$/, viewNova, 'user'], [/^#\/historico$/, viewHistorico, 'user'], [/^#\/resultado\/(\d+)$/, viewResultado, 'user'],
    [/^#\/admin\/padroes$/, viewPadroes, 'admin'], [/^#\/admin\/revisao$/, viewRevisao, 'admin'], [/^#\/admin\/conferencias$/, viewConferencias, 'admin'],
    [/^#\/admin\/relatorios$/, viewRelatorios, 'admin'], [/^#\/admin\/uso$/, viewUso, 'admin'],
    [/^#\/admin\/avaliacoes$/, viewAvaliacoes, 'admin'], [/^#\/admin\/orientacoes$/, viewOrientacoes, 'admin']
  ];
  async function render() {
    var hash = location.hash || '#/nova';
    for (var i = 0; i < rotas.length; i++) {
      var m = rotas[i][0].exec(hash);
      if (!m) continue;
      try {
        if (rotas[i][2]) {
          try { await carregarMe(); } catch (e) { if (!S.me) return; }
          if (rotas[i][2] === 'admin' && S.me.user.role !== 'admin') { go('#/nova'); return; }
        }
        await rotas[i][1](m[1]);
        window.scrollTo(0, 0);
      } catch (e) {
        if (e.status === 401) return;
        $app.innerHTML = S.me ? layout('', '<div class="banner bad"><div><b>Não foi possível abrir a tela</b>' + h(e.message) + '</div></div>') : '<div class="loading">' + h(e.message) + '</div>';
        if (S.me) bindLayout();
      }
      return;
    }
    go('#/nova');
  }
  window.addEventListener('hashchange', render);

  /* ------------------------------ login e acesso ------------------------------ */
  function authBox(conteudo) {
    return '<div class="auth"><div class="box"><div class="brand"><div class="brand-mark">CoE</div><div><b style="font-size:18px">Autoavaliação Zeev</b>' +
      '<small style="color:var(--muted);font-size:13px">Centro de Excelência · Vitru Educação</small></div></div>' + conteudo + '</div></div>';
  }
  async function viewLogin() {
    var st0 = await api('/api/setup', { allow401: true }).catch(function () { return {}; });
    if (st0.needsSetup) { go('#/setup'); return; }
    $app.innerHTML = authBox('<div><h1 style="font-size:22px">Entrar</h1><p class="lead" style="margin-top:8px">Valide seu fluxo com os padrões do CoE antes de enviá-lo para avaliação.</p></div>' +
      '<form id="f" style="display:flex;flex-direction:column;gap:14px"><label class="f">E-mail corporativo<input type="email" id="email" required autocomplete="username" placeholder="nome.sobrenome@vitru.com.br"></label>' +
      '<label class="f">Senha<input type="password" id="senha" required autocomplete="current-password"></label><div class="err-msg" id="err"></div>' +
      '<button class="btn dark" type="submit">Entrar</button></form>' +
      '<div class="foot"><span><b>Primeiro acesso?</b> Use o link de convite enviado pelo administrador do CoE.</span><span><b>Esqueceu a senha?</b> Peça um novo link ao administrador.</span></div>');
    on('#f', 'submit', async function (ev) {
      ev.preventDefault();
      try { await api('/api/login', { method: 'POST', body: { email: $('#email').value, password: $('#senha').value }, allow401: true }); await carregarMe(); go('#/nova'); }
      catch (e) { $('#err').textContent = e.message; }
    });
  }
  async function viewSetup() {
    var st0 = await api('/api/setup', { allow401: true });
    if (!st0.needsSetup) { go('#/login'); return; }
    $app.innerHTML = authBox('<div><h1 style="font-size:22px">Configuração inicial</h1><p class="lead" style="margin-top:8px">Crie o primeiro administrador. Esta tela se desativa depois disso.</p></div>' +
      '<form id="f" style="display:flex;flex-direction:column;gap:14px"><label class="f">BOOTSTRAP_TOKEN<input type="password" id="tok" required></label>' +
      '<label class="f">Seu nome<input type="text" id="nome" required></label><label class="f">Seu e-mail<input type="email" id="email" required placeholder="nome@vitru.com.br"></label>' +
      '<label class="f">Senha<input type="password" id="senha" required autocomplete="new-password"><small>Mínimo de 10 caracteres, com letras e números.</small></label>' +
      '<div class="err-msg" id="err"></div><button class="btn dark" type="submit">Criar administrador</button></form>');
    on('#f', 'submit', async function (ev) {
      ev.preventDefault();
      try {
        await api('/api/setup', { method: 'POST', body: { token: $('#tok').value, name: $('#nome').value, email: $('#email').value, password: $('#senha').value }, allow401: true });
        await carregarMe(); toast('Administrador criado. Publique o manual em Padrões do manual.'); go('#/admin/padroes');
      } catch (e) { $('#err').textContent = e.message; }
    });
  }
  async function viewConvite(token) {
    var inv;
    try { inv = await api('/api/invite/' + encodeURIComponent(token), { allow401: true }); }
    catch (e) { $app.innerHTML = authBox('<div class="banner bad"><div><b>Link inválido</b>' + h(e.message) + '</div></div><a class="btn" href="#/login">Ir para o login</a>'); return; }
    $app.innerHTML = authBox('<div><h1 style="font-size:22px">Criar sua senha</h1><p class="lead" style="margin-top:8px">Convite para <b>' + h(inv.name) + '</b> · ' + h(inv.email) +
      '. O link vale até ' + h(dataBR(inv.expires_at, true)) + ' e só pode ser usado uma vez.</p></div>' +
      '<form id="f" style="display:flex;flex-direction:column;gap:14px"><label class="f">Nova senha<input type="password" id="s1" required autocomplete="new-password"></label>' +
      '<label class="f">Confirmar senha<input type="password" id="s2" required autocomplete="new-password"></label>' +
      '<ul class="small muted" style="margin:0;padding-left:18px;line-height:1.6"><li>Mínimo de 10 caracteres</li><li>Pelo menos uma letra e um número</li></ul>' +
      '<div class="err-msg" id="err"></div><button class="btn dark" type="submit">Criar senha e entrar</button></form>');
    on('#f', 'submit', async function (ev) {
      ev.preventDefault();
      if ($('#s1').value !== $('#s2').value) { $('#err').textContent = 'As senhas não são iguais.'; return; }
      try { await api('/api/invite/' + encodeURIComponent(token), { method: 'POST', body: { password: $('#s1').value }, allow401: true }); await carregarMe(); go('#/nova'); }
      catch (e) { $('#err').textContent = e.message; }
    });
  }

  /* ------------------------------ nova autoavaliacao ------------------------------ */
  async function viewNova() {
    await carregarMe();
    var me = S.me, lim = me.limites, restam = lim.ativo ? Math.max(0, lim.porAnalista - me.uso.meu) : null;
    var semManual = !me.manual;
    var ult = S.lastFiles || {};
    $app.innerHTML = layout('#/nova',
      '<div class="head"><div><h1>Nova autoavaliação</h1><p class="lead">Envie os arquivos do processo antes de submeter ao CoE. As conferências automáticas rodam no seu navegador; a IA analisa os itens de julgamento.</p></div>' +
      (me.manual ? '<span class="tag" style="padding:8px 12px;border-radius:999px">Manual de Padrões Zeev v' + h(me.manual.version) + ' · vigente desde ' + h(dataBR(me.manual.effective_date + 'T12:00:00Z')) + '</span>' : '') + '</div>' +
      (semManual ? '<div class="note warn">Nenhuma versão do manual foi publicada ainda. As conferências automáticas funcionam, mas a análise por IA e o checklist dependem do manual' +
        (me.user.role === 'admin' ? ' (publique em <a href="#/admin/padroes">Padrões do manual</a>).' : '; avise o CoE.') + '</div>' : '') +
      '<section class="card"><h2>1. Identificação do processo</h2><div class="grid g4">' +
      '<label class="f">Nome do processo <input type="text" id="proc" required value="' + h(ult.proc || '') + '"></label>' +
      '<label class="f">Código do aplicativo Zeev<input type="text" id="appcode" value="' + h(ult.app || '') + '"></label>' +
      '<label class="f">Versão do fluxo<input type="text" id="ver" value="' + h(ult.ver || '') + '"></label>' +
      '<label class="f">Área dona<input type="text" id="area" value="' + h(ult.area || '') + '"></label></div></section>' +
      '<section class="card"><div class="card-head"><h2>2. Arquivos do processo</h2><span class="small muted">Os arquivos são lidos no navegador; só o resultado fica salvo.</span></div>' +
      fileRow('fxls', 'Export de configuração da Zeev (.xls)', true, '.xls,.xml', false) +
      fileRow('fdia', 'Diagrama (.svg) ou caderno de mapeamento (.json)', true, '.svg,.json,.bpmn', false) +
      fileRow('fjs', 'Scripts do formulário (.js)', false, '.js', true) +
      fileRow('fcss', 'Estilos (.css)', false, '.css', true) +
      '<div class="note info">Prints de evidência (tempo dos temporizadores, destinatários, botões, publicação) são anexados no resultado, em cada item do checklist.</div></section>' +
      '<section class="card"><h2>3. Como a avaliação é feita</h2><div class="steps">' +
      '<div class="step"><small>ETAPA 1 · SEM IA</small><b>Conferências automáticas</b><span>' + E.CHECKS.length + ' verificações exatas no navegador: acentos nos scripts, histórico, tipos de campo, marcos, nomes, SLA e e-mails.</span></div>' +
      '<div class="step"><small>ETAPA 2 · IA</small><b>Itens de julgamento</b><span>Nomenclatura, anotações e riscos. Envia só nomes, campos e anotações, com IDs mascarados.</span></div>' +
      '<div class="step"><small>ETAPA 3 · VOCÊ</small><b>Checklist de confirmação</b><span>Itens que nenhum arquivo comprova: você confirma ou anexa o print.</span></div></div>' +
      '<label class="check note warn" style="font-size:14px"><input type="checkbox" id="ia"' + (restam === 0 || semManual ? ' disabled' : ' checked') + '>Incluir análise por IA ' +
      '<span class="muted">' + (semManual ? '(indisponível sem manual publicado)' : restam === null ? '(sem limite diário)' : '(consome 1 das suas ' + lim.porAnalista + ' análises de hoje · restam ' + restam + ')') + '</span></label></section>' +
      '<div id="prog" class="card" style="display:none"></div>' +
      '<div class="row end"><button class="btn primary" type="button" id="rodar">Rodar autoavaliação</button></div>');
    bindLayout();
    ['fxls', 'fdia', 'fjs', 'fcss'].forEach(function (id) {
      on('#' + id, 'change', function (ev) {
        var row = ev.target.closest('.file-row'), fs = ev.target.files;
        row.classList.toggle('done', fs.length > 0);
        row.querySelector('span').textContent = fs.length ? Array.prototype.map.call(fs, function (f) { return f.name; }).join(' · ') : row.getAttribute('data-hint');
      });
    });
    on('#rodar', 'click', rodarAvaliacao);
  }
  function fileRow(id, titulo, obrig, accept, multi) {
    var hint = obrig ? 'Obrigatório' : 'Opcional';
    return '<div class="file-row" data-hint="' + hint + '"><div><b>' + titulo + (obrig ? ' <span class="req">*</span>' : '') + '</b><span>' + hint + '</span></div>' +
      '<label class="sr" for="' + id + '">' + titulo + '</label><input type="file" id="' + id + '" accept="' + accept + '"' + (multi ? ' multiple' : '') + '></div>';
  }
  async function rodarAvaliacao() {
    var proc = $('#proc').value.trim();
    var fx = $('#fxls').files, fd = $('#fdia').files;
    if (!proc) { toast('Informe o nome do processo.'); $('#proc').focus(); return; }
    if (!fx.length || !fd.length) { toast('Envie o export .xls e o diagrama.'); return; }
    S.lastFiles = { proc: proc, app: $('#appcode').value.trim(), ver: $('#ver').value.trim(), area: $('#area').value.trim() };
    var usarIA = $('#ia').checked;
    var btn = $('#rodar'); btn.disabled = true;
    var w = espera('Rodando a autoavaliação'), pAtual = -1, payload = null;
    function liberar() { btn.disabled = false; }
    async function salvar() {
      var ps = w.passo('Gravando a rodada no servidor', 30); pAtual = ps;
      var salvo = await api('/api/evaluations', { method: 'POST', body: payload, timeout: 45000 });
      w.ok(ps, 'Rodada ' + salvo.round + ' gravada');
      fecharEspera();
      go('#/resultado/' + salvo.id);
    }
    function erroSalvar(e) {
      // o resultado ja calculado (inclusive da IA) fica guardado: so a gravacao e repetida
      problemaEspera('A rodada não foi gravada: ' + e.message + ' O resultado da análise está guardado nesta tela.', [
        { txt: 'Tentar gravar de novo', fn: function () { problemaReset(); salvar().catch(erroSalvar); } },
        { txt: 'Cancelar', fn: function () { fecharEspera(); liberar(); } }
      ]);
    }
    function problemaReset() {
      Esp.el.querySelector('.espera-card').classList.remove('com-erro');
      Esp.el.querySelector('.esp-dica').textContent = ''; Esp.el.querySelector('.esp-acoes').innerHTML = '';
    }
    try {
      var p1 = w.passo('Lendo os arquivos'); pAtual = p1;
      var todos = [].concat(Array.from(fx), Array.from(fd), Array.from($('#fjs').files), Array.from($('#fcss').files));
      var files = await Promise.all(todos.map(async function (f) { return { name: f.name, text: await readText(f) }; }));
      var P = E.parseFiles(files, { processName: proc });
      if (P.notes.length) throw new Error(P.notes.join(' | '));
      if (!P.xls) throw new Error('Não reconheci o export .xls da Zeev.');
      var resumo = E.summary(P);
      w.ok(p1, 'Arquivos lidos: ' + [resumo.xls, resumo.diagram].filter(Boolean).join(' · '));
      var p2 = w.passo('Buscando padrões e conferências no servidor', 20); pAtual = p2;
      var dados = await Promise.all([api('/api/checks'), api('/api/manual'), api('/api/orientacoes')]);
      var auto = E.runChecks(P, dados[0].checks);
      var manual = dados[1].vigente;
      var rules = manual ? manual.rules : [];
      w.ok(p2, E.CHECKS.length + ' conferências automáticas concluídas');
      var resposta = null, modelo = '', avisoIA = '';
      var autoRules = {}; auto.forEach(function (a) { autoRules[a.rule] = 1; });
      var regrasIA = rules.filter(function (r) { return r.aval === 'ia' && !autoRules[r.code]; });
      if (usarIA && regrasIA.length) {
        var p3 = w.passo('Analisando ' + regrasIA.length + ' regras com IA (costuma levar de 20 s a 2 min)', 90); pAtual = p3;
        try {
          var pr = E.aiPrompt(P, regrasIA, true, dados[2].orientacoes);
          var r = await api('/api/ai/evaluate', { method: 'POST', body: pr, timeout: 170000 });
          resposta = E.parseAiAnswer(r.texto); modelo = r.modelo; avisoIA = r.aviso;
          w.ok(p3, 'Análise por IA concluída (' + r.modelo + ')');
        } catch (e) {
          w.aviso(p3, 'IA indisponível: ' + e.message + ' Os itens de IA ficam como "A verificar".');
          avisoIA = 'A IA não respondeu nesta rodada (' + e.message + '). Os itens de IA ficaram como "A verificar"; rode de novo mais tarde para avaliá-los.';
        }
      }
      var items = E.buildItems(auto, rules, resposta, { iaBloqueia: S.me.iaBloqueia });
      payload = {
        process_name: proc, app_code: S.lastFiles.app, flow_version: S.lastFiles.ver, area: S.lastFiles.area,
        manual_version: manual ? manual.version : '', with_ai: !!resposta, model: modelo, items: items,
        risks: resposta ? resposta.riscos.slice(0, 6) : [], summary: Object.assign(resumo, { arquivos: files.map(function (f) { return f.name; }), avisoIA: avisoIA })
      };
    } catch (e) {
      problemaEspera(e.message + (e.rede ? ' Confira a conexão e rode de novo.' : ''), [{ txt: 'Fechar', fn: function () { fecharEspera(); liberar(); } }]);
      return;
    }
    salvar().catch(erroSalvar);
  }

  /* ------------------------------ resultado ------------------------------ */
  async function viewResultado(id) {
    await carregarMe();
    var ev = await api('/api/evaluations/' + id);
    var dono = ev.user_id === S.me.user.id;
    var admin = S.me.user.role === 'admin';
    // CoE abriu a rodada enviada: marca "Em analise" para o analista acompanhar
    if (admin && ev.coe_status === 'enviado') {
      try { await api('/api/evaluations/' + ev.id + '/start-review', { method: 'POST', body: {} }); ev.coe_status = 'em_analise'; ev.review_started_at = new Date().toISOString(); ev.revisor = S.me.user.name; } catch (e) { /* segue como enviado */ }
    }
    var decisaoNova = dono && ev.coe_opinion && !ev.analyst_seen_at;
    var editavel = dono && ev.coe_status === 'rascunho';
    var revisando = admin && ev.coe_status !== 'rascunho';
    var filtro = { sev: 'todos', status: 'pend', origem: '' };
    // decisoes do CoE em edicao: { idx: { decisao, instrucao, orientar, regras } }
    var rev = {};
    ev.items.forEach(function (i, n) { if (i.coe) rev[n] = { decisao: i.coe.decisao, instrucao: i.coe.instrucao || '', orientar: false, regras: i.rule }; });
    var revGeral = { decisao: ev.coe_opinion ? ev.coe_opinion.decisao : '', parecer: ev.coe_opinion ? ev.coe_opinion.parecer : '' };
    function pendentes() { return ev.items.filter(exigeJust); }
    function semJust() { return pendentes().filter(function (i) { return !i.just || i.just.trim().length < MIN_JUST; }); }
    function revisavel(i) { return !!i.just || ['aberto', 'confirmar', 'verificar', 'liberado'].indexOf(i.status) >= 0; }

    function bannerHtml(t) {
      var op = ev.coe_opinion;
      if (ev.coe_status === 'em_analise') return '<div class="banner info" role="status"><div><b>Em análise pelo CoE' + (ev.revisor ? ' · ' + h(ev.revisor) : '') + '</b>' +
        (admin ? 'Avalie as justificativas abaixo e registre a decisão no fim da página.' : 'O CoE está avaliando esta rodada. Você recebe um aviso aqui quando a decisão for registrada.') + '</div></div>';
      if (ev.coe_status === 'enviado') return '<div class="banner info" role="status"><div><b>Enviado ao CoE em ' + h(dataBR(ev.submitted_at, true)) + '</b>' +
        (admin ? 'Avalie as justificativas abaixo e registre a decisão no fim da página.' : 'Aguardando a avaliação do CoE. Esta rodada não pode mais ser alterada.') + '</div></div>';
      if (op) {
        var cls = op.decisao === 'aprovado' ? 'ok' : op.decisao === 'devolvido' ? 'bad' : 'warn';
        return '<div class="banner ' + cls + '" role="status"><div><b>' + h(COE_ST[op.decisao]) + ' · ' + h(op.por) + ' em ' + h(dataBR(op.em, true)) + '</b>' +
          (op.parecer ? '<span style="white-space:pre-wrap">' + h(op.parecer) + '</span>' : '') +
          (op.decisao === 'devolvido' && dono ? '<br>Corrija os itens não aceitos e envie uma nova rodada.' : '') + '</div></div>';
      }
      if (t.pronto) return '<div class="banner ok" role="status"><div><b>Pronto para o CoE</b>Nenhum bloqueante aberto e checklist confirmado. Envie ao CoE no fim da página.</div></div>';
      var p = pendentes().length, f = semJust().length;
      return '<div class="banner bad" role="status"><div><b>' + p + ' pendência(s) bloqueante(s): ' + t.bAbertos + ' bloqueante(s) aberto(s)' + (t.confirmar ? ' e ' + t.confirmar + ' item(ns) de checklist a confirmar' : '') + '</b>' +
        'Corrija e rode uma nova rodada, ou, se discordar do apontamento, escreva uma justificativa em cada pendência e envie ao CoE. ' +
        (p - f) + ' de ' + p + ' justificada(s). Melhorias sugeridas (recomendados) não impedem o envio.</div></div>';
    }
    function celulaItem(i, idx) {
      var prints = (i.prints || []).map(function (p) { return '<a href="/api/prints/' + encodeURIComponent(p.key) + '" target="_blank" rel="noopener">' + h(p.name) + '</a>'; }).join(' · ');
      var out = '<div>' + h(i.comment) + '</div>' + (i.fix ? '<div class="fix"><b>Como corrigir:</b> ' + h(i.fix) + '</div>' : '') +
        (prints ? '<div class="fix"><b>Prints:</b> ' + prints + '</div>' : '');
      if (editavel && (i.status === 'confirmar' || i.status === 'confirmado')) out += '<div class="acts">' +
        '<label class="btn sm">Anexar print<input type="file" accept="image/png,image/jpeg" data-print="' + idx + '" class="sr"></label>' +
        (i.status === 'confirmar' ? '<button class="btn sm dark" data-ok="' + idx + '">Confirmo que está configurado</button>' : '<button class="btn sm" data-undo="' + idx + '">Desfazer confirmação</button>') + '</div>';
      if (editavel && exigeJust(i)) {
        var ok = i.just && i.just.trim().length >= MIN_JUST;
        out += '<div class="just' + (ok ? ' ok' : '') + '" data-jbox="' + idx + '"><label class="f">Justificativa para o CoE <span class="tiny muted">(obrigatória para enviar sem corrigir · mín. ' + MIN_JUST + ' caracteres)</span>' +
          '<textarea rows="2" data-just="' + idx + '" placeholder="Por que este apontamento não se aplica ou como será tratado">' + h(i.just || '') + '</textarea></label></div>';
      } else if (i.just) {
        out += '<div class="just ok"><b>Justificativa do analista:</b> <span style="white-space:pre-wrap">' + h(i.just) + '</span></div>';
      }
      if (revisando && revisavel(i)) {
        var r = rev[idx] || {};
        out += '<div class="coe-box"><div class="row" style="gap:8px;align-items:center"><b class="small">Decisão do CoE</b>' +
          '<select data-rdec="' + idx + '" aria-label="Decisão do CoE"><option value="">' + (i.just ? 'Escolha…' : 'Sem decisão') + '</option>' +
          Object.keys(DEC_ITEM).map(function (k) { return '<option value="' + k + '"' + (r.decisao === k ? ' selected' : '') + '>' + DEC_ITEM[k] + '</option>'; }).join('') + '</select></div>' +
          '<textarea rows="2" data-rins="' + idx + '" placeholder="Instrução para o analista (ex.: ajustar antes de publicar, ou desconsiderar o apontamento)">' + h(r.instrucao || '') + '</textarea>' +
          '<label class="check tiny"><input type="checkbox" data-rori="' + idx + '"' + (r.orientar ? ' checked' : '') + '>Guardar esta instrução como orientação para a IA nas próximas análises (regra ' + h(i.rule) + ')</label></div>';
      } else if (i.coe) {
        out += '<div class="coe-box ro"><b class="small">' + h(DEC_ITEM[i.coe.decisao] || i.coe.decisao) + '</b>' + (i.coe.instrucao ? ' · <span style="white-space:pre-wrap">' + h(i.coe.instrucao) + '</span>' : '') +
          '<div class="tiny muted">' + h(i.coe.por) + ' · ' + h(dataBR(i.coe.em, true)) + '</div></div>';
      }
      return out;
    }
    function rodapeHtml(t) {
      if (editavel) {
        var falta = semJust();
        return '<div class="card" id="envio" style="flex-direction:row;flex-wrap:wrap;justify-content:space-between;align-items:center;padding:16px 18px"><span class="small muted" id="envio-msg">' +
          (t.pronto ? 'Tudo certo: envie ao CoE para avaliação.' : falta.length ? 'Falta justificar: ' + falta.map(function (i) { return h(i.id); }).join(', ') + '.' : 'Todas as pendências estão justificadas. O CoE vai avaliar cada justificativa.') + '</span>' +
          '<button class="btn primary" id="enviar"' + (falta.length ? ' disabled' : '') + '>' + (t.pronto ? 'Enviar ao CoE' : 'Enviar ao CoE com justificativas') + '</button></div>';
      }
      if (revisando) {
        return '<section class="card" id="revisao"><h2>Decisão do CoE</h2><div class="row" style="gap:18px">' +
          [['aprovado', 'Aprovado'], ['aprovado_ressalva', 'Aprovado com ressalva'], ['devolvido', 'Devolvido para correção']].map(function (x) {
            return '<label class="check"><input type="radio" name="rdg" value="' + x[0] + '"' + (revGeral.decisao === x[0] ? ' checked' : '') + '>' + x[1] + '</label>'; }).join('') + '</div>' +
          '<label class="f">Parecer do CoE (obrigatório para ressalva ou devolução)<textarea id="rpar" rows="4" placeholder="Resumo da avaliação e instruções gerais para o analista">' + h(revGeral.parecer) + '</textarea></label>' +
          '<div class="err-msg" id="rerr"></div><div class="row end"><button class="btn primary" id="rsalvar">Registrar decisão</button></div></section>';
      }
      return '';
    }
    function desenhar() {
      var t = E.totals(ev.items);
      var lista = ev.items.filter(function (i) {
        if (filtro.sev !== 'todos' && i.sev !== filtro.sev) return false;
        if (filtro.origem && i.origin !== filtro.origem) return false;
        if (filtro.status === 'abertos' && !(['aberto', 'confirmar', 'verificar'].indexOf(i.status) >= 0 || i.just)) return false;
        return true;
      }).sort(function (a, b) {
        if (filtro.status === 'pend' || filtro.status === 'abertos') {
          var pa = exigeJust(a) ? 0 : 1, pb = exigeJust(b) ? 0 : 1; if (pa !== pb) return pa - pb;
          var d = (ORDEM[a.status] || 9) - (ORDEM[b.status] || 9); if (d) return d;
        }
        return (a.sev === b.sev ? 0 : a.sev === 'B' ? -1 : 1);
      });
      var nB = ev.items.filter(function (i) { return i.sev === 'B'; }).length;
      $app.innerHTML = layout(revisando ? '#/admin/avaliacoes' : '#/historico',
        '<div class="head"><div><a class="back" href="' + (revisando ? '#/admin/avaliacoes">‹ Avaliações recebidas' : '#/historico">‹ Minhas autoavaliações') + '</a><h1>' + h(ev.process_name) + ' · rodada ' + ev.round + '</h1>' +
        '<p class="lead">' + [ev.app_code ? 'App ' + h(ev.app_code) : '', ev.flow_version ? 'versão ' + h(ev.flow_version) : '', h(dataBR(ev.created_at, true)),
          ev.manual_version ? 'Manual v' + h(ev.manual_version) : 'sem manual', ev.with_ai ? 'com IA (' + h(ev.model) + ')' : 'sem IA', dono ? '' : 'analista: ' + h(ev.analista)].filter(Boolean).join(' · ') + '</p><div>' + stCoe(ev.coe_status) + '</div></div>' +
        '<div class="row">' + (admin ? '<button class="btn danger" id="excluir">Excluir</button>' : '') + '<button class="btn" id="xls">Exportar Excel</button><button class="btn" id="pdf">Exportar PDF</button>' + (dono ? '<a class="btn primary" href="#/nova">Nova rodada</a>' : '') + '</div></div>' +
        (ev.coe_status !== 'rascunho' ? progressoCoe(ev) : '') +
        bannerHtml(t) +
        (ev.summary && ev.summary.avisoIA ? '<div class="note warn">' + h(ev.summary.avisoIA) + '</div>' : '') +
        '<div class="grid g4"><div class="tile"><span>Bloqueantes abertos</span><b style="color:var(--bad)">' + t.bAbertos + '</b><small>de ' + nB + ' avaliados</small></div>' +
        '<div class="tile"><span>Para confirmar</span><b style="color:var(--warn)">' + t.confirmar + '</b><small>print ou checklist</small></div>' +
        '<div class="tile"><span>Justificados</span><b style="color:var(--info)">' + ev.items.filter(function (i) { return i.just; }).length + '</b><small>de ' + pendentes().length + ' pendência(s)</small></div>' +
        '<div class="tile"><span>Melhorias sugeridas</span><b>' + t.rAbertos + '</b><small>recomendados, não bloqueiam</small></div></div>' +
        '<section class="card flush"><div class="row between" style="padding:16px 18px;border-bottom:1px solid var(--line)">' +
        '<div class="tabs" role="tablist">' + [['todos', 'Todos · ' + ev.items.length], ['B', 'Bloqueantes · ' + nB], ['R', 'Recomendados · ' + (ev.items.length - nB)]].map(function (x) {
          return '<button type="button" role="tab" data-sev="' + x[0] + '" class="' + (filtro.sev === x[0] ? 'on' : '') + '" aria-selected="' + (filtro.sev === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
        '<div class="row"><label class="f" style="flex-direction:row;align-items:center">Mostrar<select id="fst"><option value="pend">Pendências primeiro</option><option value="abertos">Só pendências</option><option value="todos">Todos, por severidade</option></select></label>' +
        '<label class="f" style="flex-direction:row;align-items:center">Origem<select id="for"><option value="">Todas</option><option>Automática</option><option>IA</option><option>Checklist</option></select></label></div></div>' +
        '<div class="tbl-wrap"><table class="tbl" style="min-width:880px"><thead><tr><th>#</th><th>Regra</th><th style="width:26%">Item avaliado</th><th>Origem</th><th>Status</th><th>O que foi encontrado e como corrigir</th></tr></thead><tbody>' +
        lista.map(function (i) {
          var idx = ev.items.indexOf(i);
          return '<tr><td><b>' + h(i.id) + '</b></td><td class="muted">' + h(i.rule) + ' <span class="tiny">(' + h(i.sev) + ')</span></td><td>' + h(i.item) + '</td>' +
            '<td><span class="tag">' + h(i.origin) + '</span></td><td>' + stItem(i) + '</td><td>' + celulaItem(i, idx) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="tbl-foot">Mostrando ' + lista.length + ' de ' + ev.items.length + ' itens</div></section>' +
        (ev.risks && ev.risks.length ? '<section class="card"><div class="row"><h2>Pontos para validar com a área</h2><span class="tag">IA</span></div><p class="small muted" style="margin:0">Sem regra no manual; não bloqueiam, mas o CoE vai perguntar.</p><ul style="margin:0;padding-left:20px;line-height:1.6">' +
          ev.risks.map(function (r) { return '<li>' + h(r) + '</li>'; }).join('') + '</ul></section>' : '') +
        rodapeHtml(t));
      bindLayout();
      $('#fst').value = filtro.status; $('#for').value = filtro.origem;
      $$('[data-sev]').forEach(function (b) { b.addEventListener('click', function () { filtro.sev = b.getAttribute('data-sev'); desenhar(); }); });
      on('#fst', 'change', function (e) { filtro.status = e.target.value; desenhar(); });
      on('#for', 'change', function (e) { filtro.origem = e.target.value; desenhar(); });
      $$('[data-ok]').forEach(function (b) { b.addEventListener('click', function () { mudar(+b.getAttribute('data-ok'), 'confirmado'); }); });
      $$('[data-undo]').forEach(function (b) { b.addEventListener('click', function () { mudar(+b.getAttribute('data-undo'), 'confirmar'); }); });
      $$('[data-print]').forEach(function (inp) { inp.addEventListener('change', function () { anexar(+inp.getAttribute('data-print'), inp.files[0]); }); });
      $$('[data-just]').forEach(function (ta) {
        var n = +ta.getAttribute('data-just');
        ta.addEventListener('input', function () { ev.items[n].just = ta.value; atualizarEnvio(n); });
        ta.addEventListener('change', function () { salvar().catch(function (e) { toast(e.message); }); });
      });
      $$('[data-rdec]').forEach(function (sel) { sel.addEventListener('change', function () { var n = +sel.getAttribute('data-rdec'); (rev[n] = rev[n] || { regras: ev.items[n].rule }).decisao = sel.value; sugerirGeral(); }); });
      $$('[data-rins]').forEach(function (ta) { ta.addEventListener('input', function () { var n = +ta.getAttribute('data-rins'); (rev[n] = rev[n] || { regras: ev.items[n].rule }).instrucao = ta.value; }); });
      $$('[data-rori]').forEach(function (cb) { cb.addEventListener('change', function () { var n = +cb.getAttribute('data-rori'); (rev[n] = rev[n] || { regras: ev.items[n].rule }).orientar = cb.checked; }); });
      $$('[name="rdg"]').forEach(function (r) { r.addEventListener('change', function () { revGeral.decisao = r.value; }); });
      on('#rpar', 'input', function (e) { revGeral.parecer = e.target.value; });
      on('#rsalvar', 'click', registrarDecisao);
      on('#enviar', 'click', enviar);
      on('#xls', 'click', function () { exportarAvaliacao(ev, 'xlsx'); });
      on('#excluir', 'click', async function () { if (await excluirAvaliacao(ev.id)) { await carregarMe(); go(revisando ? '#/admin/avaliacoes' : '#/historico'); } });
      on('#pdf', 'click', function () { exportarAvaliacao(ev, 'pdf'); });
    }
    // Atualiza so o contador e o botao, sem redesenhar (mantem o foco no campo)
    function atualizarEnvio(n) {
      var box = $('[data-jbox="' + n + '"]');
      if (box) box.classList.toggle('ok', (ev.items[n].just || '').trim().length >= MIN_JUST);
      var falta = semJust(), b = $('#enviar'), m = $('#envio-msg');
      if (b) b.disabled = falta.length > 0;
      if (m) m.textContent = falta.length ? 'Falta justificar: ' + falta.map(function (i) { return i.id; }).join(', ') + '.' : 'Todas as pendências estão justificadas. O CoE vai avaliar cada justificativa.';
    }
    function sugerirGeral() {
      var ds = Object.keys(rev).map(function (k) { return rev[k].decisao; });
      var sug = ds.indexOf('nao_aceito') >= 0 ? 'devolvido' : ds.indexOf('ressalva') >= 0 ? 'aprovado_ressalva' : '';
      if (!sug) return;
      revGeral.decisao = sug;
      $$('[name="rdg"]').forEach(function (r) { r.checked = r.value === sug; });
    }
    async function salvar() { await api('/api/evaluations/' + ev.id, { method: 'PATCH', body: { items: ev.items } }); }
    async function mudar(i, status) {
      var it = ev.items[i];
      it.status = status;
      it.comment = status === 'confirmado' ? 'Confirmado pelo analista em ' + dataBR(new Date().toISOString(), true) + '.' : 'Confirme que está configurado ou anexe o print.';
      try { await salvar(); desenhar(); } catch (e) { toast(e.message); }
    }
    async function anexar(i, f) {
      if (!f) return;
      if (f.size > 1024 * 1024) { toast('Imagem acima de 1 MB. Reduza o print e tente de novo.'); return; }
      try {
        var r = await api('/api/evaluations/' + ev.id + '/prints?item=' + encodeURIComponent(ev.items[i].id) + '&name=' + encodeURIComponent(f.name), { method: 'POST', body: f, raw: true, type: f.type });
        ev.items[i].prints = (ev.items[i].prints || []).concat([{ key: r.key, name: f.name }]);
        if (ev.items[i].status === 'confirmar') { ev.items[i].status = 'confirmado'; ev.items[i].comment = 'Print anexado pelo analista.'; }
        await salvar(); toast('Print anexado.'); desenhar();
      } catch (e) { toast(e.message); }
    }
    async function enviar() {
      var nj = ev.items.filter(function (i) { return exigeJust(i) && i.just; }).length;
      if (!confirm(nj ? 'Enviar ao CoE com ' + nj + ' pendência(s) justificada(s)? Depois do envio a rodada não pode mais ser alterada.' : 'Enviar esta rodada ao CoE? Depois do envio ela não pode mais ser alterada.')) return;
      try {
        await comEspera('Enviando ao CoE', 'Enviando a rodada e as justificativas', function () {
          return api('/api/evaluations/' + ev.id + '/submit', { method: 'POST', body: { items: ev.items } });
        });
        await viewResultado(ev.id);
        window.scrollTo(0, 0);
        await mensagem('Enviado ao CoE', '<p>A rodada ' + ev.round + ' de <b>' + h(ev.process_name) + '</b> foi enviada' + (nj ? ' com ' + nj + ' justificativa(s)' : '') + '.</p>' +
          '<p>Acompanhe o andamento pela barra de progresso no topo desta tela. Quando o CoE registrar a decisão, aparece um aviso no app e em "Minhas autoavaliações".</p>', 'info');
      } catch (e) { if (!Esp) toast(e.message); }
    }
    async function registrarDecisao() {
      var err = $('#rerr'); err.textContent = '';
      var itens = {}, orient = [];
      Object.keys(rev).forEach(function (k) {
        var r = rev[k];
        itens[k] = { decisao: r.decisao || '', instrucao: r.instrucao || '' };
        if (r.orientar && (r.instrucao || '').trim()) orient.push({ regras: r.regras, texto: r.instrucao.trim() });
      });
      try {
        var r = await comEspera('Registrando a decisão do CoE', 'Gravando a decisão e as instruções', function () {
          return api('/api/evaluations/' + ev.id + '/review', { method: 'POST', body: { itens: itens, decisao: revGeral.decisao, parecer: revGeral.parecer, orientacoes: orient } });
        });
        toast('Decisão registrada' + (r.orientacoesCriadas ? ' · ' + r.orientacoesCriadas + ' orientação(ões) para a IA criada(s)' : '') + '.');
        await carregarMe(); viewResultado(ev.id);
      } catch (e) { err.textContent = e.message; }
    }
    desenhar();
    // Mensagem ao analista na primeira vez que abre a rodada depois da decisao do CoE
    if (decisaoNova) {
      var op = ev.coe_opinion, cls = op.decisao === 'devolvido' ? 'bad' : op.decisao === 'aprovado_ressalva' ? 'warn' : 'ok';
      var instr = ev.items.filter(function (i) { return i.coe && (i.coe.instrucao || i.coe.decisao !== 'aceito'); });
      api('/api/evaluations/' + ev.id + '/seen', { method: 'POST', body: {} }).then(carregarMe).then(function () {
        var nav = $('.nav'), tmp = document.createElement('div'); tmp.innerHTML = layout('#/historico', '');
        if (nav && tmp.querySelector('.nav')) nav.innerHTML = tmp.querySelector('.nav').innerHTML;
      }).catch(function () {});
      await mensagem('O CoE concluiu a análise: ' + COE_ST[op.decisao],
        '<p><b>' + h(ev.process_name) + ' · rodada ' + ev.round + '</b><br><span class="small muted">' + h(op.por) + ' em ' + h(dataBR(op.em, true)) + '</span></p>' +
        (op.parecer ? '<p style="white-space:pre-wrap">' + h(op.parecer) + '</p>' : '') +
        (instr.length ? '<p class="small"><b>' + instr.length + ' item(ns) com instrução do CoE</b>: ' + instr.map(function (i) { return h(i.id) + ' (' + h(DEC_ITEM[i.coe.decisao]) + ')'; }).join(', ') + '. Veja os detalhes na tabela.</p>' : '') +
        (op.decisao === 'devolvido' ? '<p>Corrija os pontos indicados e envie uma nova rodada.</p>' : op.decisao === 'aprovado_ressalva' ? '<p>Atenda às ressalvas antes da publicação.</p>' : '<p>Processo liberado pelo CoE.</p>'), cls);
    }
  }

  /* ------------------------------ exportacao ------------------------------ */
  async function identidade() {
    var cfg = (await api('/api/report-config')).report;
    var logos = {};
    for (var n = 1; n <= 2; n++) {
      if (!cfg.logos || !cfg.logos[n]) continue;
      var r = await fetch('/api/logo/' + n, { credentials: 'same-origin' });
      if (r.ok) {
        var url = await blobToDataUrl(await r.blob());
        var dim = await new Promise(function (ok) { var im = new Image(); im.onload = function () { ok({ w: im.naturalWidth, h: im.naturalHeight }); }; im.onerror = function () { ok(null); }; im.src = url; });
        if (dim) logos[n] = { url: url, w: dim.w, h: dim.h };
      }
    }
    return { cfg: cfg, logos: logos };
  }
  function hexRgb(hex) { var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); var n = m ? parseInt(m[1], 16) : 0xFFC629; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  // doc: { titulo, linhasMeta: [], secoes: [{ titulo, colunas: [], linhas: [[]], larguras }], lista: { titulo, itens: [] } }
  async function gerarPdf(doc, arquivo) {
    await loadScript('/vendor/jspdf.umd.min.js'); await loadScript('/vendor/jspdf.plugin.autotable.min.js');
    var id = await identidade(), cfg = id.cfg;
    var pdf = new window.jspdf.jsPDF({ orientation: cfg.orientation === 'portrait' ? 'portrait' : 'landscape', unit: 'mm', format: 'a4' });
    var W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 12;
    var cor = hexRgb(cfg.color);
    function cabecalho() {
      [1, 2].forEach(function (n) {
        var l = id.logos[n]; if (!l) return;
        var hh = 12, ww = Math.min(45, hh * l.w / l.h);
        try { pdf.addImage(l.url, 'PNG', n === 1 ? M : W - M - ww, 8, ww, hh); } catch (e) { console.warn('Logo ' + n + ' inv\u00e1lida', e); }
      });
      pdf.setDrawColor(cor[0], cor[1], cor[2]); pdf.setLineWidth(1); pdf.line(M, 23, W - M, 23);
    }
    cabecalho();
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(31, 41, 55);
    pdf.text(doc.titulo || cfg.title, M, 31);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(75, 85, 99);
    var y = 36;
    [cfg.subtitle].concat(doc.linhasMeta || []).filter(Boolean).forEach(function (l) { pdf.text(String(l), M, y); y += 4.5; });
    y += 2;
    (doc.secoes || []).forEach(function (s) {
      if (s.titulo) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(31, 41, 55); pdf.text(s.titulo, M, y + 4); y += 6; }
      pdf.autoTable({ startY: y, head: [s.colunas], body: s.linhas, margin: { left: M, right: M, top: 28 }, styles: { fontSize: 8, cellPadding: 1.8, valign: 'top', textColor: [31, 41, 55] },
        headStyles: { fillColor: [31, 41, 55], textColor: [255, 255, 255], fontStyle: 'bold' }, alternateRowStyles: { fillColor: [246, 247, 249] },
        columnStyles: s.larguras || {}, didDrawPage: function (d) { if (d.pageNumber > 1) cabecalho(); } });
      y = pdf.lastAutoTable.finalY + 8;
    });
    if (doc.lista && doc.lista.itens.length) {
      if (y > H - 30) { pdf.addPage(); cabecalho(); y = 32; }
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(doc.lista.titulo, M, y); y += 5;
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
      doc.lista.itens.forEach(function (t) { var ls = pdf.splitTextToSize('• ' + t, W - 2 * M); if (y + ls.length * 4 > H - 15) { pdf.addPage(); cabecalho(); y = 32; } pdf.text(ls, M, y); y += ls.length * 4 + 1; });
    }
    var tot = pdf.internal.getNumberOfPages();
    for (var p = 1; p <= tot; p++) {
      pdf.setPage(p); pdf.setFontSize(8); pdf.setTextColor(91, 100, 114);
      pdf.setDrawColor(227, 230, 235); pdf.setLineWidth(0.2); pdf.line(M, H - 10, W - M, H - 10);
      pdf.text(cfg.footer || '', M, H - 6); pdf.text('Página ' + p + ' de ' + tot, W - M, H - 6, { align: 'right' });
    }
    pdf.save(arquivo + '.pdf');
  }
  // planilhas: [{ nome, colunas: [], linhas: [[]], larguras: [] }]
  async function gerarXlsx(doc, planilhas, arquivo) {
    await loadScript('/vendor/exceljs.min.js');
    var id = await identidade(), cfg = id.cfg;
    var wb = new window.ExcelJS.Workbook();
    wb.creator = 'App de Autoavaliação CoE Zeev';
    var capa = wb.addWorksheet('Capa');
    capa.getColumn(1).width = 30; capa.getColumn(2).width = 70;
    [1, 2].forEach(function (n) {
      var l = id.logos[n]; if (!l) return;
      try {
        var img = wb.addImage({ base64: l.url, extension: 'png' });
        var hh = 48, ww = Math.round(hh * l.w / l.h);
        capa.addImage(img, { tl: { col: n === 1 ? 0 : 1, row: 0 }, ext: { width: Math.min(ww, 220), height: hh } });
      } catch (e) { console.warn('Logo ' + n + ' inv\u00e1lida', e); }
    });
    capa.getRow(1).height = 42;
    var cor = (cfg.color || '#FFC629').replace('#', 'FF');
    capa.getCell('A3').value = doc.titulo || cfg.title; capa.getCell('A3').font = { bold: true, size: 15 };
    capa.getCell('A3').border = { bottom: { style: 'thick', color: { argb: cor } } };
    capa.getCell('A4').value = cfg.subtitle; capa.getCell('A4').font = { color: { argb: 'FF4B5563' } };
    var r = 6;
    (doc.linhasMeta || []).forEach(function (l) { capa.getCell('A' + r).value = l; r++; });
    capa.getCell('A' + (r + 1)).value = cfg.footer; capa.getCell('A' + (r + 1)).font = { italic: true, size: 9, color: { argb: 'FF5B6472' } };
    planilhas.forEach(function (p) {
      var ws = wb.addWorksheet(p.nome.slice(0, 31));
      ws.addRow(p.colunas);
      p.linhas.forEach(function (l) { ws.addRow(l); });
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      ws.columns.forEach(function (c, i) { c.width = (p.larguras && p.larguras[i]) || 18; c.alignment = { wrapText: true, vertical: 'top' }; });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: p.colunas.length } };
    });
    var buf = await wb.xlsx.writeBuffer();
    baixar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), arquivo + '.xlsx');
  }
  async function exportarAvaliacao(ev, tipo, paraCoe) {
    try {
      toast('Gerando o arquivo…');
      var cfg = (await api('/api/report-config')).report, inc = cfg.include;
      var t = E.totals(ev.items);
      var meta = [ev.process_name + (ev.app_code ? ' · app ' + ev.app_code : '') + (ev.flow_version ? ' · versão ' + ev.flow_version : '') + ' · rodada ' + ev.round,
        'Analista: ' + ev.analista + ' · ' + dataBR(ev.created_at, true) + (inc.versao ? ' · Manual de Padrões Zeev v' + (ev.manual_version || '-') : ''),
        'Situação: ' + (t.pronto ? 'Pronto para o CoE' : 'Pendências bloqueantes') + ' · bloqueantes abertos: ' + t.bAbertos + ' · a confirmar: ' + t.confirmar + ' · melhorias sugeridas: ' + t.rAbertos +
          ' · justificados: ' + ev.items.filter(function (i) { return i.just; }).length,
        'No CoE: ' + COE_ST[ev.coe_status || 'rascunho'] + (ev.submitted_at ? ' · enviado em ' + dataBR(ev.submitted_at, true) : '') +
          (ev.coe_opinion ? ' · decisão de ' + ev.coe_opinion.por + ' em ' + dataBR(ev.coe_opinion.em, true) : '')];
      var temCoe = ev.items.some(function (i) { return i.just || i.coe; });
      var itens = ev.items.slice().sort(function (a, b) { return (a.sev === b.sev ? (ORDEM[a.status] || 9) - (ORDEM[b.status] || 9) : a.sev === 'B' ? -1 : 1); });
      var linhas = itens.map(function (i) {
        var l = [i.id, i.rule, i.sev === 'B' ? 'Bloqueante' : 'Recomendado', i.item, i.origin, rotulo(i),
          i.comment + (i.fix ? ' | Como corrigir: ' + i.fix : '') + (inc.prints && i.prints && i.prints.length ? ' | Prints: ' + i.prints.map(function (p) { return p.name; }).join(', ') : '')];
        if (temCoe) l.push(i.just || '', i.coe ? (DEC_ITEM[i.coe.decisao] || '') + (i.coe.instrucao ? ': ' + i.coe.instrucao : '') : '');
        return l;
      });
      var cols = ['#', 'Regra', 'Severidade', 'Item avaliado', 'Origem', 'Status', 'Comentário'].concat(temCoe ? ['Justificativa do analista', 'Decisão e instrução do CoE'] : []);
      var resumo = [['Bloqueantes', t.bTotal, t.bAbertos, t.bConformes], ['Recomendados', t.rTotal, t.rAbertos, t.rTotal - t.rAbertos]];
      var titulo = (paraCoe ? 'Relatório para o CoE – ' : 'Autoavaliação – ') + ev.process_name;
      var arq = slug(ev.process_name) + '-rodada-' + ev.round;
      var secoes = [];
      if (inc.resumo) secoes.push({ titulo: 'Resumo', colunas: ['Severidade', 'Avaliados', 'Abertos', 'Conformes/confirmados'], linhas: resumo });
      if (ev.coe_opinion && ev.coe_opinion.parecer) secoes.push({ titulo: 'Parecer do CoE · ' + COE_ST[ev.coe_opinion.decisao], colunas: ['Parecer'], linhas: [[ev.coe_opinion.parecer]] });
      if (inc.itens) secoes.push({ titulo: 'Itens avaliados', colunas: cols, linhas: linhas, larguras: temCoe
        ? { 0: { cellWidth: 14 }, 1: { cellWidth: 12 }, 2: { cellWidth: 18 }, 3: { cellWidth: 40 }, 4: { cellWidth: 16 }, 5: { cellWidth: 20 } }
        : { 0: { cellWidth: 16 }, 1: { cellWidth: 14 }, 2: { cellWidth: 20 }, 3: { cellWidth: 52 }, 4: { cellWidth: 18 }, 5: { cellWidth: 22 } } });
      var lista = inc.riscos && ev.risks && ev.risks.length ? { titulo: 'Pontos para validar com a área', itens: ev.risks } : null;
      if (tipo === 'pdf') await gerarPdf({ titulo: titulo, linhasMeta: meta, secoes: secoes, lista: lista }, arq);
      else {
        var pl = [];
        if (inc.resumo) pl.push({ nome: 'Resumo', colunas: ['Severidade', 'Avaliados', 'Abertos', 'Conformes/confirmados'], linhas: resumo, larguras: [18, 12, 12, 22] });
        if (ev.coe_opinion) pl.push({ nome: 'Parecer do CoE', colunas: ['Decisão', 'Parecer', 'Por', 'Em'], linhas: [[COE_ST[ev.coe_opinion.decisao], ev.coe_opinion.parecer, ev.coe_opinion.por, dataBR(ev.coe_opinion.em, true)]], larguras: [24, 90, 22, 18] });
        pl.push({ nome: 'Itens', colunas: cols, linhas: linhas, larguras: [10, 9, 13, 45, 12, 18, 80, 50, 50] });
        if (lista) pl.push({ nome: 'Pontos para validar', colunas: ['Ponto'], linhas: lista.itens.map(function (x) { return [x]; }), larguras: [100] });
        await gerarXlsx({ titulo: titulo, linhasMeta: meta }, pl, arq);
      }
    } catch (e) { toast('Não foi possível exportar: ' + e.message); }
  }

  /* ------------------------------ historico ------------------------------ */
  async function viewHistorico() {
    await carregarMe();
    var r = await api('/api/evaluations');
    var lista = r.evaluations;
    var porProc = {};
    lista.forEach(function (e) { var k = e.process_name.toLowerCase() + '|' + (e.app_code || ''); (porProc[k] = porProc[k] || []).push(e); });
    var ultimo = lista[0];
    var evolucao = '';
    if (ultimo) {
      var rods = porProc[ultimo.process_name.toLowerCase() + '|' + (ultimo.app_code || '')].slice(0, 6).reverse();
      var max = Math.max.apply(null, rods.map(function (x) { return x.b_open; }).concat([1]));
      evolucao = '<section class="card"><div class="card-head"><h2>' + h(ultimo.process_name) + (ultimo.app_code ? ' · app ' + h(ultimo.app_code) : '') + '</h2><span class="small muted">Bloqueantes abertos por rodada</span></div>' +
        '<div class="grid" style="grid-template-columns:repeat(' + rods.length + ',minmax(0,1fr))">' + rods.map(function (x, i) {
          return '<div class="tile" style="' + (i === rods.length - 1 ? 'border-color:var(--ink)' : '') + '"><span>Rodada ' + x.round + ' · ' + h(dataBR(x.created_at, true)) + '</span>' +
            '<b style="color:' + (x.b_open ? 'var(--bad)' : 'var(--ok)') + '">' + x.b_open + '</b><div class="bar" style="background:#f1d4d4;height:8px"><i style="height:8px;background:var(--bad);width:' + Math.round(x.b_open / max * 100) + '%"></i></div></div>';
        }).join('') + '</div></section>';
    }
    $app.innerHTML = layout('#/historico',
      '<div class="head"><div><h1>Minhas autoavaliações</h1><p class="lead">Cada envio é uma rodada. Compare as rodadas para ver o que já foi corrigido.</p></div><a class="btn primary" href="#/nova">Nova autoavaliação</a></div>' +
      evolucao +
      '<section class="card flush"><div class="tbl-wrap"><table class="tbl" style="min-width:820px"><thead><tr><th>Processo</th><th>Rodada</th><th>Data</th><th>Manual</th><th>Bloqueantes abertos</th><th>Recomendados abertos</th><th>Situação</th><th><span class="sr">Ações</span></th></tr></thead><tbody>' +
      (lista.length ? lista.map(function (e) {
        var grupo = porProc[e.process_name.toLowerCase() + '|' + (e.app_code || '')];
        var atual = grupo[0].id === e.id;
        return '<tr><td><b>' + h(e.process_name) + '</b>' + (e.app_code ? ' <span class="muted tiny">app ' + h(e.app_code) + '</span>' : '') + '</td><td>' + e.round + '</td><td>' + h(dataBR(e.created_at, true)) + '</td><td>' + (e.manual_version ? 'v' + h(e.manual_version) : '-') + '</td>' +
          '<td style="font-weight:700;color:' + (e.b_open ? 'var(--bad)' : 'var(--ok)') + '">' + e.b_open + '</td><td>' + e.r_open + '</td><td>' +
          (e.coe_status && e.coe_status !== 'rascunho' ? stCoe(e.coe_status) : atual ? (e.ready ? st('pronto', 'Pronto para o CoE') : st('corrigir', 'Corrigir ou justificar')) : st('substituida', 'Substituída')) + '</td><td class="acoes-rel"><a href="#/resultado/' + e.id + '"><b>Abrir</b></a>' +
          (S.me.user.role === 'admin' ? '<br>' + botoesExcluir(e.id, e.process_name, e.app_code) : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="muted">Nenhuma autoavaliação ainda. Comece por <a href="#/nova">Nova autoavaliação</a>.</td></tr>') +
      '</tbody></table></div></section>');
    bindLayout();
    ligarExcluir(viewHistorico);
  }

  /* ------------------------------ admin: padroes ------------------------------ */
  async function viewPadroes() {
    var r = await api('/api/manual');
    var vig = r.vigente;
    var caps = {};
    if (vig) vig.rules.forEach(function (x) { var c = x.chapter || '?'; caps[c] = (caps[c] || 0) + 1; });
    var NOMES = { 1: 'Modelagem', 2: 'Formulários', 3: 'Scripts', 4: 'Integrações', 5: 'Resp. e SLA', 6: 'E-mails', 7: 'Publicação' };
    $app.innerHTML = layout('#/admin/padroes',
      '<div class="head"><div><h1>Padrões do manual</h1><p class="lead">A versão vigente é a que todos os analistas usam nas autoavaliações. Uma nova versão só vale depois de revisada e publicada.</p></div></div>' +
      (vig ? '<section class="card"><div class="row between" style="align-items:flex-start"><div style="display:flex;flex-direction:column;gap:4px"><span class="tiny" style="font-weight:700;color:var(--ok)">VIGENTE</span>' +
        '<h2 style="font-size:20px">Manual de Padrões Zeev v' + h(vig.version) + '</h2><span class="small muted">Vigente desde ' + h(dataBR(vig.effective_date + 'T12:00:00Z')) + ' · ' + vig.rules.length + ' regras</span></div>' +
        '<button class="btn" id="ajustar">Ajustar avaliação das regras</button></div>' +
        '<div class="grid g7">' + Object.keys(caps).sort().map(function (c) { return '<div class="chip"><span>' + h(NOMES[c] || 'Cap. ' + c) + '</span><b>' + caps[c] + ' regras</b></div>'; }).join('') + '</div></section>'
        : '<div class="note warn">Nenhuma versão publicada. Envie o Word do manual abaixo para começar.</div>') +
      '<section class="card"><h2>Publicar nova versão do manual</h2>' +
      '<div class="grid g3"><label class="f">Número da versão<input type="text" id="mv" placeholder="ex.: 1.3"></label>' +
      '<label class="f">Vigente a partir de<input type="date" id="md"></label><label class="f">Resumo das mudanças<input type="text" id="ms" placeholder="ex.: novas regras de e-mail"></label></div>' +
      '<label class="drop"><b>Word do manual (.docx)</b><span class="small muted" style="max-width:560px">O app lê as tabelas de regras (código, regra, severidade) e os itens (B)/(R) das seções, e compara com a versão vigente. Nada é publicado sem a sua revisão.</span>' +
      '<input type="file" id="mf" accept=".docx"></label><div class="err-msg" id="merr"></div>' +
      '<div class="row end"><button class="btn primary" id="extrair">Extrair regras e revisar</button></div></section>' +
      '<section class="card flush"><div class="card-head"><h2>Histórico de versões</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Versão</th><th>Vigência</th><th>Regras</th><th>Mudanças</th><th>Publicada por</th><th>Situação</th></tr></thead><tbody>' +
      (r.versoes.length ? r.versoes.map(function (v) {
        return '<tr><td><b>' + h(v.version) + '</b></td><td>' + h(dataBR(v.effective_date + 'T12:00:00Z')) + '</td><td>' + v.regras + '</td><td>' + h(v.summary || '-') + '</td><td>' + h(v.autor || '') + '</td><td>' + st(v.status, { vigente: 'Vigente', arquivada: 'Arquivada', rascunho: 'Rascunho' }[v.status]) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">Nenhuma versão.</td></tr>') + '</tbody></table></div></section>');
    bindLayout();
    $('#md').value = new Date().toISOString().slice(0, 10);
    on('#ajustar', 'click', function () {
      S.draft = { version: vig.version, effective_date: vig.effective_date, summary: 'Ajuste de avaliação das regras', rules: vig.rules.map(function (x) { return Object.assign({}, x); }), base: vig.rules, ajuste: true };
      go('#/admin/revisao');
    });
    on('#extrair', 'click', async function () {
      var f = $('#mf').files[0], err = $('#merr');
      err.textContent = '';
      if (!$('#mv').value.trim()) { err.textContent = 'Informe o número da versão.'; return; }
      if (!f) { err.textContent = 'Selecione o Word do manual.'; return; }
      try {
        await loadScript('/vendor/mammoth.browser.min.js');
        var res = await window.mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
        var regras = E.parseManualHtml(res.value);
        if (!regras.length) throw new Error('Nenhuma regra encontrada. O Word precisa ter as tabelas com as colunas código, regra e severidade (B/R).');
        var base = vig ? vig.rules : [];
        var porCod = {}; base.forEach(function (x) { porCod[x.code] = x; });
        regras.forEach(function (x) { if (porCod[x.code]) x.aval = porCod[x.code].aval; });
        S.draft = { version: $('#mv').value.trim(), effective_date: $('#md').value, summary: $('#ms').value.trim(), rules: regras, base: base, arquivo: f.name };
        go('#/admin/revisao');
      } catch (e) { err.textContent = e.message; }
    });
  }
  var AVAL = { auto: 'Automática', ia: 'IA', checklist: 'Checklist', nao: 'Não avaliar' };
  async function viewRevisao() {
    var d = S.draft;
    if (!d) { go('#/admin/padroes'); return; }
    var diff = E.diffRules(d.base, d.rules);
    var mudou = {}; diff.novas.forEach(function (x) { mudou[x.code] = 'Nova'; }); diff.alteradas.forEach(function (x) { mudou[x.code] = 'Alterada'; });
    var mostrarTodas = d.ajuste || !d.base.length;
    var checks = {}; E.CHECKS.forEach(function (c) { (checks[c.rule] = checks[c.rule] || []).push(c.id); });
    function desenhar() {
      var linhas = d.rules.filter(function (x) { return mostrarTodas || mudou[x.code]; });
      var semAuto = d.rules.filter(function (x) { return x.aval === 'auto' && !checks[x.code]; });
      $app.innerHTML = layout('#/admin/padroes',
        '<div class="head"><div><a class="back" href="#/admin/padroes">‹ Padrões do manual</a><h1>' + (d.ajuste ? 'Ajustar avaliação das regras' : 'Revisar versão ' + h(d.version)) + '</h1>' +
        '<p class="lead">' + (d.ajuste ? 'Defina como cada regra é avaliada: conferência automática, IA, checklist do analista ou não avaliar.' : 'Lido de ' + h(d.arquivo) + '. Ajuste o que o app leu errado antes de publicar.') + '</p></div></div>' +
        (d.ajuste ? '' : '<div class="grid g4"><div class="tile"><span>Regras novas</span><b>' + diff.novas.length + '</b></div><div class="tile"><span>Alteradas</span><b>' + diff.alteradas.length + '</b></div>' +
          '<div class="tile"><span>Removidas</span><b>' + diff.removidas.length + '</b></div><div class="tile"><span>Sem mudança</span><b>' + diff.iguais + '</b></div></div>') +
        (semAuto.length ? '<div class="note warn"><b>Sem conferência automática:</b> ' + semAuto.map(function (x) { return h(x.code); }).join(', ') + '. Essas regras ficam "Automática" mas não têm código de conferência; mude para IA ou Checklist, ou peça a conferência à equipe de Automação.</div>' : '') +
        (diff.removidas.length && !d.ajuste ? '<div class="note info"><b>Removidas nesta versão:</b> ' + diff.removidas.map(function (x) { return h(x.code); }).join(', ') + '</div>' : '') +
        '<section class="card flush"><div class="row between" style="padding:14px 18px;border-bottom:1px solid var(--line)"><span class="small muted">' + linhas.length + ' de ' + d.rules.length + ' regras</span>' +
        (d.base.length && !d.ajuste ? '<label class="check small"><input type="checkbox" id="todas"' + (mostrarTodas ? ' checked' : '') + '>Mostrar todas as regras</label>' : '') + '</div>' +
        '<div class="tbl-wrap"><table class="tbl" style="min-width:900px"><thead><tr><th>Código</th><th>Mudança</th><th>Regra como lida do Word</th><th style="width:150px">Severidade</th><th style="width:170px">Avaliação</th></tr></thead><tbody>' +
        linhas.map(function (x) {
          var i = d.rules.indexOf(x), m = mudou[x.code];
          return '<tr><td><b>' + h(x.code) + '</b></td><td>' + (m ? st(m === 'Nova' ? 'conforme' : 'liberado', m) : '<span class="muted tiny">—</span>') + '</td><td>' + h(x.text) +
            (m === 'Alterada' ? '<div class="fix tiny"><b>Antes:</b> ' + h((diff.alteradas.filter(function (a) { return a.code === x.code; })[0] || {}).antes) + '</div>' : '') +
            (checks[x.code] ? '<div class="fix tiny">Conferência: ' + checks[x.code].join(', ') + '</div>' : '') + '</td>' +
            '<td><select data-sev="' + i + '" aria-label="Severidade"><option value="B"' + (x.sev === 'B' ? ' selected' : '') + '>B - Bloqueante</option><option value="R"' + (x.sev === 'R' ? ' selected' : '') + '>R - Recomendado</option></select></td>' +
            '<td><select data-aval="' + i + '" aria-label="Avaliação">' + Object.keys(AVAL).map(function (k) { return '<option value="' + k + '"' + (x.aval === k ? ' selected' : '') + '>' + AVAL[k] + '</option>'; }).join('') + '</select></td></tr>';
        }).join('') + '</tbody></table></div></section>' +
        '<div class="card" style="flex-direction:row;flex-wrap:wrap;justify-content:space-between;align-items:center;padding:16px 18px"><span class="small muted">Ao publicar, as novas autoavaliações passam a usar esta versão. As anteriores mantêm a versão com que foram feitas.</span>' +
        '<div class="row"><button class="btn danger" id="desc">Descartar</button>' + (d.ajuste ? '' : '<button class="btn" id="rasc">Salvar rascunho</button>') + '<button class="btn primary" id="pub">Publicar versão</button></div></div>');
      bindLayout();
      $$('[data-sev]').forEach(function (s) { s.addEventListener('change', function () { d.rules[+s.getAttribute('data-sev')].sev = s.value; }); });
      $$('[data-aval]').forEach(function (s) { s.addEventListener('change', function () { d.rules[+s.getAttribute('data-aval')].aval = s.value; desenhar(); }); });
      on('#todas', 'change', function (e) { mostrarTodas = e.target.checked; desenhar(); });
      on('#desc', 'click', function () { S.draft = null; go('#/admin/padroes'); });
      on('#rasc', 'click', function () { publicar(true); });
      on('#pub', 'click', function () { publicar(false); });
    }
    async function publicar(rascunho) {
      if (!rascunho && !confirm('Publicar a versão ' + d.version + ' do manual para toda a equipe?')) return;
      try {
        await api('/api/manual', { method: 'POST', body: { version: d.version, effective_date: d.effective_date, summary: d.summary, rules: d.rules, draft: rascunho } });
        toast(rascunho ? 'Rascunho salvo.' : 'Versão ' + d.version + ' publicada.');
        if (!rascunho) S.draft = null;
        go('#/admin/padroes');
      } catch (e) { toast(e.message); }
    }
    desenhar();
  }

  /* ------------------------------ admin: conferencias ------------------------------ */
  async function viewConferencias() {
    var cfg = (await api('/api/checks')).checks || [];
    var m = {}; cfg.forEach(function (c) { m[c.id] = c; });
    var lista = E.CHECKS.map(function (c) { var x = m[c.id] || {}; return Object.assign({}, c, { active: x.active !== false, severity: x.severity || c.sev, mode: x.mode || c.mode || 'bloqueia', params: Object.assign({}, c.params || {}, x.params || {}) }); });
    $app.innerHTML = layout('#/admin/conferencias',
      '<div class="head"><div><h1>Conferências automáticas</h1><p class="lead">Verificações exatas, sem IA, que rodam no navegador do analista. O CoE pode ligar, desligar, mudar a severidade e definir se o apontamento bloqueia ou só avisa (útil para padrão ainda em validação). Uma conferência nova exige código: peça à equipe de Automação.</p></div></div>' +
      '<section class="card flush"><div class="tbl-wrap"><table class="tbl" style="min-width:980px"><thead><tr><th>ID</th><th>O que verifica</th><th>Arquivo</th><th>Regra</th><th style="width:150px">Severidade</th><th style="width:150px">Efeito</th><th>Ativa</th></tr></thead><tbody>' +
      lista.map(function (c, i) {
        return '<tr><td><b>' + h(c.id) + '</b></td><td>' + h(c.desc) +
          (c.id === 'AUTO-02' ? '<div class="fix tiny">Versão esperada: <input type="text" data-ver="' + i + '" value="' + h(c.params.versao || '3.1') + '" style="width:70px;padding:4px 6px"></div>' : '') +
          (c.id === 'AUTO-01' ? '<div class="fix tiny">Trechos padrão liberados (um por linha; a linha do script que contém o trecho é ignorada):<textarea data-ign="' + i + '" rows="2" style="width:100%;margin-top:4px">' + h((c.params.ignorar || []).join('\n')) + '</textarea></div>' : '') + '</td>' +
          '<td><span class="tag">' + h(c.files) + '</span></td><td><b>' + h(c.rule) + '</b></td>' +
          '<td><select data-s="' + i + '" aria-label="Severidade"><option value="B"' + (c.severity === 'B' ? ' selected' : '') + '>B - Bloqueante</option><option value="R"' + (c.severity === 'R' ? ' selected' : '') + '>R - Recomendado</option></select></td>' +
          '<td><select data-m="' + i + '" aria-label="Efeito"><option value="bloqueia"' + (c.mode !== 'aviso' ? ' selected' : '') + '>Bloqueia</option><option value="aviso"' + (c.mode === 'aviso' ? ' selected' : '') + '>Só avisa</option></select></td>' +
          '<td><label class="check"><input type="checkbox" data-a="' + i + '"' + (c.active ? ' checked' : '') + '>Sim</label></td></tr>';
      }).join('') + '</tbody></table></div></section><div class="row end"><button class="btn primary" id="salvar">Salvar alterações</button></div>');
    bindLayout();
    on('#salvar', 'click', async function () {
      var out = lista.map(function (c, i) {
        var o = { id: c.id, active: $('[data-a="' + i + '"]').checked, severity: $('[data-s="' + i + '"]').value, mode: $('[data-m="' + i + '"]').value };
        var v = $('[data-ver="' + i + '"]'); if (v) o.params = { versao: v.value.trim() || '3.1' };
        var g = $('[data-ign="' + i + '"]'); if (g) o.params = { ignorar: g.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean) };
        return o;
      });
      try { await api('/api/checks', { method: 'PUT', body: { checks: out } }); toast('Conferências salvas.'); } catch (e) { toast(e.message); }
    });
  }

  /* ------------------------------ admin: relatorios ------------------------------ */
  var TIPOS = {
    processos: { nome: 'Autoavaliações por processo', cols: [['process_name', 'Processo'], ['app_code', 'App'], ['analista', 'Analista'], ['round', 'Rodada'], ['created_at', 'Data'], ['manual_version', 'Manual'], ['b_open', 'Bloqueantes abertos'], ['r_open', 'Recomendados abertos'], ['confirm', 'A confirmar'], ['ready', 'Situação'], ['coe_status', 'Situação no CoE']] },
    regras: { nome: 'Não conformidades mais frequentes', cols: [['regra', 'Regra'], ['item', 'Item'], ['severidade', 'Sev.'], ['ocorrencias', 'Ocorrências'], ['processos', 'Processos']] },
    uso: { nome: 'Uso da IA por analista', cols: [['analista', 'Analista'], ['email', 'E-mail'], ['analises', 'Análises'], ['falhas', 'Falhas'], ['dias', 'Dias com uso']] },
    itens: { nome: 'Detalhe dos itens avaliados', cols: [['processo', 'Processo'], ['rodada', 'Rodada'], ['analista', 'Analista'], ['data', 'Data'], ['regra', 'Regra'], ['item', 'Item'], ['origem', 'Origem'], ['severidade', 'Sev.'], ['status', 'Status'], ['comentario', 'Comentário'], ['justificativa', 'Justificativa do analista'], ['decisao_coe', 'Decisão do CoE'], ['instrucao_coe', 'Instrução do CoE']] }
  };
  function celula(k, v) {
    if (k === 'created_at' || k === 'data') return dataBR(v, true);
    if (k === 'ready') return v ? 'Pronto para o CoE' : 'Corrigir antes do CoE';
    if (k === 'status') return STATUS[v] || v;
    if (k === 'coe_status') return COE_ST[v || 'rascunho'];
    if (k === 'decisao_coe') return DEC_ITEM[v] || '';
    return v == null ? '' : v;
  }
  async function viewRelatorios() {
    var filtros = await api('/api/reports/filters');
    var cfgAll = (await api('/api/config')).config;
    var rep = cfgAll.report;
    var hoje = new Date(), ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    var modo = 'tabelas';
    var f = { tipo: 'processos', area: '', de: ini.toISOString().slice(0, 10), ate: hoje.toISOString().slice(0, 10), processo: '', analista: '', situacao: '', coe: '', severidade: '', capitulo: '', manual: '', ultima: '1' };
    var dados = { linhas: [] };
    function opt(v, t, sel) { return '<option value="' + h(v) + '"' + (v === sel ? ' selected' : '') + '>' + h(t) + '</option>'; }
    $app.innerHTML = layout('#/admin/relatorios',
      '<div class="head"><div><h1>Relatórios</h1><p class="lead">Acompanhe as autoavaliações da equipe e exporte com a identidade configurada abaixo.</p></div>' +
      '<div class="row"><button class="btn" id="rx">Exportar Excel</button><button class="btn primary" id="rp">Exportar PDF</button></div></div>' +
      '<div class="tabs big" role="tablist" id="rmodo"><button type="button" role="tab" data-modo="tabelas">Relatórios</button><button type="button" role="tab" data-modo="painel">Painel gráfico</button></div>' +
      '<section class="card"><div class="card-head"><h2>Filtros</h2><button class="link" id="limpar">Limpar filtros</button></div><div class="grid g4">' +
      '<label class="f" id="ftipo">Tipo de relatório<select id="tipo">' + Object.keys(TIPOS).map(function (k) { return opt(k, TIPOS[k].nome, f.tipo); }).join('') + '</select></label>' +
      '<label class="f">Período de<input type="date" id="de" value="' + f.de + '"></label><label class="f">até<input type="date" id="ate" value="' + f.ate + '"></label>' +
      '<label class="f">Processo<select id="processo">' + opt('', 'Todos', '') + filtros.processos.map(function (p) { return opt(p, p, ''); }).join('') + '</select></label>' +
      '<label class="f">Analista<select id="analista">' + opt('', 'Todos', '') + filtros.analistas.map(function (a) { return opt(String(a.id), a.name, ''); }).join('') + '</select></label>' +
      '<label class="f">Área responsável<select id="area">' + opt('', 'Todas', '') + (filtros.areas || []).map(function (a) { return opt(a, a, ''); }).join('') + '</select></label>' +
      '<label class="f">Situação<select id="situacao">' + opt('', 'Todas', '') + opt('corrigir', 'Corrigir antes do CoE', '') + opt('pronto', 'Pronto para o CoE', '') + '</select></label>' +
      '<label class="f">Situação no CoE<select id="coe">' + opt('', 'Todas', '') + Object.keys(COE_ST).map(function (k) { return opt(k, COE_ST[k], ''); }).join('') + '</select></label>' +
      '<label class="f">Severidade<select id="severidade">' + opt('', 'Bloqueantes e recomendados', '') + opt('B', 'Só bloqueantes', '') + opt('R', 'Só recomendados', '') + '</select></label>' +
      '<label class="f">Capítulo do manual<select id="capitulo">' + opt('', 'Todos', '') + ['1. Modelagem', '2. Formulários', '3. Scripts e estilos', '4. Integrações', '5. Responsáveis e SLA', '6. E-mails', '7. Publicação'].map(function (c) { return opt(c[0], c, ''); }).join('') + '</select></label></div>' +
      '<div class="row"><label class="check small"><input type="checkbox" id="ultima" checked>Só a última rodada de cada processo</label>' +
      '<label class="f" style="flex-direction:row;align-items:center">Versão do manual<select id="manual" style="width:auto">' + opt('', 'Todas', '') + filtros.manuais.filter(Boolean).map(function (m) { return opt(m, 'v' + m, ''); }).join('') + '</select></label>' +
      '<button class="btn dark" id="aplicar">Aplicar</button></div><p class="tiny muted" style="margin:0">Severidade e capítulo valem para o painel, "Não conformidades" e "Detalhe dos itens". No painel, os gráficos consideram todas as rodadas do período; o tipo de cada gráfico pode ser trocado no próprio gráfico.</p></section>' +
      '<div class="grid g4" id="tiles"></div><div id="painel" class="painel"></div><div class="ctip" id="ctip" role="tooltip"></div>' +
      '<section class="card flush" id="rcard"><div class="card-head"><h2 id="rtit"></h2><span class="small muted">Pré-visualização do que será exportado</span></div><div class="tbl-wrap" id="rtab"></div></section>' +
      '<section class="card"><div><h2>Configurar relatório</h2><p class="small muted" style="margin:4px 0 0">Vale para todas as exportações em PDF e Excel, inclusive o relatório que o analista gera para o CoE.</p></div>' +
      '<div class="row" style="align-items:flex-start;gap:24px"><div style="flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:16px"><div class="grid g2">' +
      [1, 2].map(function (n) {
        return '<div style="display:flex;flex-direction:column;gap:8px"><span class="tiny" style="font-weight:600;color:var(--muted)">Logo ' + n + ' · canto ' + (n === 1 ? 'esquerdo' : 'direito (opcional)') + '</span>' +
          '<div class="logo-box" id="lb' + n + '">' + (rep.logos && rep.logos[n] ? '<img alt="Logo ' + n + '" src="/api/logo/' + n + '?t=' + Date.now() + '">' : '<b>Sem logo</b>') +
          '<span class="tiny muted">PNG, fundo transparente, até 1 MB</span><input type="file" accept="image/png" data-logo="' + n + '" style="font-size:12px;max-width:100%">' +
          (rep.logos && rep.logos[n] ? '<button class="link" data-rmlogo="' + n + '">Remover</button>' : '') + '</div></div>';
      }).join('') + '</div>' +
      '<label class="f">Título<input type="text" id="rt" value="' + h(rep.title) + '"></label><label class="f">Subtítulo<input type="text" id="rs" value="' + h(rep.subtitle) + '"></label>' +
      '<label class="f">Rodapé<input type="text" id="rf" value="' + h(rep.footer) + '"></label>' +
      '<div class="grid g2"><label class="f">Orientação do PDF<select id="ro">' + opt('landscape', 'Paisagem', rep.orientation) + opt('portrait', 'Retrato', rep.orientation) + '</select></label>' +
      '<label class="f">Cor de destaque<select id="rc">' + opt('#FFC629', 'Amarelo Vitru #FFC629', rep.color) + opt('#1F2937', 'Grafite #1F2937', rep.color) + '</select></label></div>' +
      '<fieldset><legend>Incluir no relatório da autoavaliação</legend>' + [['resumo', 'Resumo por severidade'], ['itens', 'Tabela de itens com comentário'], ['riscos', 'Pontos para validar com a área'], ['prints', 'Nome dos prints anexados'], ['versao', 'Versão do manual e data da avaliação']].map(function (x) {
        return '<label class="check small"><input type="checkbox" data-inc="' + x[0] + '"' + (rep.include[x[0]] ? ' checked' : '') + '>' + x[1] + '</label>'; }).join('') + '</fieldset></div>' +
      '<div style="flex:1 1 360px;min-width:0;display:flex;flex-direction:column;gap:8px"><span class="tiny" style="font-weight:600;color:var(--muted)">Pré-visualização do cabeçalho (PDF)</span>' +
      '<div class="pdf-prev"><div class="logos">' + [1, 2].map(function (n) { return rep.logos && rep.logos[n] ? '<img alt="" src="/api/logo/' + n + '?t=' + Date.now() + '">' : '<div class="ph">Logo ' + n + '</div>'; }).join('') + '</div>' +
      '<div style="height:3px;background:' + h(rep.color) + '"></div><b id="pvt">' + h(rep.title) + '</b><span class="tiny muted" id="pvs">' + h(rep.subtitle) + '</span>' +
      '<div style="border-top:1px solid var(--line);padding-top:8px;display:flex;justify-content:space-between;font-size:10px;color:var(--muted2)"><span id="pvf">' + h(rep.footer) + '</span><span>Página 1 de 1</span></div></div>' +
      '<span class="tiny muted">No Excel, as logos e o título vão na aba Capa; os dados ficam nas abas seguintes.</span></div></div>' +
      '<div class="row end"><button class="btn primary" id="rsave">Salvar configuração</button></div></section>');
    bindLayout();
    function lerFiltros() {
      ['tipo', 'de', 'ate', 'processo', 'analista', 'area', 'situacao', 'coe', 'severidade', 'capitulo', 'manual'].forEach(function (k) { f[k] = $('#' + k).value; });
      f.ultima = $('#ultima').checked ? '1' : '0';
    }
    async function carregar() {
      lerFiltros();
      var q = Object.keys(f).filter(function (k) { return f[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(f[k]); }).join('&');
      if (modo === 'painel') {
        var pn = await api('/api/reports/painel?' + q);
        dados = { tipo: 'painel', painel: pn, linhas: [] };
        $('#rcard').style.display = 'none';
        desenharPainel(pn);
        return;
      }
      $('#rcard').style.display = ''; $('#painel').innerHTML = '';
      dados = await api('/api/reports?' + q);
      var T = TIPOS[dados.tipo];
      var acoes = dados.tipo === 'processos' || dados.tipo === 'itens';
      $('#rtit').textContent = T.nome;
      $('#rtab').innerHTML = '<table class="tbl" style="min-width:860px"><thead><tr>' + (acoes ? '<th>Avaliação</th>' : '') + T.cols.map(function (c) { return '<th>' + h(c[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (dados.linhas.length ? dados.linhas.slice(0, 200).map(function (l) {
          var id = l.eval_id || l.id;
          return '<tr>' + (acoes ? '<td class="acoes-rel"><a href="#/resultado/' + id + '">Abrir</a>' + (dados.tipo === 'processos' ? ' · <button class="link" data-rpdf="' + id + '">PDF</button> · <button class="link" data-rxls="' + id + '">Excel</button><br>' + botoesExcluir(id, l.process_name, l.app_code) : '') + '</td>' : '') +
            T.cols.map(function (c) { return '<td>' + h(celula(c[0], l[c[0]])) + '</td>'; }).join('') + '</tr>'; }).join('')
          : '<tr><td colspan="' + (T.cols.length + (acoes ? 1 : 0)) + '" class="muted">Nenhum registro com esses filtros.</td></tr>') + '</tbody></table>' +
        (dados.linhas.length > 200 ? '<div class="tbl-foot">Mostrando 200 de ' + dados.linhas.length + '; a exportação leva todos.</div>' : '');
      $$('[data-rpdf]').forEach(function (b) { b.addEventListener('click', function () { baixarAvaliacao(b.getAttribute('data-rpdf'), 'pdf'); }); });
      $$('[data-rxls]').forEach(function (b) { b.addEventListener('click', function () { baixarAvaliacao(b.getAttribute('data-rxls'), 'xlsx'); }); });
      ligarExcluir(atualizarTudo);
      var L = dados.linhas, tiles;
      if (dados.tipo === 'processos') tiles = [['Autoavaliações listadas', L.length], ['Processos', new Set(L.map(function (x) { return x.process_name.toLowerCase(); })).size],
        ['Prontos para o CoE', L.filter(function (x) { return x.ready; }).length], ['Bloqueantes abertos (soma)', L.reduce(function (a, x) { return a + x.b_open; }, 0)]];
      else if (dados.tipo === 'regras') tiles = [['Regras com não conformidade', L.length], ['Ocorrências', L.reduce(function (a, x) { return a + x.ocorrencias; }, 0)],
        ['Bloqueantes', L.filter(function (x) { return x.severidade === 'B'; }).length], ['Recomendados', L.filter(function (x) { return x.severidade === 'R'; }).length]];
      else if (dados.tipo === 'uso') tiles = [['Analistas', L.length], ['Análises com IA', L.reduce(function (a, x) { return a + x.analises; }, 0)], ['Falhas', L.reduce(function (a, x) { return a + x.falhas; }, 0)], ['Com uso no período', L.filter(function (x) { return x.analises; }).length]];
      else tiles = [['Itens', L.length], ['Abertos', L.filter(function (x) { return x.status === 'aberto'; }).length], ['A confirmar', L.filter(function (x) { return x.status === 'confirmar'; }).length], ['Processos', new Set(L.map(function (x) { return x.processo; })).size]];
      $('#tiles').innerHTML = tiles.map(function (t) { return '<div class="tile"><span>' + h(t[0]) + '</span><b>' + t[1] + '</b></div>'; }).join('');
    }
    // Depois de excluir: recarrega filtros, menu, tabela e painel
    async function atualizarTudo() {
      try {
        filtros = await api('/api/reports/filters');
        var sel = $('#processo'), atual = sel.value;
        if (filtros.processos.indexOf(atual) < 0) atual = '';
        sel.innerHTML = opt('', 'Todos', atual) + filtros.processos.map(function (p) { return opt(p, p, atual); }).join('');
        var nav = $('.nav'); if (nav) { var tmp = document.createElement('div'); tmp.innerHTML = layout('#/admin/relatorios', ''); var nn = tmp.querySelector('.nav'); if (nn) nav.innerHTML = nn.innerHTML; }
        await carregar();
      } catch (e) { toast(e.message); }
    }
    // ---------- painel grafico ----------
    var COR_COE = { rascunho: '#8A94A3', enviado: '#33475F', em_analise: '#2a78d6', aprovado: '#1E6B34', aprovado_ressalva: '#B07A00', devolvido: '#A11A1A' };
    // paleta categorica validada (ordem fixa); pizza/rosca agrupam o excedente em "Outros"
    var PALETA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6', '#8A94A3'];
    var FORMAS = [['barras', 'Barras'], ['colunas', 'Colunas'], ['pizza', 'Pizza'], ['rosca', 'Rosca'], ['tabela', 'Tabela']];
    var formaDe = {};
    try { formaDe = JSON.parse(localStorage.getItem('coe-graficos') || '{}') || {}; } catch (e) { formaDe = {}; }
    var defs = {};
    function marca(l, id, i, extra) { return ' data-g="' + id + '" data-i="' + i + '" class="gm' + (l.filtro ? ' clic' : '') + (extra || '') + '"' + (l.filtro ? ' tabindex="0" role="button"' : ''); }
    function grBarras(id, linhas, max) {
      return '<div class="hbars">' + linhas.map(function (l, i) {
        return '<div' + marca(l, id, i, ' hb') + '><span class="hb-l" title="' + h(l.rotulo) + '">' + h(l.rotulo) + '</span>' +
          '<span class="hb-t"><i style="width:' + Math.max(l.valor ? 1.5 : 0, l.valor / max * 100) + '%' + (l.cor ? ';background:' + l.cor : '') + '"></i></span>' +
          '<span class="hb-v">' + l.valor + '</span></div>';
      }).join('') + '</div>';
    }
    function grColunas(id, linhas, max) {
      var n = linhas.length, E0 = 40, W = 680, H = 260, base = 190, topo = 22, passo = (W - E0 - 10) / n, larg = Math.min(56, passo * 0.62);
      return '<svg class="gsvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gráfico de colunas">' +
        '<line x1="' + E0 + '" x2="' + (W - 10) + '" y1="' + base + '" y2="' + base + '" stroke="var(--field)"/>' +
        linhas.map(function (l, i) {
          var hh = l.valor ? Math.max(3, l.valor / max * (base - topo)) : 0, x = E0 + passo * i + (passo - larg) / 2, y = base - hh;
          var rot = l.rotulo.length > 18 ? l.rotulo.slice(0, 17) + '…' : l.rotulo;
          return '<g' + marca(l, id, i) + '><rect x="' + (E0 + passo * i) + '" y="' + topo + '" width="' + passo + '" height="' + (H - topo) + '" fill="transparent"/>' +
            '<path d="M' + x + ',' + base + 'V' + (y + 4) + 'q0,-4 4,-4h' + (larg - 8) + 'q4,0 4,4V' + base + 'z" fill="' + (l.cor || 'var(--info)') + '"/>' +
            '<text x="' + (x + larg / 2) + '" y="' + (y - 6) + '" text-anchor="middle" class="gv">' + l.valor + '</text>' +
            '<text x="' + (x + larg / 2) + '" y="' + (base + 16) + '" text-anchor="end" transform="rotate(-30 ' + (x + larg / 2) + ' ' + (base + 16) + ')" class="gl">' + h(rot) + '</text></g>';
        }).join('') + '</svg>';
    }
    function grPizza(id, linhas, rosca) {
      var tot = linhas.reduce(function (a, l) { return a + l.valor; }, 0), ang = -Math.PI / 2, R = 100, r0 = rosca ? 58 : 0, cx = 110, cy = 110;
      var vis = linhas.filter(function (l) { return l.valor; });
      function pt(a, rr) { return (cx + rr * Math.cos(a)).toFixed(2) + ',' + (cy + rr * Math.sin(a)).toFixed(2); }
      var fatias = vis.map(function (l) {
        var i = linhas.indexOf(l), a2 = ang + l.valor / tot * Math.PI * 2, grande = a2 - ang > Math.PI ? 1 : 0, d;
        if (vis.length === 1) d = 'M' + pt(-Math.PI / 2, R) + 'A' + R + ',' + R + ' 0 1 1 ' + pt(Math.PI * 1.5 - 0.001, R) + 'Z' + (rosca ? 'M' + pt(-Math.PI / 2, r0) + 'A' + r0 + ',' + r0 + ' 0 1 0 ' + pt(Math.PI * 1.5 - 0.001, r0) + 'Z' : '');
        else d = 'M' + pt(ang, R) + 'A' + R + ',' + R + ' 0 ' + grande + ' 1 ' + pt(a2, R) + (rosca ? 'L' + pt(a2, r0) + 'A' + r0 + ',' + r0 + ' 0 ' + grande + ' 0 ' + pt(ang, r0) : 'L' + cx + ',' + cy) + 'Z';
        ang = a2;
        return '<path' + marca(l, id, i) + ' d="' + d + '" fill="' + l.cor + '" fill-rule="evenodd" stroke="#fff" stroke-width="2"/>';
      }).join('');
      return '<div class="gpie"><svg class="gsvg" viewBox="0 0 220 220" role="img" aria-label="Gráfico de ' + (rosca ? 'rosca' : 'pizza') + '">' + fatias +
        (rosca ? '<text x="110" y="108" text-anchor="middle" class="gtot">' + tot + '</text><text x="110" y="126" text-anchor="middle" class="gl">total</text>' : '') + '</svg>' +
        '<ul class="glegend">' + linhas.map(function (l, i) {
          return '<li' + marca(l, id, i) + '><i style="background:' + l.cor + '"></i><span class="hb-l" title="' + h(l.rotulo) + '">' + h(l.rotulo) + '</span><b>' + l.valor + '</b><small>' + (tot ? Math.round(l.valor / tot * 100) : 0) + '%</small></li>';
        }).join('') + '</ul></div>';
    }
    function grTabela(id, linhas) {
      var tot = linhas.reduce(function (a, l) { return a + l.valor; }, 0);
      return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Quantidade</th><th>%</th></tr></thead><tbody>' + linhas.map(function (l, i) {
        return '<tr' + marca(l, id, i) + '><td>' + h(l.rotulo) + '</td><td>' + l.valor + '</td><td>' + (tot ? Math.round(l.valor / tot * 100) : 0) + '%</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    // linhas desenhadas: pizza e rosca agrupam alem de 6 fatias em "Outros"; cores categoricas quando nao ha cor propria
    function linhasDe(id, forma) {
      var ls = series[id].slice();
      if ((forma === 'pizza' || forma === 'rosca') && ls.length > 7) {
        var resto = ls.slice(6), soma = resto.reduce(function (a, l) { return a + l.valor; }, 0);
        ls = ls.slice(0, 6).concat([{ rotulo: 'Outros (' + resto.length + ')', valor: soma, tip: ['Outros', soma + ' no total', resto.slice(0, 8).map(function (l) { return l.rotulo + ': ' + l.valor; }).join(' · ')] }]);
      }
      return ls.map(function (l, i) { return Object.assign({}, l, { cor: l.cor || (forma === 'pizza' || forma === 'rosca' ? PALETA[Math.min(i, PALETA.length - 1)] : '') }); });
    }
    function corpoGrafico(id) {
      var forma = formaDe[id] || defs[id].forma, ls = linhasDe(id, forma);
      desenhadas[id] = ls;
      if (!ls.length || !ls.some(function (l) { return l.valor; })) return '<p class="muted small">Sem dados no período.</p>';
      var max = Math.max.apply(null, ls.map(function (l) { return l.valor; }).concat([1]));
      if (forma === 'colunas') return grColunas(id, ls, max);
      if (forma === 'pizza' || forma === 'rosca') return grPizza(id, ls, forma === 'rosca');
      if (forma === 'tabela') return grTabela(id, ls);
      return grBarras(id, ls, max);
    }
    function grafico(id, titulo, sub, forma, nota) {
      defs[id] = { forma: forma };
      var atual = formaDe[id] || forma;
      return '<section class="card chart"><div class="row between" style="align-items:flex-start"><div><h2>' + h(titulo) + '</h2><p class="small muted" style="margin:4px 0 0">' + h(sub) + '</p></div>' +
        '<label class="f" style="flex-direction:row;align-items:center;gap:6px"><span class="sr">Tipo de gráfico</span><select data-forma="' + id + '" aria-label="Tipo de gráfico de ' + h(titulo) + '">' +
        FORMAS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === atual ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label></div>' +
        '<div class="gbody" id="gb-' + id + '">' + corpoGrafico(id) + '</div>' + (nota ? '<p class="tiny muted" style="margin:0">' + h(nota) + '</p>' : '') + '</section>';
    }
    var series = {}, desenhadas = {};
    function ligarMarcas(raiz) {
      var tip = $('#ctip');
      $$('#' + raiz.id + ' .gm, ' + (raiz.id === 'painel' ? '#painel .gm' : '')).forEach(function (el) {
        if (el._ok) return; el._ok = 1;
        var l = desenhadas[el.getAttribute('data-g')][+el.getAttribute('data-i')];
        el.addEventListener('mousemove', function (ev) {
          tip.innerHTML = (l.tip || [l.rotulo, String(l.valor)]).filter(Boolean).map(function (t, i) { return i ? '<span>' + h(t) + '</span>' : '<b>' + h(t) + '</b>'; }).join('');
          tip.classList.add('on');
          var x = Math.min(ev.clientX + 14, window.innerWidth - tip.offsetWidth - 8), y = ev.clientY + 14;
          if (y + tip.offsetHeight > window.innerHeight - 8) y = ev.clientY - tip.offsetHeight - 10;
          tip.style.left = x + 'px'; tip.style.top = y + 'px';
        });
        el.addEventListener('mouseleave', function () { tip.classList.remove('on'); });
        function ir() {
          tip.classList.remove('on');
          var fl = l.filtro;
          Object.keys(fl).forEach(function (k) { if (k === 'ultima') $('#ultima').checked = fl.ultima; else if (k === 'tipo') { if (fl.tipo !== 'painel') { modo = 'tabelas'; $('#tipo').value = fl.tipo; } } else $('#' + k).value = fl[k]; });
          marcarModo(); carregar().catch(function (e) { toast(e.message); });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        if (l.filtro) { el.addEventListener('click', ir); el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } }); }
      });
    }
    function desenharPainel(pn) {
      var k = pn.kpis;
      $('#tiles').innerHTML = [['Autoavaliações no período', k.avaliacoes, 'todas as rodadas'], ['Processos', k.processos, k.mediaRodadas + ' rodada(s) em média'],
        ['Aprovados pelo CoE', k.aprovados, 'inclui com ressalva'], ['Aguardando CoE', k.aguardando, k.devolvidos + ' devolvido(s)']].map(function (t) {
        return '<div class="tile"><span>' + h(t[0]) + '</span><b>' + t[1] + '</b><small>' + h(t[2]) + '</small></div>'; }).join('');
      var idAnalista = {}; filtros.analistas.forEach(function (a) { idAnalista[a.name] = String(a.id); });
      series = {
        regras: pn.regras.map(function (r) { return { rotulo: r.regra + ' · ' + r.item, valor: r.ocorrencias,
          tip: [r.regra + (r.item ? ' – ' + r.item : ''), r.ocorrencias + ' reprovação(ões) em ' + r.processos + ' processo(s)', r.lista] }; }),
        rodadas: pn.rodadas.map(function (r) { return { rotulo: r.rotulo, valor: r.valor, tip: [r.rotulo, r.valor + ' rodada(s)', 'Situação: ' + COE_ST[r.situacao], 'Clique para ver as rodadas'],
          filtro: { processo: r.rotulo, tipo: 'processos', ultima: false } }; }),
        situacao: pn.situacao.map(function (r) { return { rotulo: COE_ST[r.rotulo], valor: r.valor, cor: COR_COE[r.rotulo], tip: [COE_ST[r.rotulo], r.valor + ' processo(s) na última rodada', 'Clique para listar'],
          filtro: { coe: r.rotulo, tipo: 'processos', ultima: true } }; }),
        analistas: pn.analistas.map(function (r) { return { rotulo: r.rotulo, valor: r.valor, tip: [r.rotulo, r.valor + ' processo(s) avaliado(s)', 'Clique para filtrar'],
          filtro: idAnalista[r.rotulo] ? { analista: idAnalista[r.rotulo], tipo: 'painel' } : null }; }),
        avaliadores: pn.avaliadores.map(function (r) { return { rotulo: r.rotulo, valor: r.valor, tip: [r.rotulo, r.valor + ' processo(s) com decisão do CoE'] }; }),
        areas: pn.areas.map(function (r) { return { rotulo: r.rotulo, valor: r.valor, tip: [r.rotulo, r.valor + ' processo(s)', 'Clique para filtrar'], filtro: { area: r.rotulo, tipo: 'painel' } }; })
      };
      $('#painel').innerHTML =
        grafico('regras', 'Itens mais reprovados', 'Regras com bloqueante aberto ou justificativa não aceita, somando todas as rodadas', 'barras', 'Passe o mouse para ver em quais processos.') +
        '<div class="grid g2">' +
        grafico('rodadas', 'Rodadas por processo', 'Quantas rodadas cada processo precisou', 'colunas') +
        grafico('situacao', 'Situação no CoE', 'Última rodada de cada processo', 'rosca') +
        grafico('analistas', 'Processos por analista', 'Processos distintos avaliados', 'barras') +
        grafico('avaliadores', 'Processos por avaliador do CoE', 'Processos com decisão registrada', 'barras') +
        '</div>' + grafico('areas', 'Processos por área responsável', 'Processos distintos por área informada na autoavaliação', 'pizza');
      ligarMarcas($('#painel'));
      $$('[data-forma]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          var id = sel.getAttribute('data-forma');
          formaDe[id] = sel.value;
          try { localStorage.setItem('coe-graficos', JSON.stringify(formaDe)); } catch (e) { /* sem armazenamento: vale so nesta tela */ }
          $('#gb-' + id).innerHTML = corpoGrafico(id);
          ligarMarcas($('#painel'));
        });
      });
    }
    function metaFiltros() {
      var p = ['Período: ' + dataBR(f.de + 'T12:00:00Z') + ' a ' + dataBR(f.ate + 'T12:00:00Z')];
      if (f.processo) p.push('Processo: ' + f.processo);
      if (f.analista) p.push('Analista: ' + $('#analista').selectedOptions[0].textContent);
      if (f.area) p.push('Área: ' + f.area);
      if (f.situacao) p.push('Situação: ' + $('#situacao').selectedOptions[0].textContent);
      if (f.coe) p.push('No CoE: ' + COE_ST[f.coe]);
      if (f.severidade) p.push($('#severidade').selectedOptions[0].textContent);
      if (f.capitulo) p.push('Capítulo ' + $('#capitulo').selectedOptions[0].textContent);
      if (f.manual) p.push('Manual v' + f.manual);
      return [p.join(' · '), 'Gerado em ' + dataBR(new Date().toISOString(), true) + ' por ' + S.me.user.name + (dados.tipo === 'painel' ? ' · ' + dados.painel.kpis.avaliacoes + ' autoavaliação(ões) no período' : ' · ' + dados.linhas.length + ' registro(s)')];
    }
    // No painel, cada grafico vira uma tabela na exportacao
    function secoesPainel() {
      var nomes = { regras: 'Itens mais reprovados', rodadas: 'Rodadas por processo', situacao: 'Situação no CoE', analistas: 'Processos por analista', avaliadores: 'Processos por avaliador', areas: 'Processos por área' };
      return Object.keys(nomes).map(function (k) {
        if (k === 'regras') return { titulo: nomes[k], nome: nomes[k], colunas: ['Regra', 'Item', 'Reprovações', 'Processos'], linhas: dados.painel.regras.map(function (r) { return [r.regra, r.item, r.ocorrencias, r.lista]; }), larguras: [12, 60, 14, 50] };
        return { titulo: nomes[k], nome: nomes[k], colunas: [k === 'rodadas' ? 'Processo' : k === 'situacao' ? 'Situação' : k === 'areas' ? 'Área' : 'Nome', 'Quantidade'],
          linhas: series[k].map(function (l) { return [l.rotulo, l.valor]; }), larguras: [50, 14] };
      });
    }
    function tabela() { var T = TIPOS[dados.tipo]; return { colunas: T.cols.map(function (c) { return c[1]; }), linhas: dados.linhas.map(function (l) { return T.cols.map(function (c) { return celula(c[0], l[c[0]]); }); }) }; }
    on('#aplicar', 'click', function () { carregar().catch(function (e) { toast(e.message); }); });
    function marcarModo() {
      $$('[data-modo]').forEach(function (b) { var on_ = b.getAttribute('data-modo') === modo; b.classList.toggle('on', on_); b.setAttribute('aria-selected', on_); });
      $('#ftipo').style.display = modo === 'painel' ? 'none' : '';
      $('#ultima').parentNode.style.display = modo === 'painel' ? 'none' : '';
    }
    $$('[data-modo]').forEach(function (b) { b.addEventListener('click', function () { modo = b.getAttribute('data-modo'); marcarModo(); carregar().catch(function (e) { toast(e.message); }); }); });
    marcarModo();
    on('#tipo', 'change', function () { carregar().catch(function (e) { toast(e.message); }); });
    on('#limpar', 'click', function () { ['processo', 'analista', 'area', 'situacao', 'coe', 'severidade', 'capitulo', 'manual'].forEach(function (k) { $('#' + k).value = ''; }); $('#ultima').checked = true; carregar(); });
    on('#rp', 'click', async function () {
      if (dados.tipo === 'painel') { try { toast('Gerando o PDF…'); await gerarPdf({ titulo: rep.title + ' – Painel', linhasMeta: metaFiltros(), secoes: secoesPainel().map(function (x) { return { titulo: x.titulo, colunas: x.colunas, linhas: x.linhas }; }) }, 'painel-' + f.de + '-' + f.ate); } catch (e) { toast(e.message); } return; }
      try { toast('Gerando o PDF…'); var t = tabela(); await gerarPdf({ titulo: rep.title + ' – ' + TIPOS[dados.tipo].nome, linhasMeta: metaFiltros(), secoes: [{ colunas: t.colunas, linhas: t.linhas }] }, slug(TIPOS[dados.tipo].nome) + '-' + f.de + '-' + f.ate); }
      catch (e) { toast(e.message); }
    });
    on('#rx', 'click', async function () {
      if (dados.tipo === 'painel') { try { toast('Gerando o Excel…'); await gerarXlsx({ titulo: rep.title + ' – Painel', linhasMeta: metaFiltros() }, secoesPainel(), 'painel-' + f.de + '-' + f.ate); } catch (e) { toast(e.message); } return; }
      try { toast('Gerando o Excel…'); var t = tabela(); await gerarXlsx({ titulo: rep.title + ' – ' + TIPOS[dados.tipo].nome, linhasMeta: metaFiltros() }, [{ nome: TIPOS[dados.tipo].nome, colunas: t.colunas, linhas: t.linhas, larguras: t.colunas.map(function (c) { return /Coment|Item|Processos/.test(c) ? 50 : 18; }) }], slug(TIPOS[dados.tipo].nome) + '-' + f.de + '-' + f.ate); }
      catch (e) { toast(e.message); }
    });
    ['rt', 'rs', 'rf'].forEach(function (id, i) { on('#' + id, 'input', function (e) { $(['#pvt', '#pvs', '#pvf'][i]).textContent = e.target.value; }); });
    $$('[data-logo]').forEach(function (inp) {
      inp.addEventListener('change', async function () {
        var file = inp.files[0]; if (!file) return;
        if (file.type !== 'image/png') { toast('A logo precisa ser PNG.'); return; }
        if (file.size > 1024 * 1024) { toast('Logo acima de 1 MB.'); return; }
        try { await api('/api/logo/' + inp.getAttribute('data-logo'), { method: 'PUT', body: file, raw: true, type: 'image/png' }); toast('Logo salva.'); viewRelatorios(); } catch (e) { toast(e.message); }
      });
    });
    $$('[data-rmlogo]').forEach(function (b) { b.addEventListener('click', async function () { await api('/api/logo/' + b.getAttribute('data-rmlogo'), { method: 'DELETE' }); toast('Logo removida.'); viewRelatorios(); }); });
    on('#rsave', 'click', async function () {
      var inc = {}; $$('[data-inc]').forEach(function (c) { inc[c.getAttribute('data-inc')] = c.checked; });
      try {
        var r = await api('/api/config', { method: 'PUT', body: { report: { title: $('#rt').value, subtitle: $('#rs').value, footer: $('#rf').value, orientation: $('#ro').value, color: $('#rc').value, include: inc } } });
        rep = r.config.report; toast('Configuração do relatório salva.');
      } catch (e) { toast(e.message); }
    });
    carregar().catch(function (e) { toast(e.message); });
  }

  async function baixarAvaliacao(id, tipo) {
    try { toast('Gerando o arquivo…'); await exportarAvaliacao(await api('/api/evaluations/' + id), tipo); } catch (e) { toast(e.message); }
  }
  async function excluirAvaliacao(id) {
    if (!confirm('Excluir esta rodada e os prints anexados? As outras rodadas do processo continuam. Não dá para desfazer.')) return false;
    try { await api('/api/evaluations/' + id, { method: 'DELETE' }); toast('Rodada excluída.'); await carregarMe(); return true; } catch (e) { toast(e.message); return false; }
  }
  async function excluirProcesso(nome, app) {
    if (!confirm('Excluir o processo "' + nome + '"' + (app ? ' (app ' + app + ')' : '') + ' inteiro: todas as rodadas, de todos os analistas, com os prints? Não dá para desfazer.')) return false;
    try {
      var r = await api('/api/processes/delete', { method: 'POST', body: { process_name: nome, app_code: app || '' } });
      toast('Processo excluído (' + r.excluidas + ' rodada(s)).'); await carregarMe(); return true;
    } catch (e) { toast(e.message); return false; }
  }
  // Botoes de exclusao (so admin) usados no historico e nos relatorios
  function botoesExcluir(id, nome, app) {
    return '<button class="link danger" data-del-rod="' + id + '">Excluir rodada</button> · <button class="link danger" data-del-proc="' + h(nome) + '" data-del-app="' + h(app || '') + '">Excluir processo</button>';
  }
  function ligarExcluir(depois) {
    $$('[data-del-rod]').forEach(function (b) { b.addEventListener('click', async function () { if (await excluirAvaliacao(b.getAttribute('data-del-rod'))) depois(); }); });
    $$('[data-del-proc]').forEach(function (b) { b.addEventListener('click', async function () { if (await excluirProcesso(b.getAttribute('data-del-proc'), b.getAttribute('data-del-app'))) depois(); }); });
  }

  /* ------------------------------ admin: avaliacoes recebidas ------------------------------ */
  async function viewAvaliacoes() {
    await carregarMe();
    var r = await api('/api/coe/queue');
    var aba = 'enviado';
    function desenhar() {
      var lista = r.evaluations.filter(function (e) { return aba === 'todas' || (aba === 'enviado' ? aguardandoCoe(e.coe_status) : !aguardandoCoe(e.coe_status)); });
      var n = function (f) { return r.evaluations.filter(f).length; };
      $app.innerHTML = layout('#/admin/avaliacoes',
        '<div class="head"><div><h1>Avaliações recebidas</h1><p class="lead">Rodadas que os analistas enviaram ao CoE. Pendências bloqueantes chegam com a justificativa do analista: aceite, aceite com ressalva ou devolva, sempre com instrução.</p></div></div>' +
        '<section class="card flush"><div class="row between" style="padding:16px 18px;border-bottom:1px solid var(--line)"><div class="tabs" role="tablist">' +
        [['enviado', 'Aguardando CoE · ' + n(function (e) { return aguardandoCoe(e.coe_status); })], ['avaliadas', 'Avaliadas · ' + n(function (e) { return !aguardandoCoe(e.coe_status); })], ['todas', 'Todas · ' + r.evaluations.length]].map(function (x) {
          return '<button type="button" role="tab" data-aba="' + x[0] + '" class="' + (aba === x[0] ? 'on' : '') + '" aria-selected="' + (aba === x[0]) + '">' + h(x[1]) + '</button>'; }).join('') + '</div></div>' +
        '<div class="tbl-wrap"><table class="tbl" style="min-width:900px"><thead><tr><th>Processo</th><th>Analista</th><th>Rodada</th><th>Enviado em</th><th>Bloqueantes abertos</th><th>Justificados</th><th>Situação</th><th><span class="sr">Ações</span></th></tr></thead><tbody>' +
        (lista.length ? lista.map(function (e) {
          return '<tr><td><b>' + h(e.process_name) + '</b>' + (e.app_code ? ' <span class="muted tiny">app ' + h(e.app_code) + '</span>' : '') + '</td><td>' + h(e.analista) + '</td><td>' + e.round + '</td>' +
            '<td>' + h(dataBR(e.submitted_at, true)) + '</td><td style="font-weight:700;color:' + (e.b_open ? 'var(--bad)' : 'var(--ok)') + '">' + e.b_open + '</td><td>' + e.justificados + '</td>' +
            '<td>' + stCoe(e.coe_status) + (e.revisor && !aguardandoCoe(e.coe_status) ? '<div class="tiny muted">' + h(e.revisor) + ' · ' + h(dataBR(e.reviewed_at, true)) + '</div>' : '') + '</td>' +
            '<td><a href="#/resultado/' + e.id + '"><b>' + (aguardandoCoe(e.coe_status) ? 'Avaliar' : 'Abrir') + '</b></a></td></tr>';
        }).join('') : '<tr><td colspan="8" class="muted">' + (aba === 'enviado' ? 'Nada aguardando o CoE.' : 'Nenhuma avaliação.') + '</td></tr>') +
        '</tbody></table></div></section>');
      bindLayout();
      $$('[data-aba]').forEach(function (b) { b.addEventListener('click', function () { aba = b.getAttribute('data-aba'); desenhar(); }); });
    }
    desenhar();
  }

  /* ------------------------------ admin: orientacoes a IA ------------------------------ */
  async function viewOrientacoes() {
    var lista = (await api('/api/orientacoes')).orientacoes.map(function (o) { return Object.assign({}, o); });
    function desenhar() {
      $app.innerHTML = layout('#/admin/orientacoes',
        '<div class="head"><div><h1>Orientações à IA</h1><p class="lead">Decisões do CoE que a IA recebe em toda análise, antes das regras. Use para corrigir interpretações erradas (ex.: uma exceção aceita, um dado que o export não traz). Também nascem da tela de avaliação, ao marcar "Guardar como orientação".</p></div>' +
        '<button class="btn" id="add">Adicionar orientação</button></div>' +
        '<div class="note info">Em <b>Regras</b>, informe os códigos separados por vírgula (ex.: <b>S17</b> ou <b>1.3</b>, que vale para 1.3-1, 1.3-2…). Vazio vale para todas. A orientação só é enviada quando uma dessas regras está na análise.</div>' +
        '<section class="card flush"><div class="tbl-wrap"><table class="tbl" style="min-width:900px"><thead><tr><th style="width:130px">Regras</th><th>Orientação</th><th style="width:200px">Origem</th><th style="width:80px">Ativa</th><th style="width:70px"><span class="sr">Excluir</span></th></tr></thead><tbody>' +
        (lista.length ? lista.map(function (o, i) {
          return '<tr><td><input type="text" data-or="' + i + '" value="' + h(o.regras) + '" placeholder="todas" style="width:110px"></td>' +
            '<td><textarea rows="2" data-ot="' + i + '" style="width:100%">' + h(o.texto) + '</textarea></td>' +
            '<td class="tiny muted">' + h(o.origem || '') + (o.autor ? '<br>' + h(o.autor) : '') + (o.em ? ' · ' + h(dataBR(o.em)) : '') + '</td>' +
            '<td><label class="check"><input type="checkbox" data-oa="' + i + '"' + (o.ativa !== false ? ' checked' : '') + '>Sim</label></td>' +
            '<td><button class="link" data-ox="' + i + '">Excluir</button></td></tr>';
        }).join('') : '<tr><td colspan="5" class="muted">Nenhuma orientação.</td></tr>') +
        '</tbody></table></div></section><div class="row end"><button class="btn primary" id="salvar">Salvar orientações</button></div>');
      bindLayout();
      $$('[data-or]').forEach(function (x) { x.addEventListener('input', function () { lista[+x.getAttribute('data-or')].regras = x.value; }); });
      $$('[data-ot]').forEach(function (x) { x.addEventListener('input', function () { lista[+x.getAttribute('data-ot')].texto = x.value; }); });
      $$('[data-oa]').forEach(function (x) { x.addEventListener('change', function () { lista[+x.getAttribute('data-oa')].ativa = x.checked; }); });
      $$('[data-ox]').forEach(function (x) { x.addEventListener('click', function () { lista.splice(+x.getAttribute('data-ox'), 1); desenhar(); }); });
      on('#add', 'click', function () { lista.unshift({ regras: '', texto: '', ativa: true, origem: 'Cadastro manual' }); desenhar(); var t = $('[data-ot="0"]'); if (t) t.focus(); });
      on('#salvar', 'click', async function () {
        try { lista = (await api('/api/orientacoes', { method: 'PUT', body: { orientacoes: lista } })).orientacoes; toast('Orientações salvas. Valem na próxima análise com IA.'); desenhar(); }
        catch (e) { toast(e.message); }
      });
    }
    desenhar();
  }

  /* ------------------------------ admin: IA, uso e limites ------------------------------ */
  async function viewUso() {
    var dd = await Promise.all([api('/api/config'), api('/api/users'), api('/api/admin/usage')]);
    var cfg = dd[0].config, log = dd[0].log, users = dd[1].users, uso = dd[2];
    function opt(v, t, sel) { return '<option value="' + h(v) + '"' + (v === sel ? ' selected' : '') + '>' + h(t) + '</option>'; }
    var URLS = { openrouter: 'https://openrouter.ai/api/v1', anthropic: 'https://api.anthropic.com/v1', azure: '', openai: '' };
    $app.innerHTML = layout('#/admin/uso',
      '<div class="head"><div><h1>IA, uso e limites</h1><p class="lead">Só as análises com IA contam no limite. Conferências automáticas são ilimitadas.</p></div><a class="btn" href="/api/admin/backup">Exportar backup</a></div>' +
      '<div class="grid g3"><div class="tile"><span>Análises com IA hoje</span><b>' + uso.analises + (cfg.limits_enabled ? ' de ' + cfg.limit_total : '') + '</b>' +
      (cfg.limits_enabled ? '<div class="bar" style="background:var(--line2);height:8px"><i style="height:8px;width:' + Math.min(100, Math.round(uso.analises / Math.max(1, cfg.limit_total) * 100)) + '%"></i></div>' : '') + '</div>' +
      '<div class="tile"><span>Falhas hoje (também contam)</span><b>' + uso.falhas + '</b><small>Modelo indisponível ou limite do provedor</small></div>' +
      '<div class="tile"><span>Usuários ativos</span><b>' + uso.ativos + '</b><small>' + (cfg.limits_enabled ? cfg.limit_user + ' análises por pessoa por dia' : 'sem limite diário') + '</small></div></div>' +
      '<section class="card"><div class="row between" style="align-items:flex-start"><div><h2>Configuração da IA</h2><p class="small muted" style="margin:4px 0 0">Pode ser alterada a qualquer momento. Vale na hora para as próximas análises; as já feitas registram o modelo usado.</p></div>' +
      (cfg.ai_last_test ? st('conforme', 'Conexão testada em ' + dataBR(cfg.ai_last_test, true)) : st('confirmar', 'Conexão ainda não testada')) + '</div>' +
      '<fieldset><legend>Provedor e modelo</legend><div class="grid g2">' +
      '<label class="f">Provedor<select id="prov">' + opt('openrouter', 'OpenRouter', cfg.ai_provider) + opt('anthropic', 'Anthropic (Claude)', cfg.ai_provider) + opt('azure', 'Azure OpenAI', cfg.ai_provider) + opt('openai', 'Outro compatível com a API da OpenAI', cfg.ai_provider) + '</select></label>' +
      '<label class="f">Endereço da API<input type="text" id="url" value="' + h(cfg.ai_url) + '"><small>Azure: endereço completo do deployment, com api-version.</small></label>' +
      '<label class="f">Modelo principal<input type="text" id="mod" value="' + h(cfg.ai_model) + '"><small>Nome do modelo no provedor. No OpenRouter, os gratuitos terminam em :free.</small></label>' +
      '<label class="f">Modelo reserva (usado se o principal falhar)<input type="text" id="fb" value="' + h(cfg.ai_fallback) + '" placeholder="Opcional"></label></div>' +
      '<div class="row" style="align-items:flex-end"><label class="f" style="flex:1 1 320px">Chave da API<input type="text" readonly value="' + (dd[0].chaveConfigurada ? 'Guardada no Cloudflare (segredo OPENROUTER_API_KEY)' : 'NÃO CONFIGURADA: grave o segredo OPENROUTER_API_KEY no painel') + '"></label>' +
      '<button class="btn" id="trocar">Substituir chave</button><button class="btn dark" id="testar">Testar conexão</button></div>' +
      '<div class="note info" id="chave-info" style="display:none">Por segurança, a chave não passa pelo app. No painel do Cloudflare, abra <b>Workers &amp; Pages</b> > <b>coe-autoavaliacao</b> > <b>Settings</b> > <b>Variables and Secrets</b>, edite o segredo <b>OPENROUTER_API_KEY</b> (tipo Secret) e salve. Vale na hora; depois clique em Testar conexão.</div>' +
      '<label class="check"><input type="checkbox" id="mask"' + (cfg.ai_mask ? ' checked' : '') + '>Mascarar IDs, URLs e e-mails antes de enviar à IA</label>' +
      '<label class="check"><input type="checkbox" id="iab"' + (cfg.ai_bloqueia !== false ? ' checked' : '') + '>Não conformidade apontada pela IA em regra bloqueante bloqueia o envio ' +
      '<span class="muted small">(desmarcado: fica "A verificar" e o CoE confere)</span></label>' +
      '<p class="small muted" style="margin:0">Para a IA seguir as decisões do CoE, cadastre em <a href="#/admin/orientacoes">Orientações à IA</a>.</p></fieldset>' +
      '<fieldset><legend>Limites de uso</legend><label class="check"><input type="checkbox" id="lim"' + (cfg.limits_enabled ? ' checked' : '') + '>Aplicar limite diário <span class="muted small">(desmarque ao usar um modelo pago sem restrição)</span></label>' +
      '<div class="grid g2"><label class="f">Por analista por dia<input type="number" min="0" id="lu" value="' + cfg.limit_user + '"></label><label class="f">Total da equipe por dia<input type="number" min="0" id="lt" value="' + cfg.limit_total + '"></label></div>' +
      '<div class="note warn">Com modelo gratuito do OpenRouter, o teto é de 50 análises por dia sem créditos (1.000 com US$ 10 em créditos), e falhas também contam. O limite do provedor reinicia às 21h (Brasília).</div></fieldset>' +
      '<div class="row end"><button class="btn primary" id="salvar">Salvar configuração</button></div>' +
      '<div><b class="small">Histórico de alterações</b><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Quem</th><th>Alteração</th></tr></thead><tbody>' +
      (log.length ? log.map(function (l) { return '<tr><td style="white-space:nowrap">' + h(dataBR(l.at, true)) + '</td><td>' + h(l.name || '') + '</td><td>' + h(l.change) + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="muted">Sem alterações.</td></tr>') +
      '</tbody></table></div></div></section>' +
      '<section class="card flush"><div class="card-head"><h2>Usuários</h2><span class="small muted">Só e-mails @vitru.com.br</span></div>' +
      '<form id="nu" class="row" style="padding:8px 18px 16px;align-items:flex-end"><label class="f" style="flex:1 1 200px">Nome<input type="text" id="nn" required></label>' +
      '<label class="f" style="flex:1 1 240px">E-mail<input type="email" id="ne" required placeholder="nome@vitru.com.br"></label>' +
      '<label class="f" style="flex:0 1 160px">Perfil<select id="np"><option value="analista">Analista</option><option value="admin">Admin CoE</option></select></label>' +
      '<button class="btn primary" type="submit">Criar e gerar link de convite</button></form><div id="linkbox"></div>' +
      '<div class="tbl-wrap"><table class="tbl" style="min-width:960px"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Hoje</th><th>No mês</th><th>Situação</th><th>Ações</th></tr></thead><tbody>' +
      users.map(function (u) {
        var sit = u.status === 'ativo' ? st('ativo', 'Ativo') : u.status === 'convite' ? st('convite', 'Convite pendente') : st('inativo', 'Desativado');
        var eu = u.id === S.me.user.id;
        return '<tr><td><b>' + h(u.name) + '</b></td><td>' + h(u.email) + '</td><td><select data-role="' + u.id + '"' + (eu ? ' disabled' : '') + ' aria-label="Perfil">' + opt('analista', 'Analista', u.role) + opt('admin', 'Admin CoE', u.role) + '</select></td>' +
          '<td>' + u.hoje + (cfg.limits_enabled ? ' de ' + cfg.limit_user : '') + '</td><td>' + u.mes + '</td><td>' + sit + '</td><td><div class="row">' +
          (u.status !== 'inativo' ? '<button class="btn sm" data-inv="' + u.id + '" data-nome="' + h(u.name) + '">' + (u.status === 'convite' ? 'Novo link de convite' : 'Gerar link de senha') + '</button>' : '') +
          (eu ? '' : u.status === 'inativo' ? '<button class="btn sm" data-react="' + u.id + '">Reativar</button>' : '<button class="btn sm danger" data-off="' + u.id + '" data-nome="' + h(u.name) + '">Desativar</button>') + '</div></td></tr>';
      }).join('') + '</tbody></table></div></section>');
    bindLayout();
    on('#prov', 'change', function (e) { if (URLS[e.target.value]) $('#url').value = URLS[e.target.value]; });
    on('#trocar', 'click', function () { var b = $('#chave-info'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; });
    on('#testar', 'click', async function () {
      var b = $('#testar'); b.disabled = true; b.textContent = 'Testando…';
      try { var r = await api('/api/config/test', { method: 'POST', body: {} }); toast('Conexão OK com ' + r.modelo + (r.aviso ? ' (' + r.aviso + ')' : '')); viewUso(); }
      catch (e) { toast('Falhou: ' + e.message); b.disabled = false; b.textContent = 'Testar conexão'; }
    });
    on('#salvar', 'click', async function () {
      try {
        await api('/api/config', { method: 'PUT', body: { ai_provider: $('#prov').value, ai_url: $('#url').value, ai_model: $('#mod').value, ai_fallback: $('#fb').value,
          ai_mask: $('#mask').checked, ai_bloqueia: $('#iab').checked, limits_enabled: $('#lim').checked, limit_user: $('#lu').value, limit_total: $('#lt').value } });
        toast('Configuração salva.'); S.me = null; await carregarMe(); viewUso();
      } catch (e) { toast(e.message); }
    });
    function mostrarLink(nome, r) {
      $('#linkbox').innerHTML = '<div class="note info row" style="margin:0 18px 16px"><span style="flex:1 1 360px;min-width:0">Link para <b>' + h(nome) + '</b>, válido até ' + h(dataBR(r.expires_at, true)) +
        ' · envie pelo Teams:<br><code style="word-break:break-all">' + h(r.link) + '</code></span><button class="btn sm dark" id="copiar">Copiar link</button></div>';
      on('#copiar', 'click', function () { navigator.clipboard.writeText(r.link).then(function () { toast('Link copiado.'); }, function () { toast('Copie o link manualmente.'); }); });
    }
    on('#nu', 'submit', async function (ev) {
      ev.preventDefault();
      try {
        var nome = $('#nn').value;
        var r = await api('/api/users', { method: 'POST', body: { name: nome, email: $('#ne').value, role: $('#np').value } });
        await viewUso(); mostrarLink(nome, r);
      } catch (e) { toast(e.message); }
    });
    $$('[data-inv]').forEach(function (b) { b.addEventListener('click', async function () { try { mostrarLink(b.getAttribute('data-nome'), await api('/api/users/' + b.getAttribute('data-inv') + '/invite', { method: 'POST', body: {} })); } catch (e) { toast(e.message); } }); });
    $$('[data-off]').forEach(function (b) { b.addEventListener('click', async function () {
      if (!confirm('Desativar ' + b.getAttribute('data-nome') + '? A pessoa perde o acesso na hora.')) return;
      try { await api('/api/users/' + b.getAttribute('data-off'), { method: 'PATCH', body: { status: 'inativo' } }); viewUso(); } catch (e) { toast(e.message); } }); });
    $$('[data-react]').forEach(function (b) { b.addEventListener('click', async function () { try { await api('/api/users/' + b.getAttribute('data-react'), { method: 'PATCH', body: { status: 'reativar' } }); viewUso(); } catch (e) { toast(e.message); } }); });
    $$('[data-role]').forEach(function (s) { s.addEventListener('change', async function () { try { await api('/api/users/' + s.getAttribute('data-role'), { method: 'PATCH', body: { role: s.value } }); toast('Perfil atualizado.'); } catch (e) { toast(e.message); } }); });
  }

  render();
})();
