/* =====================================================================
 * App de Autoavaliacao CoE Zeev - servidor (Cloudflare Worker)
 * Login com usuarios proprios (@vitru.com.br), convites, chamada a IA com limite
 * diario, padroes do manual, autoavaliacoes, relatorios, prints/logos (KV) e backup.
 * Bindings: DB (D1), PRINTS (KV), ASSETS (telas). Segredos: OPENROUTER_API_KEY, BOOTSTRAP_TOKEN.
 * ===================================================================== */

const DOMINIO = '@vitru.com.br';
const SESSAO_HORAS = 12;
const CONVITE_HORAS = 48;
const PBKDF2_ITER = 20000;
const MAX_IMG = 1024 * 1024;

const CONFIG_PADRAO = {
  ai_provider: 'openrouter',
  ai_url: 'https://openrouter.ai/api/v1',
  ai_model: 'google/gemma-4-31b-it:free',
  ai_fallback: '',
  ai_mask: true,
  ai_bloqueia: true,
  limits_enabled: true,
  limit_user: 5,
  limit_total: 50,
  ai_last_test: '',
  report: {
    title: 'Relatório de Autoavaliação – Padrões Zeev',
    subtitle: 'Centro de Excelência · Automação de Processos · Vitru Educação',
    footer: 'Documento interno · gerado pelo app de Autoavaliação CoE',
    orientation: 'landscape',
    color: '#FFC629',
    include: { resumo: true, itens: true, riscos: true, prints: false, versao: true },
    logos: { 1: false, 2: false }
  }
};

// Decisoes do CoE enviadas a IA em toda analise (o CoE edita em Orientacoes a IA)
const ORIENTACOES_PADRAO = [
  ['', 'Cores dos eventos de início (verde) e fim (vinho) e dos marcos (cinza) são o padrão do tema da Zeev: não aponte cor desses elementos.'],
  ['R2, R3, 1.4', 'Responsável "Requisitante" em atividade de área é permitido em homologação (já conferido pela conferência automática AUTO-06): não aponte como não conformidade. O CoE sinaliza a troca antes da publicação.'],
  ['1.3', 'A nomenclatura de atividade humana (ÁREA - Verbo + complemento) vale só para atividades humanas (retângulo com borda azul, listadas em tarefasHumanas). Evento de início, eventos de fim, marcos, gateways e temporizadores não seguem essa regra.'],
  ['1.4', 'A atividade "Avaliar atendimento" (pesquisa de satisfação) é exceção aceita pelo CoE na seção 1.4: não aponte.'],
  ['1.4', 'A regra do marco final "Abrir e Fechar Encerrado" está em validação no CoE: não marque como não conforme; use inconclusivo e descreva o ponto.'],
  ['S17', 'O export da Zeev não mostra a ordem de exibição das opções de lista. Com o script padrão em uso, considere conforme; na dúvida, inconclusivo, nunca não conforme.'],
  ['', 'O export da Zeev não traz o tempo dos temporizadores nem os destinatários dos e-mails. Ausência desses dados no contexto não é não conformidade: use inconclusivo.'],
  ['3.7', 'Botões nativos "Enviar solicitação" (abertura) e "Concluir" são válidos para o histórico.'],
  ['R5, R6', 'Por regra de negócio o SLA é em horas corridas; "horas úteis" desligado não é não conformidade.'],
  ['3.6', 'O modelo administrativo da pesquisa de satisfação (seção 3.6) é padrão do CoE: seus campos, script e textos não devem ser apontados.'],
  ['1.3, P2', 'O pool com o nome do processo envolvendo todas as raias é aceito pelo CoE. Ele não é raia nem papel: não aplique a ele as regras de nomenclatura de raia.'],
  ['1.3', 'Gateway: o "?" só é exigido quando a decisão é uma pergunta de Sim/Não (ex.: "Solicitação aprovada?"). Gateway cujo campo é uma lista de ações ou opções (ex.: "Ação do atendimento", com opções "Devolver para o solicitante, Encerrar") não é pergunta e fica sem "?": está conforme. Use a lista gateways do contexto para ver o campo e as opções.']
].map((o, i) => ({ id: 'o' + (i + 1), regras: o[0], texto: o[1], ativa: true, origem: 'Decisão inicial do CoE', em: '' }));

// Colunas acrescentadas depois da primeira versao do banco (criadas sozinhas na primeira chamada)
const COLUNAS_NOVAS = [['coe_status', "TEXT DEFAULT 'rascunho'"], ['submitted_at', 'TEXT'], ['reviewed_at', 'TEXT'], ['reviewer_id', 'INTEGER'], ['coe_opinion', 'TEXT'],
  ['review_started_at', 'TEXT'], ['analyst_seen_at', 'TEXT']];
let esquemaOk = false;
async function garantirEsquema(env) {
  if (esquemaOk) return;
  const { results } = await env.DB.prepare('PRAGMA table_info(evaluations)').all();
  const tem = new Set(results.map((c) => c.name));
  for (const [nome, tipo] of COLUNAS_NOVAS) {
    if (!tem.has(nome)) await env.DB.prepare(`ALTER TABLE evaluations ADD COLUMN ${nome} ${tipo}`).run();
  }
  esquemaOk = true;
}

