--- Remove a Migra��o 
Remove-Migration

--- Adiciona migra��o de nome Initial
Add-Migration EthicAIMigration -verbose


--- Aplica as altera��o do migration para o banco de dados.
Update-Database -verbose


-- Zerar o Banco de Dados.
Update-Database 0


-- Atualizar Banco de Dados.
Update-Database 