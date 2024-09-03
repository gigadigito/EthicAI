

solicitar_wallet = function (a) {
    // Solicitar permissão para acessar a carteira
    //alert("solicitou");
    ethereum.request({ method: 'eth_requestAccounts' })
        .then(accounts => {
            const userAddress = accounts[0];
            console.log('Endereço do usuário:', userAddress);
            // Continue com suas operações após a conexão
        })
        .catch(error => {
            console.error(error);
        });

 }

//alert("carregou Wallet");

