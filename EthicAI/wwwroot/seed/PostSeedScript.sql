-- Script de seed para posts
INSERT INTO post (Title, Content, PostDate, Image, PostCategoryId) VALUES (
'teste',
'<p>teste</p>',
'2024-10-31 22:54:12',
(SELECT BulkColumn FROM Openrowset(Bulk 'C:\Users\PCMasterSound\source\repos\EthicAI\EthicAI\wwwroot\seed\5_image.png', Single_Blob) as img),
2
);