/* ------------------------------ utilitarios ------------------------------ */
const enc = new TextEncoder();
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
function erro(status, msg) { return json({ error: msg }, status); }
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const agora = () => new Date().toISOString();
const emHoras = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
// Dia no horario de Brasilia (UTC-3, sem horario de verao)
const diaBR = (d = new Date()) => new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
function b64url(bytes) {
  let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function tokenAleatorio(n = 32) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
async function sha256(txt) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(txt));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hashSenha(senha, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITER }, k, 256);
  return b64url(new Uint8Array(bits));
}
function iguais(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function senhaValida(s) { return typeof s === 'string' && s.length >= 10 && /[a-zA-Z]/.test(s) && /\d/.test(s); }
function emailValido(e) { return typeof e === 'string' && /^[a-z0-9._%+-]+@vitru\.com\.br$/i.test(e.trim()); }
function cookieSessao(token, maxAge) {
  return `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function lerCookie(req, nome) {
  const c = req.headers.get('cookie') || '';
  const m = c.split(/;\s*/).find((p) => p.startsWith(nome + '='));
  return m ? m.slice(nome.length + 1) : '';
}
async function corpo(req) {
  try { return await req.json(); } catch { throw new HttpError(400, 'Corpo da requisição inválido.'); }
}
function mascarar(s) {
  return String(s)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[ID]')
    .replace(/https?:\/\/[^\s"')]+/gi, '[URL]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[EMAIL]');
}

/* ------------------------------ configuracao ------------------------------ */
async function lerConfig(env, chave = 'app') {
  const r = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind(chave).first();
  if (chave === 'app') {
    const v = r ? JSON.parse(r.value) : {};
    return { ...CONFIG_PADRAO, ...v, report: { ...CONFIG_PADRAO.report, ...(v.report || {}), include: { ...CONFIG_PADRAO.report.include, ...((v.report || {}).include || {}) } } };
  }
  return r ? JSON.parse(r.value) : null;
}
async function gravarConfig(env, chave, valor) {
  await env.DB.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(chave, JSON.stringify(valor)).run();
}
async function logConfig(env, userId, change) {
  await env.DB.prepare('INSERT INTO config_log (at, user_id, change) VALUES (?, ?, ?)').bind(agora(), userId, change).run();
}

/* ------------------------------ sessao ------------------------------ */
async function usuarioDaSessao(req, env) {
  const t = lerCookie(req, 'sid');
  if (!t) return null;
  const h = await sha256(t);
  const u = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.status FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`).bind(h, agora()).first();
  if (!u || u.status !== 'ativo') return null;
  return u;
}
async function criarSessao(env, userId) {
  const t = tokenAleatorio();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(t), userId, emHoras(SESSAO_HORAS)).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(agora()).run();
  return cookieSessao(t, SESSAO_HORAS * 3600);
}
async function novoConvite(env, userId, origin) {
  const t = tokenAleatorio();
  await env.DB.prepare('UPDATE invites SET used = 1 WHERE user_id = ? AND used = 0').bind(userId).run();
  const exp = emHoras(CONVITE_HORAS);
  await env.DB.prepare('INSERT INTO invites (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(t), userId, exp).run();
  return { link: `${origin}/#/convite/${t}`, expires_at: exp };
}

/* ------------------------------ uso da IA ------------------------------ */
async function usoHoje(env, userId) {
  const d = diaBR();
  const u = await env.DB.prepare('SELECT count, failures FROM usage WHERE user_id = ? AND day = ?').bind(userId, d).first();
  const t = await env.DB.prepare('SELECT COALESCE(SUM(count),0) AS total FROM usage WHERE day = ?').bind(d).first();
  return { dia: d, meu: u ? u.count : 0, falhas: u ? u.failures : 0, equipe: t ? t.total : 0 };
}
async function registrarUso(env, userId, falhou) {
  await env.DB.prepare(
    `INSERT INTO usage (user_id, day, count, failures) VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1, failures = failures + ?`)
    .bind(userId, diaBR(), falhou ? 1 : 0, falhou ? 1 : 0).run();
}

/* ------------------------------ chamada a IA ------------------------------ */
// Cada modelo tem ate 75 s; com o reserva, a chamada inteira fica abaixo do limite do navegador (170 s)
const LIMITE_IA = 75000;
function erroTempo(e) {
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Error('o modelo não respondeu em ' + LIMITE_IA / 1000 + ' segundos');
  throw new Error('falha de comunicação com o provedor de IA (' + (e && e.message || e) + ')');
}
async function chamarModelo(cfg, env, modelo, system, user) {
  const chave = env.OPENROUTER_API_KEY;
  if (!chave) throw new Error('Chave da IA não configurada (segredo OPENROUTER_API_KEY).');
  let resp, texto;
  if (cfg.ai_provider === 'anthropic') {
    resp = await fetch((cfg.ai_url || 'https://api.anthropic.com/v1').replace(/\/$/, '') + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: modelo, max_tokens: 8000, temperature: 0.1, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(LIMITE_IA)
    }).catch(erroTempo);
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error((j.error && j.error.message) || `HTTP ${resp.status}`);
    texto = (j.content || []).map((c) => c.text || '').join('');
  } else {
    const azure = cfg.ai_provider === 'azure';
    const url = azure ? cfg.ai_url : cfg.ai_url.replace(/\/$/, '') + '/chat/completions';
    const headers = { 'content-type': 'application/json' };
    if (azure) headers['api-key'] = chave; else headers.authorization = 'Bearer ' + chave;
    if (cfg.ai_provider === 'openrouter') { headers['x-title'] = 'Autoavaliacao CoE Zeev'; }
    // Gemma (Google AI Studio) nao aceita mensagem de sistema: junta tudo na mensagem do usuario
    const semSistema = /gemma/i.test(modelo || '');
    const body = { messages: semSistema ? [{ role: 'user', content: system + '\n\n' + user }] : [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.1 };
    if (!azure) body.model = modelo;
    resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(LIMITE_IA) }).catch(erroTempo);
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || j.error) {
      const e = j.error || {};
      const det = e.metadata && e.metadata.raw ? ' (' + String(e.metadata.raw).slice(0, 300) + ')' : '';
      throw new Error((e.message || (typeof e === 'string' ? e : '') || `HTTP ${resp.status}`) + det);
    }
    texto = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : '';
  }
  if (!texto) throw new Error('A IA devolveu resposta vazia.');
  return texto;
}
async function chamarIA(cfg, env, system, user) {
  if (cfg.ai_mask) user = mascarar(user);
  try {
    return { texto: await chamarModelo(cfg, env, cfg.ai_model, system, user), modelo: cfg.ai_model };
  } catch (e) {
    if (!cfg.ai_fallback) throw e;
    return { texto: await chamarModelo(cfg, env, cfg.ai_fallback, system, user), modelo: cfg.ai_fallback, aviso: 'Modelo principal falhou: ' + e.message };
  }
}

/* ------------------------------ rotas ------------------------------ */
const rotas = [];
function rota(metodo, padrao, papel, fn) {
  const nomes = [];
  const re = new RegExp('^' + padrao.replace(/:(\w+)/g, (_, n) => { nomes.push(n); return '([^/]+)'; }) + '$');
  rotas.push({ metodo, re, nomes, papel, fn });
}

// ---- configuracao inicial ----
rota('GET', '/api/setup', null, async (c) => {
  const r = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'ativo'").first();
  return json({ needsSetup: !r || r.n === 0 });
});
rota('POST', '/api/setup', null, async (c) => {
  const b = await corpo(c.req);
  const r = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
  if (r && r.n > 0) throw new HttpError(403, 'A configuração inicial já foi feita.');
  if (!c.env.BOOTSTRAP_TOKEN || !iguais(String(b.token || ''), c.env.BOOTSTRAP_TOKEN)) throw new HttpError(403, 'BOOTSTRAP_TOKEN incorreto.');
  if (!b.name || !emailValido(b.email)) throw new HttpError(400, 'Informe nome e e-mail ' + DOMINIO + '.');
  if (!senhaValida(b.password)) throw new HttpError(400, 'A senha precisa de 10 caracteres, com letras e números.');
  const salt = tokenAleatorio(16);
  const res = await c.env.DB.prepare("INSERT INTO users (name, email, role, status, pw_hash, pw_salt, created_at) VALUES (?, ?, 'admin', 'ativo', ?, ?, ?)")
    .bind(String(b.name).trim(), b.email.trim().toLowerCase(), await hashSenha(b.password, salt), salt, agora()).run();
  await gravarConfig(c.env, 'app', CONFIG_PADRAO);
  await logConfig(c.env, res.meta.last_row_id, 'Configuração inicial: ' + CONFIG_PADRAO.ai_provider + ' · ' + CONFIG_PADRAO.ai_model + ' · ' + CONFIG_PADRAO.limit_user + ' por analista, ' + CONFIG_PADRAO.limit_total + ' por dia');
  return json({ ok: true }, 200, { 'set-cookie': await criarSessao(c.env, res.meta.last_row_id) });
});

