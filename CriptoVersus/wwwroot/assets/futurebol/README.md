# Futurebol assets

Esta prova de conceito não depende de assets externos: campo, bola e jogadores são criados com primitivas do Babylon.js e texturas de texto geradas em memória.

Uma futura implementação com modelos GLB deve manter os arquivos neste diretório e trocar somente a implementação de `FuturebolPlayerVisualFactory`. O estado da partida e o motor não dependem da geometria usada pelo renderer.
