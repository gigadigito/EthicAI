--- Remove a Migração 
Remove-Migration

--- Adiciona migração de nome Initial
Add-Migration EthicAIMigration -verbose


--- Aplica as alteração do migration para o banco de dados.
Update-Database -verbose


-- Zerar o Banco de Dados.
Update-Database 0


-- Atualizar Banco de Dados.
Update-Database 