// ---- login ----
rota('POST', '/api/login', null, async (c) => {
  const b = await corpo(c.req);
  const email = String(b.email || '').trim().toLowerCase();
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!u || u.status !== 'ativo' || !u.pw_hash || !iguais(await hashSenha(String(b.password || ''), u.pw_salt), u.pw_hash)) {
    throw new HttpError(401, 'E-mail ou senha incorretos.');
  }
  return json({ ok: true }, 200, { 'set-cookie': await criarSessao(c.env, u.id) });
});
rota('POST', '/api/logout', null, async (c) => {
  const t = lerCookie(c.req, 'sid');
  if (t) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(t)).run();
  return json({ ok: true }, 200, { 'set-cookie': cookieSessao('', 0) });
});
rota('GET', '/api/me', 'user', async (c) => {
  const cfg = await lerConfig(c.env);
  const m = await c.env.DB.prepare("SELECT id, version, effective_date FROM manual_versions WHERE status = 'vigente' ORDER BY id DESC LIMIT 1").first();
  let pendentesCoe = 0;
  if (c.user.role === 'admin') pendentesCoe = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM evaluations WHERE coe_status IN ('enviado','em_analise')").first()).n;
  // decisoes do CoE que o analista ainda nao viu
  const { results: novidades } = await c.env.DB.prepare(
    "SELECT id, process_name, round, coe_status, reviewed_at FROM evaluations WHERE user_id = ? AND coe_status IN ('aprovado','aprovado_ressalva','devolvido') AND analyst_seen_at IS NULL ORDER BY reviewed_at DESC LIMIT 20")
    .bind(c.user.id).all();
  return json({ user: c.user, uso: await usoHoje(c.env, c.user.id), limites: { ativo: cfg.limits_enabled, porAnalista: cfg.limit_user, total: cfg.limit_total },
    iaBloqueia: cfg.ai_bloqueia !== false, manual: m || null, pendentesCoe, novidades });
});

// ---- convite / primeiro acesso ----
async function conviteValido(env, token) {
  const inv = await env.DB.prepare('SELECT i.*, u.name, u.email, u.status FROM invites i JOIN users u ON u.id = i.user_id WHERE i.token_hash = ?')
    .bind(await sha256(token)).first();
  if (!inv || inv.used || inv.expires_at < agora() || inv.status === 'inativo') throw new HttpError(410, 'Link expirado ou já usado. Peça um novo ao administrador.');
  return inv;
}
rota('GET', '/api/invite/:token', null, async (c) => {
  const inv = await conviteValido(c.env, c.params.token);
  return json({ name: inv.name, email: inv.email, expires_at: inv.expires_at });
});
rota('POST', '/api/invite/:token', null, async (c) => {
  const inv = await conviteValido(c.env, c.params.token);
  const b = await corpo(c.req);
  if (!senhaValida(b.password)) throw new HttpError(400, 'A senha precisa de 10 caracteres, com letras e números.');
  const salt = tokenAleatorio(16);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET pw_hash = ?, pw_salt = ?, status = 'ativo' WHERE id = ?").bind(await hashSenha(b.password, salt), salt, inv.user_id),
    c.env.DB.prepare('UPDATE invites SET used = 1 WHERE user_id = ?').bind(inv.user_id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(inv.user_id)
  ]);
  return json({ ok: true }, 200, { 'set-cookie': await criarSessao(c.env, inv.user_id) });
});

