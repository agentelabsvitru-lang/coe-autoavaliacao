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
    var r = await fetch(path, init);
    var j = null;
    try { j = await r.json(); } catch (e) { j = {}; }
    if (r.status === 401 && !opts.allow401) { S.me = null; go('#/login'); throw new Error(j.error || 'Sessão expirada.'); }
    if (!r.ok) { var err = new Error(j.error || ('Erro ' + r.status)); err.status = r.status; err.data = j; throw err; }
    return j;
  }
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
      item('#/nova', 'Nova autoavaliação') + item('#/historico', 'Minhas autoavaliações') +
      (admin ? '<span class="nav-title sep">Administração CoE</span>' + item('#/admin/padroes', 'Padrões do manual') +
        item('#/admin/conferencias', 'Conferências automáticas') + item('#/admin/relatorios', 'Relatórios') + item('#/admin/uso', 'IA, uso e limites') : '') +
      '</nav><div class="side-foot">' +
      '<div class="quota"><small>Análises com IA hoje</small><b>' + (lim.ativo ? u.meu + ' de ' + lim.porAnalista + ' usadas' : u.meu + ' (sem limite)') + '</b>' +
      (lim.ativo ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '<small>Renova à meia-noite</small></div>' +
      '<div class="me"><div class="avatar">' + h(iniciais(me.user.name)) + '</div><div><b>' + h(me.user.name) + '</b><small>' + (admin ? 'Admin CoE' : 'Analista') + '</small></div>' +
      '<button type="button" id="sair">Sair</button></div></div></aside>' +
      '<main class="main"><div class="wrap">' + conteudo + '</div></main></div>';
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
    [/^#\/admin\/relatorios$/, viewRelatorios, 'admin'], [/^#\/admin\/uso$/, viewUso, 'admin']
  ];
  async function render() {
    var hash = location.hash || '#/nova';
    for (var i = 0; i < rotas.length; i++) {
      var m = rotas[i][0].exec(hash);
      if (!m) continue;
      try {
        if (rotas[i][2]) {
          if (!S.me) { try { await carregarMe(); } catch (e) { return; } }
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
    var prog = $('#prog'); prog.style.display = 'flex';
    var passos = [];
    function passo(txt, cls) { passos.push({ txt: txt, cls: cls }); desenhar(); return passos.length - 1; }
    function marca(i, cls, txt) { passos[i].cls = cls; if (txt) passos[i].txt = txt; desenhar(); }
    function desenhar() { prog.innerHTML = '<h2>Andamento</h2><div class="progress">' + passos.map(function (p) { return '<div class="' + p.cls + '">' + h(p.txt) + '</div>'; }).join('') + '</div>'; }
    try {
      var p1 = passo('Lendo os arquivos', 'run');
      var todos = [].concat(Array.from(fx), Array.from(fd), Array.from($('#fjs').files), Array.from($('#fcss').files));
      var files = await Promise.all(todos.map(async function (f) { return { name: f.name, text: await readText(f) }; }));
      var P = E.parseFiles(files, { processName: proc });
      if (P.notes.length) throw new Error(P.notes.join(' | '));
      if (!P.xls) throw new Error('Não reconheci o export .xls da Zeev.');
      var resumo = E.summary(P);
      marca(p1, 'done', 'Arquivos lidos: ' + [resumo.xls, resumo.diagram].filter(Boolean).join(' · '));
      var p2 = passo('Rodando as conferências automáticas', 'run');
      var dados = await Promise.all([api('/api/checks'), api('/api/manual')]);
      var auto = E.runChecks(P, dados[0].checks);
      var manual = dados[1].vigente;
      var rules = manual ? manual.rules : [];
      marca(p2, 'done', E.CHECKS.length + ' conferências automáticas concluídas');
      var resposta = null, modelo = '', avisoIA = '';
      var autoRules = {}; auto.forEach(function (a) { autoRules[a.rule] = 1; });
      var regrasIA = rules.filter(function (r) { return r.aval === 'ia' && !autoRules[r.code]; });
      if (usarIA && regrasIA.length) {
        var p3 = passo('Analisando ' + regrasIA.length + ' regras com IA (pode levar até 1 minuto)', 'run');
        try {
          var pr = E.aiPrompt(P, regrasIA, true);
          var r = await api('/api/ai/evaluate', { method: 'POST', body: pr });
          resposta = E.parseAiAnswer(r.texto); modelo = r.modelo; avisoIA = r.aviso;
          marca(p3, 'done', 'Análise por IA concluída (' + r.modelo + ')');
        } catch (e) {
          marca(p3, 'err', 'IA indisponível: ' + e.message + '. Os itens de IA ficam como "A verificar".');
        }
      }
      var items = E.buildItems(auto, rules, resposta);
      var p4 = passo('Salvando a rodada', 'run');
      var salvo = await api('/api/evaluations', { method: 'POST', body: {
        process_name: proc, app_code: S.lastFiles.app, flow_version: S.lastFiles.ver, area: S.lastFiles.area,
        manual_version: manual ? manual.version : '', with_ai: !!resposta, model: modelo, items: items,
        risks: resposta ? resposta.riscos.slice(0, 6) : [], summary: Object.assign(resumo, { arquivos: files.map(function (f) { return f.name; }), avisoIA: avisoIA })
      } });
      marca(p4, 'done', 'Rodada ' + salvo.round + ' salva');
      go('#/resultado/' + salvo.id);
    } catch (e) {
      passo(e.message, 'err');
      btn.disabled = false;
    }
  }

  /* ------------------------------ resultado ------------------------------ */
  async function viewResultado(id) {
    await carregarMe();
    var ev = await api('/api/evaluations/' + id);
    var dono = ev.user_id === S.me.user.id;
    var filtro = { sev: 'todos', status: 'pend', origem: '' };
    function desenhar() {
      var t = E.totals(ev.items);
      var lista = ev.items.filter(function (i) {
        if (filtro.sev !== 'todos' && i.sev !== filtro.sev) return false;
        if (filtro.origem && i.origin !== filtro.origem) return false;
        if (filtro.status === 'abertos' && ['aberto', 'confirmar', 'verificar'].indexOf(i.status) < 0) return false;
        return true;
      }).sort(function (a, b) {
        if (filtro.status === 'pend' || filtro.status === 'abertos') { var d = (ORDEM[a.status] || 9) - (ORDEM[b.status] || 9); if (d) return d; }
        return (a.sev === b.sev ? 0 : a.sev === 'B' ? -1 : 1);
      });
      var nB = ev.items.filter(function (i) { return i.sev === 'B'; }).length;
      var banner = t.pronto
        ? '<div class="banner ok" role="status"><div><b>Pronto para o CoE</b>Nenhum bloqueante aberto e checklist confirmado. Gere o relatório e envie junto com a solicitação ao CoE.</div></div>'
        : '<div class="banner bad" role="status"><div><b>Ainda não está pronto para o CoE: ' + t.bAbertos + ' bloqueante(s) aberto(s)</b>' +
          'Corrija os bloqueantes' + (t.confirmar ? ' e confirme os ' + t.confirmar + ' itens de checklist' : '') + '. Recomendados não impedem o envio, mas ficam registrados no relatório.</div></div>';
      $app.innerHTML = layout('#/historico',
        '<div class="head"><div><a class="back" href="#/historico">‹ Minhas autoavaliações</a><h1>' + h(ev.process_name) + ' · rodada ' + ev.round + '</h1>' +
        '<p class="lead">' + [ev.app_code ? 'App ' + h(ev.app_code) : '', ev.flow_version ? 'versão ' + h(ev.flow_version) : '', h(dataBR(ev.created_at, true)),
          ev.manual_version ? 'Manual v' + h(ev.manual_version) : 'sem manual', ev.with_ai ? 'com IA (' + h(ev.model) + ')' : 'sem IA', dono ? '' : 'analista: ' + h(ev.analista)].filter(Boolean).join(' · ') + '</p></div>' +
        '<div class="row"><button class="btn" id="xls">Exportar Excel</button><button class="btn" id="pdf">Exportar PDF</button>' + (dono ? '<a class="btn primary" href="#/nova">Nova rodada</a>' : '') + '</div></div>' +
        banner +
        (ev.summary && ev.summary.avisoIA ? '<div class="note warn">' + h(ev.summary.avisoIA) + '</div>' : '') +
        '<div class="grid g4"><div class="tile"><span>Bloqueantes abertos</span><b style="color:var(--bad)">' + t.bAbertos + '</b><small>de ' + nB + ' avaliados</small></div>' +
        '<div class="tile"><span>Para confirmar</span><b style="color:var(--warn)">' + t.confirmar + '</b><small>print ou checklist</small></div>' +
        '<div class="tile"><span>Bloqueantes conformes</span><b style="color:var(--ok)">' + t.bConformes + '</b><small>' + (t.liberado ? '+ ' + t.liberado + ' liberado(s) p/ homologação' : 'inclui confirmados') + '</small></div>' +
        '<div class="tile"><span>Recomendados abertos</span><b>' + t.rAbertos + '</b><small>de ' + t.rTotal + ' avaliados</small></div></div>' +
        '<section class="card flush"><div class="row between" style="padding:16px 18px;border-bottom:1px solid var(--line)">' +
        '<div class="tabs" role="tablist">' + [['todos', 'Todos · ' + ev.items.length], ['B', 'Bloqueantes · ' + nB], ['R', 'Recomendados · ' + (ev.items.length - nB)]].map(function (x) {
          return '<button type="button" role="tab" data-sev="' + x[0] + '" class="' + (filtro.sev === x[0] ? 'on' : '') + '" aria-selected="' + (filtro.sev === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
        '<div class="row"><label class="f" style="flex-direction:row;align-items:center">Mostrar<select id="fst"><option value="pend">Pendências primeiro</option><option value="abertos">Só pendências</option><option value="todos">Todos, por severidade</option></select></label>' +
        '<label class="f" style="flex-direction:row;align-items:center">Origem<select id="for"><option value="">Todas</option><option>Automática</option><option>IA</option><option>Checklist</option></select></label></div></div>' +
        '<div class="tbl-wrap"><table class="tbl" style="min-width:880px"><thead><tr><th>#</th><th>Regra</th><th style="width:28%">Item avaliado</th><th>Origem</th><th>Status</th><th>O que foi encontrado e como corrigir</th></tr></thead><tbody>' +
        lista.map(function (i) {
          var idx = ev.items.indexOf(i);
          var prints = (i.prints || []).map(function (p) { return '<a href="/api/prints/' + encodeURIComponent(p.key) + '" target="_blank" rel="noopener">' + h(p.name) + '</a>'; }).join(' · ');
          return '<tr><td><b>' + h(i.id) + '</b></td><td class="muted">' + h(i.rule) + ' <span class="tiny">(' + h(i.sev) + ')</span></td><td>' + h(i.item) + '</td>' +
            '<td><span class="tag">' + h(i.origin) + '</span></td><td>' + st(i.status) + '</td><td><div>' + h(i.comment) + '</div>' +
            (i.fix ? '<div class="fix"><b>Como corrigir:</b> ' + h(i.fix) + '</div>' : '') +
            (prints ? '<div class="fix"><b>Prints:</b> ' + prints + '</div>' : '') +
            (dono && (i.status === 'confirmar' || i.status === 'confirmado') ? '<div class="acts">' +
              '<label class="btn sm">Anexar print<input type="file" accept="image/png,image/jpeg" data-print="' + idx + '" class="sr"></label>' +
              (i.status === 'confirmar' ? '<button class="btn sm dark" data-ok="' + idx + '">Confirmo que está configurado</button>' : '<button class="btn sm" data-undo="' + idx + '">Desfazer confirmação</button>') + '</div>' : '') +
            '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="tbl-foot">Mostrando ' + lista.length + ' de ' + ev.items.length + ' itens</div></section>' +
        (ev.risks && ev.risks.length ? '<section class="card"><div class="row"><h2>Pontos para validar com a área</h2><span class="tag">IA</span></div><p class="small muted" style="margin:0">Sem regra no manual; não bloqueiam, mas o CoE vai perguntar.</p><ul style="margin:0;padding-left:20px;line-height:1.6">' +
          ev.risks.map(function (r) { return '<li>' + h(r) + '</li>'; }).join('') + '</ul></section>' : '') +
        '<div class="card" style="flex-direction:row;flex-wrap:wrap;justify-content:space-between;align-items:center;padding:16px 18px"><span class="small muted">' +
        (t.pronto ? 'Relatório pronto para anexar à solicitação do CoE.' : 'O relatório para o CoE fica disponível quando não houver bloqueante aberto nem item a confirmar.') + '</span>' +
        '<button class="btn primary" id="coe"' + (t.pronto ? '' : ' disabled') + '>Gerar relatório para o CoE</button></div>');
      bindLayout();
      $('#fst').value = filtro.status; $('#for').value = filtro.origem;
      $$('[data-sev]').forEach(function (b) { b.addEventListener('click', function () { filtro.sev = b.getAttribute('data-sev'); desenhar(); }); });
      on('#fst', 'change', function (e) { filtro.status = e.target.value; desenhar(); });
      on('#for', 'change', function (e) { filtro.origem = e.target.value; desenhar(); });
      $$('[data-ok]').forEach(function (b) { b.addEventListener('click', function () { mudar(+b.getAttribute('data-ok'), 'confirmado'); }); });
      $$('[data-undo]').forEach(function (b) { b.addEventListener('click', function () { mudar(+b.getAttribute('data-undo'), 'confirmar'); }); });
      $$('[data-print]').forEach(function (inp) { inp.addEventListener('change', function () { anexar(+inp.getAttribute('data-print'), inp.files[0]); }); });
      on('#xls', 'click', function () { exportarAvaliacao(ev, 'xlsx'); });
      on('#pdf', 'click', function () { exportarAvaliacao(ev, 'pdf'); });
      on('#coe', 'click', function () { exportarAvaliacao(ev, 'pdf', true); });
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
    desenhar();
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
        'Situação: ' + (t.pronto ? 'Pronto para o CoE' : 'Corrigir antes do CoE') + ' · bloqueantes abertos: ' + t.bAbertos + ' · a confirmar: ' + t.confirmar + ' · recomendados abertos: ' + t.rAbertos];
      var itens = ev.items.slice().sort(function (a, b) { return (a.sev === b.sev ? (ORDEM[a.status] || 9) - (ORDEM[b.status] || 9) : a.sev === 'B' ? -1 : 1); });
      var linhas = itens.map(function (i) { return [i.id, i.rule, i.sev === 'B' ? 'Bloqueante' : 'Recomendado', i.item, i.origin, STATUS[i.status] || i.status,
        i.comment + (i.fix ? ' | Como corrigir: ' + i.fix : '') + (inc.prints && i.prints && i.prints.length ? ' | Prints: ' + i.prints.map(function (p) { return p.name; }).join(', ') : '')]; });
      var cols = ['#', 'Regra', 'Severidade', 'Item avaliado', 'Origem', 'Status', 'Comentário'];
      var resumo = [['Bloqueantes', t.bTotal, t.bAbertos, t.bConformes], ['Recomendados', t.rTotal, t.rAbertos, t.rTotal - t.rAbertos]];
      var titulo = (paraCoe ? 'Relatório para o CoE – ' : 'Autoavaliação – ') + ev.process_name;
      var arq = slug(ev.process_name) + '-rodada-' + ev.round;
      var secoes = [];
      if (inc.resumo) secoes.push({ titulo: 'Resumo', colunas: ['Severidade', 'Avaliados', 'Abertos', 'Conformes/confirmados'], linhas: resumo });
      if (inc.itens) secoes.push({ titulo: 'Itens avaliados', colunas: cols, linhas: linhas, larguras: { 0: { cellWidth: 16 }, 1: { cellWidth: 14 }, 2: { cellWidth: 20 }, 3: { cellWidth: 52 }, 4: { cellWidth: 18 }, 5: { cellWidth: 22 } } });
      var lista = inc.riscos && ev.risks && ev.risks.length ? { titulo: 'Pontos para validar com a área', itens: ev.risks } : null;
      if (tipo === 'pdf') await gerarPdf({ titulo: titulo, linhasMeta: meta, secoes: secoes, lista: lista }, arq);
      else {
        var pl = [];
        if (inc.resumo) pl.push({ nome: 'Resumo', colunas: ['Severidade', 'Avaliados', 'Abertos', 'Conformes/confirmados'], linhas: resumo, larguras: [18, 12, 12, 22] });
        pl.push({ nome: 'Itens', colunas: cols, linhas: linhas, larguras: [10, 9, 13, 45, 12, 18, 80] });
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
          (atual ? (e.ready ? st('pronto', 'Pronto para o CoE') : st('corrigir', 'Corrigir antes do CoE')) : st('substituida', 'Substituída')) + '</td><td><a href="#/resultado/' + e.id + '"><b>Abrir</b></a></td></tr>';
      }).join('') : '<tr><td colspan="8" class="muted">Nenhuma autoavaliação ainda. Comece por <a href="#/nova">Nova autoavaliação</a>.</td></tr>') +
      '</tbody></table></div></section>');
    bindLayout();
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
    var lista = E.CHECKS.map(function (c) { var x = m[c.id] || {}; return Object.assign({}, c, { active: x.active !== false, severity: x.severity || c.sev, params: x.params }); });
    $app.innerHTML = layout('#/admin/conferencias',
      '<div class="head"><div><h1>Conferências automáticas</h1><p class="lead">Verificações exatas, sem IA, que rodam no navegador do analista. O CoE pode ligar, desligar e mudar a severidade. Uma conferência nova exige código: peça à equipe de Automação.</p></div></div>' +
      '<section class="card flush"><div class="tbl-wrap"><table class="tbl" style="min-width:880px"><thead><tr><th>ID</th><th>O que verifica</th><th>Arquivo</th><th>Regra</th><th style="width:150px">Severidade</th><th>Ativa</th></tr></thead><tbody>' +
      lista.map(function (c, i) {
        return '<tr><td><b>' + h(c.id) + '</b></td><td>' + h(c.desc) + (c.params && c.params.versao || (c.id === 'AUTO-02') ? '<div class="fix tiny">Versão esperada: <input type="text" data-ver="' + i + '" value="' + h((c.params && c.params.versao) || '3.1') + '" style="width:70px;padding:4px 6px"></div>' : '') + '</td>' +
          '<td><span class="tag">' + h(c.files) + '</span></td><td><b>' + h(c.rule) + '</b></td>' +
          '<td><select data-s="' + i + '" aria-label="Severidade"><option value="B"' + (c.severity === 'B' ? ' selected' : '') + '>B - Bloqueante</option><option value="R"' + (c.severity === 'R' ? ' selected' : '') + '>R - Recomendado</option></select></td>' +
          '<td><label class="check"><input type="checkbox" data-a="' + i + '"' + (c.active ? ' checked' : '') + '>Sim</label></td></tr>';
      }).join('') + '</tbody></table></div></section><div class="row end"><button class="btn primary" id="salvar">Salvar alterações</button></div>');
    bindLayout();
    on('#salvar', 'click', async function () {
      var out = lista.map(function (c, i) {
        var o = { id: c.id, active: $('[data-a="' + i + '"]').checked, severity: $('[data-s="' + i + '"]').value };
        var v = $('[data-ver="' + i + '"]'); if (v) o.params = { versao: v.value.trim() || '3.1' };
        return o;
      });
      try { await api('/api/checks', { method: 'PUT', body: { checks: out } }); toast('Conferências salvas.'); } catch (e) { toast(e.message); }
    });
  }

  /* ------------------------------ admin: relatorios ------------------------------ */
  var TIPOS = {
    processos: { nome: 'Autoavaliações por processo', cols: [['process_name', 'Processo'], ['app_code', 'App'], ['analista', 'Analista'], ['round', 'Rodada'], ['created_at', 'Data'], ['manual_version', 'Manual'], ['b_open', 'Bloqueantes abertos'], ['r_open', 'Recomendados abertos'], ['confirm', 'A confirmar'], ['ready', 'Situação']] },
    regras: { nome: 'Não conformidades mais frequentes', cols: [['regra', 'Regra'], ['item', 'Item'], ['severidade', 'Sev.'], ['ocorrencias', 'Ocorrências'], ['processos', 'Processos']] },
    uso: { nome: 'Uso da IA por analista', cols: [['analista', 'Analista'], ['email', 'E-mail'], ['analises', 'Análises'], ['falhas', 'Falhas'], ['dias', 'Dias com uso']] },
    itens: { nome: 'Detalhe dos itens avaliados', cols: [['processo', 'Processo'], ['rodada', 'Rodada'], ['analista', 'Analista'], ['data', 'Data'], ['regra', 'Regra'], ['item', 'Item'], ['origem', 'Origem'], ['severidade', 'Sev.'], ['status', 'Status'], ['comentario', 'Comentário']] }
  };
  function celula(k, v) {
    if (k === 'created_at' || k === 'data') return dataBR(v, true);
    if (k === 'ready') return v ? 'Pronto para o CoE' : 'Corrigir antes do CoE';
    if (k === 'status') return STATUS[v] || v;
    return v == null ? '' : v;
  }
  async function viewRelatorios() {
    var filtros = await api('/api/reports/filters');
    var cfgAll = (await api('/api/config')).config;
    var rep = cfgAll.report;
    var hoje = new Date(), ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    var f = { tipo: 'processos', de: ini.toISOString().slice(0, 10), ate: hoje.toISOString().slice(0, 10), processo: '', analista: '', situacao: '', severidade: '', capitulo: '', manual: '', ultima: '1' };
    var dados = { linhas: [] };
    function opt(v, t, sel) { return '<option value="' + h(v) + '"' + (v === sel ? ' selected' : '') + '>' + h(t) + '</option>'; }
    $app.innerHTML = layout('#/admin/relatorios',
      '<div class="head"><div><h1>Relatórios</h1><p class="lead">Acompanhe as autoavaliações da equipe e exporte com a identidade configurada abaixo.</p></div>' +
      '<div class="row"><button class="btn" id="rx">Exportar Excel</button><button class="btn primary" id="rp">Exportar PDF</button></div></div>' +
      '<section class="card"><div class="card-head"><h2>Filtros</h2><button class="link" id="limpar">Limpar filtros</button></div><div class="grid g4">' +
      '<label class="f">Tipo de relatório<select id="tipo">' + Object.keys(TIPOS).map(function (k) { return opt(k, TIPOS[k].nome, f.tipo); }).join('') + '</select></label>' +
      '<label class="f">Período de<input type="date" id="de" value="' + f.de + '"></label><label class="f">até<input type="date" id="ate" value="' + f.ate + '"></label>' +
      '<label class="f">Processo<select id="processo">' + opt('', 'Todos', '') + filtros.processos.map(function (p) { return opt(p, p, ''); }).join('') + '</select></label>' +
      '<label class="f">Analista<select id="analista">' + opt('', 'Todos', '') + filtros.analistas.map(function (a) { return opt(String(a.id), a.name, ''); }).join('') + '</select></label>' +
      '<label class="f">Situação<select id="situacao">' + opt('', 'Todas', '') + opt('corrigir', 'Corrigir antes do CoE', '') + opt('pronto', 'Pronto para o CoE', '') + '</select></label>' +
      '<label class="f">Severidade<select id="severidade">' + opt('', 'Bloqueantes e recomendados', '') + opt('B', 'Só bloqueantes', '') + opt('R', 'Só recomendados', '') + '</select></label>' +
      '<label class="f">Capítulo do manual<select id="capitulo">' + opt('', 'Todos', '') + ['1. Modelagem', '2. Formulários', '3. Scripts e estilos', '4. Integrações', '5. Responsáveis e SLA', '6. E-mails', '7. Publicação'].map(function (c) { return opt(c[0], c, ''); }).join('') + '</select></label></div>' +
      '<div class="row"><label class="check small"><input type="checkbox" id="ultima" checked>Só a última rodada de cada processo</label>' +
      '<label class="f" style="flex-direction:row;align-items:center">Versão do manual<select id="manual" style="width:auto">' + opt('', 'Todas', '') + filtros.manuais.filter(Boolean).map(function (m) { return opt(m, 'v' + m, ''); }).join('') + '</select></label>' +
      '<button class="btn dark" id="aplicar">Aplicar</button></div><p class="tiny muted" style="margin:0">Severidade e capítulo valem para "Não conformidades" e "Detalhe dos itens".</p></section>' +
      '<div class="grid g4" id="tiles"></div>' +
      '<section class="card flush"><div class="card-head"><h2 id="rtit"></h2><span class="small muted">Pré-visualização do que será exportado</span></div><div class="tbl-wrap" id="rtab"></div></section>' +
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
      ['tipo', 'de', 'ate', 'processo', 'analista', 'situacao', 'severidade', 'capitulo', 'manual'].forEach(function (k) { f[k] = $('#' + k).value; });
      f.ultima = $('#ultima').checked ? '1' : '0';
    }
    async function carregar() {
      lerFiltros();
      var q = Object.keys(f).filter(function (k) { return f[k] !== ''; }).map(function (k) { return k + '=' + encodeURIComponent(f[k]); }).join('&');
      dados = await api('/api/reports?' + q);
      var T = TIPOS[dados.tipo];
      $('#rtit').textContent = T.nome;
      $('#rtab').innerHTML = '<table class="tbl" style="min-width:860px"><thead><tr>' + T.cols.map(function (c) { return '<th>' + h(c[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (dados.linhas.length ? dados.linhas.slice(0, 200).map(function (l) { return '<tr>' + T.cols.map(function (c) { return '<td>' + h(celula(c[0], l[c[0]])) + '</td>'; }).join('') + '</tr>'; }).join('')
          : '<tr><td colspan="' + T.cols.length + '" class="muted">Nenhum registro com esses filtros.</td></tr>') + '</tbody></table>' +
        (dados.linhas.length > 200 ? '<div class="tbl-foot">Mostrando 200 de ' + dados.linhas.length + '; a exportação leva todos.</div>' : '');
      var L = dados.linhas, tiles;
      if (dados.tipo === 'processos') tiles = [['Autoavaliações listadas', L.length], ['Processos', new Set(L.map(function (x) { return x.process_name.toLowerCase(); })).size],
        ['Prontos para o CoE', L.filter(function (x) { return x.ready; }).length], ['Bloqueantes abertos (soma)', L.reduce(function (a, x) { return a + x.b_open; }, 0)]];
      else if (dados.tipo === 'regras') tiles = [['Regras com não conformidade', L.length], ['Ocorrências', L.reduce(function (a, x) { return a + x.ocorrencias; }, 0)],
        ['Bloqueantes', L.filter(function (x) { return x.severidade === 'B'; }).length], ['Recomendados', L.filter(function (x) { return x.severidade === 'R'; }).length]];
      else if (dados.tipo === 'uso') tiles = [['Analistas', L.length], ['Análises com IA', L.reduce(function (a, x) { return a + x.analises; }, 0)], ['Falhas', L.reduce(function (a, x) { return a + x.falhas; }, 0)], ['Com uso no período', L.filter(function (x) { return x.analises; }).length]];
      else tiles = [['Itens', L.length], ['Abertos', L.filter(function (x) { return x.status === 'aberto'; }).length], ['A confirmar', L.filter(function (x) { return x.status === 'confirmar'; }).length], ['Processos', new Set(L.map(function (x) { return x.processo; })).size]];
      $('#tiles').innerHTML = tiles.map(function (t) { return '<div class="tile"><span>' + h(t[0]) + '</span><b>' + t[1] + '</b></div>'; }).join('');
    }
    function metaFiltros() {
      var p = ['Período: ' + dataBR(f.de + 'T12:00:00Z') + ' a ' + dataBR(f.ate + 'T12:00:00Z')];
      if (f.processo) p.push('Processo: ' + f.processo);
      if (f.analista) p.push('Analista: ' + $('#analista').selectedOptions[0].textContent);
      if (f.situacao) p.push('Situação: ' + $('#situacao').selectedOptions[0].textContent);
      if (f.severidade) p.push($('#severidade').selectedOptions[0].textContent);
      if (f.capitulo) p.push('Capítulo ' + $('#capitulo').selectedOptions[0].textContent);
      if (f.manual) p.push('Manual v' + f.manual);
      return [p.join(' · '), 'Gerado em ' + dataBR(new Date().toISOString(), true) + ' por ' + S.me.user.name + ' · ' + dados.linhas.length + ' registro(s)'];
    }
    function tabela() { var T = TIPOS[dados.tipo]; return { colunas: T.cols.map(function (c) { return c[1]; }), linhas: dados.linhas.map(function (l) { return T.cols.map(function (c) { return celula(c[0], l[c[0]]); }); }) }; }
    on('#aplicar', 'click', function () { carregar().catch(function (e) { toast(e.message); }); });
    on('#tipo', 'change', function () { carregar().catch(function (e) { toast(e.message); }); });
    on('#limpar', 'click', function () { ['processo', 'analista', 'situacao', 'severidade', 'capitulo', 'manual'].forEach(function (k) { $('#' + k).value = ''; }); $('#ultima').checked = true; carregar(); });
    on('#rp', 'click', async function () {
      try { toast('Gerando o PDF…'); var t = tabela(); await gerarPdf({ titulo: rep.title + ' – ' + TIPOS[dados.tipo].nome, linhasMeta: metaFiltros(), secoes: [{ colunas: t.colunas, linhas: t.linhas }] }, slug(TIPOS[dados.tipo].nome) + '-' + f.de + '-' + f.ate); }
      catch (e) { toast(e.message); }
    });
    on('#rx', 'click', async function () {
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
      '<label class="check"><input type="checkbox" id="mask"' + (cfg.ai_mask ? ' checked' : '') + '>Mascarar IDs, URLs e e-mails antes de enviar à IA</label></fieldset>' +
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
          ai_mask: $('#mask').checked, limits_enabled: $('#lim').checked, limit_user: $('#lu').value, limit_total: $('#lt').value } });
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
