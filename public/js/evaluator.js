/* =====================================================================
 * Motor de avaliacao - App de Autoavaliacao CoE Zeev
 * Le os arquivos do processo (export .xls da Zeev, diagrama .svg ou caderno .json,
 * scripts .js e estilos .css) e roda as conferencias automaticas.
 * Roda no navegador (window.CoeEval) e no Node para testes (module.exports).
 * ===================================================================== */
(function (root) {
  'use strict';

  /* ----------------------------- utilitarios ----------------------------- */
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function key(s) {
    return norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function localName(n) { return (n.localName || n.nodeName || '').replace(/^.*:/, ''); }
  function walk(node, fn) {
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 1) { fn(k); walk(k, fn); }
    }
  }
  function byLocal(node, name) {
    var out = [];
    walk(node, function (el) { if (localName(el) === name) out.push(el); });
    return out;
  }
  function childrenLocal(node, name) {
    var out = [], kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) if (kids[i].nodeType === 1 && localName(kids[i]) === name) out.push(kids[i]);
    return out;
  }
  function attr(el, name) {
    if (!el.attributes) return null;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name === name || a.name.replace(/^.*:/, '') === name) return a.value;
    }
    return null;
  }
  function textOf(el) { return el ? (el.textContent || '') : ''; }
  function splitList(s) { return norm(s) ? String(s).split(',').map(norm).filter(Boolean) : []; }
  function stripHtml(s) {
    return norm(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  function parseXml(text) {
    var P = root.DOMParser;
    var doc = new P().parseFromString(text, 'text/xml');
    var err = doc.getElementsByTagName('parsererror');
    if (err && err.length) throw new Error('XML inválido');
    return doc;
  }

  /* --------------------------- export .xls (Zeev) --------------------------- */
  // O export da Zeev e um SpreadsheetML (XML do Excel 2003) com extensao .xls
  function parseZeevXls(text) {
    text = String(text).replace(/^﻿/, '').trim();
    text = text.replace(/<\?xml[^>]*\?>/g, '').replace(/<\?mso[^>]*\?>/g, '');
    var doc = parseXml(text);
    var sheets = {};
    byLocal(doc, 'Worksheet').forEach(function (ws) {
      var name = attr(ws, 'Name') || '';
      var rows = byLocal(ws, 'Row').map(function (r) {
        var cells = [], idx = 0;
        childrenLocal(r, 'Cell').forEach(function (c) {
          var at = attr(c, 'Index');
          if (at) idx = parseInt(at, 10) - 1;
          var d = childrenLocal(c, 'Data')[0];
          cells[idx] = d ? textOf(d) : '';
          idx++;
        });
        return cells;
      });
      var header = rows[0] || [];
      sheets[key(name)] = rows.slice(1).filter(function (r) { return r.some(function (c) { return norm(c); }); })
        .map(function (r) {
          var o = {};
          header.forEach(function (h, i) { o[key(h)] = r[i] == null ? '' : String(r[i]); });
          return o;
        });
    });
    function sheet(n) { return sheets[key(n)] || []; }
    var tasks = sheet('Tarefas humanas').map(function (r) {
      return {
        id: r['tarefa'], title: norm(r['titulo']), desc: stripHtml(r['descricao']),
        editable: splitList(r['campos editaveis']), buttons: splitList(r['botoes']),
        config: norm(r['configuracao']), people: norm(r['pessoas disponiveis']),
        hours: norm(r['horas']), businessHours: key(r['horas uteis?']) === 'sim',
        email: key(r['enviar e-mail?']) === 'sim'
      };
    });
    var fields = sheet('Formulário').map(function (r) {
      return {
        code: r['codigo'], group: norm(r['agrupamento']), id: norm(r['identificador']), name: norm(r['nome']),
        type: norm(r['tipo']), required: key(r['obrigatorio?']) === 'sim', integration: norm(r['integracao']),
        items: norm(r['itens da fonte de dados']), tasks: splitList(r['tarefas onde esta habilitado']),
        groupOrder: parseInt(r['ordem do agrupamento'], 10) || 0
      };
    });
    var messages = sheet('Eventos de mensagem').map(function (r) {
      return { id: r['tarefa'], title: norm(r['titulo']), subject: norm(r['assunto']), body: stripHtml(r['mensagem']),
        people: norm(r['pessoas disponiveis']), cc: norm(r['copia']) };
    });
    var timers = sheet('Eventos de timer').map(function (r) {
      return { id: r['tarefa'], title: norm(r['titulo']), type: norm(r['tipo']), interrupt: key(r['interruptivo?']) === 'sim',
        dynamic: key(r['dinamico?']) === 'sim', time: norm(r['tempo']), task: norm(r['tarefa associada']) };
    });
    function simple(n) { return sheet(n).map(function (r) { return { id: r['tarefa'], title: norm(r['titulo']) }; }); }
    return {
      appId: (sheet('Tarefas humanas')[0] || {})['aplicativo'] || '',
      tasks: tasks, fields: fields, messages: messages, timers: timers,
      scriptTasks: simple('Tarefas de script'), serviceTasks: simple('Tarefas de serviço'),
      ruleTasks: simple('Tarefas de regra de negócio')
    };
  }

  /* ------------------------------ diagrama ------------------------------ */
  function parseBpmn(xml) {
    var doc = parseXml(xml);
    var els = [], annotations = [];
    var skip = { definitions: 1, collaboration: 1, process: 1, laneSet: 1, BPMNDiagram: 1, BPMNPlane: 1, BPMNShape: 1,
      BPMNEdge: 1, BPMNLabel: 1, Bounds: 1, waypoint: 1, extensionElements: 1, incoming: 1, outgoing: 1 };
    walk(doc, function (el) {
      var t = localName(el);
      if (skip[t] || !attr(el, 'id')) return;
      if (/EventDefinition$/.test(t)) return;
      if (t === 'textAnnotation') {
        annotations.push(norm(textOf(childrenLocal(el, 'text')[0])));
        return;
      }
      var kind = t;
      if (t === 'intermediateThrowEvent' || t === 'intermediateCatchEvent' || t === 'boundaryEvent') {
        var defs = [];
        walk(el, function (c) { if (/EventDefinition$/.test(localName(c))) defs.push(localName(c)); });
        if (defs.indexOf('timerEventDefinition') >= 0) kind = 'timer';
        else if (defs.indexOf('messageEventDefinition') >= 0) kind = 'message';
        else if (defs.indexOf('linkEventDefinition') >= 0) kind = 'link';
        else kind = 'milestone';
      }
      els.push({ id: attr(el, 'id'), type: kind, name: norm(attr(el, 'name')) });
    });
    return { source: 'bpmn', elements: els, annotations: annotations };
  }

  function parseSvg(text) {
    var doc = parseXml(text);
    var groups = {};
    walk(doc, function (el) {
      var id = attr(el, 'data-element-id');
      if (!id || localName(el) !== 'g') return;
      var spans = byLocal(el, 'tspan');
      var txt = norm(spans.map(textOf).join(' '));
      groups[id] = { id: id, text: txt, html: el };
    });
    var els = [], annotations = [];
    Object.keys(groups).forEach(function (id) {
      if (/_label$/.test(id) || /^Flow_|^Association_/.test(id)) return;
      var g = groups[id];
      var name = groups[id + '_label'] ? groups[id + '_label'].text : g.text;
      if (/^TextAnnotation/.test(id)) { annotations.push(g.text); return; }
      var forma = shapeType(g.html);
      if (forma === 'flow') return; // setas (rotulos Sim/Nao)
      var tipo = forma === 'intermediate' || forma === 'unknown' ? guessType(name) : forma;
      if (forma === 'intermediate' && tipo === 'unknown') tipo = 'milestone';
      els.push({ id: id, type: tipo, name: name });
    });
    return { source: 'svg', elements: els, annotations: annotations };
  }
  // Tipo do elemento pela forma desenhada no SVG da Zeev
  function shapeType(g) {
    var formas = [];
    walk(g, function (el) {
      var t = localName(el);
      if (t !== 'circle' && t !== 'rect' && t !== 'polygon') return;
      var cls = attr(el, 'class') || '';
      if (/djs-(hit|outline)/.test(cls)) return;
      // ignora formas de elementos filhos (outro data-element-id)
      var p = el.parentNode;
      while (p && p !== g) { if (attr(p, 'data-element-id')) return; p = p.parentNode; }
      formas.push({ t: t, r: parseFloat(attr(el, 'r')) || 0, rx: parseFloat(attr(el, 'rx')) || 0, w: parseFloat(attr(el, 'width')) || 0 });
    });
    if (!formas.length) return 'flow';
    var f = formas[0];
    if (f.t === 'polygon') return 'exclusiveGateway';
    if (f.t === 'rect') return f.rx >= 3 ? 'task' : (f.w > 400 ? 'lane' : 'unknown');
    var circ = formas.filter(function (x) { return x.t === 'circle'; });
    if (circ.length === 1) return 'startEvent';
    if (circ[1].r && circ[1].r < 12) return 'endEvent';
    return 'intermediate';
  }
  function guessType(name) {
    if (/^(abrir e fechar|abrir|fechar)\s/i.test(name)) return 'milestone';
    if (/^(enviar|receber):/i.test(name)) return 'link';
    if (/^notificar/i.test(name)) return 'message';
    if (/^fim\b/i.test(name)) return 'endEvent';
    if (/^\d+\s+(minutos?|horas?|dias?|semanas?|meses|m[eê]s)\b/i.test(name)) return 'timer';
    if (/\?$/.test(name)) return 'exclusiveGateway';
    return 'unknown';
  }
  function parseCaderno(text) {
    var j = JSON.parse(text);
    var xml = j && j.modelagem && j.modelagem.xml;
    if (!xml) throw new Error('O caderno .json não tem o BPMN (modelagem.xml).');
    var d = parseBpmn(xml);
    d.source = 'json';
    d.processName = j.processo && j.processo.nome;
    return d;
  }

  /* --------------------------- leitura de scripts --------------------------- */
  // Varre o JS separando comentarios, strings e codigo. Devolve linhas com caractere
  // fora do ASCII em codigo ou string (regra S4).
  function nonAsciiOutsideComments(src) {
    var hits = [], line = 1, i = 0, n = src.length, state = null, prev = '';
    function hit() { if (!hits.length || hits[hits.length - 1] !== line) hits.push(line); }
    while (i < n) {
      var c = src[i];
      if (c === '\n') line++;
      if (state === null) {
        if (c === '/' && src[i + 1] === '*') { state = 'bc'; i += 2; continue; }
        if (c === '/' && src[i + 1] === '/') { state = 'lc'; i += 2; continue; }
        if (c === '"' || c === "'" || c === '`') { state = c; i++; continue; }
        if (c === '/' && /[(,=:\[!&|?{};]\s*$|^\s*$|return\s*$/.test(prev.slice(-12))) { state = 're'; i++; continue; }
        if (c.charCodeAt(0) > 127) hit();
        if (!/\s/.test(c)) prev = (prev + c).slice(-12); else prev += c;
      } else if (state === 'bc') {
        if (c === '*' && src[i + 1] === '/') { state = null; i += 2; prev = ''; continue; }
      } else if (state === 'lc') {
        if (c === '\n') { state = null; prev = ''; }
      } else if (state === 're') {
        if (c === '\\') { i += 2; continue; }
        if (c === '[') { var j = src.indexOf(']', i); if (j > 0) { i = j + 1; continue; } }
        if (c === '/' ) { state = null; prev = 'x'; }
        else if (c === '\n') state = null;
        else if (c.charCodeAt(0) > 127) hit();
      } else {
        if (c === '\\') { i += 2; continue; }
        if (c === state) { state = null; prev = 'x'; }
        else if (c.charCodeAt(0) > 127) hit();
      }
      i++;
    }
    var lines = src.split('\n');
    return hits.map(function (l) { return { line: l, text: norm(lines[l - 1]).slice(0, 120) }; });
  }
  function historyBlock(src) {
    var i = src.search(/HISTORICO DO PROTOCOLO/i);
    return i < 0 ? null : src.slice(Math.max(0, src.lastIndexOf('/*', i)));
  }
  function firstComment(src) {
    var m = /^\s*(\/\*[\s\S]*?\*\/|(?:\s*\/\/[^\n]*\n)+)/.exec(src);
    return m ? m[1] : '';
  }

  /* ----------------------------- conferencias ----------------------------- */
  // CSS padrao (secao 3.5 do manual). Comparado sem espacos.
  var CSS_MARKERS = ['#containerRequest .page-title', 'table.form > tbody', 'grid-template-columns: repeat(2, minmax(0, 1fr))',
    'table.form .form-control[readonly]', '.customFormControllers', 'border-bottom: 3px solid #FFC629'];
  var HIST_COLS = { histRodada: 'Texto', histEtapa: 'Texto', histData: 'Texto', histExecutor: 'Texto', histCampo: 'Texto', histValor: 'Longo' };
  var NATIVE_BUTTONS = { 'concluido': 'concluir', 'enviar requisicao': 'enviar solicitacao' };

  function isStartTask(t) { return t.buttons.some(function (b) { return /^enviar/i.test(key(b)); }); }
  function isRequesterTask(t) { return /^solicitante\b/i.test(key(t.title)); }
  function humanTitles(x) { return x.tasks.map(function (t) { return t.title; }); }

  function res(status, comment, fix) { return { status: status, comment: comment || '', fix: fix || '' }; }

  var CHECKS = [
    { id: 'AUTO-01', rule: 'S4', sev: 'B', files: '.js', desc: 'Acento ou caractere especial literal fora de comentário',
      params: { ignorar: ['[Pesquisa de satisfação]'] },
      run: function (P, prm) {
        if (!P.scripts.length) return res('na', 'Nenhum script enviado.');
        var ign = (prm.ignorar || []).map(key).filter(Boolean), out = [], ignoradas = 0;
        P.scripts.forEach(function (s) {
          nonAsciiOutsideComments(s.text).forEach(function (h) {
            var k = key(h.text);
            if (ign.some(function (t) { return k.indexOf(t) >= 0; })) { ignoradas++; return; }
            out.push(s.name + ', linha ' + h.line + ': ' + h.text);
          });
        });
        if (!out.length && ignoradas) return res('conforme', 'Nenhum caractere fora do ASCII em código ou string, exceto ' + ignoradas + ' linha(s) de trecho padrão liberado pelo CoE.');
        return out.length ? res('aberto', out.slice(0, 8).join(' | ') + (out.length > 8 ? ' (+' + (out.length - 8) + ')' : ''),
          'Trocar os caracteres acentuados em strings por \\uXXXX (ex.: ç = \\u00e7, ã = \\u00e3).')
          : res('conforme', 'Nenhum caractere fora do ASCII em código ou string (' + P.scripts.length + ' script(s)).');
      } },
    { id: 'AUTO-14', rule: 'S2', sev: 'R', files: '.js', desc: 'Cabeçalho do script com versão, data e autor',
      run: function (P) {
        if (!P.scripts.length) return res('na', 'Nenhum script enviado.');
        var falta = [];
        P.scripts.forEach(function (s) {
          var h = key(firstComment(s.text));
          var miss = [];
          if (!/vers(ao|ion)/.test(h)) miss.push('versão');
          if (!/\bdata\b/.test(h)) miss.push('data');
          if (!/autor/.test(h)) miss.push('autor');
          if (!/altera/.test(h)) miss.push('alterações');
          if (miss.length) falta.push(s.name + ' sem ' + miss.join(', '));
        });
        return falta.length ? res('aberto', falta.join(' | '), 'Incluir no topo: processo, atividade, versão, data, autor e resumo das alterações.')
          : res('conforme', 'Cabeçalho completo em todos os scripts.');
      } },
    { id: 'AUTO-02', rule: 'S19', sev: 'B', files: '.js', desc: 'Componente de histórico na versão vigente',
      params: { versao: '3.1' },
      run: function (P, prm) {
        var s = P.scripts.filter(function (x) { return historyBlock(x.text); })[0];
        if (!s) return res(P.scripts.length ? 'aberto' : 'na', P.scripts.length ? 'Componente de histórico não encontrado nos scripts.' : 'Nenhum script enviado.',
          'Colar o script padrão da seção 3.7 em Javascript > Todas as atividades.');
        var b = historyBlock(s.text);
        var ver = (/Versao:\s*([\d.]+)/i.exec(b) || [])[1];
        var diag = /function diagnostico\(\)[\s\S]{0,900}atributo/.test(b);
        var v = prm.versao || '3.1';
        if (ver === v && diag) return res('conforme', 'Versão ' + v + ' em ' + s.name + '.');
        return res('aberto', (ver ? 'Cabeçalho indica versão ' + ver : 'Cabeçalho sem versão') +
          (diag ? '' : '; função diagnostico() da versão anterior') + ' (' + s.name + ').',
          'Substituir o bloco inteiro pelo script ' + v + ' do manual e reaplicar só nomesTabelas e botoes no CONFIG.');
      } },
    { id: 'AUTO-03', rule: '3.7', sev: 'B', files: '.js + .xls', desc: 'CONFIG.botoes do histórico reconhece os botões do fluxo',
      run: function (P) {
        var s = P.scripts.filter(function (x) { return historyBlock(x.text); })[0];
        if (!s || !P.xls) return res('na', !s ? 'Componente de histórico não encontrado.' : 'Export .xls não enviado.');
        var m = /botoes:\s*\/(.+?)\/([gimsuy]*)\s*,/.exec(historyBlock(s.text));
        if (!m) return res('aberto', 'CONFIG.botoes não encontrado.', 'Definir CONFIG.botoes com os textos dos botões de envio.');
        var re;
        try { re = new RegExp(m[1], m[2]); } catch (e) { return res('aberto', 'CONFIG.botoes inválido: ' + e.message); }
        var labels = {};
        P.xls.tasks.forEach(function (t) { t.buttons.forEach(function (b) { var k = key(b); labels[NATIVE_BUTTONS[k] || k] = b; }); });
        var falha = Object.keys(labels).filter(function (k) { return !re.test(k); });
        return falha.length ? res('aberto', 'Não reconhece: ' + falha.map(function (k) { return '"' + k + '"'; }).join(', ') + '. O histórico não grava essas etapas.',
          'Incluir esses textos (minúsculos, sem acento) em CONFIG.botoes.')
          : res('conforme', 'Reconhece ' + Object.keys(labels).map(function (k) { return '"' + k + '"'; }).join(', ') + '.');
      } },
    { id: 'AUTO-04', rule: 'F21', sev: 'B', files: '.xls', desc: 'Tabela Histórico: último elemento, colunas e tipos padrão',
      run: function (P) {
        if (!P.xls) return res('na', 'Export .xls não enviado.');
        var f = P.xls.fields, prob = [];
        var maxG = Math.max.apply(null, f.map(function (x) { return x.groupOrder; }).concat([0]));
        var titles = humanTitles(P.xls);
        Object.keys(HIST_COLS).forEach(function (id) {
          var c = f.filter(function (x) { return x.id === id; })[0];
          if (!c) {
            var quase = f.filter(function (x) { return x.id.toLowerCase() === id.toLowerCase(); })[0];
            prob.push(quase ? id + ' escrito como ' + quase.id : id + ' ausente');
            return;
          }
          var tk = key(c.type);
          if (HIST_COLS[id] === 'Longo' && !/area de texto|texto longo/.test(tk)) prob.push(id + ' é ' + c.type + ' (deve ser Texto longo/Área de texto)');
          if (HIST_COLS[id] === 'Texto' && tk !== 'texto') prob.push(id + ' é ' + c.type + ' (deve ser Texto)');
          if (c.groupOrder !== maxG) prob.push(id + ' não está no último agrupamento');
          var falta = titles.filter(function (t) { return c.tasks.indexOf(t) < 0; });
          if (falta.length) prob.push(id + ' não habilitado em ' + falta.join(', '));
        });
        return prob.length ? res('aberto', prob.join(' | '), 'Ajustar a tabela Histórico conforme a seção 3.7 do manual.')
          : res('conforme', 'Colunas, tipos e posição conforme o padrão; editáveis nas ' + titles.length + ' atividades humanas.');
      } },
    { id: 'AUTO-05', rule: 'F19', sev: 'B', files: '.xls', desc: 'Campo situacaoDoProtocolo antes da tabela Histórico',
      run: function (P) {
        if (!P.xls) return res('na', 'Export .xls não enviado.');
        var f = P.xls.fields;
        var s = f.filter(function (x) { return x.id === 'situacaoDoProtocolo'; })[0];
        if (!s) return res('aberto', 'Campo situacaoDoProtocolo não encontrado.', 'Criar o campo Texto situacaoDoProtocolo num agrupamento antes da tabela Histórico.');
        var h = f.filter(function (x) { return x.id === 'histEtapa'; })[0];
        var prob = [];
        if (key(s.type) !== 'texto') prob.push('tipo ' + s.type + ' (deve ser Texto)');
        if (h && s.groupOrder >= h.groupOrder) prob.push('não está antes da tabela Histórico');
        var falta = humanTitles(P.xls).filter(function (t) { return s.tasks.indexOf(t) < 0; });
        if (falta.length) prob.push('não habilitado em ' + falta.join(', '));
        return prob.length ? res('aberto', prob.join(' | ')) : res('conforme', 'Texto, antes da tabela Histórico, editável em todas as atividades.');
      } },
    { id: 'AUTO-06', rule: 'R2', sev: 'B', files: '.xls', desc: 'Tarefa de área atribuída a "Requisitante"',
      run: function (P) {
        if (!P.xls) return res('na', 'Export .xls não enviado.');
        var bad = P.xls.tasks.filter(function (t) {
          return !isStartTask(t) && !isRequesterTask(t) && /requisitante/i.test(t.config + ' ' + t.people);
        });
        return bad.length ? res('liberado', bad.map(function (t) { return t.title; }).join(', ') + ' com "Requisitante". Permitido em homologação; trocar antes de publicar (R3).',
          'Atribuir o grupo definitivo no padrão Função - Tipo/Subárea (R1).')
          : res('conforme', 'Tarefas de área com grupo próprio.');
      } },
    { id: 'AUTO-07', rule: '1.4', sev: 'B', mode: 'aviso', files: '.svg / .json', desc: 'Marco final "Abrir e Fechar Encerrado" em todos os caminhos',
      run: function (P) {
        if (!P.diagram) return res('na', 'Diagrama não enviado.');
        var finais = P.diagram.elements.filter(function (e) { return /^abrir e fechar\s/i.test(e.name) && !/protocolo aberto/i.test(e.name); });
        var errados = finais.filter(function (e) { return !/encerrado$/i.test(key(e.name)); });
        if (!finais.length) return res('aberto', 'Nenhum marco "Abrir e Fechar Encerrado" encontrado.', 'Fechar todos os caminhos com "Abrir e Fechar Encerrado" antes do evento de fim.');
        return errados.length ? res('aberto', errados.length + ' marco(s) final(is): ' + uniq(errados.map(function (e) { return '"' + e.name + '"'; })).join(', ') + '. Seção 1.4 do manual em validação no CoE.',
          'O resultado fica no evento de fim; o marco final é sempre "Abrir e Fechar Encerrado".')
          : res('conforme', finais.length + ' marco(s) final(is) "Abrir e Fechar Encerrado".');
      } },
    { id: 'AUTO-08', rule: '1.3', sev: 'B', files: '.xls / .svg', desc: 'Nome do temporizador "<n> <unidade> <corridos/úteis>"',
      run: function (P) {
        var nomes = [];
        if (P.xls) P.xls.timers.forEach(function (t) { nomes.push(t.title); });
        if (P.diagram) P.diagram.elements.forEach(function (e) { if (e.type === 'timer') nomes.push(e.name); });
        nomes = uniq(nomes);
        if (!nomes.length) return res('na', 'Nenhum temporizador no fluxo.');
        var re = /^\d+\s+(minutos?|horas?|dias?|semanas?|meses|m[eê]s)\s+(corrid[oa]s?|[uú]teis|[uú]til)$/i;
        var bad = nomes.filter(function (n) { return !re.test(n); });
        return bad.length ? res('aberto', 'Fora do padrão: ' + bad.join(', '), 'Ex.: "30 dias corridos", "5 horas úteis".')
          : res('conforme', 'Nomes no padrão: ' + nomes.join(', ') + '.');
      } },
    { id: 'AUTO-09', rule: 'E9', sev: 'B', files: '.xls', desc: 'Título dos e-mails personalizados: Protocolo - Fluxo - Informativo',
      run: function (P) {
        if (!P.xls) return res('na', 'Export .xls não enviado.');
        if (!P.xls.messages.length) return res('na', 'Nenhum evento de e-mail.');
        var bad = P.xls.messages.filter(function (m) {
          var g = /^Protocolo\s+\{Instance\.Id\}\s+-\s+(.+?)\s+-\s+(.+)$/.exec(m.subject);
          return !g || (P.processName && key(g[1]) !== key(P.processName));
        });
        return bad.length ? res('aberto', bad.map(function (m) { return m.title + ': "' + m.subject + '"'; }).join(' | '),
          'Usar "Protocolo {Instance.Id} - ' + (P.processName || '[Nome do fluxo]') + ' - [Informativo]".')
          : res('conforme', P.xls.messages.length + ' evento(s) de e-mail no padrão.');
      } },
    { id: 'AUTO-15', rule: 'E1', sev: 'B', files: '.xls', desc: 'Notificação de recebimento nas atividades',
      run: function (P) {
        if (!P.xls) return res('na', 'Export .xls não enviado.');
        var bad = P.xls.tasks.filter(function (t) { return !isStartTask(t) && !t.email; });
        return bad.length ? res('aberto', 'Sem "Enviar e-mail": ' + bad.map(function (t) { return t.title; }).join(', '),
          'Ligar "Enviar notificação de recebimento" ou configurar um evento de e-mail (E2).')
          : res('conforme', 'Todas as atividades (exceto a abertura) enviam notificação.');
      } },
    { id: 'AUTO-13', rule: 'R5', sev: 'B', files: '.xls + .svg', desc: 'SLA em todas as atividades humanas',
      run: function (P) {
        if (!P.xls) return res('na', 'Export .xls não enviado.');
        var temSlaDin = P.diagram && P.diagram.annotations.some(function (a) { return /\bsla\b/i.test(a); });
        var sem = P.xls.tasks.filter(function (t) { return !isStartTask(t) && !t.hours; });
        if (!sem.length) return res('conforme', 'Todas as atividades com SLA em horas.');
        if (temSlaDin && sem.length === 1) return res('conforme', sem[0].title + ': SLA dinâmico anotado no desenho (' +
          (sem[0].businessHours ? 'horas úteis' : 'horas corridas') + ' na configuração).');
        return res('aberto', 'Sem SLA: ' + sem.map(function (t) { return t.title; }).join(', ') + (temSlaDin ? ' (há anotação de SLA dinâmico; confira a qual atividade se refere)' : ''),
          'Definir as horas da atividade ou anotar o SLA dinâmico com a regra de origem (R6).');
      } },
    { id: 'AUTO-10', rule: 'S12', sev: 'B', files: '.css', desc: 'CSS do formulário com o bloco padrão do manual',
      run: function (P) {
        if (!P.css.length) return res('na', 'Nenhum CSS enviado.');
        var ok = P.css.filter(function (c) {
          var t = c.text.replace(/\s+/g, ' ');
          return CSS_MARKERS.every(function (m) { return t.indexOf(m) >= 0; });
        });
        return ok.length ? res('conforme', 'Bloco padrão encontrado em ' + ok.map(function (c) { return c.name; }).join(', ') + '. Confira se está em todas as atividades.')
          : res('aberto', 'Bloco padrão da seção 3.5 não encontrado nos CSS enviados.', 'Colar o CSS padrão sem alteração em todas as atividades.');
      } },
    { id: 'AUTO-11', rule: 'F1', sev: 'B', files: '.xls', desc: 'Identificadores em camelCase, sem acento',
      run: function (P) {
        if (!P.xls) return res('na', 'Export .xls não enviado.');
        var bad = P.xls.fields.filter(function (f) { return !/^[a-z][a-zA-Z0-9]*$/.test(f.id); });
        return bad.length ? res('aberto', bad.map(function (f) { return f.id; }).join(', ')) : res('conforme', P.xls.fields.length + ' identificadores em camelCase.');
      } },
    { id: 'AUTO-12', rule: 'F12', sev: 'B', files: '.xls + .svg', desc: 'Campo usado em gateway é Lista de seleção',
      run: function (P) {
        if (!P.xls || !P.diagram) return res('na', 'Precisa do export .xls e do diagrama.');
        var gws = P.diagram.elements.filter(function (e) { return e.type === 'exclusiveGateway' && e.name; });
        if (!gws.length) return res('na', 'Nenhum gateway com nome.');
        var bad = [], nf = [];
        gws.forEach(function (g) {
          var f = P.xls.fields.filter(function (x) { return key(x.name).replace(/\?$/, '') === key(g.name).replace(/\?$/, ''); })[0];
          if (!f) { nf.push(g.name); return; }
          if (!/^lista de selecao/.test(key(f.type))) bad.push(g.name + ' (' + f.id + ': ' + f.type + ')');
        });
        if (bad.length) return res('aberto', bad.join(' | '), 'Usar Lista de seleção com opções fixas.');
        if (nf.length) return res('verificar', 'Sem campo com o mesmo rótulo: ' + nf.join(', ') + '. Os demais gateways usam lista.');
        return res('conforme', gws.length + ' gateway(s) ligados a Lista de seleção.');
      } }
  ];
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /* ----------------------------- leitura geral ----------------------------- */
  // files: [{ name, text }] ; info: { processName }
  function parseFiles(files, info) {
    var P = { xls: null, diagram: null, scripts: [], css: [], processName: (info && info.processName) || '', notes: [] };
    files.forEach(function (f) {
      var n = f.name.toLowerCase();
      try {
        if (/\.xlsx?$/.test(n) || /<Workbook/i.test(f.text.slice(0, 2000))) P.xls = parseZeevXls(f.text);
        else if (/\.svg$/.test(n)) P.diagram = parseSvg(f.text);
        else if (/\.json$/.test(n)) P.diagram = parseCaderno(f.text);
        else if (/\.bpmn$/.test(n)) P.diagram = parseBpmn(f.text);
        else if (/\.js$/.test(n)) P.scripts.push({ name: f.name, text: f.text });
        else if (/\.css$/.test(n)) P.css.push({ name: f.name, text: f.text });
      } catch (e) {
        P.notes.push(f.name + ': ' + e.message);
      }
    });
    return P;
  }
  function summary(P) {
    var s = {};
    if (P.xls) {
      s.xls = P.xls.tasks.length + ' tarefas humanas, ' + P.xls.fields.length + ' campos, ' + P.xls.timers.length + ' temporizadores, ' + P.xls.messages.length + ' eventos de e-mail';
    }
    if (P.diagram) {
      var c = function (t) { return P.diagram.elements.filter(function (e) { return e.type === t; }).length; };
      s.diagram = c('milestone') + ' marcos, ' + c('exclusiveGateway') + ' gateways, ' + c('timer') + ' temporizadores, ' + P.diagram.annotations.length + ' anotações';
    }
    return s;
  }
  // checksConfig: [{ id, active, severity }]
  function runChecks(P, checksConfig) {
    var cfg = {};
    (checksConfig || []).forEach(function (c) { cfg[c.id] = c; });
    return CHECKS.filter(function (c) { return !cfg[c.id] || cfg[c.id].active !== false; }).map(function (c) {
      var r;
      try { r = c.run(P, Object.assign({}, c.params || {}, (cfg[c.id] && cfg[c.id].params) || {})); }
      catch (e) { r = res('verificar', 'Erro ao conferir: ' + e.message); }
      var modo = (cfg[c.id] && cfg[c.id].mode) || c.mode || 'bloqueia';
      if (modo === 'aviso' && r.status === 'aberto') { r.status = 'verificar'; r.comment += ' Só aviso: definido pelo CoE como não bloqueante.'; }
      return { id: c.id, rule: c.rule, item: c.desc, origin: 'Automática', sev: (cfg[c.id] && cfg[c.id].severity) || c.sev,
        status: r.status, comment: r.comment, fix: r.fix };
    });
  }

  /* ------------------------------- IA ------------------------------- */
  function mask(s) {
    return String(s)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[ID]')
      .replace(/https?:\/\/[^\s"')]+/gi, '[URL]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[EMAIL]')
      .replace(/\/api\/[\w/.-]+/g, '[API]');
  }
  var TIPOS_PT = { startEvent: 'Evento de início (círculo, não é atividade humana)', endEvent: 'Evento de fim', task: 'Atividade (retângulo)',
    userTask: 'Atividade humana', serviceTask: 'Tarefa de serviço', scriptTask: 'Tarefa de script', businessRuleTask: 'Tarefa de regra',
    exclusiveGateway: 'Gateway', milestone: 'Marco', timer: 'Temporizador', message: 'Evento de e-mail', link: 'Evento de link', unknown: 'Elemento' };
  // Contexto enviado a IA: so nomes, campos, anotacoes e cabecalhos (sem o codigo inteiro)
  function aiContext(P, doMask) {
    var ctx = { processo: P.processName };
    if (P.xls) {
      ctx.tarefasHumanas = P.xls.tasks.map(function (t) {
        return { titulo: t.title, botoes: t.buttons.join(', '), responsavel: t.config || t.people, horas: t.hours || '(dinâmico ou vazio)',
          horasUteis: t.businessHours, enviaEmail: t.email, camposEditaveis: t.editable.length };
      });
      ctx.campos = P.xls.fields.map(function (f) {
        return [f.group, f.id, f.name, f.type, f.required ? 'obrigatório' : '', f.items ? 'opções: ' + f.items.slice(0, 160) : '', f.integration ? 'fonte: ' + f.integration : ''].filter(Boolean).join(' | ');
      });
      ctx.temporizadores = P.xls.timers.map(function (t) { return t.title + ' | ' + (t.interrupt ? 'interruptivo' : 'não interruptivo') + ' | atividade: ' + t.task; });
      ctx.eventosEmail = P.xls.messages.map(function (m) { return { nome: m.title, assunto: m.subject, corpo: m.body.slice(0, 600) }; });
      ctx.tarefasServico = P.xls.serviceTasks.map(function (t) { return t.title; });
      ctx.tarefasRegra = P.xls.ruleTasks.map(function (t) { return t.title; });
    }
    if (P.diagram) {
      ctx.elementosDiagrama = P.diagram.elements.filter(function (e) { return e.name && e.type !== 'lane'; }).map(function (e) { return (TIPOS_PT[e.type] || e.type) + ': ' + e.name; });
      ctx.raias = P.diagram.elements.filter(function (e) { return e.type === 'lane'; }).map(function (e) { return e.name; });
      ctx.anotacoes = P.diagram.annotations;
    }
    ctx.cabecalhosScripts = P.scripts.map(function (s) { return s.name + ': ' + firstComment(s.text).slice(0, 1200); });
    var txt = JSON.stringify(ctx, null, 1);
    return doMask ? mask(txt) : txt;
  }
  // orientacoes: [{ regras: 'S17, 1.3', texto }] decisoes do CoE que prevalecem sobre a leitura literal das regras
  function aiPrompt(P, rules, doMask, orientacoes) {
    var sys = 'Você é o avaliador do Centro de Excelência (CoE) da Vitru para fluxos na plataforma Zeev. ' +
      'Avalie SOMENTE as regras listadas, com base SOMENTE no contexto do processo enviado. Não invente regras. ' +
      'Marque "nao_conforme" só com evidência explícita no contexto, citando o nome do elemento ou campo. ' +
      'Falta de informação no contexto não é não conformidade: use "inconclusivo". ' +
      'Aplique cada regra só ao tipo de elemento a que ela se refere (ex.: regra de atividade humana não vale para evento de início, marco ou gateway). ' +
      'As ORIENTAÇÕES DO CoE prevalecem sobre a leitura literal das regras. Responda em português do Brasil, apenas com JSON válido.';
    var codigos = {}; rules.forEach(function (r) { codigos[r.code] = 1; });
    var ori = (orientacoes || []).filter(function (o) {
      if (o.ativa === false || !norm(o.texto)) return false;
      var rs = splitList(o.regras);
      // sem regra = vale sempre; "1.3" vale para 1.3-1, 1.3-2...
      return !rs.length || rs.some(function (c) { return codigos[c] || Object.keys(codigos).some(function (k) { return k.indexOf(c + '-') === 0; }); });
    });
    var user = (ori.length ? 'ORIENTAÇÕES DO CoE (decisões já tomadas; siga sempre):\n' +
      ori.map(function (o) { return '- ' + (norm(o.regras) ? '[' + norm(o.regras) + '] ' : '') + norm(o.texto); }).join('\n') + '\n\n' : '') +
      'REGRAS A AVALIAR (código | severidade | seção | texto):\n' +
      rules.map(function (r) { return r.code + ' | ' + r.sev + ' | ' + (r.section || r.chapter || '') + ' | ' + r.text; }).join('\n') +
      '\n\nCONTEXTO DO PROCESSO:\n' + aiContext(P, doMask) +
      '\n\nResponda neste formato JSON, um item por regra listada:\n' +
      '{"itens":[{"codigo":"F4","status":"conforme|nao_conforme|inconclusivo|nao_aplicavel","comentario":"o que foi encontrado, citando nomes do fluxo","correcao":"o que fazer, se não conforme"}],' +
      '"riscos":["comportamentos do fluxo que merecem validação com a área, sem regra no manual (no máximo 4)"]}';
    return { system: sys, user: user };
  }
  function parseAiAnswer(text) {
    var t = String(text || '').replace(/```json|```/g, '');
    var i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i < 0 || j < i) throw new Error('A IA não devolveu JSON.');
    var o = JSON.parse(t.slice(i, j + 1));
    return { itens: o.itens || o.items || [], riscos: o.riscos || [] };
  }
  var AI_STATUS = { conforme: 'conforme', nao_conforme: 'aberto', 'não_conforme': 'aberto', inconclusivo: 'verificar', nao_aplicavel: 'na', 'não_aplicável': 'na' };

  /* ------------------------------ resultado ------------------------------ */
  // rules: regras do manual vigente [{code, text, sev, aval: auto|ia|checklist|nao}]
  // opts.iaBloqueia === false: nao conformidade da IA fica "A verificar" (nao bloqueia sozinha)
  function buildItems(autoItems, rules, aiAnswer, opts) {
    opts = opts || {};
    var items = autoItems.slice();
    var autoRules = {};
    autoItems.forEach(function (a) { autoRules[a.rule] = true; });
    var aiMap = {};
    if (aiAnswer) aiAnswer.itens.forEach(function (x) { aiMap[String(x.codigo || x.code || '').trim()] = x; });
    rules.forEach(function (r) {
      if (r.aval === 'checklist') {
        items.push({ id: r.code, rule: r.code, item: r.text, origin: 'Checklist', sev: r.sev, status: 'confirmar', comment: 'Confirme que está configurado ou anexe o print.', fix: '' });
      } else if (r.aval === 'ia' && !autoRules[r.code]) {
        var a = aiMap[r.code];
        if (aiAnswer) {
          var stt = a ? (AI_STATUS[key(a.status).replace(/\s/g, '_')] || 'verificar') : 'verificar';
          var com = a ? norm(a.comentario || a.comment) : 'A IA não avaliou esta regra.';
          if (stt === 'aberto' && opts.iaBloqueia === false) { stt = 'verificar'; com = 'IA apontou possível não conformidade: ' + com; }
          items.push({ id: r.code, rule: r.code, item: r.text, origin: 'IA', sev: r.sev, status: stt, comment: com, fix: a ? norm(a.correcao || a.fix) : '' });
        } else {
          items.push({ id: r.code, rule: r.code, item: r.text, origin: 'IA', sev: r.sev, status: 'verificar', comment: 'Avaliação por IA não executada nesta rodada.', fix: '' });
        }
      }
    });
    return items;
  }
  function totals(items) {
    var t = { total: items.length, bAbertos: 0, rAbertos: 0, confirmar: 0, bTotal: 0, rTotal: 0, bConformes: 0, liberado: 0, verificar: 0 };
    items.forEach(function (i) {
      if (i.sev === 'B') t.bTotal++; else t.rTotal++;
      if (i.status === 'aberto') { if (i.sev === 'B') t.bAbertos++; else t.rAbertos++; }
      if (i.status === 'confirmar') t.confirmar++;
      if (i.status === 'liberado') t.liberado++;
      if (i.status === 'verificar') t.verificar++;
      if (i.sev === 'B' && (i.status === 'conforme' || i.status === 'confirmado' || i.status === 'na')) t.bConformes++;
    });
    t.pronto = t.bAbertos === 0 && t.confirmar === 0;
    return t;
  }

  /* ----------------------- leitura do manual (Word) ----------------------- */
  // Recebe o HTML gerado pelo mammoth a partir do .docx e extrai as regras das tabelas
  // cuja ultima coluna e a severidade (B ou R). Linhas sem codigo (secoes 1.2 e 1.3)
  // e paragrafos "(B) ..." da secao 1.4 recebem codigo da secao (ex.: 1.4-3).
  // Padrao inicial de como cada regra e avaliada; o CoE ajusta na tela de revisao.
  //  auto: confere por codigo | checklist: o analista confirma ou anexa print |
  //  nao: visual ou etapa do proprio CoE, fora da autoavaliacao | demais: IA
  var DEFAULT_AVAL = {
    auto: ['S4', 'S2', 'S19', 'F21', 'F19', 'R2', 'R3', 'E9', 'E1', 'R5', 'S12', 'F1', 'F12', 'S20'],
    checklist: ['F16', 'F17', 'F18', 'E4', 'R6', 'R15', 'R16', 'R17', 'S18', 'V3', 'V4', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12',
      'V15', 'V16', 'V17', 'V18', 'V19', 'V20'],
    nao: ['P1', 'P5', 'P7', 'R1', 'R4', 'R7', 'R8', 'R11', 'R12', 'R13', 'R14', 'I2', 'I4', 'I6', 'I10', 'I12', 'I13',
      'S11', 'E6', 'V1', 'V5', 'V6', 'V13', 'V14']
  };
  function defaultAval(code) {
    if (DEFAULT_AVAL.auto.indexOf(code) >= 0) return 'auto';
    if (DEFAULT_AVAL.checklist.indexOf(code) >= 0) return 'checklist';
    if (DEFAULT_AVAL.nao.indexOf(code) >= 0 || /^1\.2-/.test(code)) return 'nao';
    return 'ia';
  }
  function parseManualHtml(html) {
    var doc = new root.DOMParser().parseFromString('<div id="r">' + html + '</div>', 'text/html');
    var rootEl = doc.getElementById ? doc.getElementById('r') : doc.documentElement;
    var rules = [], seen = {}, section = '', chapter = '', counter = {}, sectionTitle = '';
    function add(code, text, sev) {
      text = norm(text);
      if (!text || seen[code]) return;
      seen[code] = 1;
      rules.push({ code: code, text: text, sev: sev, chapter: chapter, section: sectionTitle.slice(0, 80), aval: defaultAval(code) });
    }
    function autoCode() { var s = section || chapter || 'X'; counter[s] = (counter[s] || 0) + 1; return s + '-' + counter[s]; }
    var nodes = [];
    walk(rootEl, function (el) {
      var t = localName(el).toLowerCase();
      if (t === 'table' || t === 'p' || /^h[1-6]$/.test(t) || t === 'li') nodes.push(el);
    });
    nodes.forEach(function (el) {
      var t = localName(el).toLowerCase();
      if (t !== 'table' && el.parentNode && closestLocal(el, 'table')) return;
      if (t === 'table') {
        var cab = null;
        rowsOf(el).forEach(function (cells) {
          if (cells.length < 2) return;
          var sev = norm(cells[cells.length - 1]).toUpperCase();
          if (sev !== 'B' && sev !== 'R') { if (!cab) cab = cells.map(norm); return; }
          var first = norm(cells[0]);
          var isCode = /^[A-Z]{1,2}\d{1,3}$/.test(first);
          var ini = isCode ? 1 : 0;
          var partes = [];
          cells.slice(ini, cells.length - 1).forEach(function (c, j) {
            c = norm(c); if (!c) return;
            var rot = cab && cab.length === cells.length ? cab[ini + j] : '';
            // rotulo da coluna, exceto quando e o proprio texto da regra
            partes.push(rot && !/^(regra|descri[cç][aã]o|crit[eé]rio|requisito)$/i.test(rot) ? rot + ': ' + c : c);
          });
          add(isCode ? first : autoCode(), partes.join(' — '), sev);
        });
        return;
      }
      var txt = norm(textOf(el));
      var mSec = /^(\d+)\.(\d+)\s+\S/.exec(txt);
      var mCap = /^(\d+)\.\s+\S/.exec(txt);
      if (mSec && txt.length < 90) { section = mSec[1] + '.' + mSec[2]; chapter = mSec[1]; sectionTitle = txt; return; }
      if (mCap && txt.length < 60) { chapter = mCap[1]; section = ''; sectionTitle = txt; return; }
      var mR = /^\(\s*(B|R)\s*\)\s*(.+)$/.exec(txt);
      if (mR && section && !/checklist/i.test(sectionTitle)) add(autoCode(), mR[2], mR[1]);
    });
    return rules;
  }
  function closestLocal(el, name) {
    var p = el.parentNode;
    while (p && p.nodeType === 1) { if (localName(p).toLowerCase() === name) return p; p = p.parentNode; }
    return null;
  }
  function rowsOf(table) {
    var out = [];
    walk(table, function (tr) {
      if (localName(tr).toLowerCase() !== 'tr' || closestLocal(tr, 'table') !== table) return;
      var cells = [];
      for (var i = 0; i < tr.childNodes.length; i++) {
        var c = tr.childNodes[i];
        if (c.nodeType === 1 && /^t[dh]$/i.test(localName(c))) cells.push(textOf(c));
      }
      out.push(cells);
    });
    return out;
  }
  function diffRules(oldRules, newRules) {
    var om = {}; (oldRules || []).forEach(function (r) { om[r.code] = r; });
    var nm = {}; newRules.forEach(function (r) { nm[r.code] = r; });
    var out = { novas: [], alteradas: [], removidas: [], iguais: 0 };
    newRules.forEach(function (r) {
      var o = om[r.code];
      if (!o) out.novas.push(r);
      else if (key(o.text) !== key(r.text) || o.sev !== r.sev) { out.alteradas.push(Object.assign({ antes: o.text, sevAntes: o.sev }, r)); }
      else out.iguais++;
    });
    (oldRules || []).forEach(function (r) { if (!nm[r.code]) out.removidas.push(r); });
    return out;
  }

  var api = {
    parseFiles: parseFiles, summary: summary, runChecks: runChecks, CHECKS: CHECKS.map(function (c) {
      return { id: c.id, rule: c.rule, sev: c.sev, files: c.files, desc: c.desc, params: c.params || {} };
    }),
    aiPrompt: aiPrompt, parseAiAnswer: parseAiAnswer, buildItems: buildItems, totals: totals, mask: mask,
    TIPOS_PT: TIPOS_PT, parseManualHtml: parseManualHtml, diffRules: diffRules, defaultAval: defaultAval, key: key, norm: norm,
    _internal: { nonAsciiOutsideComments: nonAsciiOutsideComments, parseZeevXls: parseZeevXls, parseSvg: parseSvg }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CoeEval = api;
})(typeof window !== 'undefined' ? window : globalThis);
