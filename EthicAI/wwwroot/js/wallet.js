

solicitar_wallet = function (a) {
    // Solicitar permiss�o para acessar a carteira
    //alert("solicitou");
    ethereum.request({ method: 'eth_requestAccounts' })
        .then(accounts => {
            const userAddress = accounts[0];
            console.log('Endere�o do usu�rio:', userAddress);
            // Continue com suas opera��es ap�s a conex�o
        })
        .catch(error => {
            console.error(error);
        });

 }

//alert("carregou Wallet");

