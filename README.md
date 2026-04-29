# Extensao Tarefario - Abas de Cards

Extensao para Chrome e Edge que adiciona duas abas na pagina do Tarefario:

- Meus: mostra todos os cards que nao sao do tipo Code Review.
- Code Review: mostra apenas os cards do tipo Code Review.
- Ocultos: mostra apenas os cards marcados manualmente como ocultos.

Tambem adiciona um menu de opcoes em cada card (icone de 3 bolinhas ao lado do status)
com checkbox para ocultar ou remover o status de oculto.
Os cards ocultos ficam salvos no localStorage e continuam marcados apos recarregar a pagina.
Quando um card e marcado como oculto, ele deixa de aparecer na aba Meus com animacao de saida.

## Como instalar (modo desenvolvedor)

1. Abra o navegador:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
2. Ative o Modo do desenvolvedor.
3. Clique em Carregar sem compactacao.
4. Selecione a pasta desta extensao (`better-tarefario-extension`).

## Como usar

1. Acesse https://tarefario.dtigab.com.br/.
2. As abas serao exibidas acima dos cards.
3. Clique em Meus, Code Review ou Ocultos para alternar a visualizacao.
4. Em cada card, clique no icone de 3 bolinhas ao lado do status.
5. No menu flutuante, marque o checkbox Ocultar para adicionar na aba Ocultos.

## Observacoes tecnicas

- A identificacao de Code Review usa a classe `status-code-review` e tambem o texto do badge, para maior compatibilidade.
- A aba ativa fica salva no navegador e e restaurada ao recarregar a pagina.