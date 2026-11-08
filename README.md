# App de Autoavaliação CoE Zeev

Aplicativo para a equipe de Automação da Vitru avaliar um fluxo da Zeev contra o **Manual de Padrões Zeev** antes de enviá-lo ao CoE.

Roda inteiro no plano gratuito do Cloudflare (Workers + D1 + KV), com IA pelo OpenRouter (modelo configurável na tela do admin).

## Estrutura

| Arquivo | O que é |
| --- | --- |
| `wrangler.toml` | Configuração do Cloudflare. **Cole aqui o Database ID do D1 e o ID do KV** |
| `schema.sql` | Tabelas do banco. Executar uma vez no console do D1 |
| `src/worker.js` | Servidor: login, convites, IA com limite diário, manual, autoavaliações, relatórios, backup |
| `public/` | Telas do app (HTML, CSS e JavaScript, sem etapa de build) |
| `public/js/evaluator.js` | Motor de avaliação: lê o export .xls da Zeev, o diagrama (.svg/.json), scripts e CSS, e roda as conferências automáticas |
| `public/vendor/` | Bibliotecas usadas no navegador: ExcelJS (Excel), jsPDF + AutoTable (PDF), Mammoth (leitura do Word do manual) |
| `package.json` | Versão do Wrangler usada na publicação pelo Cloudflare |

## Segredos (painel do Cloudflare > Worker > Settings > Variables and Secrets, tipo Secret)

- `OPENROUTER_API_KEY`: chave da IA (OpenRouter, ou do provedor escolhido na tela "IA, uso e limites").
- `BOOTSTRAP_TOKEN`: senha temporária para criar o primeiro administrador em `/setup`.

## Primeiro uso

1. Abra `https://<endereço>/setup` e crie o administrador.
2. Em **IA, uso e limites**: teste a conexão e cadastre os analistas (o app gera o link de convite, válido por 48 h).
3. Em **Padrões do manual**: envie o Word do manual, revise as regras e publique.

O passo a passo completo está no Guia de implantação.

## Como as regras são avaliadas

Cada regra do manual tem uma forma de avaliação, ajustável pelo CoE em **Padrões do manual > Ajustar avaliação das regras**:

- **Automática**: conferida por código (15 conferências, lista em "Conferências automáticas").
- **IA**: enviada ao modelo junto com nomes de tarefas, campos, anotações e cabeçalhos de scripts (IDs, URLs e e-mails mascarados).
- **Checklist**: o analista confirma ou anexa print (itens que nenhum arquivo comprova).
- **Não avaliar**: visual ou etapa do próprio CoE.

## Segurança

- Usuários só com e-mail `@vitru.com.br`; senhas com PBKDF2-SHA256 e sal; sessão em cookie HttpOnly de 12 h.
- Rotas de administração restritas ao perfil Admin CoE; usuários desativados perdem a sessão na hora.
- A chave da IA fica só nos segredos do Cloudflare; nunca no código nem no navegador.
- Os arquivos do processo são lidos no navegador; o servidor guarda apenas o resultado da avaliação e os prints anexados.