// ---- usuarios (admin) ----
rota('GET', '/api/users', 'admin', async (c) => {
  const d = diaBR(), mes = d.slice(0, 7);
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
       COALESCE((SELECT count FROM usage WHERE user_id = u.id AND day = ?), 0) AS hoje,
       COALESCE((SELECT SUM(count) FROM usage WHERE user_id = u.id AND substr(day,1,7) = ?), 0) AS mes,
       (SELECT MAX(expires_at) FROM invites WHERE user_id = u.id AND used = 0) AS convite_ate
     FROM users u ORDER BY u.status = 'inativo', u.name`).bind(d, mes).all();
  return json({ users: results });
});
rota('POST', '/api/users', 'admin', async (c) => {
  const b = await corpo(c.req);
  const email = String(b.email || '').trim().toLowerCase();
  if (!b.name || !emailValido(email)) throw new HttpError(400, 'Informe nome e um e-mail ' + DOMINIO + '.');
  const role = b.role === 'admin' ? 'admin' : 'analista';
  const ex = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (ex) throw new HttpError(409, 'Já existe um usuário com esse e-mail.');
  const r = await c.env.DB.prepare("INSERT INTO users (name, email, role, status, created_at) VALUES (?, ?, ?, 'convite', ?)")
    .bind(String(b.name).trim(), email, role, agora()).run();
  return json({ id: r.meta.last_row_id, ...(await novoConvite(c.env, r.meta.last_row_id, c.url.origin)) });
});
rota('POST', '/api/users/:id/invite', 'admin', async (c) => {
  const u = await c.env.DB.prepare('SELECT id, status FROM users WHERE id = ?').bind(c.params.id).first();
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  if (u.status === 'inativo') throw new HttpError(400, 'Reative o usuário antes de gerar o link.');
  return json(await novoConvite(c.env, u.id, c.url.origin));
});
rota('PATCH', '/api/users/:id', 'admin', async (c) => {
  const b = await corpo(c.req);
  const id = Number(c.params.id);
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  if (id === c.user.id && (b.role === 'analista' || b.status === 'inativo')) throw new HttpError(400, 'Você não pode remover o próprio acesso de administrador.');
  if (b.role && ['admin', 'analista'].includes(b.role)) await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role, id).run();
  if (b.status === 'inativo') {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET status = 'inativo' WHERE id = ?").bind(id),
      c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
      c.env.DB.prepare('UPDATE invites SET used = 1 WHERE user_id = ?').bind(id)
    ]);
  } else if (b.status === 'reativar') {
    await c.env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(u.pw_hash ? 'ativo' : 'convite', id).run();
  }
  return json({ ok: true });
});

// ---- configuracao da IA, limites e relatorio (admin) ----
rota('GET', '/api/config', 'admin', async (c) => {
  const cfg = await lerConfig(c.env);
  const { results } = await c.env.DB.prepare(
    'SELECT l.at, l.change, u.name FROM config_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 30').all();
  return json({ config: cfg, chaveConfigurada: !!c.env.OPENROUTER_API_KEY, log: results });
});
rota('PUT', '/api/config', 'admin', async (c) => {
  const b = await corpo(c.req);
  const cfg = await lerConfig(c.env);
  const campos = ['ai_provider', 'ai_url', 'ai_model', 'ai_fallback', 'ai_mask', 'ai_bloqueia', 'limits_enabled', 'limit_user', 'limit_total'];
  const mud = [];
  campos.forEach((k) => {
    if (b[k] === undefined) return;
    let v = b[k];
    if (k === 'limit_user' || k === 'limit_total') v = Math.max(0, parseInt(v, 10) || 0);
    if (k === 'ai_mask' || k === 'limits_enabled' || k === 'ai_bloqueia') v = !!v;
    if (typeof v === 'string') v = v.trim();
    if (JSON.stringify(cfg[k]) !== JSON.stringify(v)) { mud.push(k + ': ' + (cfg[k] === '' ? '(vazio)' : cfg[k]) + ' → ' + (v === '' ? '(vazio)' : v)); cfg[k] = v; }
  });
  if (!['openrouter', 'anthropic', 'azure', 'openai'].includes(cfg.ai_provider)) throw new HttpError(400, 'Provedor inválido.');
  if (b.report) {
    const r = b.report;
    ['title', 'subtitle', 'footer', 'orientation', 'color'].forEach((k) => { if (typeof r[k] === 'string') cfg.report[k] = r[k].slice(0, 200); });
    if (r.include) Object.keys(cfg.report.include).forEach((k) => { if (r.include[k] !== undefined) cfg.report.include[k] = !!r.include[k]; });
    mud.push('Configuração do relatório atualizada');
  }
  await gravarConfig(c.env, 'app', cfg);
  if (mud.length) await logConfig(c.env, c.user.id, mud.join('; '));
  return json({ config: cfg });
});
rota('POST', '/api/config/test', 'admin', async (c) => {
  const cfg = await lerConfig(c.env);
  try {
    const r = await chamarIA(cfg, c.env, 'Responda apenas com a palavra OK.', 'Teste de conexão.');
    cfg.ai_last_test = agora();
    await gravarConfig(c.env, 'app', cfg);
    return json({ ok: true, modelo: r.modelo, resposta: r.texto.slice(0, 80), aviso: r.aviso || '' });
  } catch (e) {
    return json({ ok: false, error: e.message }, 502);
  }
});

// ---- conferencias automaticas (admin) ----
rota('GET', '/api/checks', 'user', async (c) => json({ checks: (await lerConfig(c.env, 'checks')) || [] }));
rota('PUT', '/api/checks', 'admin', async (c) => {
  const b = await corpo(c.req);
  if (!Array.isArray(b.checks)) throw new HttpError(400, 'Lista inválida.');
  const lista = b.checks.map((x) => ({ id: String(x.id), active: x.active !== false, severity: x.severity === 'R' ? 'R' : 'B',
    mode: x.mode === 'aviso' ? 'aviso' : 'bloqueia', params: x.params || undefined }));
  await gravarConfig(c.env, 'checks', lista);
  await logConfig(c.env, c.user.id, 'Conferências automáticas atualizadas');
  return json({ ok: true });
});

// ---- manual de padroes ----
rota('GET', '/api/manual', 'user', async (c) => {
  const vig = await c.env.DB.prepare("SELECT * FROM manual_versions WHERE status = 'vigente' ORDER BY id DESC LIMIT 1").first();
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.version, m.effective_date, m.summary, m.status, m.created_at, u.name AS autor,
            json_array_length(m.rules) AS regras
     FROM manual_versions m LEFT JOIN users u ON u.id = m.created_by ORDER BY m.id DESC`).all();
  return json({ vigente: vig ? { ...vig, rules: JSON.parse(vig.rules) } : null, versoes: results });
});
rota('GET', '/api/manual/:id', 'admin', async (c) => {
  const m = await c.env.DB.prepare('SELECT * FROM manual_versions WHERE id = ?').bind(c.params.id).first();
  if (!m) throw new HttpError(404, 'Versão não encontrada.');
  return json({ ...m, rules: JSON.parse(m.rules) });
});
rota('POST', '/api/manual', 'admin', async (c) => {
  const b = await corpo(c.req);
  if (!b.version || !Array.isArray(b.rules) || !b.rules.length) throw new HttpError(400, 'Informe a versão e as regras.');
  const regras = b.rules.map((r) => ({
    code: String(r.code).slice(0, 20), text: String(r.text).slice(0, 2000), sev: r.sev === 'R' ? 'R' : 'B',
    chapter: String(r.chapter || ''), section: String(r.section || '').slice(0, 80), aval: ['auto', 'ia', 'checklist', 'nao'].includes(r.aval) ? r.aval : 'ia'
  }));
  const status = b.draft ? 'rascunho' : 'vigente';
  const stmts = [c.env.DB.prepare("DELETE FROM manual_versions WHERE status = 'rascunho'")];
  if (!b.draft) stmts.push(c.env.DB.prepare("UPDATE manual_versions SET status = 'arquivada' WHERE status = 'vigente'"));
  stmts.push(c.env.DB.prepare('INSERT INTO manual_versions (version, effective_date, summary, status, rules, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(String(b.version).slice(0, 20), b.effective_date || diaBR(), String(b.summary || '').slice(0, 500), status, JSON.stringify(regras), c.user.id, agora()));
  await c.env.DB.batch(stmts);
  if (!b.draft) await logConfig(c.env, c.user.id, 'Manual v' + b.version + ' publicado (' + regras.length + ' regras)');
  return json({ ok: true, status });
});

// ---- orientacoes do CoE para a IA ----
// Orientacoes padrao novas entram sozinhas na lista salva, exceto as que o CoE excluiu
async function lerOrientacoes(env) {
  const o = await lerConfig(env, 'orientacoes');
  if (!Array.isArray(o)) return ORIENTACOES_PADRAO;
  const removidas = (await lerConfig(env, 'orientacoes_removidas')) || [];
  const ids = new Set(o.map((x) => x.id));
  return o.concat(ORIENTACOES_PADRAO.filter((x) => !ids.has(x.id) && !removidas.includes(x.id)));
}
function limparOrientacao(o, autor) {
  return { id: String(o.id || 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).slice(0, 20),
    regras: String(o.regras || '').slice(0, 80), texto: String(o.texto || '').trim().slice(0, 600), ativa: o.ativa !== false,
    origem: String(o.origem || 'Cadastro manual').slice(0, 120), em: o.em || agora(), autor: o.autor || autor || '' };
}
rota('GET', '/api/orientacoes', 'user', async (c) => json({ orientacoes: await lerOrientacoes(c.env) }));
rota('PUT', '/api/orientacoes', 'admin', async (c) => {
  const b = await corpo(c.req);
  if (!Array.isArray(b.orientacoes)) throw new HttpError(400, 'Lista inválida.');
  const lista = b.orientacoes.map((o) => limparOrientacao(o, c.user.name)).filter((o) => o.texto).slice(0, 80);
  const ids = new Set(lista.map((o) => o.id));
  await gravarConfig(c.env, 'orientacoes_removidas', ORIENTACOES_PADRAO.map((o) => o.id).filter((id) => !ids.has(id)));
  await gravarConfig(c.env, 'orientacoes', lista);
  await logConfig(c.env, c.user.id, 'Orientações à IA atualizadas (' + lista.filter((o) => o.ativa).length + ' ativas)');
  return json({ orientacoes: lista });
});

// ---- IA na autoavaliacao ----
rota('POST', '/api/ai/evaluate', 'user', async (c) => {
  const b = await corpo(c.req);
  if (!b.system || !b.user) throw new HttpError(400, 'Prompt vazio.');
  const cfg = await lerConfig(c.env);
  if (cfg.limits_enabled) {
    const u = await usoHoje(c.env, c.user.id);
    if (u.meu >= cfg.limit_user) throw new HttpError(429, 'Você já usou as ' + cfg.limit_user + ' análises com IA de hoje. Renova à meia-noite.');
    if (u.equipe >= cfg.limit_total) throw new HttpError(429, 'A equipe atingiu o limite de ' + cfg.limit_total + ' análises com IA hoje.');
  }
  try {
    const r = await chamarIA(cfg, c.env, String(b.system).slice(0, 8000), String(b.user).slice(0, 120000));
    await registrarUso(c.env, c.user.id, false);
    return json({ texto: r.texto, modelo: r.modelo, aviso: r.aviso || '', uso: await usoHoje(c.env, c.user.id) });
  } catch (e) {
    await registrarUso(c.env, c.user.id, true);
    throw new HttpError(502, 'Falha na IA: ' + e.message);
  }
});

// ---- autoavaliacoes ----
function totais(items) {
  let b = 0, r = 0, conf = 0;
  items.forEach((i) => {
    if (i.status === 'aberto') { if (i.sev === 'B') b++; else r++; }
    if (i.status === 'confirmar') conf++;
  });
  return { b, r, conf, ready: b === 0 && conf === 0 ? 1 : 0 };
}
rota('POST', '/api/evaluations', 'user', async (c) => {
  const b = await corpo(c.req);
  if (!b.process_name || !Array.isArray(b.items)) throw new HttpError(400, 'Dados da avaliação incompletos.');
  const prev = await c.env.DB.prepare('SELECT COALESCE(MAX(round),0) AS n FROM evaluations WHERE user_id = ? AND lower(process_name) = lower(?) AND COALESCE(app_code,\'\') = ?')
    .bind(c.user.id, b.process_name, String(b.app_code || '')).first();
  const t = totais(b.items);
  const r = await c.env.DB.prepare(
    `INSERT INTO evaluations (user_id, process_name, app_code, flow_version, area, round, manual_version, with_ai, model, created_at, b_open, r_open, confirm, ready, items, risks, summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(c.user.id, String(b.process_name).slice(0, 200), String(b.app_code || ''), String(b.flow_version || ''), String(b.area || ''),
      prev.n + 1, String(b.manual_version || ''), b.with_ai ? 1 : 0, String(b.model || ''), agora(), t.b, t.r, t.conf, t.ready,
      JSON.stringify(b.items), JSON.stringify(b.risks || []), JSON.stringify(b.summary || {})).run();
  return json({ id: r.meta.last_row_id, round: prev.n + 1 });
});
rota('GET', '/api/evaluations', 'user', async (c) => {
  const todos = c.user.role === 'admin' && c.url.searchParams.get('todos') === '1';
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.process_name, e.app_code, e.flow_version, e.round, e.manual_version, e.with_ai, e.created_at, e.b_open, e.r_open, e.confirm, e.ready,
            COALESCE(e.coe_status,'rascunho') AS coe_status, e.submitted_at, e.reviewed_at, u.name AS analista
     FROM evaluations e JOIN users u ON u.id = e.user_id ${todos ? '' : 'WHERE e.user_id = ?'} ORDER BY e.id DESC LIMIT 300`)
    .bind(...(todos ? [] : [c.user.id])).all();
  return json({ evaluations: results });
});
// Fila do CoE: autoavaliacoes enviadas pelos analistas
rota('GET', '/api/coe/queue', 'admin', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.process_name, e.app_code, e.flow_version, e.round, e.manual_version, e.created_at, e.b_open, e.r_open, e.confirm, e.ready,
            e.coe_status, e.submitted_at, e.reviewed_at, e.items, u.name AS analista, r.name AS revisor
     FROM evaluations e JOIN users u ON u.id = e.user_id LEFT JOIN users r ON r.id = e.reviewer_id
     WHERE COALESCE(e.coe_status,'rascunho') <> 'rascunho' ORDER BY e.coe_status NOT IN ('enviado','em_analise'), COALESCE(e.submitted_at, e.created_at) DESC LIMIT 300`).all();
  return json({ evaluations: results.map((e) => {
    const its = JSON.parse(e.items || '[]');
    const { items, ...rest } = e;
    return { ...rest, justificados: its.filter((i) => i.just).length };
  }) });
});
async function avaliacaoDoUsuario(c) {
  const e = await c.env.DB.prepare(
    `SELECT e.*, COALESCE(e.coe_status,'rascunho') AS coe_status, u.name AS analista, r.name AS revisor
     FROM evaluations e JOIN users u ON u.id = e.user_id LEFT JOIN users r ON r.id = e.reviewer_id WHERE e.id = ?`).bind(c.params.id).first();
  if (!e || (e.user_id !== c.user.id && c.user.role !== 'admin')) throw new HttpError(404, 'Autoavaliação não encontrada.');
  return e;
}
rota('GET', '/api/evaluations/:id', 'user', async (c) => {
  const e = await avaliacaoDoUsuario(c);
  return json({ ...e, items: JSON.parse(e.items), risks: JSON.parse(e.risks || '[]'), summary: JSON.parse(e.summary || '{}'), coe_opinion: JSON.parse(e.coe_opinion || 'null') });
});
rota('PATCH', '/api/evaluations/:id', 'user', async (c) => {
  const e = await avaliacaoDoUsuario(c);
  if (e.user_id !== c.user.id) throw new HttpError(403, 'Só o analista que fez a autoavaliação pode alterá-la.');
  if (e.coe_status !== 'rascunho') throw new HttpError(409, 'Esta rodada já foi enviada ao CoE e não pode mais ser alterada. Faça uma nova rodada.');
  const b = await corpo(c.req);
  if (!Array.isArray(b.items)) throw new HttpError(400, 'Itens inválidos.');
  const t = totais(b.items);
  await c.env.DB.prepare('UPDATE evaluations SET items = ?, b_open = ?, r_open = ?, confirm = ?, ready = ? WHERE id = ?')
    .bind(JSON.stringify(b.items), t.b, t.r, t.conf, t.ready, e.id).run();
  return json({ ok: true, ...t });
});

// Itens que impedem o envio sem justificativa: bloqueante aberto ou checklist nao confirmado
const exigeJustificativa = (i) => (i.status === 'aberto' && i.sev === 'B') || i.status === 'confirmar';
const MIN_JUST = 15;
rota('POST', '/api/evaluations/:id/submit', 'user', async (c) => {
  const e = await avaliacaoDoUsuario(c);
  if (e.user_id !== c.user.id) throw new HttpError(403, 'Só o analista que fez a autoavaliação pode enviá-la.');
  if (e.coe_status !== 'rascunho') throw new HttpError(409, 'Esta rodada já foi enviada ao CoE.');
  const b = await corpo(c.req);
  const antes = JSON.parse(e.items);
  if (!Array.isArray(b.items) || b.items.length !== antes.length) throw new HttpError(400, 'Itens inválidos.');
  // o analista so altera status de checklist e a justificativa; o resto vem do banco
  const items = antes.map((i, n) => {
    const x = b.items[n] || {};
    const novo = { ...i };
    if (['confirmar', 'confirmado'].includes(i.status) && ['confirmar', 'confirmado'].includes(x.status)) { novo.status = x.status; novo.comment = x.comment || i.comment; }
    if (x.prints) novo.prints = x.prints;
    const j = String(x.just || '').trim().slice(0, 1500);
    if (j && exigeJustificativa(novo)) { novo.just = j; novo.justAt = agora(); } else delete novo.just;
    return novo;
  });
  const falta = items.filter((i) => exigeJustificativa(i) && (!i.just || i.just.length < MIN_JUST));
  if (falta.length) throw new HttpError(400, 'Justifique cada pendência bloqueante (mínimo de ' + MIN_JUST + ' caracteres): ' + falta.map((i) => i.id).join(', ') + '.');
  const t = totais(items);
  await c.env.DB.prepare("UPDATE evaluations SET items = ?, b_open = ?, r_open = ?, confirm = ?, ready = ?, coe_status = 'enviado', submitted_at = ? WHERE id = ?")
    .bind(JSON.stringify(items), t.b, t.r, t.conf, t.ready, agora(), e.id).run();
  return json({ ok: true, justificados: items.filter((i) => i.just).length });
});

// Exclusao de uma rodada (so admin): apaga tambem os prints guardados
async function apagarAvaliacao(env, id) {
  let cursor;
  do {
    const l = await env.PRINTS.list({ prefix: 'print:' + id + ':', cursor });
    await Promise.all(l.keys.map((k) => env.PRINTS.delete(k.name)));
    cursor = l.list_complete ? null : l.cursor;
  } while (cursor);
  await env.DB.prepare('DELETE FROM evaluations WHERE id = ?').bind(id).run();
}
rota('DELETE', '/api/evaluations/:id', 'admin', async (c) => {
  const e = await c.env.DB.prepare('SELECT id, process_name, round FROM evaluations WHERE id = ?').bind(c.params.id).first();
  if (!e) throw new HttpError(404, 'Autoavaliação não encontrada.');
  await apagarAvaliacao(c.env, e.id);
  await logConfig(c.env, c.user.id, 'Autoavaliação #' + e.id + ' excluída (' + e.process_name + ', rodada ' + e.round + ')');
  return json({ ok: true, excluidas: 1 });
});
// Exclui o processo inteiro: todas as rodadas, de todos os analistas, com o mesmo nome e app
rota('POST', '/api/processes/delete', 'admin', async (c) => {
  const b = await corpo(c.req);
  const nome = String(b.process_name || '').trim();
  if (!nome) throw new HttpError(400, 'Informe o processo.');
  const { results } = await c.env.DB.prepare("SELECT id FROM evaluations WHERE lower(trim(process_name)) = lower(?) AND COALESCE(app_code,'') = ?")
    .bind(nome, String(b.app_code || '')).all();
  for (const r of results) await apagarAvaliacao(c.env, r.id);
  await logConfig(c.env, c.user.id, 'Processo excluído: ' + nome + (b.app_code ? ' (app ' + b.app_code + ')' : '') + ', ' + results.length + ' rodada(s)');
  return json({ ok: true, excluidas: results.length });
});

// CoE abriu a rodada enviada: passa para "Em analise" (o analista acompanha pela barra de progresso)
rota('POST', '/api/evaluations/:id/start-review', 'admin', async (c) => {
  const r = await c.env.DB.prepare("UPDATE evaluations SET coe_status = 'em_analise', review_started_at = ?, reviewer_id = ? WHERE id = ? AND coe_status = 'enviado'")
    .bind(agora(), c.user.id, c.params.id).run();
  return json({ ok: true, mudou: r.meta.changes > 0 });
});
// Analista viu a decisao do CoE
rota('POST', '/api/evaluations/:id/seen', 'user', async (c) => {
  await c.env.DB.prepare('UPDATE evaluations SET analyst_seen_at = ? WHERE id = ? AND user_id = ? AND analyst_seen_at IS NULL').bind(agora(), c.params.id, c.user.id).run();
  return json({ ok: true });
});

const DECISOES_ITEM = ['aceito', 'ressalva', 'nao_aceito'];
const DECISOES_GERAIS = ['aprovado', 'aprovado_ressalva', 'devolvido'];
rota('POST', '/api/evaluations/:id/review', 'admin', async (c) => {
  const e = await avaliacaoDoUsuario(c);
  if (e.coe_status === 'rascunho') throw new HttpError(409, 'O analista ainda não enviou esta rodada ao CoE.');
  const b = await corpo(c.req);
  if (!DECISOES_GERAIS.includes(b.decisao)) throw new HttpError(400, 'Escolha a decisão: aprovado, aprovado com ressalva ou devolvido.');
  const items = JSON.parse(e.items);
  const dec = b.itens || {};
  Object.keys(dec).forEach((k) => {
    const i = items[Number(k)], d = dec[k] || {};
    if (!i) return;
    const instr = String(d.instrucao || '').trim().slice(0, 1500);
    if (!DECISOES_ITEM.includes(d.decisao) && !instr) { delete i.coe; return; }
    i.coe = { decisao: DECISOES_ITEM.includes(d.decisao) ? d.decisao : 'aceito', instrucao: instr, por: c.user.name, em: agora() };
  });
  // itens justificados precisam de decisao
  const semDecisao = items.filter((i) => i.just && !i.coe);
  if (semDecisao.length) throw new HttpError(400, 'Decida as justificativas de: ' + semDecisao.map((i) => i.id).join(', ') + '.');
  const nao = items.filter((i) => i.coe && i.coe.decisao === 'nao_aceito').length;
  const ress = items.filter((i) => i.coe && i.coe.decisao === 'ressalva').length;
  if (nao && b.decisao !== 'devolvido') throw new HttpError(400, 'Há justificativa não aceita: a decisão precisa ser "Devolvido para correção".');
  if (ress && b.decisao === 'aprovado') throw new HttpError(400, 'Há item aceito com ressalva: use "Aprovado com ressalva" ou "Devolvido para correção".');
  const parecer = String(b.parecer || '').trim().slice(0, 4000);
  if (b.decisao !== 'aprovado' && parecer.length < 10) throw new HttpError(400, 'Escreva o parecer do CoE com as instruções para o analista.');
  const opinion = { decisao: b.decisao, parecer, por: c.user.name, em: agora() };
  await c.env.DB.prepare('UPDATE evaluations SET items = ?, coe_status = ?, coe_opinion = ?, reviewed_at = ?, reviewer_id = ?, analyst_seen_at = NULL, review_started_at = COALESCE(review_started_at, ?) WHERE id = ?')
    .bind(JSON.stringify(items), b.decisao, JSON.stringify(opinion), agora(), c.user.id, agora(), e.id).run();
  // decisoes que o CoE quer que a IA siga daqui em diante
  const novas = (Array.isArray(b.orientacoes) ? b.orientacoes : []).map((o) => limparOrientacao({
    ...o, origem: 'Decisão na avaliação de ' + e.process_name + ' (rodada ' + e.round + ')' }, c.user.name)).filter((o) => o.texto);
  if (novas.length) {
    const lista = (await lerOrientacoes(c.env)).concat(novas).slice(-80);
    await gravarConfig(c.env, 'orientacoes', lista);
    await logConfig(c.env, c.user.id, novas.length + ' orientação(ões) à IA criadas a partir da avaliação #' + e.id);
  }
  return json({ ok: true, orientacoesCriadas: novas.length });
});

// ---- prints de evidencia (KV) ----
rota('POST', '/api/evaluations/:id/prints', 'user', async (c) => {
  const e = await avaliacaoDoUsuario(c);
  if (e.user_id !== c.user.id) throw new HttpError(403, 'Sem permissão.');
  const tipo = c.req.headers.get('content-type') || '';
  if (!/^image\/(png|jpeg)$/.test(tipo)) throw new HttpError(400, 'Envie PNG ou JPG.');
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_IMG) throw new HttpError(413, 'Imagem acima de 1 MB.');
  const item = (c.url.searchParams.get('item') || 'geral').replace(/[^\w.-]/g, '').slice(0, 30);
  const k = `print:${e.id}:${item}:${tokenAleatorio(6)}`;
  await c.env.PRINTS.put(k, buf, { metadata: { type: tipo, name: (c.url.searchParams.get('name') || 'print').slice(0, 80) } });
  return json({ key: k });
});
rota('GET', '/api/prints/:key', 'user', async (c) => {
  const k = decodeURIComponent(c.params.key);
  const m = /^print:(\d+):/.exec(k);
  if (!m) throw new HttpError(404, 'Não encontrado.');
  c.params.id = m[1];
  await avaliacaoDoUsuario(c);
  const v = await c.env.PRINTS.getWithMetadata(k, 'arrayBuffer');
  if (!v.value) throw new HttpError(404, 'Não encontrado.');
  return new Response(v.value, { headers: { 'content-type': (v.metadata && v.metadata.type) || 'image/png', 'cache-control': 'private, max-age=3600' } });
});

// ---- logos do relatorio ----
rota('PUT', '/api/logo/:n', 'admin', async (c) => {
  const n = c.params.n;
  if (n !== '1' && n !== '2') throw new HttpError(400, 'Logo 1 ou 2.');
  if ((c.req.headers.get('content-type') || '') !== 'image/png') throw new HttpError(400, 'A logo precisa ser PNG.');
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_IMG) throw new HttpError(413, 'Logo acima de 1 MB.');
  await c.env.PRINTS.put('logo:' + n, buf);
  const cfg = await lerConfig(c.env);
  cfg.report.logos[n] = true;
  await gravarConfig(c.env, 'app', cfg);
  await logConfig(c.env, c.user.id, 'Logo ' + n + ' do relatório atualizada');
  return json({ ok: true });
});
rota('DELETE', '/api/logo/:n', 'admin', async (c) => {
  await c.env.PRINTS.delete('logo:' + c.params.n);
  const cfg = await lerConfig(c.env);
  cfg.report.logos[c.params.n] = false;
  await gravarConfig(c.env, 'app', cfg);
  return json({ ok: true });
});
rota('GET', '/api/logo/:n', 'user', async (c) => {
  const v = await c.env.PRINTS.get('logo:' + c.params.n, 'arrayBuffer');
  if (!v) return new Response(null, { status: 404 });
  return new Response(v, { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' } });
});
rota('GET', '/api/report-config', 'user', async (c) => json({ report: (await lerConfig(c.env)).report }));

// ---- relatorios (admin) ----
rota('GET', '/api/reports', 'admin', async (c) => {
  const q = c.url.searchParams;
  const tipo = q.get('tipo') || 'processos';
  if (tipo === 'uso') {
    const { results } = await c.env.DB.prepare(
      `SELECT u.name AS analista, u.email, COALESCE(SUM(g.count),0) AS analises, COALESCE(SUM(g.failures),0) AS falhas, COUNT(g.day) AS dias
       FROM users u LEFT JOIN usage g ON g.user_id = u.id AND g.day BETWEEN ? AND ? GROUP BY u.id ORDER BY analises DESC`)
      .bind(q.get('de') || '2000-01-01', q.get('ate') || '2999-12-31').all();
    return json({ tipo, linhas: results });
  }
  const { cond, args } = filtrosRelatorio(q);
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.process_name, e.app_code, e.area, e.round, e.manual_version, e.created_at, e.b_open, e.r_open, e.confirm, e.ready,
            COALESCE(e.coe_status,'rascunho') AS coe_status, u.name AS analista
       ${tipo === 'processos' ? '' : ', e.items'}
     FROM evaluations e JOIN users u ON u.id = e.user_id WHERE ${cond.join(' AND ')} ORDER BY e.created_at DESC LIMIT 1000`).bind(...args).all();
  return relatorioLinhas(q, tipo, results);
});
function filtrosRelatorio(q, semUltima) {
  const de = q.get('de') || '2000-01-01', ate = (q.get('ate') || '2999-12-31') + 'T23:59:59Z';
  const cond = ['e.created_at BETWEEN ? AND ?'], args = [de, ate];
  if (q.get('processo')) { cond.push('e.process_name = ?'); args.push(q.get('processo')); }
  if (q.get('area')) { cond.push("COALESCE(NULLIF(e.area,''),'Não informada') = ?"); args.push(q.get('area')); }
  if (q.get('analista')) { cond.push('e.user_id = ?'); args.push(q.get('analista')); }
  if (q.get('manual')) { cond.push('e.manual_version = ?'); args.push(q.get('manual')); }
  if (q.get('situacao') === 'pronto') cond.push('e.ready = 1');
  if (q.get('situacao') === 'corrigir') cond.push('e.ready = 0');
  if (['rascunho', 'enviado', 'em_analise', 'aprovado', 'aprovado_ressalva', 'devolvido'].includes(q.get('coe'))) { cond.push("COALESCE(e.coe_status,'rascunho') = ?"); args.push(q.get('coe')); }
  if (!semUltima && q.get('ultima') !== '0') cond.push(`e.id = (SELECT MAX(x.id) FROM evaluations x WHERE x.user_id = e.user_id AND lower(x.process_name) = lower(e.process_name) AND COALESCE(x.app_code,'') = COALESCE(e.app_code,''))`);
  return { cond, args };
}
function relatorioLinhas(q, tipo, results) {
  if (tipo === 'processos') return json({ tipo, linhas: results });
  const sev = q.get('severidade'), cap = q.get('capitulo');
  const filtra = (i) => (!sev || i.sev === sev) && (!cap || capitulo(i.rule) === cap);
  if (tipo === 'regras') {
    const agg = {};
    results.forEach((e) => JSON.parse(e.items).filter((i) => i.status === 'aberto' && filtra(i)).forEach((i) => {
      const k = i.rule + '|' + i.item;
      if (!agg[k]) agg[k] = { regra: i.rule, item: i.item, severidade: i.sev, ocorrencias: 0, processos: new Set() };
      agg[k].ocorrencias++; agg[k].processos.add(e.process_name);
    }));
    const linhas = Object.values(agg).map((a) => ({ ...a, processos: [...a.processos].join(', ') })).sort((a, b) => b.ocorrencias - a.ocorrencias);
    return json({ tipo, linhas });
  }
  const linhas = [];
  results.forEach((e) => JSON.parse(e.items).filter(filtra).forEach((i) => linhas.push({
    eval_id: e.id, processo: e.process_name, rodada: e.round, analista: e.analista, data: e.created_at, regra: i.rule, item: i.item, origem: i.origin,
    severidade: i.sev, status: i.status, comentario: i.comment, justificativa: i.just || '',
    decisao_coe: i.coe ? i.coe.decisao : '', instrucao_coe: i.coe ? i.coe.instrucao : ''
  })));
  return json({ tipo: 'itens', linhas });
}

// Painel grafico: agregados das autoavaliacoes no periodo (todas as rodadas)
rota('GET', '/api/reports/painel', 'admin', async (c) => {
  const q = c.url.searchParams;
  const { cond, args } = filtrosRelatorio(q, true);
  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.user_id, e.process_name, e.app_code, COALESCE(NULLIF(e.area,''),'Não informada') AS area, e.round, e.created_at, e.b_open, e.items,
            COALESCE(e.coe_status,'rascunho') AS coe_status, u.name AS analista, r.name AS revisor
     FROM evaluations e JOIN users u ON u.id = e.user_id LEFT JOIN users r ON r.id = e.reviewer_id
     WHERE ${cond.join(' AND ')} ORDER BY e.id LIMIT 2000`).bind(...args).all();
  const sev = q.get('severidade'), cap = q.get('capitulo');
  const chaveProc = (e) => e.process_name.trim().toLowerCase() + '|' + (e.app_code || '');
  const nomeProc = {}, rodadas = {}, ultima = {}, porAnalista = {}, porAvaliador = {}, porArea = {}, regras = {};
  const somaSet = (m, k, v) => { (m[k] = m[k] || new Set()).add(v); };
  results.forEach((e) => {
    const p = chaveProc(e);
    nomeProc[p] = e.process_name;
    rodadas[p] = Math.max(rodadas[p] || 0, e.round);
    ultima[p] = e; // ordenado por id: fica a mais recente
    somaSet(porAnalista, e.analista, p);
    somaSet(porArea, e.area, p);
    if (e.revisor) somaSet(porAvaliador, e.revisor, p);
    JSON.parse(e.items || '[]').forEach((i) => {
      const reprovado = (i.status === 'aberto' && i.sev === 'B') || (i.coe && i.coe.decisao === 'nao_aceito');
      if (!reprovado || (sev && i.sev !== sev) || (cap && capitulo(i.rule) !== cap)) return;
      const k = i.rule;
      const r = regras[k] = regras[k] || { regra: i.rule, item: i.item, ocorrencias: 0, processos: new Set() };
      r.ocorrencias++; r.processos.add(e.process_name);
    });
  });
  const ord = (m) => Object.entries(m).map(([k, v]) => ({ rotulo: k, valor: v.size })).sort((a, b) => b.valor - a.valor);
  const situacao = {};
  Object.values(ultima).forEach((e) => { situacao[e.coe_status] = (situacao[e.coe_status] || 0) + 1; });
  const procs = Object.keys(rodadas);
  const aprov = Object.values(ultima).filter((e) => e.coe_status === 'aprovado' || e.coe_status === 'aprovado_ressalva');
  return json({
    kpis: {
      avaliacoes: results.length, processos: procs.length,
      mediaRodadas: procs.length ? Math.round(procs.reduce((a, p) => a + rodadas[p], 0) / procs.length * 10) / 10 : 0,
      aprovados: aprov.length, aguardando: (situacao.enviado || 0) + (situacao.em_analise || 0), devolvidos: situacao.devolvido || 0
    },
    regras: Object.values(regras).map((r) => ({ regra: r.regra, item: r.item, ocorrencias: r.ocorrencias, processos: r.processos.size, lista: [...r.processos].slice(0, 6).join(', ') }))
      .sort((a, b) => b.ocorrencias - a.ocorrencias).slice(0, 12),
    rodadas: procs.map((p) => ({ rotulo: nomeProc[p], valor: rodadas[p], situacao: ultima[p].coe_status })).sort((a, b) => b.valor - a.valor).slice(0, 15),
    analistas: ord(porAnalista), avaliadores: ord(porAvaliador), areas: ord(porArea),
    situacao: ['rascunho', 'enviado', 'em_analise', 'aprovado', 'aprovado_ressalva', 'devolvido'].map((k) => ({ rotulo: k, valor: situacao[k] || 0 }))
  });
});
function capitulo(rule) {
  const r = String(rule || '');
  if (/^[0-9]/.test(r)) return r[0];
  return { P: '1', F: '2', S: '3', I: '4', R: '5', E: '6', V: '7' }[r[0]] || '';
}
rota('GET', '/api/reports/filters', 'admin', async (c) => {
  const p = await c.env.DB.prepare('SELECT DISTINCT process_name FROM evaluations ORDER BY process_name').all();
  const u = await c.env.DB.prepare('SELECT id, name FROM users ORDER BY name').all();
  const m = await c.env.DB.prepare('SELECT DISTINCT manual_version FROM evaluations ORDER BY manual_version').all();
  const a = await c.env.DB.prepare("SELECT DISTINCT COALESCE(NULLIF(area,''),'Não informada') AS area FROM evaluations ORDER BY 1").all();
  return json({ processos: p.results.map((x) => x.process_name), analistas: u.results, manuais: m.results.map((x) => x.manual_version), areas: a.results.map((x) => x.area) });
});

// ---- uso e backup (admin) ----
rota('GET', '/api/admin/usage', 'admin', async (c) => {
  const d = diaBR();
  const t = await c.env.DB.prepare('SELECT COALESCE(SUM(count),0) AS analises, COALESCE(SUM(failures),0) AS falhas FROM usage WHERE day = ?').bind(d).first();
  const a = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'ativo'").first();
  return json({ dia: d, analises: t.analises, falhas: t.falhas, ativos: a.n });
});
rota('GET', '/api/admin/backup', 'admin', async (c) => {
  const tab = async (sql) => (await c.env.DB.prepare(sql).all()).results;
  const dados = {
    exportado_em: agora(), observacao: 'Senhas não são exportadas. Após restaurar, gere novos links de convite.',
    users: await tab('SELECT id, name, email, role, status, created_at FROM users'),
    manual_versions: await tab('SELECT * FROM manual_versions'),
    evaluations: await tab('SELECT * FROM evaluations'),
    usage: await tab('SELECT * FROM usage'),
    config: await tab('SELECT * FROM config'),
    config_log: await tab('SELECT * FROM config_log')
  };
  return new Response(JSON.stringify(dados, null, 1), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="backup-coe-autoavaliacao-${diaBR()}.json"` }
  });
});

/* ------------------------------ despacho ------------------------------ */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/setup') return Response.redirect(url.origin + '/#/setup', 302);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      await garantirEsquema(env);
      // Protecao contra requisicoes de outros sites
      if (req.method !== 'GET') {
        const origem = req.headers.get('origin');
        if (origem && origem !== url.origin) throw new HttpError(403, 'Origem não permitida.');
      }
      for (const r of rotas) {
        if (r.metodo !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = {};
        r.nomes.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
        const c = { req, env, url, params, user: null };
        if (r.papel) {
          c.user = await usuarioDaSessao(req, env);
          if (!c.user) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
          if (r.papel === 'admin' && c.user.role !== 'admin') throw new HttpError(403, 'Acesso restrito ao CoE.');
        }
        return await r.fn(c);
      }
      return erro(404, 'Rota não encontrada.');
    } catch (e) {
      if (e instanceof HttpError) return erro(e.status, e.message);
      console.error(e);
      return erro(500, 'Erro interno: ' + (e.message || e));
    }
  }
};
